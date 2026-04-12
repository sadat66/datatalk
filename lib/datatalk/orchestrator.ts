import { chatCompletionJson } from "@/lib/ai/completion";
import { metricsPromptBlock } from "@/lib/northwind/metrics";
import { buildSchemaPromptExcerpt } from "@/lib/northwind/schema";
import { buildConversationContext } from "@/lib/datatalk/query-intelligence";
import { executeReadonlySelect } from "@/lib/datatalk/executor";
import { llmPipelineSchema, type LlmPipelineResult, type TrustReport } from "@/lib/datatalk/types";
import { buildTrustReport } from "@/lib/datatalk/trust";
import { validateSelectSql } from "@/lib/datatalk/sql-validator";
import { sqlContextFollowUp } from "@/lib/datatalk/conversation-nudges";
import { critiqueNorthwindSql, isSqlCritiqueEnabled } from "@/lib/datatalk/sql-critique";

type Turn = { role: "user" | "assistant"; text: string };

const SYSTEM_PROMPT = `You are DataTalk, an analytics assistant for the Northwind PostgreSQL database.
You must respond with a single JSON object (no markdown) using this shape:
{
  "kind": "answer" | "clarify" | "refuse",
  "assistant_message": string (short, business-friendly),
  "clarify_question": string | null (one targeted question if kind is clarify),
  "sql": string | null (a single PostgreSQL SELECT if kind is answer; otherwise null),
  "plan_summary": string | null,
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
- Use lowercase identifiers matching the schema. Dates in Northwind are mostly in the 1990s sample data.
- When using metrics, set metric_ids to the ids you relied on.
- If the user message includes "Focus for this turn" with join recipes, prefer those join paths over inventing new keys (especially ship_* vs territories).

Ranking and words like "best" / "top" / "winner":
- Here, those words mean objective ordering on a numeric field, not subjective opinion. Default "best" to highest value of the measure already in play (e.g. revenue, totals, counts) unless the user clearly asked for the opposite ("lowest", "worst performer", "cheapest").
- If they just saw a ranked or tabular answer and ask who is the best / which is #1 / who wins, reuse the same grain, filters, and metric; return the top row (SQL pattern: ORDER BY that metric DESC, NULLS LAST, LIMIT 1) or a small top-N — do not refuse as subjective criteria.
- In the assistant_message JSON field, state the rule in one short phrase (e.g. Treating best as highest revenue in this list.). Add the same to assumptions when helpful.

Vague or underspecified prompts:
- If the user omits a time range, geography, or segment, default to the full Northwind sample for that dimension (e.g. all order dates, all regions) when one clear SELECT still follows; list those defaults in assumptions.
- If only one natural interpretation exists (e.g. "total orders" without filters), answer with kind=answer and state defaults in assumptions — do not over-clarify.
- Phrases like "regional breakdown", "orders by region", "order count by region" already specify the dimension (region). Use kind=answer with SQL: default to sales region path orders → employees → employee_territories → territories → region, unless they clearly mean ship-to geography (then use orders.ship_region or ship_country). Never ask whether they meant region versus "another dimension" — that is unhelpful over-clarification.
- If several interpretations are equally likely (e.g. "sales" could mean revenue, units, or order count by product vs by customer), use kind=clarify with one question that names the fork (pick one).
- For follow-ups like "what about X", "same for Y", "and the suppliers?", inherit tables, filters, and time window from the last assistant answer unless the user overrides.
- Relative dates ("this year", "last quarter") do not match the 1990s sample literally — either clarify that the dataset is historical demo data or answer on full sample and say so in assumptions.

Meta and discovery questions (what can you do, what insights are available, how does this work):
- These are in scope. Use kind=answer with sql set to null (no query yet). Write a short, welcoming assistant_message: you analyze the Northwind sales sample (orders, customers, products, suppliers, shippers, territories, etc.), run read-only SQL after safety checks, and explain results.
- Include 4–6 concrete example prompts the user could paste next (e.g. revenue by category, top customers by order total, monthly order counts, freight by shipper, products low in stock). Do not refuse for lack of a "specific question" — you are the guide. For this pattern use kind=answer, sql null, and clarify_question null; weave any gentle nudge (e.g. pick revenue vs products) into assistant_message.

Data-backed answers (kind=answer with non-null sql):
- In assistant_message, give findings and definitions only (no trailing "what next" question). The app will append a short row summary and then a suggested follow-up question tied to the query.

Known metrics (prefer citing metric_ids when you use them):
${metricsPromptBlock()}

Allowlisted schema (tables and columns):
${buildSchemaPromptExcerpt()}
`;

function joinHeuristic(sql: string | null | undefined): boolean {
  if (!sql) return false;
  return /\bjoin\b/i.test(sql);
}

function parseLlmJson(raw: string): LlmPipelineResult {
  const parsedJson = JSON.parse(raw) as unknown;
  const parsed = llmPipelineSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Model JSON did not match the expected schema: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function runModel(context: string): Promise<LlmPipelineResult> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
  ]);
  return parseLlmJson(raw);
}

