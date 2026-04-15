"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileBarChartIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  SettingsIcon,
} from "lucide-react";

import { DataTalkLogo } from "@/components/datatalk-logo";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard/overview", label: "Overview", icon: LayoutDashboardIcon, match: "overview" as const },
  { href: "/dashboard/chat", label: "Chat", icon: MessageSquareIcon, match: "prefix" as const },
  { href: "/dashboard/metrics", label: "Metrics", icon: FileBarChartIcon, match: "prefix" as const },
] as const;

function isActive(pathname: string, href: string, match: (typeof nav)[number]["match"]) {
  if (match === "overview") {
    return (
      pathname === "/dashboard" ||
      pathname === "/dashboard/overview" ||
      pathname.startsWith("/dashboard/overview/")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

type DashboardSidebarProps = {
  onNavigate?: () => void;
};

export function DashboardSidebar({ onNavigate }: DashboardSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full min-h-0 w-[220px] shrink-0 flex-col border-r border-white/10 bg-[var(--dt-navy)] text-white">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <DataTalkLogo variant="inverse" size="sm" />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3" aria-label="Main">
        {nav.map((item) => {
          const active = isActive(pathname, item.href, item.match);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => onNavigate?.()}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-[18px] shrink-0 opacity-90" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-white/10 p-3">
        <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/45">
          <SettingsIcon className="size-[18px] shrink-0" />
          Settings
        </span>
        <div className="px-1 pt-1 [&_button]:w-full [&_button]:justify-start [&_button]:text-white/80 [&_button]:hover:bg-white/10 [&_button]:hover:text-white">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
