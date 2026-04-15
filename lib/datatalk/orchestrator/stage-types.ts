import type { SqlValidationResult } from "@/lib/datatalk/sql-validator";
import type { LlmPipelineResult, TrustReport } from "@/lib/datatalk/types";

export type Turn = { role: "user" | "assistant"; text: string };

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

export type OkValidation = Extract<SqlValidationResult, { ok: true }>;
export type ExecutionAttemptKey = "primary" | "pre_critique" | "previous_turn";
