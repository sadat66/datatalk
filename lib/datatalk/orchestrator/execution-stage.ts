import {
  CHAT_RESULT_PAGE_SIZE,
  executeReadonlySelect,
} from "@/lib/datatalk/executor";
import { validateSelectSql } from "@/lib/datatalk/sql-validator";
import type {
  ExecutionAttemptKey,
  OkValidation,
} from "@/lib/datatalk/orchestrator/stage-types";

type ExecutionAttempt = {
  key: ExecutionAttemptKey;
  v: OkValidation;
};

type ExecSuccess = Extract<
  Awaited<ReturnType<typeof executeReadonlySelect>>,
  { ok: true }
>;

export type ExecutionStageResult =
  | {
      ok: true;
      exec: ExecSuccess;
      usedAttemptKey: ExecutionAttemptKey;
      usedValidation: OkValidation;
      effectiveSql: string;
      executionFallbackNote: string;
      resultNextOffset: number | null;
      hasMore: boolean;
      rowPreview: string;
    }
  | {
      ok: false;
      validatedSql: string;
      validation: OkValidation;
      primaryExecError: string;
      lastFallbackError: string;
    };

function collectExecutionAttempts(input: {
  primary: OkValidation;
  critiqueReplacedSql: boolean;
  sqlAfterLlm: string;
  strictVerification?: boolean;
  lastSuccessfulDataSql?: string | null;
}): ExecutionAttempt[] {
  const attempts: ExecutionAttempt[] = [];
  const seenNorm = new Set<string>();

  const pushAttempt = (key: ExecutionAttemptKey, validation: OkValidation | null) => {
    if (!validation) return;
    if (seenNorm.has(validation.normalizedSql)) return;
    seenNorm.add(validation.normalizedSql);
    attempts.push({ key, v: validation });
  };

  pushAttempt("primary", input.primary);
  if (input.critiqueReplacedSql) {
    const beforeCritique = validateSelectSql(input.sqlAfterLlm);
    pushAttempt("pre_critique", beforeCritique.ok ? beforeCritique : null);
  }
  if (input.strictVerification && input.lastSuccessfulDataSql?.trim()) {
    const previousTurn = validateSelectSql(input.lastSuccessfulDataSql.trim());
    pushAttempt("previous_turn", previousTurn.ok ? previousTurn : null);
  }
  return attempts;
}

/**
 * Stage 3: execute the validated query with guarded fallbacks.
 * Fallbacks keep the response resilient while remaining inside validated SQL.
 */
export async function runExecutionStage(input: {
  validation: OkValidation;
  validatedSql: string;
  critiqueReplacedSql: boolean;
  sqlAfterLlm: string;
  strictVerification?: boolean;
  lastSuccessfulDataSql?: string | null;
}): Promise<ExecutionStageResult> {
  const attempts = collectExecutionAttempts({
    primary: input.validation,
    critiqueReplacedSql: input.critiqueReplacedSql,
    sqlAfterLlm: input.sqlAfterLlm,
    strictVerification: input.strictVerification,
    lastSuccessfulDataSql: input.lastSuccessfulDataSql,
  });

  let execution = await executeReadonlySelect(input.validation.normalizedSql, {
    maxRows: CHAT_RESULT_PAGE_SIZE,
    offset: 0,
  });
  const primaryExecError = execution.ok ? "" : execution.error;
  let usedAttemptKey: ExecutionAttemptKey = "primary";
  let usedValidation: OkValidation = input.validation;
  let lastFallbackError = "";
  let effectiveSql = input.validatedSql;

  if (!execution.ok && attempts.length > 1) {
    for (let i = 1; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      const fallback = await executeReadonlySelect(attempt.v.normalizedSql, {
        maxRows: CHAT_RESULT_PAGE_SIZE,
        offset: 0,
      });
      if (!fallback.ok) {
        lastFallbackError = fallback.error;
      }
      if (fallback.ok) {
        execution = fallback;
        usedAttemptKey = attempt.key;
        usedValidation = attempt.v;
        if (attempt.key === "pre_critique") {
          effectiveSql = input.sqlAfterLlm;
        } else if (attempt.key === "previous_turn" && input.lastSuccessfulDataSql?.trim()) {
          effectiveSql = input.lastSuccessfulDataSql.trim();
        } else {
          effectiveSql = attempt.v.normalizedSql;
        }
        break;
      }
    }
  }

  if (!execution.ok) {
    return {
      ok: false,
      validatedSql: input.validatedSql,
      validation: input.validation,
      primaryExecError,
      lastFallbackError,
    };
  }

  const executionFallbackNote =
    usedAttemptKey === "pre_critique"
      ? "**Note:** The extra SQL review suggested a revision that failed at runtime; results use the **original** model query instead.\n\n"
      : usedAttemptKey === "previous_turn"
        ? "**Note:** The strict verification run produced a query that failed at runtime; showing results from your **previous successful** query instead.\n\n"
        : "";

  const hasMore = execution.limited;
  const resultNextOffset = hasMore ? CHAT_RESULT_PAGE_SIZE : null;
  const rowPreview =
    execution.rows.length === 0
      ? "No rows matched."
      : `Returned ${execution.rowCount} row(s)${execution.limited ? ` (up to ${CHAT_RESULT_PAGE_SIZE} per answer; more available — use Next ${CHAT_RESULT_PAGE_SIZE})` : ""}.`;

  return {
    ok: true,
    exec: execution,
    usedAttemptKey,
    usedValidation,
    effectiveSql,
    executionFallbackNote,
    resultNextOffset,
    hasMore,
    rowPreview,
  };
}
