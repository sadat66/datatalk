import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  MessageSquareIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { DataTalkLogo } from "@/components/datatalk-logo";
import { MarketingDashboardPreview } from "@/components/marketing-dashboard-preview";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthUser } from "@/lib/supabase/auth";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const user = await getAuthUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <DataTalkLogo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ size: "sm" }), "gap-1.5 bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90")}
              >
                Dashboard
                <ArrowRightIcon className="size-3.5 opacity-90" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className={cn(buttonVariants({ size: "sm" }), "bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90")}
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border/60 bg-[var(--dt-surface)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.92_0.04_195/0.5),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--dt-teal)]/25 bg-white/80 px-3 py-1 text-xs font-medium text-[var(--dt-teal)] shadow-sm backdrop-blur dark:bg-card/60">
              <SparklesIcon className="size-3.5" />
              Natural language data intelligence
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Ask questions about your business data in plain English.
            </h1>
            <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
              DataTalk connects to your Northwind-style warehouse, validates SQL, and explains answers so
              stakeholders get numbers they can trust, with an agent always close by.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {user ? (
                <Link
                  href="/dashboard"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "justify-center gap-2 bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90",
                  )}
                >
                  Open dashboard
                  <ArrowRightIcon className="size-4" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className={cn(
                      buttonVariants({ size: "lg" }),
                      "justify-center gap-2 bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90",
                    )}
                  >
                    Create an account
                  </Link>
                  <Link
                    href="/login"
                    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "justify-center")}
                  >
                    I already have an account
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="relative">
            <MarketingDashboardPreview />
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Product preview - your workspace uses the same visual system after sign in.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Built for clarity</h2>
          <p className="mt-2 text-muted-foreground">
            Everything in one place: overview metrics, curated reports, and a conversational agent.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Dashboard overview",
              desc: "KPIs, trends, and operational tables aligned with how teams actually review performance.",
              icon: BarChart3Icon,
            },
            {
              title: "Trusted answers",
              desc: "Validation and transparency on generated SQL so you know what ran and why.",
              icon: ShieldCheckIcon,
            },
            {
              title: "DataTalk Agent",
              desc: "Natural language on the right rail - ask follow-ups without leaving the numbers.",
              icon: MessageSquareIcon,
            },
          ].map((f) => (
            <Card key={f.title} className="border-border/80 shadow-sm">
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-[var(--dt-teal)]/10 text-[var(--dt-teal)]">
                  <f.icon className="size-5" />
                </div>
                <CardTitle className="text-base">{f.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <footer className="mt-auto border-t border-border bg-muted/30 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6">
          <DataTalkLogo size="sm" />
          <p className="text-xs text-muted-foreground">(c) {new Date().getFullYear()} DataTalk</p>
        </div>
      </footer>
    </div>
  );
}

