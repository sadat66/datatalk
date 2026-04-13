import { ChatPanel } from "@/components/chat-panel";
import { DashboardOverview } from "@/components/dashboard-overview";
import { getDashboardDataset } from "@/lib/northwind/dashboard-data";

export default async function DashboardPage() {
  const dashboardData = await getDashboardDataset();

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <DashboardOverview data={dashboardData} />
      </div>
      <div className="flex min-h-[min(480px,60vh)] w-full shrink-0 flex-col border-t border-border bg-background lg:min-h-0 lg:w-[400px] lg:border-l lg:border-t-0 xl:w-[420px]">
        <ChatPanel variant="embedded" />
      </div>
    </div>
  );
}
