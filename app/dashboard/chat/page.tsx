import { redirect } from "next/navigation";

import { ChatPanel } from "@/components/chat-panel";
import { getConversationsPanelData } from "@/lib/conversations/panel-data";

type Props = {
  searchParams?: Promise<{ prompt?: string | string[] }>;
};

export default async function DashboardChatPage({ searchParams }: Props) {
  const initialPanelData = await getConversationsPanelData(null);
  if (!initialPanelData) {
    redirect("/login");
  }

  const sp = (await searchParams) ?? {};
  const raw = sp.prompt;
  const promptParam = Array.isArray(raw) ? raw[0] : raw;
  const initialAutoSendPrompt =
    typeof promptParam === "string" && promptParam.trim() ? promptParam.trim() : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatPanel
          variant="default"
          initialPanelData={initialPanelData}
          initialAutoSendPrompt={initialAutoSendPrompt}
        />
      </div>
    </div>
  );
}
