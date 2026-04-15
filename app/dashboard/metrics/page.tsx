import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NORTHWIND_METRICS } from "@/lib/northwind/metrics";
import { cn } from "@/lib/utils";

export default function MetricsPage() {
  const metricsByCategory = Object.entries(
    NORTHWIND_METRICS.reduce<Record<string, typeof NORTHWIND_METRICS>>((acc, m) => {
      acc[m.category] = [...(acc[m.category] ?? []), m];
      return acc;
    }, {}),
  );

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Metric dictionary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curated definitions the assistant should cite as <code className="text-xs">metric_ids</code>{" "}
            when generating SQL.
          </p>
        </div>
        <Link href="/dashboard/chat" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to chat
        </Link>
      </div>

      <Card className="border-dashed border-border bg-muted/20">
        <CardHeader>
          <CardTitle className="text-base">How this works</CardTitle>
          <CardDescription>
            Each metric is a reusable business definition. The orchestrator injects this dictionary into the model
            prompt, and the returned SQL still goes through allowlist validation + strict verification before execution.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-6">
        {metricsByCategory.map(([category, metrics]) => (
          <section key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h2>
              <Badge variant="outline" className="text-[10px]">
                {metrics.length} {metrics.length === 1 ? "metric" : "metrics"}
              </Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {metrics.map((m) => (
                <Card key={m.id} className="border-border">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{m.name}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                        {m.id}
                      </Badge>
                    </div>
                    <CardDescription>{m.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-foreground">Grain: </span>
                      <span className="text-muted-foreground">{m.defaultGrain}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Tables: </span>
                      <span className="text-muted-foreground">{m.tables.join(", ")}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">SQL expression: </span>
                      <code className="block rounded bg-muted px-2 py-1 text-xs">{m.sqlExpr}</code>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Starter prompt: </span>
                      <span className="text-muted-foreground">{m.sampleQuestion}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Card className="border-dashed border-border bg-muted/20">
        <CardHeader>
          <CardTitle className="text-base">Use in chat</CardTitle>
          <CardDescription>
            Ask with the high-trust pattern: metric + dimension + time window (+ optional filter), for example:
            “Revenue by category in 1997.”
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/chat" className={cn(buttonVariants({ variant: "link" }), "h-auto px-0")}>
            Return to chat
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
