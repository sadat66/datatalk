import { Parser } from "node-sql-parser";
import type { Select } from "node-sql-parser";

import { buildSqlWhitelist } from "@/lib/northwind/schema";
import { joinFanoutTrustPenaltyFromAst } from "@/lib/datatalk/join-risk";

const parser = new Parser();
const { tables: TABLE_WHITELIST, columns: COLUMN_WHITELIST } = buildSqlWhitelist();

const BLOCKED = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|pg_sleep|dblink|lo_import|set\s+role)\b/i;

export type SqlValidationResult =
  | { ok: true; normalizedSql: string; joinFanoutTrustPenalty: boolean }
  | { ok: false; errors: string[] };

export function validateSelectSql(rawSql: string): SqlValidationResult {
  const errors: string[] = [];
  const sql = rawSql.trim();

  if (!sql) {
    return { ok: false, errors: ["Empty SQL."] };
  }
  if (sql.length > 12_000) {
    return { ok: false, errors: ["SQL is too long."] };
  }
  if (sql.includes(";")) {
    return { ok: false, errors: ["Multiple statements are not allowed (found ';')."] };
  }
  if (BLOCKED.test(sql)) {
    return { ok: false, errors: ["Only read-only SELECT queries are allowed."] };
  }
  if (!/^\s*select\b/i.test(sql)) {
    return { ok: false, errors: ["Query must start with SELECT."] };
  }

  let parsed: ReturnType<Parser["parse"]>;
  try {
    parsed = parser.parse(sql, { database: "postgresql" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse error";
    return { ok: false, errors: [`SQL parse error: ${msg}`] };
  }

  const ast = Array.isArray(parsed.ast) ? parsed.ast[0] : parsed.ast;
  if (!ast || (ast as { type?: string }).type !== "select") {
    return { ok: false, errors: ["Expected a single SELECT statement."] };
  }
  if (Array.isArray(parsed.ast) && parsed.ast.length > 1) {
    return { ok: false, errors: ["Multiple statements are not allowed."] };
  }

  try {
    parser.whiteListCheck(sql, TABLE_WHITELIST, { database: "postgresql", type: "table" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Table allowlist: ${msg}`);
  }

  try {
    parser.whiteListCheck(sql, COLUMN_WHITELIST, { database: "postgresql", type: "column" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Column allowlist: ${msg}`);
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const joinFanoutTrustPenalty = joinFanoutTrustPenaltyFromAst(ast as Select, sql);
  return { ok: true, normalizedSql: sql, joinFanoutTrustPenalty };
}
