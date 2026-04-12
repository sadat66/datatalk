import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { runOrchestrator } from "@/lib/datatalk/orchestrator";
import type { AssistantMessageContent } from "@/lib/datatalk/types";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1).max(8000),
});

function textFromContent(role: string, content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (role === "user" && c.type === "user" && typeof c.text === "string") return c.text;
  if (role === "assistant" && c.type === "assistant" && typeof c.text === "string") return c.text;
  return JSON.stringify(content);
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

  const { message, conversationId: incomingConversationId } = parsed.data;
  let conversationId = incomingConversationId ?? null;

  if (conversationId) {
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError || !conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    const { data: conv, error: createError } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: message.slice(0, 80),
      })
      .select("id")
      .single();

    if (createError || !conv) {
      return NextResponse.json(
        { error: createError?.message ?? "Could not create conversation" },
        { status: 500 },
      );
    }
    conversationId = conv.id;
  }

  const { data: priorMessages, error: priorError } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }

  const turns = (priorMessages ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    text: textFromContent(m.role, m.content),
  }));

  const { error: userMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "user",
    content: { type: "user", text: message },
  });

  if (userMsgError) {
    return NextResponse.json({ error: userMsgError.message }, { status: 500 });
  }

  let result;
  try {
    result = await runOrchestrator({ turns, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const assistantContent: AssistantMessageContent = {
    type: "assistant",
    text: result.assistant_message,
    sql: result.sql,
    rows: result.rows,
    trust: result.trust,
    plan_summary: result.plan_summary ?? undefined,
    metric_ids: result.metric_ids,
    assumptions: result.assumptions,
  };

  const { error: asstMsgError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "assistant",
    content: assistantContent as unknown as Record<string, unknown>,
  });

  if (asstMsgError) {
    return NextResponse.json({ error: asstMsgError.message }, { status: 500 });
  }

  return NextResponse.json({
    conversationId,
    kind: result.kind,
    assistant_message: result.assistant_message,
    sql: result.sql,
    rows: result.rows,
    trust: result.trust,
    plan_summary: result.plan_summary,
    metric_ids: result.metric_ids,
    assumptions: result.assumptions,
  });
}
