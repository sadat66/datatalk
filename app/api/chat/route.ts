import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/datatalk/orchestrator";
import type { AssistantMessageContent } from "@/lib/datatalk/types";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1).max(8000),
});

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
  };
}

function splitTextForStreaming(text: string, chunkSize = 36): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const token of tokens) {
    if ((current + token).length > chunkSize && current) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [text];
}

async function runChatFlow({
  supabase,
  userId,
  message,
  incomingConversationId,
  onProgress,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  message: string;
  incomingConversationId: string | null;
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

  let result: Awaited<ReturnType<typeof runOrchestrator>>;
  try {
    result = await runOrchestrator({ turns, message });
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
  const { message, conversationId: incomingConversationId } = parsed.data;

  if (!wantsStream) {
    try {
      const payload = await runChatFlow({
        supabase,
        userId: user.id,
        message,
        incomingConversationId,
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
            onProgress: emit,
          });

          for (const delta of splitTextForStreaming(payload.assistant_message)) {
            emit("assistant_delta", { delta });
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
    },
  });
}
