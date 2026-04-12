import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  email: string;
  children: React.ReactNode;
};

export function DashboardShell({ email, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              DataTalk
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Northwind analytics
            </span>
            <nav className="hidden items-center gap-1 sm:flex">
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
              >
                Chat
              </Link>
              <Link
                href="/dashboard/metrics"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
              >
                Metrics
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="max-w-[200px] truncate text-xs text-muted-foreground sm:max-w-xs">
              {email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
        {children}
      </div>
    </div>
  );
}
