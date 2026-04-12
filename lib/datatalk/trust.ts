import type { TrustReport } from "@/lib/datatalk/types";

export function buildTrustReport(input: {
  validationPassed: boolean;
  validationDetails: string[];
  rowCount: number;
  limited: boolean;
  executionMs: number;
  skippedExecution: boolean;
  hadRepair: boolean;
  joinHeuristic: boolean;
}): TrustReport {
  const reasons: string[] = [];

  let score = 0;
  if (input.validationPassed) {
    score += 2;
    reasons.push("SQL passed parse and allowlist checks.");
  } else {
    reasons.push("SQL did not pass validation.");
  }
  if (!input.skippedExecution) {
    score += 1;
    reasons.push(`Executed in ${input.executionMs}ms, returned ${input.rowCount} row(s).`);
    if (input.limited) {
      score -= 1;
      reasons.push("Results were capped at the configured row limit.");
    }
  } else {
    reasons.push("Execution was skipped (no SQL or validation failed).");
  }
  if (input.joinHeuristic) {
    score -= 1;
    reasons.push("Query uses joins — review for fan-out / double counting.");
  }
  if (input.hadRepair) {
    score -= 1;
    reasons.push("SQL was adjusted after a failed validation attempt.");
  }

  const level: TrustReport["level"] =
    score >= 3 ? "high" : score >= 1 ? "medium" : "low";

  return {
    level,
    reasons,
    validation: {
      passed: input.validationPassed,
      details: input.validationDetails,
    },
    execution: {
      rowCount: input.rowCount,
      limited: input.limited,
      ms: input.executionMs,
      skipped: input.skippedExecution,
    },
  };
}
