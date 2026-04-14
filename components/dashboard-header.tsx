"use client";

import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardHeaderProps = {
  displayName: string;
};

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "U";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || "U";
}

export function DashboardHeader({ displayName }: DashboardHeaderProps) {
  const initials = initialsFromEmail(displayName);
  const shortName = displayName.includes("@")
    ? displayName.split("@")[0]?.replace(/[._]/g, " ") ?? "User"
    : displayName;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg text-base font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          DataTalk
        </Link>
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-semibold text-foreground">Workspace</p>
          <p className="truncate text-xs text-muted-foreground">Northwind analytics &amp; DataTalk chat</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Link
          href="/dashboard/chat"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "hidden h-8 gap-1.5 border-border bg-background font-normal text-muted-foreground md:inline-flex",
          )}
        >
          <MessageSquareIcon className="size-3.5" />
          Open chat
        </Link>
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
              "bg-[var(--dt-teal)]",
            )}
            aria-hidden
          >
            {initials}
          </span>
          <span className="hidden max-w-[160px] truncate text-sm font-medium text-foreground lg:inline">
            {shortName}
          </span>
        </div>
      </div>
    </header>
  );
}
