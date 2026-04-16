import type { Conversation, MessageRow } from "@/components/chat/types";
import { getUserOrClearSession } from "@/lib/supabase/get-user";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConversationsPanelPayload = {
  conversations: Conversation[];
  messages?: MessageRow[];
};

/**
 * Same data as GET /api/conversations — used by the dashboard (SSR) to avoid a duplicate
 * client fetch on every full page load.
 */
export async function getConversationsPanelData(
  messagesFor: string | null,
): Promise<ConversationsPanelPayload | null> {
  if (!hasSupabaseEnv()) {
    return null;
  }

  const supabase = await createClient();
  const user = await getUserOrClearSession(supabase);

  if (!user) {
    return null;
  }

  const { data: conversations, error: listError } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const conversationList: Conversation[] = listError ? [] : (conversations ?? []);
  if (listError) {
    console.error("[getConversationsPanelData] conversations list:", listError.message);
  }

  if (!messagesFor) {
    return { conversations: conversationList };
  }

  if (!UUID_RE.test(messagesFor)) {
    throw new Error("Invalid messagesFor");
  }

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", messagesFor)
    .maybeSingle();

  if (convError || !conv) {
    throw new Error("Conversation not found");
  }

  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", messagesFor)
    .order("created_at", { ascending: true });

  if (msgError) {
    console.error("[getConversationsPanelData] messages:", msgError.message);
  }

  return {
    conversations: conversationList,
    messages: msgError ? [] : (messages ?? []),
  };
}
