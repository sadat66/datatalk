import { z } from "zod";
import { chatCompletionJson } from "@/lib/ai/completion";

const resultSchema = z.object({
  aligned: z.boolean(),
  /** Subjective 0–100: how well the SQL matches the user request and Northwind semantics */
  confidence_0_100: z.number().min(0).max(100),
  plain_explanation: z.string(),
  mismatches: z.array(z.string()),
  /** When aligned is false or confidence is low: one short clarification question or two labeled choices */
  clarify_suggestion: z.string().nullable().optional(),
});

export type IntentVerificationResult = z.infer<typeof resultSchema>;

const SYSTEM = `You are a verification model for a Northwind PostgreSQL analytics assistant.
The user asked a question in English; another model proposed a SELECT. Your job is self-reflection / double-check:
- Does this SQL accurately reflect the user's intent?
- Flag wrong grain (e.g. duplicate rows from bad joins), wrong filters (year vs full date), wrong dimension (ship_region vs sales territory path), or invented identifiers.
 - Tie handling on extrema:
   - For prompts asking highest/lowest/min/max entities, assume all ties should be returned unless the user explicitly asked for one row (top 1, single, #1, just one).
   - If SQL uses ORDER BY on the extrema metric with LIMIT 1 but user did not request one row, treat that as a mismatch (possible tie truncation) and lower confidence.
 - For discount-comparative wording:
   - "least/lowest discount" means minimum discount value in the scoped rows.
   - Treat SQL using MIN(discount) as semantically valid when it correctly identifies/filter products at the minimum discount level.
   - Do not flag a mismatch just because SQL computes MIN(discount); flag only when the SQL clearly fails to constrain to the minimum-discount cohort despite that being requested.
Be conservative: if you are unsure, lower confidence and suggest clarification.
Return a single JSON object only:
{
  "aligned": boolean,
  "confidence_0_100": number (0-100),
  "plain_explanation": string (one sentence: what the query returns, in business language),
  "mismatches": string[] (short; empty if none),
  "clarify_suggestion": string | null (one question or "A vs B" choice if we should not run yet; null if ok to run)
}`;

export function getConfidenceRunThreshold(): number {
  const raw = process.env.DATATALK_CONFIDENCE_RUN_THRESHOLD?.trim();
  if (!raw) return 85;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 85;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Extra LLM pass — off via DATATALK_INTENT_VERIFIER=0 */
export function isIntentVerifierEnabled(): boolean {
  const v = process.env.DATATALK_INTENT_VERIFIER?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

export async function verifySqlAgainstIntent(input: {
  userQuestion: string;
  sql: string;
}): Promise<IntentVerificationResult | null> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `User question:\n${input.userQuestion}\n\nProposed SQL (read-only SELECT):\n${input.sql}`,
    },
  ]);

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}
