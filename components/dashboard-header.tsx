"use client";

import { BellIcon, CalendarIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardHeaderProps = {
  displayName: string;
  subtitle?: string;
};

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "U";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase() || "U";
}

export function DashboardHeader({ displayName, subtitle = "Analytics workspace" }: DashboardHeaderProps) {
  const initials = initialsFromEmail(displayName);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <p className="hidden text-xs text-muted-foreground sm:block">{subtitle}</p>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-8 gap-1.5 border-border bg-background font-normal text-muted-foreground sm:inline-flex"
        >
          <CalendarIcon className="size-3.5" />
          Jan 1, 2026 – Mar 31, 2026
          <ChevronDownIcon className="size-3.5 opacity-60" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative text-muted-foreground"
          aria-label="Notifications"
        >
          <BellIcon className="size-4" />
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-[var(--dt-alert)] text-[10px] font-semibold text-white">
            3
          </span>
        </Button>
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm",
              "bg-[var(--dt-teal)]",
            )}
          >
            {initials}
          </span>
          <span className="hidden max-w-[140px] truncate text-sm font-medium text-foreground lg:inline">
            {displayName.includes("@")
              ? displayName.split("@")[0]?.replace(/[._]/g, " ") ?? "User"
              : displayName}
          </span>
        </div>
      </div>
    </header>
  );
}
