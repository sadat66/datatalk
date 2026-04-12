/** Suggested next-step question from executed SQL — appended after row counts to keep threads moving. */

export function sqlContextFollowUp(sql: string): string {
  const lower = sql.toLowerCase();
  const has = (t: string) => new RegExp(`\\b${t}\\b`, "i").test(lower);

  if (has("products") || /\bproduct_id\b/i.test(lower)) {
    return "Want to see suppliers or categories for these products next, or which orders used them most?";
  }
  if (has("order_details")) {
    return "Want to roll this up by order date, customer, or product next?";
  }
  if (has("orders")) {
    return "Should we trend this over time, split by shipper, or add customer or territory context next?";
  }
  if (has("customers")) {
    return "Want to rank by order totals, segment by country, or open recent order lines next?";
  }
  if (has("employees")) {
    return "Compare another sales metric for these people, or map results by territory next?";
  }
  if (has("suppliers")) {
    return "Want to list products by supplier, or tie suppliers back to order lines next?";
  }
  if (has("categories")) {
    return "Drill into products in a category, or compare revenue across categories next?";
  }
  return "Want to add another slice next — for example by region, time period, or product category?";
}
