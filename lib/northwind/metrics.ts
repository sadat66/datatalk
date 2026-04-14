/** Curated business metrics — wild-card “metric dictionary” for grounded NL→SQL. */

export type NorthwindMetric = {
  id: string;
  name: string;
  description: string;
  /** Expression usable inside SELECT list / aggregates (already qualified where needed). */
  sqlExpr: string;
  defaultGrain: string;
  tables: readonly string[];
  category: "revenue" | "orders" | "customers" | "shipping" | "inventory";
  sampleQuestion: string;
};

export const NORTHWIND_METRICS: readonly NorthwindMetric[] = [
  {
    id: "line_revenue",
    name: "Line revenue",
    description: "Revenue from order line items before tax (unit price × quantity × (1 − discount)).",
    sqlExpr: "od.unit_price * od.quantity * (1 - COALESCE(od.discount, 0))",
    defaultGrain: "per order line (order_details row)",
    tables: ["order_details"],
    category: "revenue",
    sampleQuestion: "Revenue by category in 1997.",
  },
  {
    id: "gross_line_revenue",
    name: "Gross line revenue",
    description: "Revenue before discount (unit price × quantity). Useful to compare discount impact.",
    sqlExpr: "od.unit_price * od.quantity",
    defaultGrain: "per order line (order_details row)",
    tables: ["order_details"],
    category: "revenue",
    sampleQuestion: "Gross revenue by product for 1998.",
  },
  {
    id: "discount_amount",
    name: "Discount amount",
    description: "Absolute value discounted on line items (unit price × quantity × discount).",
    sqlExpr: "od.unit_price * od.quantity * COALESCE(od.discount, 0)",
    defaultGrain: "per order line (order_details row)",
    tables: ["order_details"],
    category: "revenue",
    sampleQuestion: "Discount amount by category in 1997.",
  },
  {
    id: "avg_order_value",
    name: "Average order value",
    description: "Average net revenue per order.",
    sqlExpr:
      "SUM(od.unit_price * od.quantity * (1 - COALESCE(od.discount, 0))) / NULLIF(COUNT(DISTINCT o.order_id), 0)",
    defaultGrain: "aggregated result set using orders as o and order_details as od",
    tables: ["orders", "order_details"],
    category: "revenue",
    sampleQuestion: "Average order value by month for 1997.",
  },
  {
    id: "order_count",
    name: "Order count",
    description: "Number of orders (rows in orders).",
    sqlExpr: "1",
    defaultGrain: "per order row — use COUNT(o.order_id) with alias o on orders",
    tables: ["orders"],
    category: "orders",
    sampleQuestion: "Order count by region in 1998.",
  },
  {
    id: "late_order_count",
    name: "Late order count",
    description: "Orders shipped after required date.",
    sqlExpr: "CASE WHEN o.shipped_date > o.required_date THEN 1 ELSE 0 END",
    defaultGrain: "per order row — SUM(...) with alias o on orders",
    tables: ["orders"],
    category: "shipping",
    sampleQuestion: "Late order count by shipper in 1997.",
  },
  {
    id: "on_time_ship_rate",
    name: "On-time shipping rate",
    description: "Percentage of shipped orders delivered by required date.",
    sqlExpr:
      "SUM(CASE WHEN o.shipped_date IS NOT NULL AND (o.required_date IS NULL OR o.shipped_date <= o.required_date) THEN 1 ELSE 0 END)::numeric / NULLIF(SUM(CASE WHEN o.shipped_date IS NOT NULL THEN 1 ELSE 0 END), 0)",
    defaultGrain: "aggregated result set using orders as o",
    tables: ["orders"],
    category: "shipping",
    sampleQuestion: "On-time shipping rate by month in 1998.",
  },
  {
    id: "units_sold",
    name: "Units sold",
    description: "Sum of quantities shipped on order lines.",
    sqlExpr: "od.quantity",
    defaultGrain: "SUM over order_details as od",
    tables: ["order_details"],
    category: "orders",
    sampleQuestion: "Units sold by product category in 1997.",
  },
  {
    id: "new_customer_count",
    name: "New customer count",
    description: "Count of customers whose first recorded order falls in the selected period.",
    sqlExpr: "1",
    defaultGrain: "per customer in a first_order CTE before aggregating by period",
    tables: ["orders", "customers"],
    category: "customers",
    sampleQuestion: "New customer count by month in 1998.",
  },
  {
    id: "inventory_gap_units",
    name: "Inventory gap units",
    description: "Units needed to hit reorder level when stock is below threshold.",
    sqlExpr: "GREATEST(p.reorder_level - p.units_in_stock, 0)",
    defaultGrain: "per product row using products as p",
    tables: ["products"],
    category: "inventory",
    sampleQuestion: "Products with largest inventory gap units.",
  },
] as const;

export function metricsPromptBlock(): string {
  return NORTHWIND_METRICS.map(
    (m) =>
      `- ${m.id}: ${m.name} — ${m.description} [expr: ${m.sqlExpr}] [tables: ${m.tables.join(", ")}] [grain: ${m.defaultGrain}]`,
  ).join("\n");
}
