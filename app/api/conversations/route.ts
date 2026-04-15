import { NextResponse } from "next/server";

import { getConversationsPanelData } from "@/lib/conversations/panel-data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const messagesFor = searchParams.get("messagesFor");

  try {
    const data = await getConversationsPanelData(messagesFor);
    if (!data) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Invalid messagesFor") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (msg === "Conversation not found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error("[conversations] unexpected error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
