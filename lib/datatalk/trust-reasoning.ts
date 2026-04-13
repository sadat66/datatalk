import type { TrustReport } from "@/lib/datatalk/types";

export type TrustReasoningTone = "default" | "success" | "warning" | "danger";

export type TrustReasoningSection = {
  id: string;
  title: string;
  body: string;
  /** Prefer bullets for multi-part guidance (e.g. path to high trust) */
  bullets?: string[];
  tone?: TrustReasoningTone;
};

/**
 * Human-readable reasoning for the trust panel — maps pipeline state to
 * validation, confidence, graceful failure, and hallucination checks (product story).
 */
export function buildTrustReasoningSections(trust: TrustReport): TrustReasoningSection[] {
  const sections: TrustReasoningSection[] = [];

  sections.push({
    id: "principle",
    title: "Reliability principle",
    body: "Wrong data is worse than no data. We validate every SELECT, run read-only against your schema allowlist, score confidence honestly, and flag assistant text that may not match the result table.",
    tone: "default",
  });

  const valPassed = trust.validation.passed;
  sections.push({
    id: "query_validation",
    title: "Query validation",
    body: valPassed
      ? `Passed — ${trust.validation.details.join(" · ")}`
      : `Did not pass — ${trust.validation.details.join(" · ")}`,
    tone: valPassed ? "success" : "danger",
  });

  const ex = trust.execution;
  const skipped = ex.skipped === true;
  if (skipped) {
    sections.push({
      id: "execution",
      title: "Execution & SQL data",
      body:
        "No query executed this turn (clarification, informational reply, refusal, canned reply, or validation blocked the run). No SQL-backed table to verify.",
      tone: "default",
    });
  } else {
    sections.push({
      id: "execution",
      title: "Execution & SQL data",
      body: `Read-only SELECT ran successfully in ${ex.ms}ms · ${ex.rowCount} row(s) returned${ex.limited ? " · additional rows may exist (use Next 15 in chat)" : ""}. These values are what Postgres returned for the validated query.`,
      tone: "success",
    });
  }

  if (trust.reliability) {
    const r = trust.reliability;
    const suspect = r.narrativeNumericGrounding === "suspect";
    sections.push({
      id: "hallucination",
      title: "Hallucination / narrative check",
      body: suspect
        ? `Flagged — ${(r.narrativeNotes ?? []).join(" ") || "Some numbers in the assistant text may not appear in result cells. Treat the table as authoritative."}`
        : "Assistant text was scanned for numeric literals and compared to result cells where applicable — no strong mismatch detected (heuristic).",
      tone: suspect ? "warning" : "success",
    });

    sections.push({
      id: "confidence",
      title: "Confidence score",
      body: `${r.confidenceScore}/100 (${trust.level} trust). Combines validation, execution, joins, pagination cap, SQL repair, strict verification, and narrative grounding — not a guarantee of business correctness.`,
      tone: trust.level === "low" ? "warning" : "default",
    });
  } else {
    sections.push({
      id: "hallucination",
      title: "Hallucination / narrative check",
      body: "Not applicable — no numeric result table to compare against prose for this turn.",
      tone: "default",
    });
    sections.push({
      id: "confidence",
      title: "Confidence score",
      body: `Pipeline outcome: ${trust.level} trust (no execution-based 0–100 score for this turn).`,
      tone: "default",
    });
  }

  if (trust.gapsToHighTrust && trust.gapsToHighTrust.length > 0) {
    sections.push({
      id: "path_to_high",
      title: "What would make this high trust?",
      body: "",
      bullets: trust.gapsToHighTrust,
      tone: trust.level === "high" ? "success" : "warning",
    });
  }

  if (trust.pipeline === "validation_failed" || trust.pipeline === "execution_failed") {
    sections.push({
      id: "graceful_failure",
      title: "Graceful failure",
      body:
        trust.pipeline === "execution_failed"
          ? "We did not invent rows. SQL passed safety checks but the database run failed — fix connectivity or rephrase; see the error in the assistant message."
          : "We did not run an unsafe query. Validation or repair failed — the assistant explains next steps instead of returning unverified numbers.",
      tone: "warning",
    });
  }

  if (trust.pipeline === "refused") {
    sections.push({
      id: "graceful_refusal",
      title: "Graceful refusal",
      body: "This request was declined instead of fabricating analytics or bypassing safety rules.",
      tone: "warning",
    });
  }

  if (trust.pipeline === "clarify") {
    sections.push({
      id: "clarify_first",
      title: "Clarify before committing SQL",
      body: "Ambiguous questions get one targeted follow-up so we do not guess the wrong metric or grain.",
      tone: "default",
    });
  }

  return sections;
}

export function trustReasoningToneClass(tone: TrustReasoningTone | undefined): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/5";
    case "warning":
      return "border-amber-500/35 bg-amber-500/5";
    case "danger":
      return "border-red-500/30 bg-red-500/5";
    default:
      return "border-border bg-muted/30";
  }
}
