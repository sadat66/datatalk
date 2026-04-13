import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NORTHWIND_METRICS } from "@/lib/northwind/metrics";
import { cn } from "@/lib/utils";

export default function MetricsPage() {
  return (
    <div className="space-y-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Metric dictionary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curated definitions the assistant should cite as <code className="text-xs">metric_ids</code>{" "}
            when generating SQL.
          </p>
        </div>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to chat
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {NORTHWIND_METRICS.map((m) => (
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
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed border-border bg-muted/20">
        <CardHeader>
          <CardTitle className="text-base">How this is used</CardTitle>
          <CardDescription>
            The orchestration prompt lists these metrics so the model can ground revenue and counts
            in shared business language before SQL is validated and executed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "link" }), "h-auto px-0")}
          >
            Return to chat
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
