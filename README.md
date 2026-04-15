# DataTalk

DataTalk is a **web app for asking questions about a sample PostgreSQL database in everyday language**. It is built with Next.js and Supabase and is intended as a **prototype / learning project**—useful for demos and development, not positioned as a turnkey production analytics product.

For deeper architecture notes, see [plan.md](plan.md).

---

## At a glance

| | |
| --- | --- |
| **What you get** | Sign in, open the chat, and (when the backend is configured) get answers driven by **read-only SQL** against a Northwind-style dataset, with validation and a “why this answer?” style breakdown. |
| **What it is not** | It does not replace a full BI stack, warehouse governance, or guaranteed-accuracy reporting. The LLM can misunderstand questions; the app is designed to **fail visibly** when SQL or validation does not pass. |

---

## For non-technical readers

1. **You need accounts/services** (free tiers are usually enough to try): a [Supabase](https://supabase.com) project for login and storing conversations, and either an [OpenRouter](https://openrouter.ai) key or an OpenAI-compatible API for the assistant. Without those, the UI may load but **chat answers will not work end-to-end**.
2. **Sample data**: The app expects **Northwind-style** tables in Postgres. If that data is missing, questions will have nothing valid to query.
3. **Voice button**: Optional. It uses your **browser’s built-in speech recognition** where supported (often Chrome or Edge). No extra voice API keys are required for that path.

---

## For developers

**Stack:** Next.js (App Router), TypeScript, Supabase Auth, Tailwind/shadcn-style UI, `node-sql-parser` for SQL checks, read-only Postgres for execution.

**Prerequisites:** Node.js 20+, npm, a Supabase project, and a Postgres instance (can be Supabase’s Postgres) with a **SELECT-only** role for the app’s query path.

---

## Environment variables

Create `.env.local` in the project root (you can start from any local template your team uses). Typical variables:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anon key (browser + server with user session) |
| `DATABASE_URL_READONLY` | For real query results | **Server-only** connection string with **SELECT-only** access to the Northwind-style schema |
| `OPENROUTER_API_KEY` | One LLM path | [OpenRouter](https://openrouter.ai) API key |
| `OPENROUTER_MODEL` | No | Default in code is a small, cost-aware model; override if you need different behavior |
| `OPENROUTER_HTTP_REFERER` | No | Optional header for OpenRouter |
| `OPENAI_API_KEY` | Alternative LLM path | If set **without** `OPENROUTER_API_KEY`, uses OpenAI-compatible `POST …/chat/completions` |
| `OPENAI_BASE_URL` | No | Default `https://api.openai.com/v1`; can point to other compatible servers |
| `OPENAI_MODEL` | No | Model name for OpenAI-compatible mode |

Missing LLM or database configuration usually means **empty errors, placeholders, or no useful SQL**—that is expected until variables are set.

---

## Setup

1. **Install dependencies:** `npm install`
2. **Configure environment:** Add `.env.local` with at least the Supabase variables and one working LLM + read-only DB URL when you want full behavior.
3. **Supabase Auth:** Enable the email provider, turn on **Confirm email** if you use verification links, and set **Site URL** and **Redirect URLs** (include `http://localhost:3000` and `/auth/callback` as needed).
4. **App tables:** Apply [supabase/migrations/001_app_tables.sql](supabase/migrations/001_app_tables.sql) in the Supabase SQL editor, or use the Supabase CLI if your workflow uses linked projects. Next.js does **not** apply this automatically.
5. **Northwind data:** Load Northwind (or equivalent) so table names align with [lib/northwind/schema.ts](lib/northwind/schema.ts). See [supabase/migrations/README.txt](supabase/migrations/README.txt) for notes (e.g. `region` vs `regions`, optional `000_northwind.sql` migration).
6. **Run locally:** `npm run dev` → [http://localhost:3000](http://localhost:3000)

---

## Trust and safety (short)

- Read-only DB credentials stay on the server.
- Queries are constrained by an allowlisted schema, parser checks, and **single-statement `SELECT`** rules before execution.
- **LLM output is treated as untrusted** until it passes validation.

---

## Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run supabase -- <args>` | Supabase CLI (e.g. `npm run supabase -- login`) |

---

## Demo / assignment notes

If you are recording a walkthrough, a sensible flow is: landing → auth → one successful Northwind question → expand explanation / trust UI → show a clarification or validation failure → metrics page → what you would improve next (testing, caching, stricter evals, etc.).

---

## License

Private / assignment use unless you add a license.
