"use client";

import { useState } from "react";

import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

type DashboardShellProps = {
  email: string;
  children: React.ReactNode;
};

export function DashboardShell({ email, children }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-[var(--dt-surface)]">
      <div className="hidden h-full shrink-0 lg:flex">
        <DashboardSidebar />
      </div>
      {mobileNavOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 flex h-full w-[220px] lg:hidden">
            <DashboardSidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DashboardHeader displayName={email} onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
