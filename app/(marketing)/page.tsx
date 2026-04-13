import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col">
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-foreground">DataTalk</span>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                href="/dashboard"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  Log in
                </Link>
                <Link href="/signup" className={cn(buttonVariants({ size: "sm" }))}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-4 py-20 sm:px-6">
        <div className="max-w-2xl space-y-5">
          <p className="text-sm font-medium text-primary">Natural language data intelligence</p>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Ask questions about your business data in plain English.
          </h1>
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground">
            DataTalk connects to your Northwind-style warehouse, keeps answers grounded with
            validation and transparency, and helps non-technical stakeholders get numbers they can
            trust.
          </p>
        </div>
        {user ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/dashboard" className={cn(buttonVariants({ size: "lg" }), "justify-center")}>
              Open dashboard
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "justify-center")}>
              Create an account
            </Link>
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "justify-center")}
            >
              I already have an account
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
