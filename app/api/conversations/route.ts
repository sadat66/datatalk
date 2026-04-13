import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const messagesFor = searchParams.get("messagesFor");

  const { data: conversations, error: listError } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  if (!messagesFor) {
    return NextResponse.json({ conversations: conversations ?? [] });
  }

  if (!UUID_RE.test(messagesFor)) {
    return NextResponse.json({ error: "Invalid messagesFor" }, { status: 400 });
  }

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", messagesFor)
    .maybeSingle();

  if (convError || !conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", messagesFor)
    .order("created_at", { ascending: true });

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json({
    conversations: conversations ?? [],
    messages: messages ?? [],
  });
}
