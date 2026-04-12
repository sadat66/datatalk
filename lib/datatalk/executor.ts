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

const DEFAULT_MAX_ROWS = 500;
const DEFAULT_TIMEOUT_MS = 5000;

function getReadonlyUrl(): string | null {
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

export async function executeReadonlySelect(
  validatedSql: string,
  options?: { maxRows?: number; timeoutMs?: number },
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
  const wrapped = `select * from (${validatedSql}) as datatalk_inner limit ${maxRows + 1}`;

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    connection: { statement_timeout: timeoutMs },
  });

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
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
