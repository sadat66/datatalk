import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import { critiqueNorthwindSql, isSqlCritiqueEnabled } from "@/lib/datatalk/sql-critique";
import { validateSelectSql, type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { buildTrustReport } from "@/lib/datatalk/trust";
import {
  MAX_REPAIR_ATTEMPTS,
  repairFailureMessage,
  repairSql,
} from "@/lib/datatalk/orchestrator-llm";
import { enforceRequestedTopN } from "@/lib/datatalk/query-heuristics";
import type { TrustReport } from "@/lib/datatalk/types";
import type { OkValidation } from "@/lib/datatalk/orchestrator/stage-types";

type ValidationFailure = {
  assistant_message: string;
  trust: TrustReport;
};

type ValidationStageResult =
  | {
      ok: true;
      validation: OkValidation;
      validatedSql: string;
      sqlAfterLlm: string;
      critiqueReplacedSql: boolean;
      hadRepair: boolean;
    }
  | {
      ok: false;
      failure: ValidationFailure;
    };

function joinFanoutPenalty(sql: string | null | undefined, validated?: SqlValidationResult): boolean {
  if (!sql?.trim()) return false;
  if (validated?.ok) return validated.joinFanoutTrustPenalty;
  return inferJoinFanoutTrustPenalty(sql);
}

type ValidationStageInput = {
  context: string;
  message: string;
  initialSql: string;
  strictVerification?: boolean;
};

/**
 * Stage 1: convert model SQL into a validated, safe query.
 * We run optional critique first, then static validation + bounded repair attempts.
 */
export async function runValidationStage(input: ValidationStageInput): Promise<ValidationStageResult> {
  let hadRepair = false;
  let sql = input.initialSql.trim();
  const sqlAfterLlm = sql;

  const runSqlCritique =
    input.strictVerification || (isSqlCritiqueEnabled() && inferJoinFanoutTrustPenalty(sql));
  if (runSqlCritique) {
    try {
      const critique = await critiqueNorthwindSql({ userQuestion: input.message, sql });
      const revisedSql = typeof critique.revised_sql === "string" ? critique.revised_sql.trim() : "";
      if (!critique.ok_to_run && revisedSql) {
        const revisedValidation = validateSelectSql(revisedSql);
        if (revisedValidation.ok) {
          sql = revisedSql;
        }
      }
    } catch {
      // Best-effort critique stage; static validation still enforces safety.
    }
  }

  const critiqueReplacedSql = sql !== sqlAfterLlm;
  sql = enforceRequestedTopN(sql, input.message);

  let validation = validateSelectSql(sql);
  let failedValidationErrors = !validation.ok ? [...validation.errors] : [];
  if (!validation.ok) {
    const validationAttempts: { sql: string; errors: string[] }[] = [];
    let repairFailed = false;

    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
      try {
        sql = await repairSql(
          input.context,
          sql,
          validation.ok ? [] : validation.errors,
          validationAttempts.length > 0 ? validationAttempts : undefined,
        );
        sql = enforceRequestedTopN(sql, input.message);
        hadRepair = true;
        validation = validateSelectSql(sql);
        if (validation.ok) break;
        validationAttempts.push({ sql, errors: [...validation.errors] });
        failedValidationErrors = [...validation.errors];
      } catch (err) {
        repairFailed = true;
        const trust = buildTrustReport({
          pipeline: "validation_failed",
          validationPassed: false,
          validationDetails: failedValidationErrors,
          rowCount: 0,
          limited: false,
          executionMs: 0,
          skippedExecution: true,
          hadRepair,
          joinHeuristic: joinFanoutPenalty(sql),
        });
        return {
          ok: false,
          failure: {
            assistant_message: `I could not generate a safe query for that request. (${repairFailureMessage(err)})`,
            trust,
          },
        };
      }
    }

    if (!repairFailed && !validation.ok) {
      const trust = buildTrustReport({
        pipeline: "validation_failed",
        validationPassed: false,
        validationDetails: validation.errors,
        rowCount: 0,
        limited: false,
        executionMs: 0,
        skippedExecution: true,
        hadRepair,
        joinHeuristic: joinFanoutPenalty(sql),
      });
      return {
        ok: false,
        failure: {
          assistant_message: `That query failed safety checks after ${MAX_REPAIR_ATTEMPTS} repair attempt(s). Please rephrase your question.`,
          trust,
        },
      };
    }
  }

  if (!validation.ok) {
    throw new Error("Unreachable: validation must be ok after repair loop");
  }

  return {
    ok: true,
    validation,
    validatedSql: validation.normalizedSql,
    sqlAfterLlm,
    critiqueReplacedSql,
    hadRepair,
  };
}
