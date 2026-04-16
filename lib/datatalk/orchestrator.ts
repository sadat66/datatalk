import { buildConversationContext } from "@/lib/datatalk/query-intelligence";
import {
  CHAT_RESULT_PAGE_SIZE,
  executeReadonlySelect,
} from "@/lib/datatalk/executor";
import { buildTrustReport } from "@/lib/datatalk/trust";
import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import { validateSelectSql, type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { sqlContextFollowUp } from "@/lib/datatalk/conversation-nudges";
import { checkNarrativeNumericGrounding } from "@/lib/datatalk/narrative-consistency";
import { runModel } from "@/lib/datatalk/orchestrator-llm";
import { isReferentialFollowUpMessage } from "@/lib/datatalk/query-heuristics";
import {
  runValidationStage,
} from "@/lib/datatalk/orchestrator/validation-stage";
import {
  runVerificationStage,
} from "@/lib/datatalk/orchestrator/verification-stage";
import { runExecutionStage } from "@/lib/datatalk/orchestrator/execution-stage";
import {
  buildPaginationRowPreview,
  runTrustStage,
} from "@/lib/datatalk/orchestrator/trust-stage";
import type { OrchestratorResult, Turn } from "@/lib/datatalk/orchestrator/stage-types";

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

export type { OrchestratorResult } from "@/lib/datatalk/orchestrator/stage-types";

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
  const rowPreview = buildPaginationRowPreview(exec.rowCount, offset);

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

  const sql = typeof model.sql === "string" ? model.sql.trim() : "";
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

  // Stage 1: SQL critique + deterministic validation/repair.
  const validationStage = await runValidationStage({
    context,
    message: input.message,
    initialSql: sql,
    strictVerification: input.strictVerification,
  });
  if (!validationStage.ok) {
    return {
      assistant_message: validationStage.failure.assistant_message,
      kind: "answer",
      trust: validationStage.failure.trust,
    };
  }

  if (isVeryShortReferentialFollowUp(input.message) && input.lastSuccessfulDataSql?.trim()) {
    const previousValidation = validateSelectSql(input.lastSuccessfulDataSql.trim());
    if (
      previousValidation.ok &&
      previousValidation.normalizedSql === validationStage.validation.normalizedSql
    ) {
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

  // Stage 2: server-side EXPLAIN and intent verification, with clarify-first fallback.
  const verificationStage = await runVerificationStage({
    context,
    userMessage: input.message,
    intentQuestion,
    validatedSql: validationStage.validatedSql,
    validation: validationStage.validation,
    hadRepair: validationStage.hadRepair,
    model: {
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    },
  });
  if (verificationStage.kind === "return") {
    return verificationStage.result;
  }

  // Stage 3: execute the chosen SQL and runtime fallbacks.
  const executionStage = await runExecutionStage({
    validation: verificationStage.validation,
    validatedSql: verificationStage.validatedSql,
    critiqueReplacedSql: validationStage.critiqueReplacedSql,
    sqlAfterLlm: validationStage.sqlAfterLlm,
    strictVerification: input.strictVerification,
    lastSuccessfulDataSql: input.lastSuccessfulDataSql,
  });
  if (!executionStage.ok) {
    const trust = buildTrustReport({
      pipeline: "execution_failed",
      validationPassed: true,
      validationDetails: ["Parsed SQL and allowlist checks passed."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: verificationStage.hadRepair,
      joinHeuristic: joinFanoutPenalty(executionStage.validatedSql, executionStage.validation),
    });
    return {
      assistant_message: `The query could not be executed: ${executionStage.primaryExecError || executionStage.lastFallbackError}`,
      kind: "answer",
      sql: executionStage.validatedSql,
      trust,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    };
  }

  // Stage 4: trust synthesis + user-facing reliability copy.
  return runTrustStage({
    message: input.message,
    model: {
      assistant_message: model.assistant_message,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    },
    strictVerification: input.strictVerification,
    hadRepair: verificationStage.hadRepair,
    explainValidated: verificationStage.explainValidated,
    intentVerifierRan: verificationStage.intentVerifierRan,
    intentVerifierError: verificationStage.intentVerifierError,
    intentConfidence: verificationStage.intentConfidence,
    intentAligned: verificationStage.intentAligned,
    execution: executionStage.exec,
    usedValidation: executionStage.usedValidation,
    usedAttemptKey: executionStage.usedAttemptKey,
    effectiveSql: executionStage.effectiveSql,
    executionFallbackNote: executionStage.executionFallbackNote,
    rowPreview: executionStage.rowPreview,
    hasMore: executionStage.hasMore,
    resultNextOffset: executionStage.resultNextOffset,
  });
}
