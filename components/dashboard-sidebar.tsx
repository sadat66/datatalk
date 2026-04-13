"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  FileBarChartIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
} from "lucide-react";

import { DataTalkLogo } from "@/components/datatalk-logo";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboardIcon, match: "exact" as const },
  { href: "/dashboard", label: "Orders", icon: ShoppingCartIcon, match: "never" as const },
  { href: "/dashboard", label: "Customers", icon: UsersIcon, match: "never" as const },
  { href: "/dashboard", label: "Suppliers", icon: TruckIcon, match: "never" as const },
  { href: "/dashboard/metrics", label: "Reports", icon: FileBarChartIcon, match: "prefix" as const },
  { href: "/dashboard", label: "Agents", icon: BotIcon, match: "never" as const },
] as const;

function isActive(pathname: string, href: string, match: (typeof nav)[number]["match"]) {
  if (match === "never") return false;
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-[240px] shrink-0 flex-col border-r border-white/10 bg-[var(--dt-navy)] text-white">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <DataTalkLogo variant="inverse" size="sm" />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {nav.map((item) => {
          const active = isActive(pathname, item.href, item.match);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
                item.match === "never" && "pointer-events-none opacity-45",
              )}
              aria-current={active ? "page" : undefined}
              tabIndex={item.match === "never" ? -1 : undefined}
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
