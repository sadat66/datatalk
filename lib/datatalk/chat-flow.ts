import { createClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/datatalk/orchestrator";
import type { AssistantMessageContent } from "@/lib/datatalk/types";
import {
  buildMemoryHints,
  parseConversationMemory,
  updateConversationMemory,
} from "@/lib/datatalk/conversation-memory";
import {
  cannedFrustrationResponse,
  cannedGreetingResponse,
  cannedVagueGuidanceResponse,
  classifyUserPrompt,
} from "@/lib/datatalk/userPromptKeywords";

function extractLastDataSql(messages: { role: string; content: unknown }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "assistant") continue;
    const c = messages[i].content;
    if (!c || typeof c !== "object") continue;
    const sql = (c as { sql?: unknown }).sql;
    if (typeof sql === "string" && sql.trim().length > 0) return sql.trim();
  }
  return null;
}

export class ChatFlowError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function textFromContent(role: string, content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (role === "user" && c.type === "user" && typeof c.text === "string") return c.text;
  if (role === "assistant" && c.type === "assistant" && typeof c.text === "string") return c.text;
  return JSON.stringify(content);
}

export type ChatPayload = {
  conversationId: string;
  kind: string;
  assistant_message: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  trust: AssistantMessageContent["trust"];
  plan_summary?: string | null;
  metric_ids?: string[];
  assumptions?: string[];
  trust_upgrade_suggestion?: string;
  result_has_more?: boolean;
  result_next_offset?: number | null;
};

function buildPayload(conversationId: string, result: Awaited<ReturnType<typeof runOrchestrator>>): ChatPayload {
  return {
    conversationId,
    kind: result.kind,
    assistant_message: result.assistant_message,
    sql: result.sql,
    rows: result.rows,
    trust: result.trust,
    plan_summary: result.plan_summary,
    metric_ids: result.metric_ids,
    assumptions: result.assumptions,
    trust_upgrade_suggestion: result.trustUpgradeSuggestion,
    result_has_more: result.resultHasMore,
    result_next_offset: result.resultNextOffset,
  };
}

function toAssistantContent(result: Awaited<ReturnType<typeof runOrchestrator>>): AssistantMessageContent {
  return {
    type: "assistant",
    text: result.assistant_message,
    sql: result.sql,
    rows: result.rows,
    trust: result.trust,
    plan_summary: result.plan_summary ?? undefined,
    metric_ids: result.metric_ids,
    assumptions: result.assumptions,
    trust_upgrade_suggestion: result.trustUpgradeSuggestion,
    result_has_more: result.resultHasMore,
    result_next_offset: result.resultNextOffset,
  };
}

export async function runChatFlow({
  supabase,
  userId,
  message,
  incomingConversationId,
  resultOffset,
  strictVerification,
  onProgress,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  message: string;
  incomingConversationId: string | null;
  resultOffset?: number;
  strictVerification?: boolean;
  onProgress?: (event: string, payload: Record<string, unknown>) => void;
}): Promise<ChatPayload> {
  let conversationId = incomingConversationId ?? null;

  if (conversationId) {
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id, memory_state")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError || !conv) {
      throw new ChatFlowError("Conversation not found", 404);
    }
  } else {
    const { data: conv, error: createError } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        title: message.slice(0, 80),
      })
      .select("id, memory_state")
      .single();

    if (createError || !conv) {
      throw new ChatFlowError(createError?.message ?? "Could not create conversation", 500);
    }
    conversationId = conv.id;
  }

  if (!conversationId) {
    throw new ChatFlowError("Internal: missing conversation", 500);
  }

  const { data: convState, error: convStateError } = await supabase
    .from("conversations")
    .select("memory_state")
    .eq("id", conversationId)
    .single();
  if (convStateError) {
    throw new ChatFlowError(convStateError.message, 500);
  }
  const conversationMemory = parseConversationMemory(convState?.memory_state);

  onProgress?.("meta", { conversationId });

  const { data: priorMessages, error: priorError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (priorError) {
    throw new ChatFlowError(priorError.message, 500);
  }

  const turns = (priorMessages ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    text: textFromContent(m.role, m.content),
  }));

  const lastDataSql = extractLastDataSql(priorMessages ?? []);
  const offset = resultOffset ?? 0;
  if (offset > 0 && !lastDataSql) {
    throw new ChatFlowError("No previous data query to paginate — ask a question first.", 400);
  }

  const { error: userMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: { type: "user", text: message },
  });

  if (userMsgError) {
    throw new ChatFlowError(userMsgError.message, 500);
  }

  onProgress?.("status", { stage: "thinking" });

  const classification = classifyUserPrompt(message);
  let result: Awaited<ReturnType<typeof runOrchestrator>>;
  try {
    if (offset > 0 && lastDataSql) {
      result = await runOrchestrator({
        turns,
        message,
        resultOffset: offset,
        lastDataSql,
      });
    } else if (classification.skipLlm && classification.canned === "greeting") {
      result = cannedGreetingResponse("hello");
    } else if (classification.skipLlm && classification.canned === "thanks") {
      result = cannedGreetingResponse("thanks");
    } else if (classification.skipLlm && classification.canned === "frustration") {
      result = cannedFrustrationResponse();
    } else if (classification.skipLlm && classification.canned === "vague_guidance") {
      result = cannedVagueGuidanceResponse();
    } else {
      const memoryHints = buildMemoryHints(conversationMemory, message);
      result = await runOrchestrator({
        turns,
        message,
        toneHints: [...(classification.toneHints ?? []), ...memoryHints],
        strictVerification,
        lastSuccessfulDataSql: lastDataSql,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM error";
    throw new ChatFlowError(msg, 502);
  }

  onProgress?.("status", { stage: "finalizing" });

  const assistantContent = toAssistantContent(result);
  const { error: asstMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "assistant",
    content: assistantContent as unknown as Record<string, unknown>,
  });

  if (asstMsgError) {
    throw new ChatFlowError(asstMsgError.message, 500);
  }

  const updatedMemory = updateConversationMemory({
    previous: conversationMemory,
    userMessage: message,
    result,
  });
  const { error: memoryUpdateError } = await supabase
    .from("conversations")
    .update({
      memory_state: updatedMemory as unknown as Record<string, unknown>,
      memory_updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (memoryUpdateError) {
    // Non-fatal: answer is already persisted and returned; memory is advisory.
    console.warn("conversation memory update failed", memoryUpdateError.message);
  }

  return buildPayload(conversationId, result);
}
