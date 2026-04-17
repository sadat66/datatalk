# DataTalk

DataTalk is a demo app for asking questions about a Northwind-style PostgreSQL database in plain English. It combines a dashboard, authenticated chat, read-only SQL execution, and a trust panel that explains what ran and why.

This is intentionally a scoped prototype for demos and take-home review, not a production BI platform. For deeper architecture notes, see [plan.md](plan.md).

## Live demo

**Deployed app:** [https://datatalk-three.vercel.app/](https://datatalk-three.vercel.app/) — sign in and explore the dashboard and chat without cloning the repo.

If you prefer to run the stack locally (or verify migrations and env), follow **Setup** below.

## Approach

The prototype goes deep on **two tracks** from the assignment:

1. **Query Intelligence** — Multi-turn context, targeted clarifications when a question is genuinely ambiguous, and referential follow-ups (“what about them?”) grounded in thread history rather than guesses.
2. **Reliability & Trust** — LLM-generated SQL is treated as untrusted until it passes deterministic validation (parse, allowlist, single `SELECT`), optional verification steps, and read-only execution. The UI surfaces *why* an answer is trustworthy instead of hiding the pipeline.

**Thesis:** Wrong numbers are worse than no numbers — so the product prioritizes validated SQL and visible trust signals over fluent but ungrounded prose.

## How this maps to the brief

- **Northwind:** Business analytics over a realistic B2B dataset; schema expectations live in [lib/northwind/schema.ts](lib/northwind/schema.ts).
- **Depth over breadth:** Deliberately not a shallow checklist of every optional track; see [plan.md](plan.md) for scope and out-of-scope notes (e.g. no custom model fine-tuning in this repo).
- **Show your work:** Primary surfaces are the chat UI and the **“Why this answer?”** panel (validation, execution, confidence-style reasoning).

## Demo video

Add your recorded walkthrough (5–10 minutes) here after you upload it, for example:

- **Demo:** *(link — e.g. Loom or unlisted YouTube)*

## What Reviewers Can Expect

- Open the [live demo](https://datatalk-three.vercel.app/) **or** run locally after **Setup**.
- Sign in with Supabase Auth.
- Ask a question in chat and get a streamed answer backed by validated, read-only SQL.
- Expand "Why this answer?" to inspect trust signals, validation steps, and the SQL that ran.
- See visible failure modes when a question is ambiguous or unsafe.

## Tech Stack

- Next.js 16 App Router
- TypeScript
- Supabase Auth + Postgres
- Tailwind + shadcn-style UI
- `node-sql-parser` for SQL validation
- Read-only Postgres execution for results

## Required Services

You need:

- A Supabase project for authentication and conversation storage
- A Postgres database with Northwind-style tables
- One LLM provider:
  `OPENROUTER_API_KEY`, or
  `OPENAI_API_KEY` plus optional compatible base URL

Without the database and LLM configuration, the UI can still render, but chat will not work end to end.

## Environment Variables

Create `.env.local` in the project root.

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `DATABASE_URL_READONLY` **or** `DATABASE_TRANSACTION_URL` **or** `DIRECT_DATABASE_URL` | Yes for live SQL results | Server-only Postgres URL. The app uses the **first non-empty** value in that order ([`getReadonlyDatabaseUrl`](lib/datatalk/executor.ts)). You do **not** need `DATABASE_URL_READONLY` if you already set e.g. `DIRECT_DATABASE_URL`. Prefer a read-only role when possible. |
| `OPENROUTER_API_KEY` | One LLM path | OpenRouter API key |
| `OPENROUTER_MODEL` | yes | OpenRouter model |

## Setup

1. Install dependencies with `npm install`.
2. Add `.env.local` with the Supabase variables, **one** Postgres URL from the table above (see [`.env.example`](.env.example)), and one LLM path.
3. In Supabase Auth, enable email auth and configure the site URL and redirect URLs for `http://localhost:3000` and `/auth/callback`.
4. Apply chat migrations (SQL editor or `psql` against the database the app uses):
   - [001_app_tables.sql](supabase/migrations/001_app_tables.sql) — `conversations` / `messages` + RLS
   - [002_conversations_delete_policy.sql](supabase/migrations/002_conversations_delete_policy.sql) — delete own conversations  
5. Load **Northwind** (or equivalent) so it matches [lib/northwind/schema.ts](lib/northwind/schema.ts). Options: [supabase/migrations/northwind.sql](supabase/migrations/northwind.sql), or [github.com/pthom/northwind_psql](https://github.com/pthom/northwind_psql). **Required before step 6** — the semantic view joins `orders`, `order_details`, `products`, etc.
6. Apply DataTalk migrations that depend on Northwind:
   - [003_datatalk_semantic_views.sql](supabase/migrations/003_datatalk_semantic_views.sql) — `datatalk_order_details_extended` view
   - [004_datatalk_semantic_view_security_invoker.sql](supabase/migrations/004_datatalk_semantic_view_security_invoker.sql) — `security_invoker` on that view
   - [005_conversation_memory_state.sql](supabase/migrations/005_conversation_memory_state.sql) — `memory_state` on `conversations`  
   Overview: [supabase/migrations/README.txt](supabase/migrations/README.txt).
7. Start the app with `npm run dev`.
8. Open [http://localhost:3000](http://localhost:3000).

## Edge cases (manual QA)

There is **no automated test suite** in this prototype; behavior is validated manually and through the staged pipeline.

**Use the checklist:** **[EDGE_CASES.md](EDGE_CASES.md)** — pass/fail tables 


## Local Verification

| Command | Purpose |
| ------- | ------- |
| `npm run lint` | Lint the project |
| `npm run build` | Standard production build |
| `$env:NEXT_DIST_DIR='.next-build'; npm run build` | Build to an alternate output folder if `.next` is locked by a running dev process |
| `npm run start` | Run the production build |

`next build` can fail on Windows if another process is still holding files in `.next`. The alternate `NEXT_DIST_DIR` option is included for reliable local verification without interrupting an active dev session.

## Trust And Safety

- Read-only database credentials stay on the server.
- SQL is constrained by an allowlisted schema and single-statement `SELECT` validation.
- LLM output is treated as untrusted until it passes validation.
- The app is designed to fail visibly instead of pretending uncertain answers are correct.

## Why I Built It This Way

- **Trust-first over fluency:** The biggest product risk in text-to-SQL is confidently wrong numbers. I intentionally built a pipeline where SQL must pass deterministic checks before execution, then surfaced those checks in UI so reviewers can inspect evidence instead of trusting hidden logic.
- **Depth over checklist breadth:** I chose to go deeper on query intelligence + reliability/trust rather than implement every optional idea at shallow quality. This made it possible to show end-to-end behavior for ambiguity handling, follow-up context, and SQL safety in one coherent demo.
- **Scoped data contract:** I optimized for a Northwind-style schema and explicit semantic expectations to keep behavior predictable in a take-home timeframe. Generalized schema onboarding is valuable, but this scope gave better signal on reasoning quality and guardrails.
- **Visible failure modes:** I preferred explicit clarifications and safe failures over fallback guesses. In analytics UX, "I need clarification" is usually better than an elegant but fabricated answer.
- **Reviewability as a feature:** The "Why this answer?" panel exists to make internal decisions inspectable (validation and execution evidence), because this assignment asks not just for answers but for explainable behavior.

## What I Would Improve Next

1. **Automated eval harness (highest priority):** Add golden-question suites (including adversarial prompts), SQL/result assertions, and CI gating so regressions are caught automatically instead of relying on manual runs in [EDGE_CASES.md](EDGE_CASES.md).
2. **Broader schema portability:** Move from Northwind-focused assumptions to metadata-driven onboarding (introspection + semantic config), so the same system works across arbitrary warehouse schemas.
3. **Stronger observability:** Add structured traces for clarification rate, validation reject categories, execution latency, and answer acceptance rate to make quality/performance tradeoffs measurable.
4. **Performance and cost controls:** Introduce query/result caching, prompt-token budgets, and model-routing policies to reduce latency and API cost while preserving trust guarantees.
5. **Tighter metric semantics:** Formalize canonical business metric definitions (for example revenue, discount handling, returns) to avoid subtle drift between natural-language intent and SQL implementation.
6. **Fine-tuned NL-to-SQL model:** This prototype currently uses a general-purpose LLM with prompt + validation guardrails (not a fine-tuned NL-to-SQL model). A clear next improvement is to train/adapt a schema-aware NL-to-SQL model to improve SQL accuracy and consistency.


## License

Private / assignment use unless you add a license.
