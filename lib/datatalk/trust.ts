import type { NarrativeGroundingResult } from "@/lib/datatalk/narrative-consistency";
import type { TrustPipeline, TrustReport } from "@/lib/datatalk/types";

type DataPathInput = {
  pipeline: "data";
  validationPassed: boolean;
  validationDetails: string[];
  rowCount: number;
  limited: boolean;
  executionMs: number;
  skippedExecution: boolean;
  hadRepair: boolean;
  joinHeuristic: boolean;
  /** Post-execution check: numbers in narrative vs result cells */
  narrativeGrounding?: NarrativeGroundingResult;
  /** User asked for stricter checks — extra SQL review + score boost when grounding is clean */
  strictVerification?: boolean;
};

type SimplePipelineInput = {
  pipeline: Exclude<TrustPipeline, "data" | "validation_failed" | "execution_failed">;
};

type FailurePipelineInput = {
  pipeline: "validation_failed" | "execution_failed";
  validationPassed: boolean;
  validationDetails: string[];
  rowCount: number;
  limited: boolean;
  executionMs: number;
  skippedExecution: boolean;
  hadRepair: boolean;
  joinHeuristic: boolean;
};

export type BuildTrustReportInput = DataPathInput | SimplePipelineInput | FailurePipelineInput;

/** Build trust / confidence report for a chat turn. Use `pipeline` to separate data-backed runs from informational or failed SQL. */
export function buildTrustReport(input: BuildTrustReportInput): TrustReport {
  if (input.pipeline === "data") {
    return buildDataPathTrust(input);
  }
  if (input.pipeline === "validation_failed" || input.pipeline === "execution_failed") {
    return buildFailurePathTrust(input);
  }

  switch (input.pipeline) {
    case "conversational":
      return {
        level: "medium",
        pipeline: "conversational",
        reasons: [
          "Informational answer — no database query was run for this turn, which is expected for discovery or how-it-works questions.",
        ],
        validation: {
          passed: true,
          details: ["No SQL required for this informational answer."],
        },
        execution: {
          rowCount: 0,
          limited: false,
          ms: 0,
          skipped: true,
        },
        gapsToHighTrust: [
          "High trust is scored on executed, validated SQL — ask a concrete Northwind question (metric + dimension) to unlock a data-backed run.",
        ],
      };
    case "clarify":
      return {
        level: "medium",
        pipeline: "clarify",
        reasons: [
          "The assistant asked a clarifying question before generating SQL — confidence applies once a query runs.",
        ],
        validation: {
          passed: true,
          details: ["No SQL executed yet — waiting for a more specific question."],
        },
        execution: {
          rowCount: 0,
          limited: false,
          ms: 0,
          skipped: true,
        },
        gapsToHighTrust: [
          "Reply with a specific metric, time range, and grain — then we can generate SQL and earn a high-trust data answer.",
        ],
      };
    case "refused":
      return {
        level: "low",
        pipeline: "refused",
        reasons: ["This request was declined — no query was generated."],
        validation: {
          passed: false,
          details: ["No SQL — assistant refused this request as out of scope or unsafe."],
        },
        execution: {
          rowCount: 0,
          limited: false,
          ms: 0,
          skipped: true,
        },
        gapsToHighTrust: [
          "Rephrase as a safe Northwind analytics question (read-only, allowlisted tables). High trust only applies once we can run validated SQL.",
        ],
      };
    case "canned":
      return {
        level: "medium",
        pipeline: "canned",
        reasons: ["Preset reply — no database query for this turn."],
        validation: {
          passed: true,
          details: ["No SQL — keyword-based canned response."],
        },
        execution: {
          rowCount: 0,
          limited: false,
          ms: 0,
          skipped: true,
        },
        gapsToHighTrust: [
          "Ask a real analytics question in the composer — high trust is tied to executed SQL, not canned greetings.",
        ],
      };
  }
  throw new Error("unreachable trust pipeline branch");
}

