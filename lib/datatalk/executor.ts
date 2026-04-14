import postgres from "postgres";

export type ExecutionResult =
  | {
      ok: true;
      rows: Record<string, unknown>[];
      rowCount: number;
      limited: boolean;
      ms: number;
    }
  | { ok: false; error: string };

/** Chat answers never return more than this many rows per request (pagination uses offset). */
export const CHAT_RESULT_PAGE_SIZE = 15;

const DEFAULT_MAX_ROWS = CHAT_RESULT_PAGE_SIZE;
const DEFAULT_TIMEOUT_MS = 5000;
const NOOP_ASYNC = async () => {};
const readonlyClientCache = new Map<string, ReturnType<typeof postgres>>();

/** Server-only: first configured read-capable Postgres URL (same resolution as execution). */
export function getReadonlyDatabaseUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL_READONLY,
    process.env.DATABASE_TRANSACTION_URL,
    process.env.DIRECT_DATABASE_URL,
  ];
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t;
  }
  return null;
}

function getReadonlyUrl(): string | null {
  return getReadonlyDatabaseUrl();
}

function createReadonlyClient(url: string, timeoutMs: number): ReturnType<typeof postgres> {
  return postgres(url, {
    max: 1,
    prepare: false,
    connection: { statement_timeout: timeoutMs },
  });
}

function acquireReadonlyClient(url: string, timeoutMs: number): {
  sql: ReturnType<typeof postgres>;
  release: () => Promise<void>;
} {
  if (timeoutMs === DEFAULT_TIMEOUT_MS) {
    const cacheKey = `${url}::${timeoutMs}`;
    const existing = readonlyClientCache.get(cacheKey);
    if (existing) {
      return { sql: existing, release: NOOP_ASYNC };
    }
    const sql = createReadonlyClient(url, timeoutMs);
    readonlyClientCache.set(cacheKey, sql);
    return { sql, release: NOOP_ASYNC };
  }
  const sql = createReadonlyClient(url, timeoutMs);
  return {
    sql,
    release: async () => {
      await sql.end({ timeout: 2 }).catch(() => undefined);
    },
  };
}

export async function executeReadonlySelect(
  validatedSql: string,
  options?: { maxRows?: number; timeoutMs?: number; offset?: number },
): Promise<ExecutionResult> {
  const url = getReadonlyUrl();
  if (!url) {
    return {
      ok: false,
      error:
        "No database URL for execution. Set DATABASE_URL_READONLY (preferred), or DATABASE_TRANSACTION_URL (pooler), or DIRECT_DATABASE_URL — server only; see README.",
    };
  }

  const maxRows = options?.maxRows ?? DEFAULT_MAX_ROWS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const wrapped = `select * from (${validatedSql}) as datatalk_inner limit ${maxRows + 1} offset ${offset}`;

  const { sql, release } = acquireReadonlyClient(url, timeoutMs);

  const started = performance.now();
  try {
    const rows = (await sql.unsafe(wrapped)) as Record<string, unknown>[];
    const ms = Math.round(performance.now() - started);
    const limited = rows.length > maxRows;
    const trimmed = limited ? rows.slice(0, maxRows) : rows;
    return {
      ok: true,
      rows: trimmed,
      rowCount: trimmed.length,
      limited,
      ms,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    await release();
  }
}

/** Run PostgreSQL EXPLAIN on the same statement shape as execution — validates server-side without returning data rows. */
export function isExplainValidateEnabled(): boolean {
  const v = process.env.DATATALK_EXPLAIN_VALIDATE?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

export async function explainValidateReadonlySelect(validatedSql: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const url = getReadonlyUrl();
  if (!url) {
    return {
      ok: false,
      error:
        "No database URL for EXPLAIN. Set DATABASE_URL_READONLY (preferred), or DATABASE_TRANSACTION_URL, or DIRECT_DATABASE_URL.",
    };
  }

  const wrapped = `explain (costs off, verbose off) select * from (${validatedSql}) as datatalk_explain_inner limit 1`;
  const { sql, release } = acquireReadonlyClient(url, DEFAULT_TIMEOUT_MS);

  try {
    await sql.unsafe(wrapped);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    await release();
  }
}
