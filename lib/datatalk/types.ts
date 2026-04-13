import { z } from "zod";

export const trustLevelSchema = z.enum(["low", "medium", "high"]);

/** How this turn was produced — drives confidence copy (esp. non-data turns vs real failures). */
export const trustPipelineSchema = z.enum([
  "data",
  "conversational",
  "clarify",
  "refused",
  "validation_failed",
  "execution_failed",
  "canned",
]);

export type TrustPipeline = z.infer<typeof trustPipelineSchema>;

export const trustReliabilitySchema = z.object({
  /** 0–100 heuristic: higher = safer to rely on for decision-making */
  confidenceScore: z.number().min(0).max(100),
  narrativeNumericGrounding: z.enum(["ok", "suspect"]),
  narrativeNotes: z.array(z.string()).optional(),
});

export type TrustReliability = z.infer<typeof trustReliabilitySchema>;

export const trustReportSchema = z.object({
  level: trustLevelSchema,
  pipeline: trustPipelineSchema.optional(),
  reasons: z.array(z.string()),
  validation: z.object({
    passed: z.boolean(),
    details: z.array(z.string()),
  }),
  execution: z.object({
    rowCount: z.number(),
    limited: z.boolean(),
    ms: z.number(),
    skipped: z.boolean().optional(),
  }),
  reliability: trustReliabilitySchema.optional(),
  /** Actionable gaps vs a “high trust” bar for this turn */
  gapsToHighTrust: z.array(z.string()).optional(),
});

export type TrustReport = z.infer<typeof trustReportSchema>;

/** LLM often returns null for "empty" arrays; normalize to undefined. */
const optionalStringArray = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((v) => (v == null ? undefined : v));

export const llmPipelineSchema = z.object({
  kind: z.enum(["answer", "clarify", "refuse"]),
  assistant_message: z.string(),
  clarify_question: z.string().nullable().optional(),
  sql: z.string().nullable().optional(),
  plan_summary: z.string().nullable().optional(),
  metric_ids: optionalStringArray,
  assumptions: optionalStringArray,
});

export type LlmPipelineResult = z.infer<typeof llmPipelineSchema>;

export const userMessageContentSchema = z.object({
  type: z.literal("user"),
  text: z.string(),
});

export const assistantMessageContentSchema = z.object({
  type: z.literal("assistant"),
  text: z.string(),
  sql: z.string().optional(),
  rows: z.array(z.record(z.string(), z.any())).optional(),
  trust: trustReportSchema.optional(),
  plan_summary: z.string().optional(),
  metric_ids: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  /** Shown when trust is medium — user can confirm to re-run with strict verification */
  trust_upgrade_suggestion: z.string().optional(),
  result_has_more: z.boolean().optional(),
  result_next_offset: z.number().nullable().optional(),
  error: z.string().optional(),
});

export type AssistantMessageContent = z.infer<typeof assistantMessageContentSchema>;
