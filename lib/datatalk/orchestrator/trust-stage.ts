import { CHAT_RESULT_PAGE_SIZE } from "@/lib/datatalk/executor";
import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import {
  checkNarrativeNumericGrounding,
  correctNarrative,
} from "@/lib/datatalk/narrative-consistency";
import { buildTrustSpecNudge } from "@/lib/datatalk/query-heuristics";
import { type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { buildTrustReport } from "@/lib/datatalk/trust";
import { sqlContextFollowUp } from "@/lib/datatalk/conversation-nudges";
import type {
  ExecutionAttemptKey,
  OkValidation,
  OrchestratorResult,
} from "@/lib/datatalk/orchestrator/stage-types";
import type { LlmPipelineResult } from "@/lib/datatalk/types";

type ExecSuccess = {
  rows: Record<string, unknown>[];
  rowCount: number;
  limited: boolean;
  ms: number;
};

function joinFanoutPenalty(sql: string | null | undefined, validated?: SqlValidationResult): boolean {
  if (!sql?.trim()) return false;
  if (validated?.ok) return validated.joinFanoutTrustPenalty;
  return inferJoinFanoutTrustPenalty(sql);
}

function buildDataValidationDetails(input: {
  explainValidated: boolean;
  intentVerifierRan: boolean;
  intentConfidence?: number;
  intentVerifierError: boolean;
  usedAttemptKey: ExecutionAttemptKey;
  narrativeCorrected: boolean;
}): string[] {
  const details: string[] = ["Parsed SQL", "Allowlisted tables/columns", "Single SELECT"];
  if (input.explainValidated) details.push("EXPLAIN dry-run succeeded (server-side)");
  if (input.intentVerifierRan && typeof input.intentConfidence === "number") {
    details.push(`Intent verification confidence ${input.intentConfidence}/100`);
  }
  if (input.intentVerifierError) {
    details.push("Intent verification skipped or failed — SQL still statically validated");
  }
  if (input.usedAttemptKey !== "primary") {
    details.push(
      "Runtime fallback: a different validated SQL ran after the primary failed — EXPLAIN and intent checks targeted the primary candidate.",
    );
  }
  if (input.narrativeCorrected) details.push("Narrative auto-corrected to match result data");
  return details;
}

/**
 * Stage 4: convert execution + verification signals into the final assistant payload.
 * This stage is where we make uncertainty explicit in user-facing copy.
 */
export async function runTrustStage(input: {
  message: string;
  model: Pick<LlmPipelineResult, "assistant_message" | "plan_summary" | "metric_ids" | "assumptions">;
  strictVerification?: boolean;
  hadRepair: boolean;
  explainValidated: boolean;
  intentVerifierRan: boolean;
  intentVerifierError: boolean;
  intentConfidence?: number;
  intentAligned?: boolean;
  execution: ExecSuccess;
  usedValidation: OkValidation;
  usedAttemptKey: ExecutionAttemptKey;
  effectiveSql: string;
  executionFallbackNote: string;
  rowPreview: string;
  hasMore: boolean;
  resultNextOffset: number | null;
}): Promise<OrchestratorResult> {
  const trimmedNarrative = input.model.assistant_message.trim();
  const narrativeGrounding = checkNarrativeNumericGrounding(
    trimmedNarrative,
    input.execution.rows,
    input.model.plan_summary,
  );

  let finalNarrative = trimmedNarrative;
  let narrativeCorrected = false;
  if (!narrativeGrounding.ok && input.execution.rows.length > 0) {
    const corrected = await correctNarrative({
      originalNarrative: trimmedNarrative,
      rows: input.execution.rows,
      groundingNotes: narrativeGrounding.notes,
      planSummary: input.model.plan_summary,
    });
    if (corrected) {
      finalNarrative = corrected;
      narrativeCorrected = true;
    }
  }

  const validationDetails = buildDataValidationDetails({
    explainValidated: input.explainValidated,
    intentVerifierRan: input.intentVerifierRan,
    intentConfidence: input.intentConfidence,
    intentVerifierError: input.intentVerifierError,
    usedAttemptKey: input.usedAttemptKey,
    narrativeCorrected,
  });

  const narrativeGroundingForTrust = narrativeCorrected
    ? { ok: true, suspiciousNumbers: [], notes: [] }
    : narrativeGrounding;

  const trust = buildTrustReport({
    pipeline: "data",
    validationPassed: true,
    validationDetails,
    rowCount: input.execution.rowCount,
    limited: input.execution.limited,
    executionMs: input.execution.ms,
    skippedExecution: false,
    hadRepair: input.hadRepair,
    joinHeuristic: joinFanoutPenalty(input.effectiveSql, input.usedValidation),
    narrativeGrounding: narrativeGroundingForTrust,
    strictVerification: input.strictVerification === true,
    explainValidated: input.explainValidated || undefined,
    intentVerifierRan: input.intentVerifierRan || undefined,
    intentVerifierError: input.intentVerifierError || undefined,
    intentConfidence: input.intentConfidence,
    intentAligned: input.intentAligned,
    emptyResultSet: input.execution.rowCount === 0 || undefined,
  });

  const reliabilityBanner = narrativeCorrected
    ? "**Reliability:** This summary was auto-corrected to match the database results.\n\n"
    : !narrativeGrounding.ok
      ? "**Reliability:** Some numbers in the text below may not match the database — **use the result summary and table as the source of truth.**\n\n"
      : "";
  const planLine =
    typeof input.model.plan_summary === "string" && input.model.plan_summary.trim().length > 0
      ? `**What this shows:** ${input.model.plan_summary.trim()}\n\n`
      : "";
  const emptyRowsNote =
    input.execution.rowCount === 0
      ? "**Note:** No rows matched. If you expected data, the filters may not match the Northwind sample (mostly 1996-1998) or category/region names may differ.\n\n"
      : "";
  const trustSpecNudge = buildTrustSpecNudge(input.message);

  return {
    assistant_message: `${input.executionFallbackNote}${reliabilityBanner}${planLine}${emptyRowsNote}${finalNarrative}${trustSpecNudge}\n\n${input.rowPreview}\n\n${sqlContextFollowUp(input.usedValidation.normalizedSql)}`,
    kind: "answer",
    sql: input.usedValidation.normalizedSql,
    rows: input.execution.rows,
    trust,
    plan_summary: input.model.plan_summary,
    metric_ids: input.model.metric_ids,
    assumptions: input.model.assumptions,
    trustUpgradeSuggestion: undefined,
    resultHasMore: input.hasMore,
    resultNextOffset: input.resultNextOffset,
  };
}

export function buildPaginationRowPreview(rowCount: number, offset: number): string {
  if (rowCount === 0) return "No more rows for this query.";
  const rangeStart = offset + 1;
  const rangeEnd = offset + rowCount;
  return `Returned ${rowCount} row(s) (rows ${rangeStart}-${rangeEnd} of the full result; ${CHAT_RESULT_PAGE_SIZE} per page).`;
}
