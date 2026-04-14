import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd, type DashboardDataset } from "@/lib/northwind/dashboard-data";
import { NORTHWIND_METRICS } from "@/lib/northwind/metrics";

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
  focusYear,
  compareYear,
}: {
  rows: { month: number; monthLabel: string; revenue: number; baselineRevenue: number }[];
  focusYear: number;
  compareYear: number;
}) {
  const w = 280;
  const h = 120;
  const pad = 24;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const vals = rows.map((r) => r.revenue);
  const baseVals = rows.map((r) => r.baselineRevenue);
  const max = Math.max(...vals, ...baseVals, 1);

  function line(series: number[]) {
    return series
      .map((v, i) => {
        const x = pad + (i / Math.max(series.length - 1, 1)) * plotW;
        const y = pad + plotH - (v / max) * plotH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const monthTicks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter(
    (i, j, a) => a.indexOf(i) === j,
  );

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full max-w-full" role="img" aria-label="Revenue trends by month">
      <line x1={pad} y1={pad + plotH} x2={pad + plotW} y2={pad + plotH} className="stroke-border" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={pad + plotH} className="stroke-border" strokeWidth="1" />
      <path d={line(vals)} fill="none" stroke="var(--dt-teal)" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d={line(baseVals)}
        fill="none"
        stroke="oklch(0.65 0.12 195)"
        strokeWidth="2"
        strokeDasharray="4 4"
        strokeLinecap="round"
      />
      {monthTicks.map((i) => (
        <text key={i} x={pad + (i / Math.max(rows.length - 1, 1)) * plotW - 8} y={h - 4} className="fill-muted-foreground text-[9px]">
          {rows[i]?.monthLabel ?? ""}
        </text>
      ))}
      <text x={pad + plotW - 4} y={pad + 10} className="fill-muted-foreground text-[9px]">
        {focusYear} vs {compareYear}
      </text>
    </svg>
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
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Live metrics unavailable</p>
          <p className="mt-1 text-pretty text-muted-foreground dark:text-amber-200/90">{data.error}</p>
        </div>
      </div>
    );
  }

  const { focusYear, compareYear, kpis, revenueByMonth, lateOrders, unfinishedOrders, anomalyCount } = data;
  const metricPreview = NORTHWIND_METRICS.slice(0, 6);

  const kpiCards = [
    {
      title: "Total revenue",
      value: formatUsd(kpis.totalRevenue),
      ...deltaLabel(kpis.totalRevenueDeltaPct, compareYear),
      spark: kpis.revenueSpark,
      kind: "line" as const,
    },
    {
      title: "Avg order value",
      value: formatUsd(kpis.avgOrderValue),
      ...deltaLabel(kpis.avgOrderValueDeltaPct, compareYear),
      spark: kpis.avgOrderSpark,
      kind: "line" as const,
    },
    {
      title: "Orders shipped",
      value: kpis.ordersShipped.toLocaleString(),
      ...deltaLabel(kpis.ordersShippedDeltaPct, compareYear),
      spark: kpis.shippedSpark,
      kind: "bars" as const,
    },
    {
      title: "New customers",
      value: kpis.newCustomers.toLocaleString(),
      ...deltaLabel(kpis.newCustomersDeltaPct, compareYear),
      spark: kpis.customersSpark,
      kind: "bars" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
        <Badge
          variant="secondary"
          className="rounded-full border border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300"
        >
          {anomalyCount} {anomalyCount === 1 ? "anomaly" : "anomalies"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Northwind · FY {focusYear}
          {focusYear > compareYear ? ` (vs ${compareYear})` : ""}
        </span>
      </div>

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
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Revenue trends by month</CardTitle>
            <CardDescription>
              Line revenue in {focusYear} vs {compareYear} (same calendar months)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--dt-teal)]" />
                {focusYear}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[var(--dt-teal)]/40" />
                {compareYear}
              </span>
            </div>
            <RevenueChart rows={revenueByMonth} focusYear={focusYear} compareYear={compareYear} />
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Metrics dictionary</CardTitle>
            <CardDescription>Shared metric definitions for trusted NL-to-SQL answers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {metricPreview.map((m) => (
                <Badge key={m.id} variant="secondary" className="font-mono text-[10px]">
                  {m.id}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Metrics keep prompts grounded in consistent business logic (revenue, orders, shipping, and inventory).
            </p>
            <Link href="/dashboard/metrics" className="text-sm font-medium text-[var(--dt-teal)] hover:underline">
              Open full metrics catalog
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent late orders</CardTitle>
            <CardDescription>Shipped after required date (most recent first)</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {lateOrders.length ? (
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
                        <Link href="/dashboard" className="text-[var(--dt-teal)] hover:underline">
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
                        <Link href="/dashboard" className="text-[var(--dt-teal)] hover:underline">
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
            ) : (
              <p className="px-4 text-sm text-muted-foreground">No open or late orders in this year.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
