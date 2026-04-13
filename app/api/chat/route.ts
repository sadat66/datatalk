import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/datatalk/orchestrator";
import type { AssistantMessageContent } from "@/lib/datatalk/types";
import {
  cannedFrustrationResponse,
  cannedGreetingResponse,
  classifyUserPrompt,
} from "@/lib/datatalk/userPromptKeywords";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1).max(8000),
  /** Re-run with extra SQL review + trust boost when checks pass */
  strictVerification: z.boolean().optional(),
  /** Next page of last query — 15 rows per page */
  resultOffset: z.number().int().min(0).optional(),
});

function extractLastDataSql(
  messages: { role: string; content: unknown }[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "assistant") continue;
    const c = messages[i].content;
    if (!c || typeof c !== "object") continue;
    const sql = (c as { sql?: unknown }).sql;
    if (typeof sql === "string" && sql.trim().length > 0) return sql.trim();
  }
  return null;
}

class RouteError extends Error {
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

type ChatPayload = {
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

/** Word-ish tokens (keeps spaces) so the UI can reveal text smoothly. */
function splitTextForStreaming(text: string): string[] {
  const tokens = text.match(/\S+\s*/g) ?? (text ? [text] : []);
  if (!tokens.length) return [""];
  const maxChunks = 280;
  if (tokens.length <= maxChunks) return tokens;
  const group = Math.ceil(tokens.length / maxChunks);
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i += group) {
    merged.push(tokens.slice(i, i + group).join(""));
  }
  return merged;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runChatFlow({
  supabase,
  userId,
  message,
  incomingConversationId,
  strictVerification,
  resultOffset,
  onProgress,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  message: string;
  incomingConversationId: string | null;
  strictVerification?: boolean;
  resultOffset?: number;
  onProgress?: (event: string, payload: Record<string, unknown>) => void;
}): Promise<ChatPayload> {
  let conversationId = incomingConversationId ?? null;

  if (conversationId) {
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError || !conv) {
      throw new RouteError("Conversation not found", 404);
    }
  } else {
    const { data: conv, error: createError } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        title: message.slice(0, 80),
      })
      .select("id")
      .single();

    if (createError || !conv) {
      throw new RouteError(createError?.message ?? "Could not create conversation", 500);
    }
    conversationId = conv.id;
  }

  if (!conversationId) {
    throw new RouteError("Internal: missing conversation", 500);
  }

  onProgress?.("meta", { conversationId });

  const { data: priorMessages, error: priorError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (priorError) {
    throw new RouteError(priorError.message, 500);
  }

  const turns = (priorMessages ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    text: textFromContent(m.role, m.content),
  }));

  const lastDataSql = extractLastDataSql(priorMessages ?? []);
  const offset = resultOffset ?? 0;
  if (offset > 0 && !lastDataSql) {
    throw new RouteError("No previous data query to paginate — ask a question first.", 400);
  }

  const { error: userMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: userId,
    role: "user",
    content: { type: "user", text: message },
  });

  if (userMsgError) {
    throw new RouteError(userMsgError.message, 500);
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
    } else {
      result = await runOrchestrator({
        turns,
        message,
        toneHints: classification.toneHints,
        strictVerification: strictVerification === true,
        lastSuccessfulDataSql: strictVerification === true ? lastDataSql : undefined,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM error";
    throw new RouteError(msg, 502);
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
    throw new RouteError(asstMsgError.message, 500);
  }

  return buildPayload(conversationId, result);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
  const { message, conversationId: rawConversationId, strictVerification, resultOffset } = parsed.data;
  const incomingConversationId = rawConversationId ?? null;

  if (!wantsStream) {
    try {
      const payload = await runChatFlow({
        supabase,
        userId: user.id,
        message,
        incomingConversationId,
        strictVerification,
        resultOffset,
      });
      return NextResponse.json(payload);
    } catch (e) {
      if (e instanceof RouteError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return NextResponse.json({ error: "Failed to process chat request" }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      void (async () => {
        try {
          const payload = await runChatFlow({
            supabase,
            userId: user.id,
            message,
            incomingConversationId,
            strictVerification,
            resultOffset,
            onProgress: emit,
          });

          const chunks = splitTextForStreaming(payload.assistant_message);
          for (let i = 0; i < chunks.length; i += 1) {
            emit("assistant_delta", { delta: chunks[i] });
            // Pace chunks so the client can render progressively (avoid one blob frame).
            const base = chunks.length > 120 ? 4 : 12;
            const jitter = chunks.length > 120 ? 6 : 18;
            await delay(base + Math.random() * jitter);
          }

          emit("final", payload);
        } catch (e) {
          if (e instanceof RouteError) {
            emit("error", { error: e.message, status: e.status });
          } else {
            emit("error", { error: "Failed to process chat request", status: 500 });
          }
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
