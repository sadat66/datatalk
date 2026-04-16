# DataTalk — edge cases (manual QA)

Use this as a **manual test log**. Run each scenario in the app (or note *N/A* if not applicable), then fill in **Pass / Fail** and **Notes** (what you observed, screenshots, model behavior).

**Legend**

- **Pass** — Behavior matches the expected outcome (or an acceptable documented alternative).
- **Fail** — Wrong data, unsafe SQL executed, silent hallucination, crash, or misleading UX.
- **N/A** — Blocked by environment (e.g. no DB), or scenario does not apply.

| # | Scenario | Expected (high level) | Pass / Fail | Notes |
|---|----------|------------------------|-------------|-------|
| 1 | Paste SQL with `;` or `DELETE` / `DROP` in chat | Request blocked or refused; no destructive SQL runs | | |
| 2 | Ask for non-allowlisted table or column | Validation fails; user sees failure in trust / message, not silent success | | |
| 3 | Ask something vague: “How are sales?” | Clarify **or** answer with explicit assumptions (metric + scope) — not a random guess with fake numbers | | |
| 4 | Ask “sales” without defining revenue vs units vs order count | Either one clarify question **or** one metric with assumptions stated | | |
| 5 | “Regional breakdown” / “orders by region” | Sensible SQL (sales-region path or ship geography) with assumptions if ambiguous | | |
| 6 | Follow-up: “What about them?” **after** a real analytics answer | Resolves referent; adds insight or drill-down — not a repeat without clarification | | |
| 7 | “What about them?” with **no** prior analytics context (e.g. greeting only) | Clarification; does not invent entities | | |
| 8 | Very short follow-up that would repeat the same SQL | Clarify or nudge — not useless duplicate table | | |
| 9 | “Top 5 customers by revenue in 1997” | `LIMIT` / top-N respected; numbers match DB | | |
| 10 | “Who’s #1 / best?” after a ranked table | Same metric/grain as prior; ties handled reasonably (not arbitrary single row if ties matter) | | |
| 11 | “This year” / “last quarter” (relative dates) | Acknowledges 1990s sample **or** maps to full sample with assumptions | | |
| 12 | Meta: “What can you do?” / “How does this work?” | Helpful answer; no fake query results; **no** refusal claiming no DB access | | |
| 13 | “Why this answer?” expanded — validation + execution | Shows validation, read-only execution, row count when SQL ran | | |
| 14 | Assistant message: no invented totals before execution | Specific numbers appear only from executed result / table | | |
| 15 | Join-heavy question (risk of fanout / duplicate rows) | Trust panel warns or critique path; user not misled into double-counting | | |
| 16 | “Strict verification” / confirm path (if present in UI) | Stricter checks; no regression on safety | | |
| 17 | Pagination: “next 15 rows” / more results | Next offset works; cap/limit respected | | |
| 18 | PDF export (if enabled) | Table matches on-screen result; truncation noted if capped | | |
| 19 | Dashboard KPIs load (`DATABASE_URL_READONLY` set) | Cards match definitions in UI; no error state | | |
| 20 | Mobile: overview “What you can ask” pill → Chat | Opens with prompt pre-filled or sent; usable on narrow viewport | | |
| 21 | Mobile: chat suggestion chips | Tappable; horizontal scroll; send works | | |
| 22 | Sign out / sign in; reopen saved conversation | Thread persists; messages load | | |




