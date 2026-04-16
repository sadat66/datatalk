import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserOrClearSession } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import { executeReadonlySelect } from "@/lib/datatalk/executor";
import { QUERY_RESULT_EXPORT_MAX_ROWS } from "@/lib/datatalk/query-export-limits";
import { validateSelectSql } from "@/lib/datatalk/sql-validator";

const bodySchema = z.object({
  sql: z.string().min(1).max(12_000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getUserOrClearSession(supabase);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const validation = validateSelectSql(parsed.data.sql.trim());
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.errors[0] ?? "Invalid SQL", errors: validation.errors },
      { status: 400 },
    );
  }

  const exec = await executeReadonlySelect(validation.normalizedSql, {
    maxRows: QUERY_RESULT_EXPORT_MAX_ROWS,
    offset: 0,
    timeoutMs: 120_000,
  });

  if (!exec.ok) {
    console.error("[query-export] execution error:", exec.error);
    return NextResponse.json({ error: "Query execution failed" }, { status: 502 });
  }

  return NextResponse.json({
    rows: exec.rows,
    truncated: exec.limited,
    exportMaxRows: QUERY_RESULT_EXPORT_MAX_ROWS,
    rowCount: exec.rowCount,
  });
}
