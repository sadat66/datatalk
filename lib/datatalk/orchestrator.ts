import { buildConversationContext } from "@/lib/datatalk/query-intelligence";
import {
  CHAT_RESULT_PAGE_SIZE,
  executeReadonlySelect,
  explainValidateReadonlySelect,
  isExplainValidateEnabled,
} from "@/lib/datatalk/executor";
import {
  getConfidenceRunThreshold,
  isIntentVerifierEnabled,
  verifySqlAgainstIntent,
} from "@/lib/datatalk/intent-verifier";
import { type LlmPipelineResult, type TrustReport } from "@/lib/datatalk/types";
import { buildTrustReport } from "@/lib/datatalk/trust";
import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import { validateSelectSql, type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { sqlContextFollowUp } from "@/lib/datatalk/conversation-nudges";
import { critiqueNorthwindSql, isSqlCritiqueEnabled } from "@/lib/datatalk/sql-critique";
import { checkNarrativeNumericGrounding, correctNarrative } from "@/lib/datatalk/narrative-consistency";
import {
  MAX_REPAIR_ATTEMPTS,
  repairFailureMessage,
  repairSql,
  repairSqlForExplain,
  repairSqlForIntent,
  runModel,
} from "@/lib/datatalk/orchestrator-llm";
import {
  buildTrustSpecNudge,
  enforceRequestedTopN,
  isReferentialFollowUpMessage,
} from "@/lib/datatalk/query-heuristics";

type Turn = { role: "user" | "assistant"; text: string };

function isVeryShortReferentialFollowUp(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  return (
    /\bwhat about (them|those|these|it|that)\b/i.test(trimmed) ||
    /\bhow about (them|those|these|it|that)\b/i.test(trimmed) ||
    /\b(and|also) (them|those|these|it|that)\b/i.test(trimmed) ||
    /\b(same|again|as before)\b/i.test(trimmed)
  );
}

function buildIntentVerificationQuestion(turns: Turn[], latestMessage: string): string {
  const trimmed = latestMessage.trim();
  if (!trimmed) return latestMessage;
  if (!isReferentialFollowUpMessage(trimmed)) return trimmed;
  const recent = turns.slice(-4);
  if (!recent.length) return trimmed;
  const transcript = recent
    .map((t) => {
      const text = t.text.length > 320 ? `${t.text.slice(0, 320)}...` : t.text;
      return `${t.role === "user" ? "User" : "Assistant"}: ${text}`;
    })
    .join("\n");
  return `Conversation context (for resolving this short follow-up intent):
${transcript}
User: ${trimmed}`;
}

/** Trust penalty for join fan-out / grain issues — prefers AST from validateSelectSql when available. */
function joinFanoutPenalty(sql: string | null | undefined, validated?: SqlValidationResult): boolean {
  if (!sql?.trim()) return false;
  if (validated?.ok) return validated.joinFanoutTrustPenalty;
  return inferJoinFanoutTrustPenalty(sql);
}

export type OrchestratorResult = {
  assistant_message: string;
  kind: LlmPipelineResult["kind"];
  sql?: string;
  rows?: Record<string, unknown>[];
  trust: TrustReport;
  plan_summary?: string | null;
  metric_ids?: string[];
  assumptions?: string[];
  clarify_question?: string | null;
  /** Offered when trust is medium on a data-backed answer — user can confirm strict verification */
  trustUpgradeSuggestion?: string;
  /** More rows exist — client sends `resultOffset` for the next page */
  resultHasMore?: boolean;
  /** Pass as `resultOffset` on the next request to fetch the next page (15 rows) */
  resultNextOffset?: number | null;
};

async function runPaginationPage(input: {
  lastDataSql: string;
  resultOffset: number;
}): Promise<OrchestratorResult> {
  const offset = Math.max(0, input.resultOffset);
  const validation = validateSelectSql(input.lastDataSql.trim());
  if (!validation.ok) {
    const trust = buildTrustReport({
      pipeline: "validation_failed",
      validationPassed: false,
      validationDetails: validation.errors,
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: false,
      joinHeuristic: joinFanoutPenalty(input.lastDataSql),
    });
    return {
      assistant_message: "Could not re-run the previous query for pagination.",
      kind: "answer",
      trust,
      resultHasMore: false,
      resultNextOffset: null,
    };
  }

  const sql = validation.normalizedSql;
  const exec = await executeReadonlySelect(sql, {
    maxRows: CHAT_RESULT_PAGE_SIZE,
    offset,
  });

  if (!exec.ok) {
    const trust = buildTrustReport({
      pipeline: "execution_failed",
      validationPassed: true,
      validationDetails: ["Parsed SQL and allowlist checks passed."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: false,
      joinHeuristic: joinFanoutPenalty(sql, validation),
    });
    return {
      assistant_message: `Could not load the next rows: ${exec.error}`,
      kind: "answer",
      sql,
      trust,
      resultHasMore: false,
      resultNextOffset: null,
    };
  }

  const hasMore = exec.limited;
  const nextOffset = hasMore ? offset + CHAT_RESULT_PAGE_SIZE : null;
  const rangeStart = offset + (exec.rowCount > 0 ? 1 : 0);
  const rangeEnd = offset + exec.rowCount;

  const rowPreview =
    exec.rowCount === 0
      ? "No more rows for this query."
      : `Returned ${exec.rowCount} row(s) (rows ${rangeStart}–${rangeEnd} of the full result; ${CHAT_RESULT_PAGE_SIZE} per page).`;

  const narrative = "Next page of results from your previous query.";
  const narrativeGrounding = checkNarrativeNumericGrounding(narrative, exec.rows);

  const trust = buildTrustReport({
    pipeline: "data",
    validationPassed: true,
    validationDetails: ["Parsed SQL", "Allowlisted tables/columns", "Single SELECT"],
    rowCount: exec.rowCount,
    limited: exec.limited,
    executionMs: exec.ms,
    skippedExecution: false,
    hadRepair: false,
    joinHeuristic: joinFanoutPenalty(sql, validation),
    narrativeGrounding,
    strictVerification: false,
  });

  return {
    assistant_message: `${narrative}\n\n${rowPreview}\n\n${sqlContextFollowUp(sql)}`,
    kind: "answer",
    sql,
    rows: exec.rows,
    trust,
    resultHasMore: hasMore,
    resultNextOffset: nextOffset,
  };
}

export async function runOrchestrator(input: {
  turns: Turn[];
  message: string;
  /** From user-prompt keyword sweep (e.g. frustration tone). */
  toneHints?: string[];
  /** User confirmed — extra SQL critique + trust boost when checks pass */
  strictVerification?: boolean;
  /** Last assistant message `sql` from history — used if strict verification produces a query that fails at runtime */
  lastSuccessfulDataSql?: string | null;
  /** Skip LLM and fetch next page of last data SQL */
  resultOffset?: number;
  lastDataSql?: string | null;
}): Promise<OrchestratorResult> {
  if (
    (input.resultOffset ?? 0) > 0 &&
    typeof input.lastDataSql === "string" &&
    input.lastDataSql.trim().length > 0
  ) {
    return runPaginationPage({
      lastDataSql: input.lastDataSql,
      resultOffset: input.resultOffset ?? 0,
    });
  }

  const extraHints = [...(input.toneHints ?? [])];
  if (input.strictVerification) {
    extraHints.push(
      "STRICT VERIFICATION: The user asked to re-run with strict verification. Match the same analytical intent as their prior question when possible. Output one safe SELECT; the server runs an extra SQL review.",
    );
  }
  const context = buildConversationContext(input.turns, input.message, extraHints);
  const intentQuestion = buildIntentVerificationQuestion(input.turns, input.message);
  let hadRepair = false;

  const model = await runModel(context);

  if (model.kind === "clarify") {
    const trust = buildTrustReport({ pipeline: "clarify" });
    return {
      assistant_message: model.clarify_question
        ? `${model.assistant_message}\n\n${model.clarify_question}`
        : model.assistant_message,
      kind: "clarify",
      trust,
      plan_summary: model.plan_summary,
      clarify_question: model.clarify_question ?? null,
    };
  }

  if (model.kind === "refuse") {
    const trust = buildTrustReport({ pipeline: "refused" });
    return { assistant_message: model.assistant_message, kind: "refuse", trust };
  }

  let sql = typeof model.sql === "string" ? model.sql.trim() : "";
  if (!sql) {
    const trust = buildTrustReport({ pipeline: "conversational" });
    return {
      assistant_message: model.assistant_message || "I could not produce a query for that request.",
      kind: "answer",
      trust,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    };
  }

  const sqlAfterLlm = sql;
  const runSqlCritique =
    input.strictVerification || (isSqlCritiqueEnabled() && inferJoinFanoutTrustPenalty(sql));
  if (runSqlCritique) {
    try {
      const cr = await critiqueNorthwindSql({ userQuestion: input.message, sql });
      const rev = typeof cr.revised_sql === "string" ? cr.revised_sql.trim() : "";
      if (!cr.ok_to_run && rev) {
        const revVal = validateSelectSql(rev);
        if (revVal.ok) {
          sql = rev;
        }
      }
    } catch {
      /* optional second LLM; ignore */
    }
  }
  const critiqueReplacedSql = sql !== sqlAfterLlm;
  sql = enforceRequestedTopN(sql, input.message);

  let validation = validateSelectSql(sql);
  let failedValidationErrors = !validation.ok ? [...validation.errors] : [];
  if (!validation.ok) {
    const validationAttempts: { sql: string; errors: string[] }[] = [];
    let repairFailed = false;
    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
      try {
        sql = await repairSql(context, sql, validation.ok ? [] : validation.errors, validationAttempts.length > 0 ? validationAttempts : undefined);
        sql = enforceRequestedTopN(sql, input.message);
        hadRepair = true;
        validation = validateSelectSql(sql);
        if (validation.ok) break;
        validationAttempts.push({ sql, errors: [...validation.errors] });
        failedValidationErrors = [...validation.errors];
      } catch (err) {
        repairFailed = true;
        const trust = buildTrustReport({
          pipeline: "validation_failed",
          validationPassed: false,
          validationDetails: failedValidationErrors,
          rowCount: 0,
          limited: false,
          executionMs: 0,
          skippedExecution: true,
          hadRepair,
          joinHeuristic: joinFanoutPenalty(sql),
        });
        return {
          assistant_message: `I could not generate a safe query for that request. (${repairFailureMessage(err)})`,
          kind: "answer",
          trust,
        };
      }
    }
    if (!repairFailed && !validation.ok) {
      const trust = buildTrustReport({
        pipeline: "validation_failed",
        validationPassed: false,
        validationDetails: validation.errors,
        rowCount: 0,
        limited: false,
        executionMs: 0,
        skippedExecution: true,
        hadRepair,
        joinHeuristic: joinFanoutPenalty(sql),
      });
      return {
        assistant_message: `That query failed safety checks after ${MAX_REPAIR_ATTEMPTS} repair attempt(s). Please rephrase your question.`,
        kind: "answer",
        trust,
      };
    }
  }

  if (!validation.ok) {
    throw new Error("Unreachable: validation must be ok after repair loop");
  }

  if (isVeryShortReferentialFollowUp(input.message) && input.lastSuccessfulDataSql?.trim()) {
    const previousValidation = validateSelectSql(input.lastSuccessfulDataSql.trim());
    if (previousValidation.ok && previousValidation.normalizedSql === validation.normalizedSql) {
      const trust = buildTrustReport({ pipeline: "clarify" });
      return {
        assistant_message:
          "I can continue from the same customers, but this follow-up is ambiguous and would just repeat the same result. Which comparison do you want next: by order date trend, by product/category split, or by country/region?",
        kind: "clarify",
        trust,
        plan_summary: model.plan_summary,
        clarify_question:
          "Choose one: order date trend, product/category split, or country/region comparison for these same customers.",
      };
    }
  }

  let validatedSql = validation.normalizedSql;
  let explainValidated = false;
  let intentVerifierRan = false;
  let intentVerifierError = false;
  let intentConfidence: number | undefined;
  let intentAligned: boolean | undefined;

  if (isExplainValidateEnabled()) {
    let exRes = await explainValidateReadonlySelect(validatedSql);
    if (!exRes.ok) {
      const firstExplainError = exRes.error;
      const explainAttempts: { sql: string; error: string }[] = [];
      let explainRecovered = false;

      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
        try {
          const repairedSql = await repairSqlForExplain({
            context,
            previousSql: validatedSql,
            userMessage: input.message,
            explainError: exRes.error,
            priorAttempts: explainAttempts.length > 0 ? explainAttempts : undefined,
          });
          const repairedValidation = validateSelectSql(enforceRequestedTopN(repairedSql, input.message));
          if (!repairedValidation.ok) {
            explainAttempts.push({ sql: repairedSql, error: `Static validation: ${repairedValidation.errors.join("; ")}` });
            continue;
          }
          validatedSql = repairedValidation.normalizedSql;
          validation = repairedValidation;
          sql = validatedSql;
          hadRepair = true;
          exRes = await explainValidateReadonlySelect(validatedSql);
          if (exRes.ok) {
            explainRecovered = true;
            break;
          }
          explainAttempts.push({ sql: validatedSql, error: exRes.error });
        } catch (err) {
          const trust = buildTrustReport({
            pipeline: "execution_failed",
            validationPassed: true,
            validationDetails: [
              "Parsed SQL and allowlist checks passed.",
              `EXPLAIN dry-run failed: ${firstExplainError}`,
              `Automatic repair failed after ${attempt + 1} attempt(s): ${repairFailureMessage(err)}`,
            ],
            rowCount: 0,
            limited: false,
            executionMs: 0,
            skippedExecution: true,
            hadRepair,
            joinHeuristic: joinFanoutPenalty(validatedSql, validation),
          });
          return {
            assistant_message: `The query did not pass the database dry-run (EXPLAIN): ${firstExplainError}`,
            kind: "answer",
            sql: validatedSql,
            trust,
            plan_summary: model.plan_summary,
            metric_ids: model.metric_ids,
            assumptions: model.assumptions,
          };
        }
      }

      if (!explainRecovered) {
        const lastError = explainAttempts.length > 0 ? explainAttempts[explainAttempts.length - 1].error : (!exRes.ok ? exRes.error : firstExplainError);
        const trust = buildTrustReport({
          pipeline: "execution_failed",
          validationPassed: true,
          validationDetails: [
            "Parsed SQL and allowlist checks passed.",
            `EXPLAIN dry-run failed: ${lastError}`,
            `Automatic repair exhausted ${MAX_REPAIR_ATTEMPTS} attempt(s).`,
          ],
          rowCount: 0,
          limited: false,
          executionMs: 0,
          skippedExecution: true,
          hadRepair,
          joinHeuristic: joinFanoutPenalty(validatedSql, validation),
        });
        return {
          assistant_message: `The query did not pass the database dry-run (EXPLAIN): ${lastError}`,
          kind: "answer",
          sql: validatedSql,
          trust,
          plan_summary: model.plan_summary,
          metric_ids: model.metric_ids,
          assumptions: model.assumptions,
        };
      }
    }
    explainValidated = true;
  }

  if (isIntentVerifierEnabled()) {
    try {
      const iv = await verifySqlAgainstIntent({
        userQuestion: intentQuestion,
        sql: validatedSql,
      });
      if (iv == null) {
        intentVerifierError = true;
      } else {
        intentVerifierRan = true;
        intentConfidence = iv.confidence_0_100;
        intentAligned = iv.aligned;
        const threshold = getConfidenceRunThreshold();
        const shouldHold = iv.confidence_0_100 < threshold || iv.aligned === false;
        if (shouldHold) {
          let recovered = false;
          const hasFeedback = iv.mismatches.length > 0 || (iv.clarify_suggestion?.trim().length ?? 0) > 0;

          if (hasFeedback) {
            const intentAttempts: { sql: string; confidence: number; mismatches: string[] }[] = [];
            let currentSql = validatedSql;
            let currentMismatches = iv.mismatches;
            let currentConfidence = iv.confidence_0_100;
            let currentClarify = iv.clarify_suggestion;

            for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
              try {
                const repairedSql = await repairSqlForIntent({
                  context,
                  previousSql: currentSql,
                  userMessage: input.message,
                  confidence: currentConfidence,
                  mismatches: currentMismatches,
                  clarifySuggestion: currentClarify,
                  priorAttempts: intentAttempts.length > 0 ? intentAttempts : undefined,
                });
                const repairedValidation = validateSelectSql(enforceRequestedTopN(repairedSql, input.message));
                if (!repairedValidation.ok) {
                  intentAttempts.push({ sql: repairedSql, confidence: 0, mismatches: repairedValidation.errors });
                  continue;
                }
                if (isExplainValidateEnabled()) {
                  const exRes = await explainValidateReadonlySelect(repairedValidation.normalizedSql);
                  if (!exRes.ok) {
                    intentAttempts.push({ sql: repairedValidation.normalizedSql, confidence: 0, mismatches: [`EXPLAIN failed: ${exRes.error}`] });
                    continue;
                  }
                  explainValidated = true;
                }
                const repairedIv = await verifySqlAgainstIntent({
                  userQuestion: intentQuestion,
                  sql: repairedValidation.normalizedSql,
                });
                if (
                  repairedIv &&
                  repairedIv.aligned !== false &&
                  repairedIv.confidence_0_100 >= threshold
                ) {
                  validation = repairedValidation;
                  sql = repairedValidation.normalizedSql;
                  hadRepair = true;
                  intentConfidence = repairedIv.confidence_0_100;
                  intentAligned = repairedIv.aligned;
                  recovered = true;
                  break;
                }
                intentAttempts.push({
                  sql: repairedValidation.normalizedSql,
                  confidence: repairedIv?.confidence_0_100 ?? 0,
                  mismatches: repairedIv?.mismatches ?? [],
                });
                currentSql = repairedValidation.normalizedSql;
                currentConfidence = repairedIv?.confidence_0_100 ?? currentConfidence;
                currentMismatches = repairedIv?.mismatches ?? currentMismatches;
                currentClarify = repairedIv?.clarify_suggestion ?? currentClarify;
              } catch {
                break;
              }
            }
          }

          if (!recovered) {
            const clarifyQ =
              iv.clarify_suggestion?.trim() ||
              `Which interpretation should we use? (Verification confidence ${iv.confidence_0_100}% is below the ${threshold}% run threshold.)`;
            const intro = `I have not run the query against the database — intent verification scored ${iv.confidence_0_100}% confidence${iv.aligned === false ? " and flagged alignment issues" : ""} (threshold ${threshold}%).`;
            const mismatchLine =
              iv.mismatches.length > 0
                ? `Potential mismatches: ${iv.mismatches.slice(0, 5).join("; ")}`
                : "";
            const explainLine = iv.plain_explanation
              ? `Proposed SQL would: ${iv.plain_explanation}`
              : "";
            const assistant_message = [intro, mismatchLine, explainLine].filter(Boolean).join("\n\n");
            const trust = buildTrustReport({ pipeline: "clarify" });
            return {
              assistant_message: `${assistant_message}\n\n${clarifyQ}`,
              kind: "clarify",
              trust,
              plan_summary: model.plan_summary,
              clarify_question: clarifyQ,
            };
          }
        }
      }
    } catch {
      intentVerifierError = true;
    }
  }

  type OkValidation = Extract<SqlValidationResult, { ok: true }>;
  const executionAttempts: { key: "primary" | "pre_critique" | "previous_turn"; v: OkValidation }[] = [];
  const seenNorm = new Set<string>();
  const pushAttempt = (
    key: "primary" | "pre_critique" | "previous_turn",
    res: SqlValidationResult,
  ) => {
    if (!res.ok) return;
    if (seenNorm.has(res.normalizedSql)) return;
    seenNorm.add(res.normalizedSql);
    executionAttempts.push({ key, v: res });
  };
  pushAttempt("primary", validation);
  if (critiqueReplacedSql) {
    pushAttempt("pre_critique", validateSelectSql(sqlAfterLlm));
  }
  if (input.strictVerification && input.lastSuccessfulDataSql?.trim()) {
    pushAttempt("previous_turn", validateSelectSql(input.lastSuccessfulDataSql.trim()));
  }

  if (!validation.ok) {
    throw new Error("Unreachable: validation must be ok before execution");
  }

  let exec = await executeReadonlySelect(validation.normalizedSql, {
    maxRows: CHAT_RESULT_PAGE_SIZE,
    offset: 0,
  });
  const primaryExecError = exec.ok ? "" : exec.error;
  let usedAttemptKey: "primary" | "pre_critique" | "previous_turn" = "primary";
  let usedValidation: OkValidation = validation;
  let lastFallbackError = "";

  if (!exec.ok && executionAttempts.length > 1) {
    for (let i = 1; i < executionAttempts.length; i += 1) {
      const a = executionAttempts[i];
      const e = await executeReadonlySelect(a.v.normalizedSql, {
        maxRows: CHAT_RESULT_PAGE_SIZE,
        offset: 0,
      });
      if (!e.ok) {
        lastFallbackError = e.error;
      }
      if (e.ok) {
        exec = e;
        usedAttemptKey = a.key;
        usedValidation = a.v;
        if (a.key === "pre_critique") {
          sql = sqlAfterLlm;
        } else if (a.key === "previous_turn" && input.lastSuccessfulDataSql?.trim()) {
          sql = input.lastSuccessfulDataSql.trim();
        }
        break;
      }
    }
  }

  if (!exec.ok) {
    const trust = buildTrustReport({
      pipeline: "execution_failed",
      validationPassed: true,
      validationDetails: ["Parsed SQL and allowlist checks passed."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair,
      joinHeuristic: joinFanoutPenalty(validatedSql, validation),
    });
    return {
      assistant_message: `The query could not be executed: ${primaryExecError || lastFallbackError || exec.error}`,
      kind: "answer",
      sql: validatedSql,
      trust,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    };
  }

  const executionFallbackNote =
    usedAttemptKey === "pre_critique"
      ? "**Note:** The extra SQL review suggested a revision that failed at runtime; results use the **original** model query instead.\n\n"
      : usedAttemptKey === "previous_turn"
        ? "**Note:** The strict verification run produced a query that failed at runtime; showing results from your **previous successful** query instead.\n\n"
        : "";

  const hasMore = exec.limited;
  const resultNextOffset = hasMore ? CHAT_RESULT_PAGE_SIZE : null;

  const rowPreview =
    exec.rows.length === 0
      ? "No rows matched."
      : `Returned ${exec.rowCount} row(s)${exec.limited ? ` (up to ${CHAT_RESULT_PAGE_SIZE} per answer; more available — use Next ${CHAT_RESULT_PAGE_SIZE})` : ""}.`;

  const trimmedNarrative = model.assistant_message.trim();
  const narrativeGrounding = checkNarrativeNumericGrounding(trimmedNarrative, exec.rows, model.plan_summary);

  let finalNarrative = trimmedNarrative;
  let narrativeCorrected = false;
  if (!narrativeGrounding.ok && exec.rows.length > 0) {
    const corrected = await correctNarrative({
      originalNarrative: trimmedNarrative,
      rows: exec.rows,
      groundingNotes: narrativeGrounding.notes,
      planSummary: model.plan_summary,
    });
    if (corrected) {
      finalNarrative = corrected;
      narrativeCorrected = true;
    }
  }

  const validationDetails: string[] = [
    "Parsed SQL",
    "Allowlisted tables/columns",
    "Single SELECT",
  ];
  if (explainValidated) validationDetails.push("EXPLAIN dry-run succeeded (server-side)");
  if (intentVerifierRan && typeof intentConfidence === "number") {
    validationDetails.push(`Intent verification confidence ${intentConfidence}/100`);
  }
  if (intentVerifierError) validationDetails.push("Intent verification skipped or failed — SQL still statically validated");
  if (usedAttemptKey !== "primary") {
    validationDetails.push(
      "Runtime fallback: a different validated SQL ran after the primary failed — EXPLAIN and intent checks targeted the primary candidate.",
    );
  }
  if (narrativeCorrected) validationDetails.push("Narrative auto-corrected to match result data");

  const narrativeGroundingForTrust = narrativeCorrected
    ? { ok: true, suspiciousNumbers: [], notes: [] }
    : narrativeGrounding;

  const trust = buildTrustReport({
    pipeline: "data",
    validationPassed: true,
    validationDetails,
    rowCount: exec.rowCount,
    limited: exec.limited,
    executionMs: exec.ms,
    skippedExecution: false,
    hadRepair,
    joinHeuristic: joinFanoutPenalty(sql, usedValidation),
    narrativeGrounding: narrativeGroundingForTrust,
    strictVerification: input.strictVerification === true,
    explainValidated: explainValidated || undefined,
    intentVerifierRan: intentVerifierRan || undefined,
    intentVerifierError: intentVerifierError || undefined,
    intentConfidence,
    intentAligned,
    emptyResultSet: exec.rowCount === 0 || undefined,
  });

  const reliabilityBanner = narrativeCorrected
    ? "**Reliability:** This summary was auto-corrected to match the database results.\n\n"
    : !narrativeGrounding.ok
      ? "**Reliability:** Some numbers in the text below may not match the database — **use the result summary and table as the source of truth.**\n\n"
      : "";

  const planLine =
    typeof model.plan_summary === "string" && model.plan_summary.trim().length > 0
      ? `**What this shows:** ${model.plan_summary.trim()}\n\n`
      : "";

  const emptyRowsNote =
    exec.rowCount === 0
      ? "**Note:** No rows matched. If you expected data, the filters may not match the Northwind sample (mostly 1996–1998) or category/region names may differ.\n\n"
      : "";
  const trustSpecNudge = buildTrustSpecNudge(input.message);

  return {
    assistant_message: `${executionFallbackNote}${reliabilityBanner}${planLine}${emptyRowsNote}${finalNarrative}${trustSpecNudge}\n\n${rowPreview}\n\n${sqlContextFollowUp(usedValidation.normalizedSql)}`,
    kind: "answer",
    sql: usedValidation.normalizedSql,
    rows: exec.rows,
    trust,
    plan_summary: model.plan_summary,
    metric_ids: model.metric_ids,
    assumptions: model.assumptions,
    trustUpgradeSuggestion: undefined,
    resultHasMore: hasMore,
    resultNextOffset,
  };
}
