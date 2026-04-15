import { chatCompletionJson } from "@/lib/ai/completion";
import { metricsPromptBlock } from "@/lib/northwind/metrics";
import { buildColumnSemanticsHint, buildSchemaPromptExcerpt } from "@/lib/northwind/schema";
import { goldStandardExamplesBlock } from "@/lib/northwind/gold-examples";
import { llmPipelineSchema, type LlmPipelineResult } from "@/lib/datatalk/types";

function parseMaxRepairAttempts(): number {
  const raw = process.env.DATATALK_MAX_REPAIR_ATTEMPTS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 5) : 3;
}

export const MAX_REPAIR_ATTEMPTS = parseMaxRepairAttempts();

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
- If the user asks for a specific top-N or rank range (for example "top 5", "rank 1 to 5"), include LIMIT N in SQL and preserve that cap in follow-ups.
- Use lowercase identifiers matching the schema. Dates in Northwind are mostly in the 1990s sample data.
- When using metrics, set metric_ids to the ids you relied on.
- If the user message includes "Focus for this turn" with join recipes, prefer those join paths over inventing new keys (especially ship_* vs territories).

Ranking and words like "best" / "top" / "winner":
- Here, those words mean objective ordering on a numeric field, not subjective opinion. Default "best" to highest value of the measure already in play (e.g. revenue, totals, counts) unless the user clearly asked for the opposite ("lowest", "worst performer", "cheapest").
- If they just saw a ranked or tabular answer and ask who is the best / which is #1 / who wins, reuse the same grain, filters, and metric; return the top row (SQL pattern: ORDER BY that metric DESC, NULLS LAST, LIMIT 1) or a small top-N — do not refuse as subjective criteria.
- In the assistant_message JSON field, state the rule in one short phrase (e.g. Treating best as highest revenue in this list.). Add the same to assumptions when helpful.

Tie-handling for extrema (highest / lowest / min / max):
- Unless the user explicitly asks for one row ("top 1", "single", "#1", "just one"), include all tied rows at the extreme value.
- Avoid LIMIT 1 for extrema when ties are likely; prefer tie-aware filtering (for example compare against a min/max subquery or CTE).
- If you intentionally return one row for an extrema question, say in assumptions that ties may exist and this is one representative row.

Discount-comparative phrasing ("least discount", "lowest discount", "most discounted"):
- "Least/lowest discount" means minimum discount value in the requested scope.
- If combined with a ranking objective (for example "products sold the most ... with least discount"), use two-step logic: first identify the minimum-discount cohort in-scope, then rank that cohort by the sales metric.
- Prefer CTEs/subqueries that aggregate cleanly over correlated subqueries that reference outer columns not in GROUP BY.
- When aggregating by product, group by stable keys (\`product_id\` plus \`product_name\`) to avoid brittle SQL.
- If the user pasted SQL and also gave a natural-language request, prioritize the natural-language intent and return clean SQL; do not copy malformed fragments.

Vague or underspecified prompts:
- If the user omits a time range, geography, or segment, default to the full Northwind sample for that dimension (e.g. all order dates, all regions) when one clear SELECT still follows; list those defaults in assumptions.
- If only one natural interpretation exists (e.g. "total orders" without filters), answer with kind=answer and state defaults in assumptions — do not over-clarify.
- Prefer answering with sensible defaults over clarifying when a safe SQL is still clear enough; then include assumptions and a short trust-improvement nudge naming the most useful missing specs (typically time window, dimension, and filters).
- Phrases like "regional breakdown", "orders by region", "order count by region" already specify the dimension (region). Use kind=answer with SQL: default to sales region path orders → employees → employee_territories → territories → region, unless they clearly mean ship-to geography (then use orders.ship_region or ship_country). Never ask whether they meant region versus "another dimension" — that is unhelpful over-clarification.
- If several interpretations are equally likely (e.g. "sales" could mean revenue, units, or order count by product vs by customer), use kind=clarify with one question that names the fork (pick one).
- For follow-ups like "what about X", "same for Y", "and the suppliers?", inherit tables, filters, and time window from the last assistant answer unless the user overrides.
- Referential follow-ups ("what about them", "how about those", "and them?", "same thing for…", "they" / "it" pointing back): resolve who or what the user means from the prior user + assistant turns — usually the entities or dimension just discussed. In assistant_message, state that link in one short phrase (e.g. Here for the same top customers we ranked by revenue.) so the answer is explicit. Prefer kind=answer with SQL that adds insight for those referents: a breakdown, comparison, trend slice, or next-level drill-down — not a vague restatement.
- If there is no concrete prior user referent (e.g. conversation starts with greeting/small talk, then "what about them"), do not guess from generic examples in assistant text; use kind=clarify and ask who/which entity they mean.
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

function parseLlmJson(raw: string): LlmPipelineResult {
  const parsedJson = JSON.parse(raw) as unknown;
  const parsed = llmPipelineSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Model JSON did not match the expected schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function runModel(context: string): Promise<LlmPipelineResult> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
  ]);
  return parseLlmJson(raw);
}

export async function repairSql(
  context: string,
  previousSql: string,
  errors: string[],
  priorAttempts?: { sql: string; errors: string[] }[],
): Promise<string> {
  const historyBlock =
    priorAttempts && priorAttempts.length > 0
      ? `\n\nPrior repair attempts that also failed:\n${priorAttempts.map((a, i) => `Attempt ${i + 1}:\nSQL: ${a.sql}\nErrors: ${a.errors.join("; ")}`).join("\n")}\nAvoid repeating the same mistakes.`
      : "";

  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${context}\n\nThe previous SQL failed validation:\nSQL:\n${previousSql}\nErrors:\n- ${errors.join("\n- ")}${historyBlock}\n\nReturn a NEW full JSON object with kind=answer and corrected sql only if you can fix it; otherwise kind=refuse with assistant_message explaining why.`,
    },
  ]);
  const parsed = parseLlmJson(raw);
  if (parsed.kind !== "answer" || !parsed.sql) {
    throw new Error(parsed.assistant_message || "Could not repair SQL.");
  }
  return parsed.sql;
}

