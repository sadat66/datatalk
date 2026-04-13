import { chatCompletionJson } from "@/lib/ai/completion";
import { metricsPromptBlock } from "@/lib/northwind/metrics";
import { buildColumnSemanticsHint, buildSchemaPromptExcerpt } from "@/lib/northwind/schema";
import { goldStandardExamplesBlock } from "@/lib/northwind/gold-examples";
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
import { llmPipelineSchema, type LlmPipelineResult, type TrustReport } from "@/lib/datatalk/types";
import { buildTrustReport } from "@/lib/datatalk/trust";
import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import { validateSelectSql, type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { sqlContextFollowUp } from "@/lib/datatalk/conversation-nudges";
import { critiqueNorthwindSql, isSqlCritiqueEnabled } from "@/lib/datatalk/sql-critique";
import { checkNarrativeNumericGrounding } from "@/lib/datatalk/narrative-consistency";

type Turn = { role: "user" | "assistant"; text: string };

const SYSTEM_PROMPT = `You are DataTalk, an analytics assistant for the Northwind PostgreSQL database.
You must respond with a single JSON object (no markdown) using this shape:
{
  "kind": "answer" | "clarify" | "refuse",
  "assistant_message": string (short, business-friendly),
  "clarify_question": string | null (one targeted question if kind is clarify),
  "sql": string | null (a single PostgreSQL SELECT if kind is answer; otherwise null),
  "plan_summary": string | null (required when sql is non-null: one sentence "explain-back" describing what the query returns in plain English — e.g. "Total revenue by category for all years in the sample."),
  "metric_ids": string[] | null (subset of known metric ids when applicable),
  "assumptions": string[] | null
}

Execution model (critical):
- You never connect to Postgres yourself. The backend runs your SELECT on a read-only server URL after automated validation.
- Your job is to produce safe analytics SQL over the provided Northwind allowlist — not to troubleshoot the user’s infrastructure, credentials, or hosting. That is still true: you are not being asked to fix their servers.
- For normal Northwind analytics questions, use kind=answer and include sql. Never refuse (and never apologize) claiming you cannot help with "database access", "technical issues", "connection problems", "security", or "troubleshooting" — those refusals are wrong here. The product executes your read-only SELECT after checks.
- Do not say you cannot access the database, cannot run queries, or lack a connection — that is false in this product.
- Use kind=refuse only for out-of-scope requests (non-business, destructive, not representable from the allowlisted schema), not for imaginary technical limits or policy confusion about analytics.

Rules:
- kind=clarify when more than one reasonable reading would materially change the SQL (scope, grain, metric, entity). Ask exactly one concrete clarify_question; keep assistant_message brief. Do not refuse solely because the prompt is vague.
- For kind=clarify: put the single disambiguation question in clarify_question only, or only in assistant_message — never two paraphrased versions of the same question in both fields.
- kind=refuse for destructive requests, non-business questions, or anything outside Northwind sales data — not because the question touches "databases" or "SQL" (those are the core product).
- kind=answer when you either (a) answer with one safe SELECT using allowlisted tables, or (b) answer a meta / discovery question without needing data (see below) — in case (b) set sql to null.
- sql must not contain a semicolon. No DML/DDL. Prefer explicit column lists over SELECT * when reasonable.
- Use lowercase identifiers matching the schema. Dates in Northwind are mostly in the 1990s sample data.
- When using metrics, set metric_ids to the ids you relied on.
- If the user message includes "Focus for this turn" with join recipes, prefer those join paths over inventing new keys (especially ship_* vs territories).

Ranking and words like "best" / "top" / "winner":
- Here, those words mean objective ordering on a numeric field, not subjective opinion. Default "best" to highest value of the measure already in play (e.g. revenue, totals, counts) unless the user clearly asked for the opposite ("lowest", "worst performer", "cheapest").
- If they just saw a ranked or tabular answer and ask who is the best / which is #1 / who wins, reuse the same grain, filters, and metric; return the top row (SQL pattern: ORDER BY that metric DESC, NULLS LAST, LIMIT 1) or a small top-N — do not refuse as subjective criteria.
- In the assistant_message JSON field, state the rule in one short phrase (e.g. Treating best as highest revenue in this list.). Add the same to assumptions when helpful.

Vague or underspecified prompts:
- If the user omits a time range, geography, or segment, default to the full Northwind sample for that dimension (e.g. all order dates, all regions) when one clear SELECT still follows; list those defaults in assumptions.
- If only one natural interpretation exists (e.g. "total orders" without filters), answer with kind=answer and state defaults in assumptions — do not over-clarify.
- Phrases like "regional breakdown", "orders by region", "order count by region" already specify the dimension (region). Use kind=answer with SQL: default to sales region path orders → employees → employee_territories → territories → region, unless they clearly mean ship-to geography (then use orders.ship_region or ship_country). Never ask whether they meant region versus "another dimension" — that is unhelpful over-clarification.
- If several interpretations are equally likely (e.g. "sales" could mean revenue, units, or order count by product vs by customer), use kind=clarify with one question that names the fork (pick one).
- For follow-ups like "what about X", "same for Y", "and the suppliers?", inherit tables, filters, and time window from the last assistant answer unless the user overrides.
- Referential follow-ups ("what about them", "how about those", "and them?", "same thing for…", "they" / "it" pointing back): resolve who or what the user means from the prior user + assistant turns — usually the entities or dimension just discussed. In assistant_message, state that link in one short phrase (e.g. Here for the same top customers we ranked by revenue.) so the answer is explicit. Prefer kind=answer with SQL that adds insight for those referents: a breakdown, comparison, trend slice, or next-level drill-down — not a vague restatement. Use kind=clarify only when several prior referents are equally plausible.
- Relative dates ("this year", "last quarter") do not match the 1990s sample literally — either clarify that the dataset is historical demo data or answer on full sample and say so in assumptions.

Meta and discovery questions (what can you do, what insights are available, how does this work):
- These are in scope. Use kind=answer with sql set to null (no query yet). Write a short, welcoming assistant_message: you analyze the Northwind sales sample (orders, customers, products, suppliers, shippers, territories, etc.), run read-only SQL after safety checks, and explain results.
- Include 4–6 concrete example prompts the user could paste next (e.g. revenue by category, top customers by order total, monthly order counts, freight by shipper, products low in stock). Do not refuse for lack of a "specific question" — you are the guide. For this pattern use kind=answer, sql null, and clarify_question null; weave any gentle nudge (e.g. pick revenue vs products) into assistant_message.

Data-backed answers (kind=answer with non-null sql):
- Reliability first: wrong numbers are worse than no numbers. Do NOT state specific totals, counts, currency amounts, or percentages in assistant_message — you have not seen query results yet. Describe what the query returns in plain language (e.g. "Revenue by category, highest first") and list assumptions; the app attaches real figures from the database after execution.
- Never invent statistics. If the question cannot be answered without ambiguity, prefer kind=clarify.
- In assistant_message, give findings and definitions only (no trailing "what next" question). The app will append a short row summary and then a suggested follow-up question tied to the query.

Known metrics (prefer citing metric_ids when you use them):
${metricsPromptBlock()}

${buildColumnSemanticsHint()}

Semantic layer: prefer the view \`datatalk_order_details_extended\` when you need order lines with product and category pre-joined — fewer join errors than wiring tables manually.

Few-shot gold examples (use as patterns):
${goldStandardExamplesBlock()}

Allowlisted schema (tables and columns):
${buildSchemaPromptExcerpt()}
`;

/** Trust penalty for join fan-out / grain issues — prefers AST from validateSelectSql when available. */
function joinFanoutPenalty(sql: string | null | undefined, validated?: SqlValidationResult): boolean {
  if (!sql?.trim()) return false;
  if (validated?.ok) return validated.joinFanoutTrustPenalty;
  return inferJoinFanoutTrustPenalty(sql);
}

function parseLlmJson(raw: string): LlmPipelineResult {
  const parsedJson = JSON.parse(raw) as unknown;
  const parsed = llmPipelineSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Model JSON did not match the expected schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function runModel(context: string): Promise<LlmPipelineResult> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
  ]);
  return parseLlmJson(raw);
}

