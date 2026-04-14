"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NORTHWIND_METRICS, type NorthwindMetric } from "@/lib/northwind/metrics";
import { cn } from "@/lib/utils";

export function DashboardMetricsPicker() {
  const [selected, setSelected] = useState<NorthwindMetric>(NORTHWIND_METRICS[0]!);

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Metrics catalog</CardTitle>
        <CardDescription>
          Select a metric to see the SQL logic DataTalk uses. For the full glossary, validation flow, and
          teaching notes, use the link below.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-h-[min(360px,52vh)] gap-4 pt-0 sm:grid-cols-[minmax(0,200px)_1fr] lg:min-h-[320px] lg:grid-cols-[minmax(0,220px)_1fr]">
        <div
          className="flex max-h-[min(360px,52vh)] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-muted/25 p-1.5 lg:max-h-none"
          role="listbox"
          aria-label="Metrics"
        >
          {NORTHWIND_METRICS.map((m) => {
            const active = selected.id === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSelected(m)}
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-[var(--dt-teal)]/15 text-foreground ring-1 ring-[var(--dt-teal)]/30"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                )}
              >
                <span className="block font-medium text-foreground">{m.name}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{m.id}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0 space-y-3 border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-base font-semibold text-foreground">{selected.name}</h3>
            <Badge variant="secondary" className="text-[10px] capitalize">
              {selected.category}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{selected.description}</p>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SQL expression</p>
            <pre className="mt-1.5 max-h-[min(200px,28vh)] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed">
              <code className="text-foreground">{selected.sqlExpr}</code>
            </pre>
          </div>
          <dl className="grid gap-2 text-xs text-muted-foreground">
            <div>
              <dt className="font-medium text-foreground">Grain</dt>
              <dd className="mt-0.5 text-pretty">{selected.defaultGrain}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Tables</dt>
              <dd className="mt-0.5 font-mono text-[11px]">{selected.tables.join(", ")}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Example question</dt>
              <dd className="mt-0.5 text-pretty italic">&ldquo;{selected.sampleQuestion}&rdquo;</dd>
            </div>
          </dl>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {NORTHWIND_METRICS.length} metrics in the Northwind dictionary.
        </p>
        <Link
          href="/dashboard/metrics"
          className="text-sm font-medium text-[var(--dt-teal)] underline-offset-4 hover:underline"
        >
          Learn more — browse full glossary
        </Link>
      </CardFooter>
    </Card>
  );
}
