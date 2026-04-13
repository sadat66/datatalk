/**
 * AST-based join / aggregate fan-out detection for trust scoring.
 * Conservative when the parser fails or the shape is unfamiliar.
 */
import { Parser } from "node-sql-parser";
import type { Select } from "node-sql-parser";

const parser = new Parser();

function asSelect(node: unknown): Select | null {
  if (!node || typeof node !== "object") return null;
  const t = (node as { type?: string }).type;
  return t === "select" ? (node as Select) : null;
}

function normalizeFrom(from: Select["from"]): unknown[] {
  if (from == null) return [];
  return Array.isArray(from) ? from : [from];
}

/** Chained FROM items that use JOIN (INNER / LEFT / …); first item is the driving table. */
function countExplicitJoins(from: Select["from"]): number {
  let n = 0;
  for (const f of normalizeFrom(from)) {
    if (f && typeof f === "object" && "join" in f && (f as { join?: string }).join) {
      n += 1;
    }
  }
  return n;
}

function hasGroupBy(s: Select): boolean {
  const g = s.groupby as { columns?: unknown[] | null } | null | undefined;
  if (g == null) return false;
  const cols = g.columns;
  return Array.isArray(cols) && cols.length > 0;
}

function columnExpression(col: unknown): unknown {
  if (col && typeof col === "object" && "expr" in col && (col as { expr?: unknown }).expr != null) {
    return (col as { expr: unknown }).expr;
  }
  return col;
}

/** True if this expression is allowed as a full SELECT-list item for a scalar aggregate query (no GROUP BY) with a single join — i.e. no bare dimensions, no SELECT *. */
function scalarSelectListExpr(expr: unknown): boolean {
  if (expr == null || typeof expr !== "object") return true;

  const e = expr as Record<string, unknown>;
  const t = e.type as string | undefined;

  if (t === "aggr_func") {
    if (e.over) return false;
    return true;
  }
  if (t === "column_ref") return false;
  if (t === "star") return false;

  if (
    t === "number" ||
    t === "bool" ||
    t === "boolean" ||
    t === "null" ||
    t === "single_quote_string" ||
    t === "double_quote_string" ||
    t === "full_hex_string" ||
    t === "hex_string" ||
    t === "natural_string" ||
    t === "regexp_string"
  ) {
    return true;
  }

  if (t === "binary_expr") {
    return scalarSelectListExpr(e.left) && scalarSelectListExpr(e.right);
  }
  if (t === "cast") {
    const inner = (e.expr as unknown) ?? (e as { value?: unknown }).value;
    return scalarSelectListExpr(inner);
  }
  if (t === "case") {
    const args = e.args as unknown[] | undefined;
    if (!Array.isArray(args)) return false;
    for (const a of args) {
      if (!a || typeof a !== "object") continue;
      const arm = a as { type?: string; cond?: unknown; result?: unknown };
      if (arm.type === "when" && !scalarSelectListExpr(arm.cond)) return false;
      if (arm.result != null && !scalarSelectListExpr(arm.result)) return false;
    }
    return true;
  }
  if (t === "function") {
    const args = e.args as { value?: unknown[] } | undefined;
    const vals = args?.value;
    if (!Array.isArray(vals)) return false;
    for (const arg of vals) {
      if (!scalarSelectListExpr(arg)) return false;
    }
    return true;
  }

  if (t === "expr_list") {
    const vals = e.value as unknown[] | undefined;
    if (!Array.isArray(vals)) return false;
    return vals.every((x) => scalarSelectListExpr(x));
  }

  return false;
}

function selectListAllowsScalarAggregateWithOneJoin(s: Select): boolean {
  const cols = s.columns as unknown[] | undefined;
  if (!cols?.length) return false;
  for (const col of cols) {
    if (!scalarSelectListExpr(columnExpression(col))) return false;
  }
  return true;
}

/**
 * One SELECT block: should we penalize trust for join / grain issues?
 * - 0 joins in this block: no penalty from joins here.
 * - 2+ joins: penalty (fan-out paths).
 * - CROSS JOIN anywhere in full SQL: penalty (parser may mangle CROSS).
 * - 1 join + GROUP BY: penalty (grain ambiguity vs joins).
 * - 1 join + no GROUP BY but SELECT not all-aggregates: penalty.
 * - 1 join + scalar aggregates only: no penalty.
 */
function localSelectJoinPenalty(s: Select, fullSql: string): boolean {
  if (/\bcross\s+join\b/i.test(fullSql)) return true;

  const jc = countExplicitJoins(s.from);
  if (jc === 0) return false;
  if (jc >= 2) return true;

  if (hasGroupBy(s)) return true;
  if (!selectListAllowsScalarAggregateWithOneJoin(s)) return true;
  return false;
}

function visitExprForNestedSelects(node: unknown, visit: (s: Select) => void): void {
  if (node == null) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) visitExprForNestedSelects(x, visit);
    return;
  }

  const o = node as Record<string, unknown>;
  if (o.type === "select") {
    visitSelectDeep(o as unknown as Select, visit);
    return;
  }

  for (const k of Object.keys(o)) {
    if (k === "loc") continue;
    visitExprForNestedSelects(o[k], visit);
  }
}

/** Visit every SELECT (including UNION arms and nested subqueries). */
function visitSelectDeep(s: Select | null | undefined, visit: (s: Select) => void): void {
  if (!s) return;

  let cur: Select | undefined = s;
  while (cur) {
    visit(cur);

    const w = cur.with;
    if (Array.isArray(w)) {
      for (const cte of w) {
        const stmt = (cte as { stmt?: { ast?: unknown } }).stmt;
        const inner = stmt?.ast;
        const sel = asSelect(inner);
        if (sel) visitSelectDeep(sel, visit);
      }
    }

    for (const f of normalizeFrom(cur.from)) {
      const fe = f as { expr?: { ast?: unknown } };
      const inner = fe.expr?.ast;
      const sel = asSelect(inner);
      if (sel) visitSelectDeep(sel, visit);
    }

    visitExprForNestedSelects(cur.where, visit);
    visitExprForNestedSelects(cur.having, visit);

    for (const col of (cur.columns ?? []) as unknown[]) {
      visitExprForNestedSelects(columnExpression(col), visit);
    }

    cur = (cur as Select & { _next?: Select })._next;
  }
}

/** True = apply join fan-out trust penalty (same meaning as legacy `joinHeuristic` true). */
export function joinFanoutTrustPenaltyFromAst(root: Select, fullSql: string): boolean {
  let penalty = false;
  visitSelectDeep(root, (s) => {
    if (localSelectJoinPenalty(s, fullSql)) penalty = true;
  });
  return penalty;
}

export function inferJoinFanoutTrustPenalty(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;
  try {
    const parsed = parser.parse(trimmed, { database: "postgresql" });
    const ast = (Array.isArray(parsed.ast) ? parsed.ast[0] : parsed.ast) as Select;
    if (!ast || ast.type !== "select") return /\bjoin\b/i.test(trimmed);
    return joinFanoutTrustPenaltyFromAst(ast, trimmed);
  } catch {
    return /\bjoin\b/i.test(trimmed);
  }
}
