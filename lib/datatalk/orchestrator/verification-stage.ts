import {
  explainValidateReadonlySelect,
  isExplainValidateEnabled,
} from "@/lib/datatalk/executor";
import {
  getConfidenceRunThreshold,
  isIntentVerifierEnabled,
  verifySqlAgainstIntent,
} from "@/lib/datatalk/intent-verifier";
import { inferJoinFanoutTrustPenalty } from "@/lib/datatalk/join-risk";
import { enforceRequestedTopN } from "@/lib/datatalk/query-heuristics";
import { validateSelectSql, type SqlValidationResult } from "@/lib/datatalk/sql-validator";
import { buildTrustReport } from "@/lib/datatalk/trust";
import {
  MAX_REPAIR_ATTEMPTS,
  repairFailureMessage,
  repairSqlForExplain,
  repairSqlForIntent,
} from "@/lib/datatalk/orchestrator-llm";
import type { OrchestratorResult, OkValidation } from "@/lib/datatalk/orchestrator/stage-types";
import type { LlmPipelineResult } from "@/lib/datatalk/types";

type VerificationContinue = {
  kind: "continue";
  validatedSql: string;
  validation: OkValidation;
  hadRepair: boolean;
  explainValidated: boolean;
  intentVerifierRan: boolean;
  intentVerifierError: boolean;
  intentConfidence?: number;
  intentAligned?: boolean;
};

type VerificationStageResult =
  | VerificationContinue
  | {
      kind: "return";
      result: OrchestratorResult;
    };

type VerificationInput = {
  context: string;
  userMessage: string;
  intentQuestion: string;
  validatedSql: string;
  validation: OkValidation;
  hadRepair: boolean;
  model: Pick<LlmPipelineResult, "plan_summary" | "metric_ids" | "assumptions">;
};

function joinFanoutPenalty(sql: string | null | undefined, validated?: SqlValidationResult): boolean {
  if (!sql?.trim()) return false;
  if (validated?.ok) return validated.joinFanoutTrustPenalty;
  return inferJoinFanoutTrustPenalty(sql);
}

/**
 * Stage 2: verify that the query is executable and semantically aligned.
 * This is where we prefer clarifying before execution when confidence is low.
 */
