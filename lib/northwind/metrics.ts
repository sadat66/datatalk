/** Curated business metrics — wild-card “metric dictionary” for grounded NL→SQL. */

export type NorthwindMetric = {
  id: string;
  name: string;
  description: string;
  /** Expression usable inside SELECT list / aggregates (already qualified where needed). */
  sqlExpr: string;
  defaultGrain: string;
  tables: readonly string[];
};

export const NORTHWIND_METRICS: readonly NorthwindMetric[] = [
  {
    id: "line_revenue",
    name: "Line revenue",
    description: "Revenue from order line items before tax (unit price × quantity × (1 − discount)).",
    sqlExpr: "od.unit_price * od.quantity * (1 - COALESCE(od.discount, 0))",
    defaultGrain: "per order line (order_details row)",
    tables: ["order_details"],
  },
  {
    id: "order_count",
    name: "Order count",
    description: "Number of orders (rows in orders).",
    sqlExpr: "1",
    defaultGrain: "per order row — use COUNT(o.order_id) with alias o on orders",
    tables: ["orders"],
  },
  {
    id: "units_sold",
    name: "Units sold",
    description: "Sum of quantities shipped on order lines.",
    sqlExpr: "od.quantity",
    defaultGrain: "SUM over order_details as od",
    tables: ["order_details"],
  },
] as const;

export function metricsPromptBlock(): string {
  return NORTHWIND_METRICS.map(
    (m) =>
      `- ${m.id}: ${m.name} — ${m.description} [expr: ${m.sqlExpr}] [tables: ${m.tables.join(", ")}] [grain: ${m.defaultGrain}]`,
  ).join("\n");
}
