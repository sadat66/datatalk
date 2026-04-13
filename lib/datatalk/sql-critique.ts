import { z } from "zod";
import { chatCompletionJson } from "@/lib/ai/completion";

const critiqueSchema = z.object({
  ok_to_run: z.boolean(),
  issues: z.array(z.string()),
  revised_sql: z.string().nullable().optional(),
});

export type SqlCritiqueResult = z.infer<typeof critiqueSchema>;

const CRITIQUE_SYSTEM = `You are a strict Northwind PostgreSQL SQL reviewer for a read-only analytics app.
The database is classic Northwind: orders, customers, products, order_details, employees, suppliers, shippers, categories, region, territories, employee_territories, etc.

Check JOIN semantics and grain:
- orders.ship_region / ship_city / ship_country are SHIPPING ADDRESS fields, not foreign keys to territories. Never equate ship_region to territories.territory_id for "sales by region" — use orders.employee_id → employees → employee_territories → territories → region instead.
- territory_id types: join on the correct types; do not invent keys.

PostgreSQL validity for revised_sql:
- revised_sql must be executable PostgreSQL. Do not put aggregate functions (COUNT, SUM, AVG, MIN, MAX, etc.) in WHERE or JOIN … ON conditions unless they appear inside a subquery that groups appropriately (use HAVING in grouped subqueries, or CTEs / window functions).
- Example of an invalid pattern: WHERE id IN (SELECT … GROUP BY … ORDER BY COUNT(*) …) — ORDER BY COUNT in a subquery used only for IN can still be wrong; prefer RANK()/ROW_NUMBER() OVER (ORDER BY …) or a grouped subquery with HAVING.

Return a single JSON object only:
{
  "ok_to_run": boolean,
  "issues": string[] (empty if ok),
  "revised_sql": string | null (a single SELECT without semicolon, or null if ok_to_run or you cannot fix)
}

If you provide revised_sql, it must be a complete replacement SELECT. Set ok_to_run true only when the original SQL is sound; if you supply a fixed revised_sql, you may set ok_to_run false and put the fixed query in revised_sql.`;

/** Second-pass LLM review of JOIN semantics; on by default — set DATATALK_SQL_CRITIQUE=0 to disable. */
export function isSqlCritiqueEnabled(): boolean {
  const v = process.env.DATATALK_SQL_CRITIQUE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

export async function critiqueNorthwindSql(input: {
  userQuestion: string;
  sql: string;
}): Promise<SqlCritiqueResult> {
  const raw = await chatCompletionJson([
    { role: "system", content: CRITIQUE_SYSTEM },
    {
      role: "user",
      content: `User question:\n${input.userQuestion}\n\nSQL to review:\n${input.sql}`,
    },
  ]);

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return { ok_to_run: true, issues: [], revised_sql: null };
  }
  const parsed = critiqueSchema.safeParse(json);
  if (!parsed.success) {
    return { ok_to_run: true, issues: [], revised_sql: null };
  }
  return parsed.data;
}
