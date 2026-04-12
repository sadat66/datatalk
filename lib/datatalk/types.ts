import { z } from "zod";

export const trustLevelSchema = z.enum(["low", "medium", "high"]);

export const trustReportSchema = z.object({
  level: trustLevelSchema,
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
  error: z.string().optional(),
});

export type AssistantMessageContent = z.infer<typeof assistantMessageContentSchema>;
