/**
 * Gold-standard NL → SQL pairs for few-shot grounding (Northwind PostgreSQL).
 * Keep identifiers lowercase; single SELECT; no semicolons (app rule).
 */
export function goldStandardExamplesBlock(): string {
  return `
Gold-standard examples (Northwind; adapt patterns, do not copy blindly):
1) "Total revenue by category" → SELECT c.category_name, sum(od.unit_price * od.quantity * (1 - od.discount)) AS revenue FROM order_details od JOIN products p ON p.product_id = od.product_id JOIN categories c ON c.category_id = p.category_id GROUP BY c.category_name ORDER BY revenue DESC NULLS LAST
2) "Top 5 customers by order total" → SELECT c.company_name, sum(od.unit_price * od.quantity * (1 - od.discount)) AS total FROM orders o JOIN order_details od ON od.order_id = o.order_id JOIN customers c ON c.customer_id = o.customer_id GROUP BY c.company_name ORDER BY total DESC NULLS LAST LIMIT 5
3) "Orders per month in 1997" → SELECT date_trunc('month', o.order_date) AS month, count(*)::bigint AS order_count FROM orders o WHERE o.order_date >= '1997-01-01' AND o.order_date < '1998-01-01' GROUP BY date_trunc('month', o.order_date) ORDER BY month
4) "Average freight by shipper" → SELECT s.company_name, avg(o.freight) AS avg_freight FROM orders o JOIN shippers s ON s.shipper_id = o.ship_via GROUP BY s.company_name ORDER BY avg_freight DESC NULLS LAST
5) "Products low in stock" → SELECT p.product_name, p.units_in_stock FROM products p WHERE p.discontinued = 0 AND p.units_in_stock < p.reorder_level ORDER BY p.units_in_stock ASC LIMIT 20
6) "Sales count by employee territory region" → SELECT r.region_description, count(DISTINCT o.order_id)::bigint AS orders FROM orders o JOIN employees e ON e.employee_id = o.employee_id JOIN employee_territories et ON et.employee_id = e.employee_id JOIN territories t ON t.territory_id = et.territory_id JOIN region r ON r.region_id = t.region_id GROUP BY r.region_description ORDER BY orders DESC NULLS LAST
7) "Top 10 products by units sold" → SELECT p.product_name, sum(od.quantity)::bigint AS units_sold FROM order_details od JOIN products p ON p.product_id = od.product_id GROUP BY p.product_name ORDER BY units_sold DESC NULLS LAST LIMIT 10
8) "Customers in France" → SELECT company_name, city FROM customers WHERE country = 'France' ORDER BY company_name LIMIT 50
9) "Revenue for Seafood category" → SELECT sum(od.unit_price * od.quantity * (1 - od.discount)) AS revenue FROM order_details od JOIN products p ON p.product_id = od.product_id JOIN categories c ON c.category_id = p.category_id WHERE c.category_name = 'Seafood'
10) "Compare Dairy vs Beverages revenue" → SELECT c.category_name, sum(od.unit_price * od.quantity * (1 - od.discount)) AS revenue FROM order_details od JOIN products p ON p.product_id = od.product_id JOIN categories c ON c.category_id = p.category_id WHERE c.category_name IN ('Dairy Products', 'Beverages') GROUP BY c.category_name
11) "Shippers by number of orders" → SELECT s.company_name, count(*)::bigint AS shipments FROM orders o JOIN shippers s ON s.shipper_id = o.ship_via GROUP BY s.company_name ORDER BY shipments DESC NULLS LAST
12) Prefer semantic view datatalk_order_details_extended for line-level revenue + category when it reduces join errors: filter on category_name, group by product_name, etc.
`.trim();
}
