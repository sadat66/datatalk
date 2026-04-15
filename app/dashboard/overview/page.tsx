import { DashboardOverview } from "@/components/dashboard-overview";
import { getDashboardDataset } from "@/lib/northwind/dashboard-data";

export default async function DashboardOverviewPage() {
  const dashboardData = await getDashboardDataset();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <DashboardOverview data={dashboardData} />
    </div>
  );
}