export async function repairSqlForIntent(input: {
  context: string;
  previousSql: string;
  userMessage: string;
  confidence: number;
  mismatches: string[];
  clarifySuggestion?: string | null;
  priorAttempts?: { sql: string; confidence: number; mismatches: string[] }[];
}): Promise<string> {
  const mismatchLines = input.mismatches.length
    ? `\nMismatches:\n- ${input.mismatches.join("\n- ")}`
    : "\nMismatches:\n- None provided";
  const clarifyLine = input.clarifySuggestion?.trim()
    ? `\nClarify suggestion from verifier:\n${input.clarifySuggestion.trim()}`
    : "";
  const historyBlock =
    input.priorAttempts && input.priorAttempts.length > 0
      ? `\n\nPrior intent-repair attempts that still scored below threshold:\n${input.priorAttempts.map((a, i) => `Attempt ${i + 1}: confidence ${a.confidence}/100, SQL: ${a.sql}, mismatches: ${a.mismatches.join("; ") || "none"}`).join("\n")}\nTry a different approach to match the user intent.`
      : "";

  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${input.context}

The previous SQL may not match the user intent closely enough.
User question:
${input.userMessage}

Current SQL:
${input.previousSql}

Intent-verifier confidence: ${input.confidence}/100.${mismatchLines}${clarifyLine}${historyBlock}

Return a NEW full JSON object with kind=answer and corrected sql that better matches the user request. Do not ask the user to clarify if a reasonable SQL interpretation can be executed safely.`,
    },
  ]);
  const parsed = parseLlmJson(raw);
  if (parsed.kind !== "answer" || !parsed.sql) {
    throw new Error(parsed.assistant_message || "Could not repair intent alignment.");
  }
  return parsed.sql;
}

export async function repairSqlForExplain(input: {
  context: string;
  previousSql: string;
  userMessage: string;
  explainError: string;
  priorAttempts?: { sql: string; error: string }[];
}): Promise<string> {
  const historyBlock =
    input.priorAttempts && input.priorAttempts.length > 0
      ? `\n\nPrior repair attempts that also failed EXPLAIN:\n${input.priorAttempts.map((a, i) => `Attempt ${i + 1}:\nSQL: ${a.sql}\nEXPLAIN error: ${a.error}`).join("\n")}\nDo not repeat the same SQL or mistakes.`
      : "";

  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${input.context}

The previous SQL passed static allowlist checks but failed database EXPLAIN dry-run.
User question:
${input.userMessage}

Current SQL:
${input.previousSql}

EXPLAIN error:
${input.explainError}${historyBlock}

Return a NEW full JSON object with kind=answer and corrected sql that preserves the user intent.
Pay extra attention to aggregate correctness (GROUP BY vs non-aggregated selected columns), join keys, and date filters.
Do not return partial SQL fragments.`,
    },
  ]);
  const parsed = parseLlmJson(raw);
  if (parsed.kind !== "answer" || !parsed.sql) {
    throw new Error(parsed.assistant_message || "Could not repair SQL after EXPLAIN failure.");
  }
  return parsed.sql;
}

export function repairFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not repair SQL.";
}
