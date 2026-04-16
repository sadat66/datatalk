import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EXAMPLE_CHAT_PROMPTS } from "@/lib/datatalk/example-prompts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardMetricsPicker } from "@/components/dashboard-metrics-picker";
import { formatUsd, type DashboardDataset } from "@/lib/northwind/dashboard-data";

function SparkLine({ values, className }: { values: number[]; className?: string }) {
  const w = 80;
  const h = 28;
  const pad = 2;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
        <line
          x1={pad}
          y1={h / 2}
          x2={w - pad}
          y2={h / 2}
          className="stroke-muted-foreground/40"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const max = Math.max(...values, 0.0001);
  const d = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * innerW;
      const y = pad + innerH * (1 - v / max);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-emerald-600" />
    </svg>
  );
}

function SparkBars({ values, className }: { values: number[]; className?: string }) {
  const w = 80;
  const h = 28;
  const n = Math.max(values.length, 1);
  const gap = 2;
  const barW = (w - gap * (n + 1)) / n;
  const max = Math.max(...values, 0.0001);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      {values.map((v, i) => {
        const height = (v / max) * (h - 6);
        const x = gap + i * (barW + gap);
        const y = h - gap - height;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(height, 1)}
            rx="1"
            className="fill-[var(--dt-teal)]/80"
          />
        );
      })}
    </svg>
  );
}

function RevenueChart({
  rows,
}: {
  rows: {
    month: number;
    monthLabel: string;
    revenue: number;
    baselineRevenue: number;
    historyRevenue: number;
  }[];
}) {
  const w = 320;
  const h = 132;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const yBase = padT + plotH;
  const vals = rows.map((r) => r.revenue);
  const baseVals = rows.map((r) => r.baselineRevenue);
  const histVals = rows.map((r) => r.historyRevenue);
  const max = Math.max(...vals, ...baseVals, ...histVals, 1);
  const n = Math.max(rows.length, 1);
  const xAt = (i: number) => padL + (i / Math.max(n - 1, 1)) * plotW;

  function line(series: number[]) {
    return series
      .map((v, i) => {
        const x = xAt(i);
        const y = padT + plotH - (v / max) * plotH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const monthTicks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter(
    (i, j, a) => a.indexOf(i) === j,
  );

  return (
    <div className="w-full min-w-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full max-w-full"
        role="img"
        aria-label="Revenue trends by month"
      >
        <line x1={padL} y1={yBase} x2={padL + plotW} y2={yBase} className="stroke-border" strokeWidth="1" />
        <line x1={padL} y1={padT} x2={padL} y2={yBase} className="stroke-border" strokeWidth="1" />
        <path d={line(vals)} fill="none" stroke="var(--dt-teal)" strokeWidth="2.5" strokeLinecap="round" />
        <path
          d={line(baseVals)}
          fill="none"
          stroke="oklch(0.65 0.12 195)"
          strokeWidth="2"
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
        <path
          d={line(histVals)}
          fill="none"
          stroke="oklch(0.65 0.12 280)"
          strokeWidth="1.75"
          strokeDasharray="2 3"
          strokeLinecap="round"
        />
        {monthTicks.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={h - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 9 }}
          >
            {rows[i]?.monthLabel ?? ""}
          </text>
        ))}
      </svg>
    </div>
  );
}

