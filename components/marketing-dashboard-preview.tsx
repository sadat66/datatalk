import { BarChart3Icon } from "lucide-react";

/** Static visual mock for the landing page (no external image asset). */
export function MarketingDashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.04]">
      <div className="flex min-h-[280px] sm:min-h-[320px] lg:min-h-[360px]">
        <div className="flex w-[18%] min-w-[52px] flex-col border-r border-white/10 bg-[var(--dt-navy)] py-3 pl-2 pr-1 text-white">
          <div className="mb-3 flex items-center gap-1.5 px-1">
            <span className="flex size-7 items-center justify-center rounded-md bg-[var(--dt-teal)]">
              <BarChart3Icon className="size-3.5" />
            </span>
            <span className="hidden text-[10px] font-semibold leading-none sm:inline">DataTalk</span>
          </div>
          <div className="space-y-1">
            <div className="rounded-md bg-white/15 px-2 py-1.5 text-[9px] font-medium">Overview</div>
            <div className="rounded-md px-2 py-1.5 text-[9px] text-white/50">Reports</div>
            <div className="rounded-md px-2 py-1.5 text-[9px] text-white/50">Agents</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 bg-[var(--dt-surface)] p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="h-2 w-24 rounded-full bg-foreground/10" />
            <div className="h-6 w-28 rounded-md border border-border bg-background" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/80 bg-white p-2 shadow-sm dark:bg-card"
              >
                <div className="mb-1 h-1.5 w-12 rounded-full bg-muted" />
                <div className="mb-2 h-4 w-16 rounded bg-foreground/15" />
                <div className="h-6 w-full rounded-md bg-[var(--dt-teal)]/15" />
              </div>
            ))}
          </div>
          <div className="grid gap-2 lg:grid-cols-[1fr_min(32%,220px)]">
            <div className="space-y-2">
              <div className="h-20 rounded-xl border border-border/80 bg-white p-2 shadow-sm dark:bg-card">
                <div className="mb-2 h-2 w-28 rounded-full bg-muted" />
                <div className="h-10 w-full rounded-md bg-[var(--dt-teal)]/10" />
              </div>
              <div className="h-16 rounded-xl border border-border/80 bg-white p-2 shadow-sm dark:bg-card">
                <div className="h-2 w-24 rounded-full bg-muted" />
              </div>
            </div>
            <div className="rounded-xl border border-border/80 bg-white p-2 shadow-sm dark:bg-card">
              <div className="mb-2 flex items-center justify-between">
                <div className="h-2 w-16 rounded-full bg-muted" />
                <div className="size-3 rounded bg-muted" />
              </div>
              <div className="mb-2 h-12 rounded-md bg-muted/40" />
              <div className="h-14 rounded-md border border-dashed border-border bg-muted/20" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
