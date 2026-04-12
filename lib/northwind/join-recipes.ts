/**
 * Curated join semantics for Northwind (PostgreSQL). Used by retrieval to bias the LLM
 * toward valid paths — not a substitute for a join linter.
 */

export type JoinRecipe = {
  /** Tables that trigger inclusion when mentioned in the user text */
  triggers: readonly string[];
  /** Extra triggers: plain words (lowercase) */
  keywords?: readonly string[];
  title: string;
  body: string;
};

export const JOIN_RECIPES: readonly JoinRecipe[] = [
  {
    triggers: ["orders", "employees", "employee_territories", "territories", "region"],
    keywords: ["sales region", "territory", "territories"],
    title: "Orders ↔ sales region (catalog)",
    body: `Valid path: orders.employee_id → employees.employee_id → employee_territories → territories.territory_id → region.region_id.
orders.ship_region is ship-to address text, NOT territories.territory_id — never join them for sales-region rollups.`,
  },
  {
    triggers: ["orders", "customers"],
    keywords: ["ship to", "shipping address"],
    title: "Orders ↔ customers",
    body: "orders.customer_id → customers.customer_id. Use ship_* columns only for geography on the label, not for territory dimension.",
  },
  {
    triggers: ["orders", "order_details", "products"],
    keywords: ["revenue", "line total", "order lines"],
    title: "Order lines ↔ products",
    body: "orders.order_id → order_details.order_id; order_details.product_id → products.product_id. Extended line amount: unit_price * quantity * (1 - discount).",
  },
  {
    triggers: ["products", "suppliers", "categories"],
    keywords: [],
    title: "Products ↔ supplier & category",
    body: "products.supplier_id → suppliers.supplier_id; products.category_id → categories.category_id.",
  },
  {
    triggers: ["orders", "shippers"],
    keywords: ["freight", "carrier"],
    title: "Orders ↔ shippers",
    body: "orders.ship_via → shippers.shipper_id.",
  },
];