function deltaLabel(pct: number | null, compareYear: number): { text: string; positive: boolean } {
  if (pct === null) {
    return { text: `No prior-year data (${compareYear})`, positive: true };
  }
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct}% vs ${compareYear}`,
    positive: pct >= 0,
  };
}

export function DashboardOverview({ data }: { data: DashboardDataset }) {
  if (!data.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Live metrics unavailable</p>
          <p className="mt-1 text-pretty text-muted-foreground dark:text-amber-200/90">{data.error}</p>
        </div>
      </div>
    );
  }

  const {
    focusYear,
    compareYear,
    historyYear,
    kpis,
    revenueByMonth,
    lateOrders,
    unfinishedOrders,
    anomalyCount,
    anomalyExplanation,
  } = data;
  const kpiCards = [
    {
      title: "Total revenue",
      definition:
        "Sum of line revenue (unit price × quantity × (1 − discount)) for orders with an order date in the fiscal year.",
      value: formatUsd(kpis.totalRevenue),
      ...deltaLabel(kpis.totalRevenueDeltaPct, compareYear),
      spark: kpis.revenueSpark,
      kind: "line" as const,
    },
    {
      title: "Avg order value",
      definition:
        "Total line revenue for the year divided by count of distinct orders in that year (order-level average basket).",
      value: formatUsd(kpis.avgOrderValue),
      ...deltaLabel(kpis.avgOrderValueDeltaPct, compareYear),
      spark: kpis.avgOrderSpark,
      kind: "line" as const,
    },
    {
      title: "Orders shipped",
      definition:
        "Count of orders with a shipped date in the fiscal year (excludes orders that never shipped in that year).",
      value: kpis.ordersShipped.toLocaleString(),
      ...deltaLabel(kpis.ordersShippedDeltaPct, compareYear),
      spark: kpis.shippedSpark,
      kind: "bars" as const,
    },
    {
      title: "New customers",
      definition:
        "Customers whose first order falls in the fiscal year (approx. cohort based on earliest order date).",
      value: kpis.newCustomers.toLocaleString(),
      ...deltaLabel(kpis.newCustomersDeltaPct, compareYear),
      spark: kpis.customersSpark,
      kind: "bars" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
        <span
          title={anomalyExplanation}
          className="inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="secondary"
            className="pointer-events-none rounded-full border border-orange-200/90 bg-orange-50 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/50 dark:text-orange-200"
          >
            {anomalyCount} {anomalyCount === 1 ? "open / late order" : "open / late orders"}
          </Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          Northwind sample · FY {focusYear}
          {focusYear > compareYear ? ` · vs ${compareYear}` : ""}
        </span>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2 sm:pb-3">
          <CardTitle className="text-base">What you can ask</CardTitle>
          <CardDescription className="text-pretty">
            Plain-English questions — no SQL required. Tap a pill to open Chat with that question.{" "}
            <span className="lg:hidden">
              Use <strong>Chat</strong> in the menu (☰) anytime.
            </span>
            <span className="hidden lg:inline">You can also type in the DataTalk panel on the right.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:flex-wrap sm:overflow-visible">
            {EXAMPLE_CHAT_PROMPTS.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/chat?prompt=${encodeURIComponent(p.text)}`}
                scroll={false}
                className="shrink-0 snap-start rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/80 active:bg-muted"
                title={p.text}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((k) => (
          <Card
            key={k.title}
            className="border-border/80 shadow-sm shadow-black/[0.03] transition-shadow hover:shadow-md"
          >
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {k.title}
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums text-foreground">{k.value}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {k.kind === "line" ? (
                <SparkLine values={k.spark} className="h-7 w-full text-primary" />
              ) : (
                <SparkBars values={k.spark} className="h-7 w-full" />
              )}
              <p
                className={
                  k.positive
                    ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                    : "text-xs font-medium text-red-600 dark:text-red-400"
                }
              >
                {k.text}
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground">{k.definition}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.22fr)] lg:items-start">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Revenue trends by month</CardTitle>
            <CardDescription>
              Line revenue by calendar month: {focusYear}, {compareYear}, and {historyYear}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
              aria-label={`Legend: ${focusYear} solid, ${compareYear} dashed, ${historyYear} dotted`}
            >
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="size-2 shrink-0 rounded-full bg-[var(--dt-teal)]" aria-hidden />
                <span className="tabular-nums">{focusYear}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="size-2 shrink-0 rounded-full bg-[var(--dt-teal)]/40" aria-hidden />
                <span className="tabular-nums">{compareYear}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className="size-2 shrink-0 rounded-full border border-dashed border-violet-400/90 bg-violet-500/25"
                  aria-hidden
                />
                <span className="tabular-nums">{historyYear}</span>
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
              Revenue is line total (unit × qty × (1 − discount)) summed by calendar month. Solid = FY{" "}
              {focusYear}, dashed = FY {compareYear}, dotted = FY {historyYear} (same month positions).
            </p>
            <RevenueChart rows={revenueByMonth} />
          </CardContent>
        </Card>
        <DashboardMetricsPicker />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent late orders</CardTitle>
            <CardDescription>Shipped after required date (most recent first)</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {lateOrders.length ? (
              <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Shipper</TableHead>
                    <TableHead className="text-right">Days late</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lateOrders.map((row) => (
                    <TableRow key={row.orderId}>
                      <TableCell className="font-medium">
                        <Link href="/dashboard/overview" className="text-[var(--dt-teal)] hover:underline">
                          {row.orderId}
                        </Link>
                      </TableCell>
                      <TableCell>{row.customer}</TableCell>
                      <TableCell>{row.shipper}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.daysLate}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(row.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            ) : (
              <p className="px-4 text-sm text-muted-foreground">No late shipments found.</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent unfinished business</CardTitle>
            <CardDescription>Open or late orders in {focusYear}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {unfinishedOrders.length ? (
              <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unfinishedOrders.map((row) => (
                    <TableRow key={row.orderId}>
                      <TableCell className="font-medium">
                        <Link href="/dashboard/overview" className="text-[var(--dt-teal)] hover:underline">
                          {row.orderId}
                        </Link>
                      </TableCell>
                      <TableCell>{row.customer}</TableCell>
                      <TableCell>
                        {row.status === "Late" ? (
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                          >
                            Late
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="rounded-full">
                            {row.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(row.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            ) : (
              <p className="px-4 text-sm text-muted-foreground">No open or late orders in this year.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
