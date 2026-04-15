import { redirect } from "next/navigation";

import { ChatPanel } from "@/components/chat-panel";
import { getConversationsPanelData } from "@/lib/conversations/panel-data";

export default async function DashboardChatPage() {
  const initialPanelData = await getConversationsPanelData(null);
  if (!initialPanelData) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatPanel variant="default" initialPanelData={initialPanelData} />
      </div>
    </div>
  );
}