async function repairSql(context: string, previousSql: string, errors: string[]): Promise<string> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${context}\n\nThe previous SQL failed validation:\nSQL:\n${previousSql}\nErrors:\n- ${errors.join("\n- ")}\n\nReturn a NEW full JSON object with kind=answer and corrected sql only if you can fix it; otherwise kind=refuse with assistant_message explaining why.`,
    },
  ]);
  const parsed = parseLlmJson(raw);
  if (parsed.kind !== "answer" || !parsed.sql) {
    throw new Error(parsed.assistant_message || "Could not repair SQL.");
  }
  return parsed.sql;
}

function repairFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not repair SQL.";
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

  let validation = validateSelectSql(sql);
  let failedValidationErrors = !validation.ok ? [...validation.errors] : [];
  if (!validation.ok) {
    try {
      sql = await repairSql(context, sql, validation.errors);
      hadRepair = true;
      validation = validateSelectSql(sql);
      failedValidationErrors = !validation.ok ? [...validation.errors] : failedValidationErrors;
    } catch (err) {
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

  if (!validation.ok) {
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
      assistant_message:
        "That query failed safety checks after a repair attempt. Please rephrase your question.",
      kind: "answer",
      trust,
    };
  }

  const validatedSql = validation.normalizedSql;
  let explainValidated = false;
  let intentVerifierRan = false;
  let intentVerifierError = false;
  let intentConfidence: number | undefined;
  let intentAligned: boolean | undefined;

  if (isExplainValidateEnabled()) {
    const exRes = await explainValidateReadonlySelect(validatedSql);
    if (!exRes.ok) {
      const trust = buildTrustReport({
        pipeline: "execution_failed",
        validationPassed: true,
        validationDetails: [
          "Parsed SQL and allowlist checks passed.",
          `EXPLAIN dry-run failed: ${exRes.error}`,
        ],
        rowCount: 0,
        limited: false,
        executionMs: 0,
        skippedExecution: true,
        hadRepair,
        joinHeuristic: joinFanoutPenalty(validatedSql, validation),
      });
      return {
        assistant_message: `The query did not pass the database dry-run (EXPLAIN): ${exRes.error}`,
        kind: "answer",
        sql: validatedSql,
        trust,
        plan_summary: model.plan_summary,
        metric_ids: model.metric_ids,
        assumptions: model.assumptions,
      };
    }
    explainValidated = true;
  }

  if (isIntentVerifierEnabled()) {
    try {
      const iv = await verifySqlAgainstIntent({
        userQuestion: input.message,
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
      joinHeuristic: joinFanoutPenalty(validation.normalizedSql, validation),
    });
    return {
      assistant_message: `The query could not be executed: ${primaryExecError || lastFallbackError || exec.error}`,
      kind: "answer",
      sql: validation.normalizedSql,
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
  const narrativeGrounding = checkNarrativeNumericGrounding(trimmedNarrative, exec.rows);
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
    narrativeGrounding,
    strictVerification: input.strictVerification === true,
    explainValidated: explainValidated || undefined,
    intentVerifierRan: intentVerifierRan || undefined,
    intentVerifierError: intentVerifierError || undefined,
    intentConfidence,
    intentAligned,
    emptyResultSet: exec.rowCount === 0 || undefined,
  });

  const trustUpgradeSuggestion =
    trust.level === "medium" &&
    trust.pipeline === "data" &&
    !input.strictVerification &&
    narrativeGrounding.ok !== false
      ? "Confidence is medium (e.g. joins, limits, or repairs). If you want a high-confidence pass, confirm below — we will re-run with strict verification (extra SQL review). When checks pass, trust can reach high."
      : undefined;

  const reliabilityBanner = !narrativeGrounding.ok
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

  return {
    assistant_message: `${executionFallbackNote}${reliabilityBanner}${planLine}${emptyRowsNote}${trimmedNarrative}\n\n${rowPreview}\n\n${sqlContextFollowUp(usedValidation.normalizedSql)}`,
    kind: "answer",
    sql: usedValidation.normalizedSql,
    rows: exec.rows,
    trust,
    plan_summary: model.plan_summary,
    metric_ids: model.metric_ids,
    assumptions: model.assumptions,
    trustUpgradeSuggestion,
    resultHasMore: hasMore,
    resultNextOffset,
  };
}