export async function runVerificationStage(input: VerificationInput): Promise<VerificationStageResult> {
  let validatedSql = input.validatedSql;
  let validation: OkValidation = input.validation;
  let hadRepair = input.hadRepair;
  let explainValidated = false;
  let intentVerifierRan = false;
  let intentVerifierError = false;
  let intentConfidence: number | undefined;
  let intentAligned: boolean | undefined;

  if (isExplainValidateEnabled()) {
    let explainResult = await explainValidateReadonlySelect(validatedSql);
    if (!explainResult.ok) {
      const firstExplainError = explainResult.error;
      const explainAttempts: { sql: string; error: string }[] = [];
      let explainRecovered = false;

      for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
        try {
          const repairedSql = await repairSqlForExplain({
            context: input.context,
            previousSql: validatedSql,
            userMessage: input.userMessage,
            explainError: explainResult.error,
            priorAttempts: explainAttempts.length > 0 ? explainAttempts : undefined,
          });
          const repairedValidation = validateSelectSql(
            enforceRequestedTopN(repairedSql, input.userMessage),
          );
          if (!repairedValidation.ok) {
            explainAttempts.push({
              sql: repairedSql,
              error: `Static validation: ${repairedValidation.errors.join("; ")}`,
            });
            continue;
          }
          validatedSql = repairedValidation.normalizedSql;
          validation = repairedValidation;
          hadRepair = true;
          explainResult = await explainValidateReadonlySelect(validatedSql);
          if (explainResult.ok) {
            explainRecovered = true;
            break;
          }
          explainAttempts.push({ sql: validatedSql, error: explainResult.error });
        } catch (err) {
          const trust = buildTrustReport({
            pipeline: "execution_failed",
            validationPassed: true,
            validationDetails: [
              "Parsed SQL and allowlist checks passed.",
              `EXPLAIN dry-run failed: ${firstExplainError}`,
              `Automatic repair failed after ${attempt + 1} attempt(s): ${repairFailureMessage(err)}`,
            ],
            rowCount: 0,
            limited: false,
            executionMs: 0,
            skippedExecution: true,
            hadRepair,
            joinHeuristic: joinFanoutPenalty(validatedSql, validation),
          });
          return {
            kind: "return",
            result: {
              assistant_message: `The query did not pass the database dry-run (EXPLAIN): ${firstExplainError}`,
              kind: "answer",
              sql: validatedSql,
              trust,
              plan_summary: input.model.plan_summary,
              metric_ids: input.model.metric_ids,
              assumptions: input.model.assumptions,
            },
          };
        }
      }

      if (!explainRecovered) {
        const lastError =
          explainAttempts.length > 0
            ? explainAttempts[explainAttempts.length - 1].error
            : !explainResult.ok
              ? explainResult.error
              : firstExplainError;
        const trust = buildTrustReport({
          pipeline: "execution_failed",
          validationPassed: true,
          validationDetails: [
            "Parsed SQL and allowlist checks passed.",
            `EXPLAIN dry-run failed: ${lastError}`,
            `Automatic repair exhausted ${MAX_REPAIR_ATTEMPTS} attempt(s).`,
          ],
          rowCount: 0,
          limited: false,
          executionMs: 0,
          skippedExecution: true,
          hadRepair,
          joinHeuristic: joinFanoutPenalty(validatedSql, validation),
        });
        return {
          kind: "return",
          result: {
            assistant_message: `The query did not pass the database dry-run (EXPLAIN): ${lastError}`,
            kind: "answer",
            sql: validatedSql,
            trust,
            plan_summary: input.model.plan_summary,
            metric_ids: input.model.metric_ids,
            assumptions: input.model.assumptions,
          },
        };
      }
    }
    explainValidated = true;
  }

  if (isIntentVerifierEnabled()) {
    try {
      const verification = await verifySqlAgainstIntent({
        userQuestion: input.intentQuestion,
        sql: validatedSql,
      });

      if (verification == null) {
        intentVerifierError = true;
      } else {
        intentVerifierRan = true;
        intentConfidence = verification.confidence_0_100;
        intentAligned = verification.aligned;
        const threshold = getConfidenceRunThreshold();
        const shouldHold = verification.confidence_0_100 < threshold || verification.aligned === false;

        if (shouldHold) {
          let recovered = false;
          const hasFeedback =
            verification.mismatches.length > 0 ||
            (verification.clarify_suggestion?.trim().length ?? 0) > 0;

          if (hasFeedback) {
            const intentAttempts: { sql: string; confidence: number; mismatches: string[] }[] = [];
            let currentSql = validatedSql;
            let currentMismatches = verification.mismatches;
            let currentConfidence = verification.confidence_0_100;
            let currentClarify = verification.clarify_suggestion;

            for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
              try {
                const repairedSql = await repairSqlForIntent({
                  context: input.context,
                  previousSql: currentSql,
                  userMessage: input.userMessage,
                  confidence: currentConfidence,
                  mismatches: currentMismatches,
                  clarifySuggestion: currentClarify,
                  priorAttempts: intentAttempts.length > 0 ? intentAttempts : undefined,
                });
                const repairedValidation = validateSelectSql(
                  enforceRequestedTopN(repairedSql, input.userMessage),
                );
                if (!repairedValidation.ok) {
                  intentAttempts.push({
                    sql: repairedSql,
                    confidence: 0,
                    mismatches: repairedValidation.errors,
                  });
                  continue;
                }

                if (isExplainValidateEnabled()) {
                  const explainCheck = await explainValidateReadonlySelect(
                    repairedValidation.normalizedSql,
                  );
                  if (!explainCheck.ok) {
                    intentAttempts.push({
                      sql: repairedValidation.normalizedSql,
                      confidence: 0,
                      mismatches: [`EXPLAIN failed: ${explainCheck.error}`],
                    });
                    continue;
                  }
                  explainValidated = true;
                }

                const repairedIntent = await verifySqlAgainstIntent({
                  userQuestion: input.intentQuestion,
                  sql: repairedValidation.normalizedSql,
                });
                if (
                  repairedIntent &&
                  repairedIntent.aligned !== false &&
                  repairedIntent.confidence_0_100 >= threshold
                ) {
                  validation = repairedValidation;
                  validatedSql = repairedValidation.normalizedSql;
                  hadRepair = true;
                  intentConfidence = repairedIntent.confidence_0_100;
                  intentAligned = repairedIntent.aligned;
                  recovered = true;
                  break;
                }

                intentAttempts.push({
                  sql: repairedValidation.normalizedSql,
                  confidence: repairedIntent?.confidence_0_100 ?? 0,
                  mismatches: repairedIntent?.mismatches ?? [],
                });
                currentSql = repairedValidation.normalizedSql;
                currentConfidence = repairedIntent?.confidence_0_100 ?? currentConfidence;
                currentMismatches = repairedIntent?.mismatches ?? currentMismatches;
                currentClarify = repairedIntent?.clarify_suggestion ?? currentClarify;
              } catch {
                break;
              }
            }
          }

          if (!recovered) {
            const clarifyQuestion =
              verification.clarify_suggestion?.trim() ||
              `Which interpretation should we use? (Verification confidence ${verification.confidence_0_100}% is below the ${threshold}% run threshold.)`;
            const intro = `I have not run the query against the database — intent verification scored ${verification.confidence_0_100}% confidence${verification.aligned === false ? " and flagged alignment issues" : ""} (threshold ${threshold}%).`;
            const mismatchLine =
              verification.mismatches.length > 0
                ? `Potential mismatches: ${verification.mismatches.slice(0, 5).join("; ")}`
                : "";
            const explainLine = verification.plain_explanation
              ? `Proposed SQL would: ${verification.plain_explanation}`
              : "";

            const trust = buildTrustReport({ pipeline: "clarify" });
            return {
              kind: "return",
              result: {
                assistant_message: [intro, mismatchLine, explainLine].filter(Boolean).join("\n\n") + `\n\n${clarifyQuestion}`,
                kind: "clarify",
                trust,
                plan_summary: input.model.plan_summary,
                clarify_question: clarifyQuestion,
              },
            };
          }
        }
      }
    } catch {
      intentVerifierError = true;
    }
  }

  return {
    kind: "continue",
    validatedSql,
    validation,
    hadRepair,
    explainValidated,
    intentVerifierRan,
    intentVerifierError,
    intentConfidence,
    intentAligned,
  };
}
