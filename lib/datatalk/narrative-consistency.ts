/**
 * Heuristic hallucination / grounding detection: compare numbers claimed in the LLM narrative
 * to values present in executed result rows. Wrong data is worse than no data — we flag
 * likely ungrounded figures so the UI can warn and down-rank confidence.
 *
 * Also provides LLM-backed narrative correction when grounding fails.
 */

import { chatCompletionJson } from "@/lib/ai/completion";

function extractNumericLiterals(text: string): number[] {
  const out: number[] = [];
  const re = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+(?:\.\d+)?\b/g;
  let m: RegExpExecArray | null;
  const s = text;
  while ((m = re.exec(s)) !== null) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function collectNumericValuesFromRows(rows: Record<string, unknown>[]): Set<number> {
  const set = new Set<number>();
  for (const row of rows) {
    for (const v of Object.values(row)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        set.add(v);
        set.add(Math.round(v * 100) / 100);
      } else if (typeof v === "string" && /^-?\s*\d/.test(v.trim())) {
        const n = Number(String(v).replace(/,/g, ""));
        if (Number.isFinite(n)) set.add(n);
      }
    }
  }
  return set;
}

function isNorthwindYear(n: number): boolean {
  return Number.isInteger(n) && n >= 1990 && n <= 1999;
}

function numberGroundedInResults(n: number, rowNums: Set<number>): boolean {
  if (rowNums.has(n)) return true;
  for (const rn of rowNums) {
    if (Math.abs(rn) < 1e-9) continue;
    if (Math.abs(rn - n) <= 1e-6) return true;
    if (Math.abs((rn - n) / rn) <= 0.005) return true;
  }
  return false;
}

const GROWTH_WORDS = /\b(grew|growth|increase[ds]?|rising|rose|up|higher|improve[ds]?|gain[eds]?|expand[eds]?)\b/i;
const DECLINE_WORDS = /\b(decline[ds]?|decrease[ds]?|drop(?:ped)?|fell|fall[ins]?|lower|shrunk|shrink|down|contract[eds]?|los[st]|reduc[edt])\b/i;

const DIMENSION_PATTERNS: [RegExp, string][] = [
  [/\bcategor(?:y|ies)\b/i, "category"],
  [/\bcustomer/i, "customer"],
  [/\bproduct/i, "product"],
  [/\bsupplier/i, "supplier"],
  [/\bemployee/i, "employee"],
  [/\bregion/i, "region"],
  [/\bcountr(?:y|ies)\b/i, "country"],
  [/\bshipper/i, "shipper"],
  [/\border/i, "order"],
  [/\bmonth/i, "month"],
  [/\byear/i, "year"],
  [/\bquarter/i, "quarter"],
];

function detectTrendMismatch(narrative: string, planSummary: string): string | null {
  const narrativeGrowth = GROWTH_WORDS.test(narrative);
  const narrativeDecline = DECLINE_WORDS.test(narrative);
  const planGrowth = GROWTH_WORDS.test(planSummary);
  const planDecline = DECLINE_WORDS.test(planSummary);

  if (narrativeGrowth && !narrativeDecline && planDecline && !planGrowth) {
    return "Narrative claims growth/increase but the query intent suggests decline/decrease.";
  }
  if (narrativeDecline && !narrativeGrowth && planGrowth && !planDecline) {
    return "Narrative claims decline/decrease but the query intent suggests growth/increase.";
  }
  return null;
}

function detectDimensionMismatch(narrative: string, planSummary: string): string | null {
  const planDims = new Set<string>();
  const narrativeDims = new Set<string>();
  for (const [re, label] of DIMENSION_PATTERNS) {
    if (re.test(planSummary)) planDims.add(label);
    if (re.test(narrative)) narrativeDims.add(label);
  }
  if (planDims.size === 0 || narrativeDims.size === 0) return null;

  const planOnly = [...planDims].filter((d) => !narrativeDims.has(d));
  const narrativeOnly = [...narrativeDims].filter((d) => !planDims.has(d));

  if (narrativeOnly.length > 0 && planOnly.length > 0) {
    return `Narrative discusses ${narrativeOnly.join(", ")} but the query intent targets ${planOnly.join(", ")}.`;
  }
  return null;
}

