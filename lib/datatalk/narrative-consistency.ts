/**
 * Heuristic hallucination / grounding detection: compare numbers claimed in the LLM narrative
 * to values present in executed result rows. Wrong data is worse than no data — we flag
 * likely ungrounded figures so the UI can warn and down-rank confidence.
 */

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

export type NarrativeGroundingResult = {
  ok: boolean;
  suspiciousNumbers: number[];
  notes: string[];
};

/**
 * If the narrative cites specific magnitudes that do not appear in any result cell, flag as suspect.
 * Conservative: ignores small integers (IDs, ranks), Northwind years, and tiny decimals.
 */
export function checkNarrativeNumericGrounding(
  narrative: string,
  rows: Record<string, unknown>[],
): NarrativeGroundingResult {
  const literals = extractNumericLiterals(narrative);
  const rowNums = collectNumericValuesFromRows(rows);
  const suspicious: number[] = [];

  for (const n of literals) {
    if (isNorthwindYear(n)) continue;
    if (Math.abs(n) > 0 && Math.abs(n) < 8) continue;
    if (Number.isInteger(n) && n >= 1 && n <= 31) continue;

    if (!numberGroundedInResults(n, rowNums)) suspicious.push(n);
  }

  if (suspicious.length === 0) {
    return { ok: true, suspiciousNumbers: [], notes: [] };
  }

  const preview = suspicious
    .slice(0, 6)
    .map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2)))
    .join(", ");
  return {
    ok: false,
    suspiciousNumbers: suspicious,
    notes: [
      `Some numbers in the assistant text (${preview}${suspicious.length > 6 ? ", …" : ""}) do not match values in the returned rows — they may be hallucinated. Prefer the result set as the source of truth.`,
    ],
  };
}
