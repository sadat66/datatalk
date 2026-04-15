# DataTalk

DataTalk is a demo app for asking questions about a Northwind-style PostgreSQL database in plain English. It combines a dashboard, authenticated chat, read-only SQL execution, and a trust panel that explains what ran and why.

This is intentionally a scoped prototype for demos and take-home review, not a production BI platform. For deeper architecture notes, see [plan.md](plan.md).

## What Reviewers Can Expect

- Sign in with Supabase Auth.
- Open a dashboard with live Northwind summary metrics.
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
| `DATABASE_URL_READONLY` | Yes for live SQL results | Server-only connection string with `SELECT` access |
| `OPENROUTER_API_KEY` | One LLM path | OpenRouter API key |
| `OPENROUTER_MODEL` | No | Optional OpenRouter model override |
| `OPENROUTER_HTTP_REFERER` | No | Optional OpenRouter header |
| `OPENAI_API_KEY` | Alternative LLM path | OpenAI-compatible API key |
| `OPENAI_BASE_URL` | No | Defaults to `https://api.openai.com/v1` |
| `OPENAI_MODEL` | No | Model name for OpenAI-compatible mode |

## Setup

1. Install dependencies with `npm install`.
2. Add `.env.local` with the Supabase variables, one LLM path, and `DATABASE_URL_READONLY`.
3. In Supabase Auth, enable email auth and configure the site URL and redirect URLs for `http://localhost:3000` and `/auth/callback`.
4. Apply [supabase/migrations/001_app_tables.sql](supabase/migrations/001_app_tables.sql).
5. Load Northwind or equivalent sample data so it matches [lib/northwind/schema.ts](lib/northwind/schema.ts).
6. Start the app with `npm run dev`.
7. Open [http://localhost:3000](http://localhost:3000).

## Demo Flow

For a short walkthrough, this sequence works well:

1. Landing page
2. Sign up or log in
3. Dashboard overview with live metrics
4. One successful question, for example: `Top 5 customers by revenue in 1997`
5. Expand `Why this answer?`
6. Ask a follow-up or intentionally ambiguous question to show a clarification or safe failure
7. Re-open the saved conversation

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

## Tradeoffs And Future Work

- The orchestration pipeline is deeper than a typical demo, but evaluation coverage is still light.
- The current implementation is optimized for a Northwind-style schema rather than arbitrary warehouse onboarding.
- Next improvements would be test coverage, evaluation harnesses, caching strategy, and sharper metric definitions.

## License

Private / assignment use unless you add a license.
