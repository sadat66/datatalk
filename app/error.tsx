"use client";

import { useEffect } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          A server error prevented this page from rendering. If you just deployed, confirm{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_*</code> and database env vars
          are set on Vercel, and that Supabase tables exist.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className={buttonVariants({ variant: "default", size: "sm" })}
        >
          Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Home
        </Link>
      </div>
    </div>
  );
}
