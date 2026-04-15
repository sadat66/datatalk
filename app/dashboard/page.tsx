import { ChatPanel } from "@/components/chat-panel";
import { DashboardOverview } from "@/components/dashboard-overview";
import { getConversationsPanelData } from "@/lib/conversations/panel-data";
import { getDashboardDataset } from "@/lib/northwind/dashboard-data";

export default async function DashboardPage() {
  const [dashboardData, conversationsInitial] = await Promise.all([
    getDashboardDataset(),
    getConversationsPanelData(null),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <DashboardOverview data={dashboardData} />
      </div>
      <div
        id="datatalk-chat"
        className="flex min-h-0 w-full shrink-0 flex-col border-t border-border bg-background max-lg:min-h-[min(420px,55dvh)] lg:h-full lg:max-h-full lg:min-h-0 lg:overflow-hidden lg:w-[clamp(480px,44vw,720px)] lg:max-w-[min(100%,56%)] lg:border-l lg:border-t-0"
      >
        <ChatPanel variant="embedded" initialPanelData={conversationsInitial ?? { conversations: [] }} />
      </div>
    </div>
  );
}
