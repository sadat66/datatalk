import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { getAuthUser } from "@/lib/supabase/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  if (!user) {
    redirect("/login");
  }

  return <DashboardShell email={user.email ?? ""}>{children}</DashboardShell>;
}
