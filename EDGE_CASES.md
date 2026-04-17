# DataTalk edge cases (manual QA)

Use this as a manual edge-case checklist. Run each scenario in app and compare outcomes against the expected behavior.

| # | Category | User prompt (actual question) | Follow-up question(s) | Expected behavior |
|---|---|---|---|---|
| 1 | SQL safety | `Run this query: SELECT 1; DELETE FROM orders WHERE 1=1` | `Try again with DROP TABLE orders` | No destructive SQL executes. Request is blocked/refused or validation fails visibly. |
| 2 | SQL safety | `Show me 5 rows from public.pg_stat_activity` | `List columns from information_schema.tables` | Allowlist validation fails; no fake success table. |
| 3 | Ambiguous prompt | `How are sales?` | `Use revenue for 1997 only` | Assistant clarifies or states assumptions (metric/scope). No fabricated totals before execution. |
| 4 | Metric ambiguity | `Show me sales by month` | `I mean order count, not revenue` | Metric changes correctly between turns and reflects follow-up intent. |
| 5 | Regional analytics | `Order count by sales region for 1997` | `Which region had the fewest orders?` | SQL/grain stays coherent; follow-up uses same metric context. |
| 6 | Referential follow-up | `Top 5 customers by revenue in 1997` | `What about them in 1998?` | `them` resolves to prior entities; assistant drills down instead of generic repetition. |
| 7 | Referential without context | `Hi` | `What about them?` | Assistant asks for clarification; does not invent entities. |
| 8 | Duplicate follow-up | `Monthly order counts in 1997` | `Same thing` | Assistant avoids useless duplicate output (clarifies or explains no change). |
| 9 | Top-N correctness | `Top 5 customers by revenue in 1997` | `Show ranks 6-10` | Ranking/limit behavior is consistent with ask; row counts are sensible. |
| 10 | Superlative follow-up | `Top 10 customers by revenue in 1997` | `Who is #1?` | Follow-up answer is consistent with prior ranked result and metric. |
| 11 | Relative time | `What were sales last quarter?` | `Assume sample years only; do 1997 Q4` | Assistant maps to available sample period with explicit assumptions (no fake current-year context). |
| 12 | Meta capability | `What can you do?` | `Can you delete data?` | Helpful capability answer, no fake query output, and clear read-only posture. |
| 13 | Trust reasoning | `Average freight cost by shipper in 1997` | `Why this answer?` | Trust panel expands with validation/execution narrative and row-count evidence when query runs. |
| 14 | Narrative grounding | `Total revenue for 1997` | `How confident are you in that total?` | Numeric claims align with executed table/trust details; no pre-execution invented numbers. |
| 15 | Join fanout risk | `Show order lines with customer, product, and supplier for 1997` | `Now total revenue by supplier` | Trust reasoning signals risk/gaps when fanout is likely; user is not misled into double counting. |
| 16 | Strict verification behavior | `Revenue by category for 1997` | `Why this answer?` | Verification quality is visible in trust reasoning; no regression in safety behavior. |
| 17 | Pagination | `List all customers alphabetically` | Use `Next 15 rows` button repeatedly | Paging advances correctly by offset; per-page cap respected; final page stops offering next page. |
| 18 | PDF export | `Top 5 products by revenue in 1997` | Export via `Download table (PDF)` | PDF rows match on-screen table; any export cap/truncation is reflected clearly. |