async function repairSql(context: string, previousSql: string, errors: string[]): Promise<string> {
  const raw = await chatCompletionJson([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${context}\n\nThe previous SQL failed validation:\nSQL:\n${previousSql}\nErrors:\n- ${errors.join("\n- ")}\n\nReturn a NEW full JSON object with kind=answer and corrected sql only if you can fix it; otherwise kind=refuse with assistant_message explaining why.`,
    },
  ]);
  const parsed = parseLlmJson(raw);
  if (parsed.kind !== "answer" || !parsed.sql) {
    throw new Error(parsed.assistant_message || "Could not repair SQL.");
  }
  return parsed.sql;
}

function repairFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not repair SQL.";
}

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
};

export async function runOrchestrator(input: {
  turns: Turn[];
  message: string;
}): Promise<OrchestratorResult> {
  const context = buildConversationContext(input.turns, input.message);
  let hadRepair = false;

  const model = await runModel(context);

  if (model.kind === "clarify") {
    const trust = buildTrustReport({
      validationPassed: false,
      validationDetails: ["No SQL executed — clarification requested."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: false,
      joinHeuristic: false,
    });
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
    const trust = buildTrustReport({
      validationPassed: false,
      validationDetails: ["Model refused to generate SQL."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: false,
      joinHeuristic: false,
    });
    return { assistant_message: model.assistant_message, kind: "refuse", trust };
  }

  let sql = typeof model.sql === "string" ? model.sql.trim() : "";
  if (!sql) {
    const trust = buildTrustReport({
      validationPassed: false,
      validationDetails: ["Model returned answer without SQL."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair: false,
      joinHeuristic: false,
    });
    return {
      assistant_message: model.assistant_message || "I could not produce a query for that request.",
      kind: "answer",
      trust,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    };
  }

  if (isSqlCritiqueEnabled() && joinHeuristic(sql)) {
    try {
      const cr = await critiqueNorthwindSql({ userQuestion: input.message, sql });
      const rev = typeof cr.revised_sql === "string" ? cr.revised_sql.trim() : "";
      if (!cr.ok_to_run && rev) {
        const revVal = validateSelectSql(rev);
        if (revVal.ok) {
          sql = rev;
        }
      }
    } catch {
      /* optional second LLM; ignore */
    }
  }

  let validation = validateSelectSql(sql);
  let failedValidationErrors = !validation.ok ? [...validation.errors] : [];
  if (!validation.ok) {
    try {
      sql = await repairSql(context, sql, validation.errors);
      hadRepair = true;
      validation = validateSelectSql(sql);
      failedValidationErrors = !validation.ok ? [...validation.errors] : failedValidationErrors;
    } catch (err) {
      const trust = buildTrustReport({
        validationPassed: false,
        validationDetails: failedValidationErrors,
        rowCount: 0,
        limited: false,
        executionMs: 0,
        skippedExecution: true,
        hadRepair,
        joinHeuristic: joinHeuristic(sql),
      });
      return {
        assistant_message: `I could not generate a safe query for that request. (${repairFailureMessage(err)})`,
        kind: "answer",
        trust,
      };
    }
  }

  if (!validation.ok) {
    const trust = buildTrustReport({
      validationPassed: false,
      validationDetails: validation.errors,
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair,
      joinHeuristic: joinHeuristic(sql),
    });
    return {
      assistant_message:
        "That query failed safety checks after a repair attempt. Please rephrase your question.",
      kind: "answer",
      trust,
    };
  }

  const exec = await executeReadonlySelect(validation.normalizedSql);
  if (!exec.ok) {
    const trust = buildTrustReport({
      validationPassed: true,
      validationDetails: ["Parsed SQL and allowlist checks passed."],
      rowCount: 0,
      limited: false,
      executionMs: 0,
      skippedExecution: true,
      hadRepair,
      joinHeuristic: joinHeuristic(sql),
    });
    return {
      assistant_message: `The query could not be executed: ${exec.error}`,
      kind: "answer",
      sql: validation.normalizedSql,
      trust,
      plan_summary: model.plan_summary,
      metric_ids: model.metric_ids,
      assumptions: model.assumptions,
    };
  }

  const trust = buildTrustReport({
    validationPassed: true,
    validationDetails: ["Parsed SQL", "Allowlisted tables/columns", "Single SELECT"],
    rowCount: exec.rowCount,
    limited: exec.limited,
    executionMs: exec.ms,
    skippedExecution: false,
    hadRepair,
    joinHeuristic: joinHeuristic(sql),
  });

  const rowPreview =
    exec.rows.length === 0
      ? "No rows matched."
      : `Returned ${exec.rowCount} row(s)${exec.limited ? " (capped)" : ""}.`;

  const trimmedNarrative = model.assistant_message.trim();

  return {
    assistant_message: `${trimmedNarrative}\n\n${rowPreview}\n\n${sqlContextFollowUp(validation.normalizedSql)}`,
    kind: "answer",
    sql: validation.normalizedSql,
    rows: exec.rows,
    trust,
    plan_summary: model.plan_summary,
    metric_ids: model.metric_ids,
    assumptions: model.assumptions,
  };
}