export type NarrativeGroundingResult = {
  ok: boolean;
  suspiciousNumbers: number[];
  notes: string[];
};

/**
 * If the narrative cites specific magnitudes that do not appear in any result cell, flag as suspect.
 * When planSummary is provided, also checks for trend-word and dimension mismatches.
 * Conservative: ignores small integers (IDs, ranks), Northwind years, and tiny decimals.
 */
export function checkNarrativeNumericGrounding(
  narrative: string,
  rows: Record<string, unknown>[],
  planSummary?: string | null,
): NarrativeGroundingResult {
  const literals = extractNumericLiterals(narrative);
  const rowNums = collectNumericValuesFromRows(rows);
  const suspicious: number[] = [];
  const notes: string[] = [];

  for (const n of literals) {
    if (isNorthwindYear(n)) continue;
    if (Math.abs(n) > 0 && Math.abs(n) < 8) continue;
    if (Number.isInteger(n) && n >= 1 && n <= 31) continue;

    if (!numberGroundedInResults(n, rowNums)) suspicious.push(n);
  }

  if (suspicious.length > 0) {
    const preview = suspicious
      .slice(0, 6)
      .map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2)))
      .join(", ");
    notes.push(
      `Some numbers in the assistant text (${preview}${suspicious.length > 6 ? ", …" : ""}) do not match values in the returned rows — they may be hallucinated. Prefer the result set as the source of truth.`,
    );
  }

  if (planSummary?.trim()) {
    const trendNote = detectTrendMismatch(narrative, planSummary);
    if (trendNote) notes.push(trendNote);
    const dimNote = detectDimensionMismatch(narrative, planSummary);
    if (dimNote) notes.push(dimNote);
  }

  return {
    ok: suspicious.length === 0 && notes.length === 0,
    suspiciousNumbers: suspicious,
    notes,
  };
}

const CORRECTION_SYSTEM = `You are a fact-checking assistant for a data analytics product.
You receive an original narrative summary, the actual SQL result rows (JSON), and a list of issues found by automated grounding checks.
Your job: rewrite the narrative so every claim matches the actual data. Keep the same tone and length.
Rules:
- Do NOT invent numbers not present in the result rows.
- If the original says "growth" but data shows decline, fix the direction.
- If the original discusses a dimension not in the data, remove or correct it.
- Keep it short and business-friendly — 1-3 sentences.
- Return a single JSON object: { "corrected": "..." }`;

const MAX_ROWS_FOR_CORRECTION = 30;

export async function correctNarrative(input: {
  originalNarrative: string;
  rows: Record<string, unknown>[];
  groundingNotes: string[];
  planSummary?: string | null;
}): Promise<string | null> {
  try {
    const rowSlice = input.rows.slice(0, MAX_ROWS_FOR_CORRECTION);
    const intentLine = input.planSummary?.trim()
      ? `\nQuery intent: ${input.planSummary.trim()}`
      : "";
    const raw = await chatCompletionJson([
      { role: "system", content: CORRECTION_SYSTEM },
      {
        role: "user",
        content: `Original narrative:\n${input.originalNarrative}\n\nResult rows (JSON, up to ${MAX_ROWS_FOR_CORRECTION}):\n${JSON.stringify(rowSlice, null, 1)}\n\nGrounding issues found:\n- ${input.groundingNotes.join("\n- ")}${intentLine}\n\nReturn { "corrected": "..." } with the fixed narrative.`,
      },
    ]);
    const parsed = JSON.parse(raw) as { corrected?: string };
    const corrected = parsed.corrected?.trim();
    if (!corrected || corrected.length < 5) return null;
    return corrected;
  } catch {
    return null;
  }
}