/** What is still missing vs “high trust” for a successful data-backed turn (heuristic). */
function computeGapsToHighDataPath(input: DataPathInput, level: TrustReport["level"]): string[] {
  const gaps: string[] = [];

  if (level === "high") {
    gaps.push(
      "Nothing major is missing for our high-trust bar on this turn: validation passed, execution succeeded, and the score cleared the threshold.",
    );
    if (input.joinHeuristic) {
      gaps.push(
        "Optional: joins can still mis-total — for critical decisions, confirm one row per business key or use an aggregate query.",
      );
    }
    return gaps;
  }

  if (input.joinHeuristic) {
    gaps.push(
      "Joins cost a trust point: narrow grain (one row per entity) or switch to SUM/COUNT subqueries to avoid fan-out.",
    );
  }
  if (input.limited) {
    gaps.push(
      "Only a page of rows is shown: for a definitive total across all rows, ask for an aggregate (e.g. SUM) instead of raw lines.",
    );
  }
  if (input.hadRepair) {
    gaps.push(
      "The first SQL failed checks and was repaired: clearer table/metric wording reduces repair and lifts trust.",
    );
  }
  if (input.narrativeGrounding && !input.narrativeGrounding.ok) {
    gaps.push(
      "Numbers in the assistant text did not match cells — fix or remove those figures; we keep trust low until prose matches the grid.",
    );
  }
  if (level === "medium" && !input.strictVerification) {
    gaps.push(
      "Use “Confirm strict verification” for an extra SQL review — when grounding is clean, that can add +1 and push you to high.",
    );
  }
  if (level === "low") {
    gaps.push(
      "Several issues stacked (joins, paging, repair, and/or narrative). Address the strongest red flag first — usually narrative mismatch or repeated SQL repair.",
    );
  }

  return gaps;
}

function buildDataPathTrust(input: DataPathInput): TrustReport {
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

  const grounding = input.narrativeGrounding;
  if (grounding && !grounding.ok) {
    score -= 2;
    reasons.push(...grounding.notes);
    reasons.push(
      "Narrative numeric grounding check: some figures in the assistant text did not match returned cells — treat tabular results as authoritative.",
    );
  }

  const strictEligible =
    input.strictVerification &&
    (!grounding || grounding.ok) &&
    input.validationPassed &&
    !input.skippedExecution;
  if (strictEligible) {
    score += 1;
    reasons.push("Strict verification: you requested an extra SQL review pass — trust is upgraded when checks succeed.");
  }

  const level: TrustReport["level"] = score >= 3 ? "high" : score >= 1 ? "medium" : "low";

  let confidenceScore = 38;
  if (level === "high") confidenceScore = 90;
  else if (level === "medium") confidenceScore = 68;
  if (input.limited) confidenceScore -= 6;
  if (input.joinHeuristic) confidenceScore -= 5;
  if (input.hadRepair) confidenceScore -= 8;
  if (grounding && !grounding.ok) confidenceScore = Math.min(confidenceScore, 40);
  if (strictEligible && level === "high") confidenceScore = Math.max(confidenceScore, 86);
  else if (strictEligible && level === "medium") confidenceScore = Math.max(confidenceScore, 72);
  confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore)));

  return {
    level,
    pipeline: "data",
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
    reliability: {
      confidenceScore,
      narrativeNumericGrounding: grounding && !grounding.ok ? "suspect" : "ok",
      narrativeNotes: grounding && !grounding.ok ? grounding.notes : undefined,
    },
    gapsToHighTrust: computeGapsToHighDataPath(input, level),
  };
}

function buildFailurePathTrust(input: FailurePipelineInput): TrustReport {
  const isExec = input.pipeline === "execution_failed";
  return {
    level: "low",
    pipeline: input.pipeline,
    reasons: isExec
      ? [
          "SQL passed safety checks but the database run failed — treat results as unavailable for this turn.",
        ]
      : [
          "SQL did not pass validation or could not be repaired — this is a pipeline failure, not an informational answer.",
        ],
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
    gapsToHighTrust: isExec
      ? [
          "Fix the database error (connection, timeout, permissions), then retry — high trust needs a successful read-only execution with returned rows.",
        ]
      : [
          "Resolve validation errors or simplify the question — high trust requires a single allowlisted SELECT that passes all checks without unsafe repair failure.",
        ],
  };
}
