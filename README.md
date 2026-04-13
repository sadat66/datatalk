# DataTalk

Next.js (App Router) + TypeScript + Supabase Auth + shadcn/ui app for **natural-language analytics** over the **Northwind** PostgreSQL dataset. The focus is **query intelligence** (clarifications, conversation context) and **reliability & trust** (allowlisted schema, parse checks, read-only execution, transparent “Why this answer?” reporting).

See [plan.md](plan.md) for the full architecture and roadmap.

## Features (prototype)

- **Landing**, **email/password auth** with verification link, **dashboard** shell.
- **Chat** with persisted threads (`conversations` / `messages` + RLS).
- **NL → plan → SQL → validate → execute → narrate** pipeline via OpenRouter or OpenAI-compatible APIs.
- **Metric dictionary** page (`/dashboard/metrics`) and metric definitions injected into the model prompt.
- **Trust panel** per assistant turn: validation steps, execution stats, heuristic confidence (low / medium / high), and SQL.

## Prerequisites

- Node 20+
- A [Supabase](https://supabase.com) project (Auth + Postgres for app tables; Northwind data can live in the same database or another Postgres you trust with a read-only role).

## Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key (browser + server with user session) |
| `DATABASE_URL_READONLY` | For real answers | **Server-only** Postgres connection string with **SELECT-only** privileges on Northwind |
| `OPENROUTER_API_KEY` | One of LLM keys | [OpenRouter](https://openrouter.ai) API key |
| `OPENROUTER_MODEL` | No | Use **`openai/gpt-4o-mini`** on OpenRouter (default in code; good balance of cost, JSON mode, and SQL quality) |
| `OPENROUTER_HTTP_REFERER` | No | Optional referer header for OpenRouter |
| `OPENAI_API_KEY` | Alternative | If set **without** `OPENROUTER_API_KEY`, uses OpenAI-compatible `POST …/chat/completions` |
| `OPENAI_BASE_URL` | No | Default `https://api.openai.com/v1`; set to e.g. Ollama `http://localhost:11434/v1` |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` when using OpenAI-compatible mode |
| `HUGGINGFACE_API_KEY` | For voice input | Enables `/api/stt` speech-to-text using Hugging Face Inference |
| `HUGGINGFACE_STT_MODEL` | No | Defaults to `openai/whisper-tiny` |

## Setup

1. `npm install`
2. `copy .env.example .env.local` and fill variables (see table above).
3. Supabase **Auth**: enable email provider, **Confirm email**, set **Site URL** and **Redirect URLs** including `http://localhost:3000/auth/callback`.
4. **Persisted chat** needs `conversations` and `messages` with RLS. Apply [supabase/migrations/001_app_tables.sql](supabase/migrations/001_app_tables.sql) either in the Supabase SQL editor or, with the project linked, `npm run supabase -- db query --linked -f supabase/migrations/001_app_tables.sql`. Next.js dev/build does not run this automatically. **This file alone does not create Northwind**—new projects still need step 5 or analytics queries will have nothing to run against.
5. **Northwind (required for NL→SQL):** Ensure Northwind tables exist in the **same** Postgres database your app uses and match [lib/northwind/schema.ts](lib/northwind/schema.ts). Load your `northwind.sql` (or equivalent) in the SQL editor once per project. The schema this repo expects aligns with **pthom/northwind_psql** (notably the table is **`region`** singular, not `regions`, and includes **`us_states`** plus customer demo tables). To make clones reproducible without a manual step, you can add a **`000_northwind.sql`** migration (full dump) **before** `001` in `supabase/migrations/` and commit it—see [supabase/migrations/README.txt](supabase/migrations/README.txt).
6. `npm run dev` → [http://localhost:3000](http://localhost:3000)

### Voice input (Whisper Tiny STT)

- Add `HUGGINGFACE_API_KEY` in `.env.local`.
- Optional: set `HUGGINGFACE_STT_MODEL` (default is `openai/whisper-tiny`).
- In chat, click **Voice**, speak, then click **Stop**. The transcript is appended to the text box.

## NL→SQL threat model (short)

- **Never** send the read-only database URL or service role keys to the client.
- **Allowlist** tables/columns via `node-sql-parser` + explicit schema map before any execution.
- **Single `SELECT` only**; reject `;`, DML/DDL keywords, and blocked functions in a pre-check.
- **Wrap** execution with `SELECT * FROM (<inner>) … LIMIT n` and a **statement timeout** on the server connection.
- **LLM output is untrusted** until it passes validation; one **repair** attempt is allowed with validator errors fed back.

Wrong data is worse than no data: the UI surfaces **validation failures** and **execution errors** instead of silently guessing.

## Demo video (assignment)

Record **5–10 minutes** covering: landing → auth → chat with a successful Northwind question → expand **Why this answer?** → show a **clarification** or **validation failure** → **Metrics** page → technical trade-offs and what you would improve next (auth hardening, caching, join fan-out tests, eval harness).

## Supabase CLI

The CLI is installed as a **dev dependency**. From the project root:

```bash
npx supabase --version
# or
npm run supabase -- --version
```

Typical flow after you collect credentials: `npx supabase login`, then `npx supabase link --project-ref <ref>` (or init a local config). Use `npm run supabase -- db push` only if you adopt Supabase migration tracking; otherwise keep applying SQL from `supabase/migrations/` in the dashboard as documented above.

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run supabase -- <args>` | Supabase CLI (e.g. `npm run supabase -- login`) |

## What we would improve next

- Stronger **join fan-out** detection and **EXPLAIN** (cost-limited) optional step.
- **Eval harness** (“trust lab”) with golden questions (see plan wild-card option).
- **Streaming** assistant responses and cancel in-flight requests.
- Typed **Supabase** `Database` codegen and stricter `messages.content` JSON typing.

## License

Private / assignment use unless you add a license.
