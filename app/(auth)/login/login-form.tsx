"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@/lib/auth-schema";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  nextPath?: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const submitLockRef = useRef(false);

  const next = useMemo(
    () => nextPath ?? searchParams.get("next") ?? "/dashboard",
    [nextPath, searchParams],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const submitter = (event.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    if (submitter) {
      submitter.disabled = true;
    }

    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setPending(true);

    const formData = new FormData(event.currentTarget);

    const parsed = loginSchema.safeParse({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Invalid input");
      setPending(false);
      submitLockRef.current = false;
      return;
    }

    let errorMessage: string | null = null;
    let signInSucceeded = false;
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) {
        errorMessage = error.message;
      } else {
        signInSucceeded = true;
      }
    } finally {
      if (!signInSucceeded) {
        setPending(false);
        submitLockRef.current = false;
      }
    }

    if (errorMessage) {
      if (errorMessage.toLowerCase().includes("email not confirmed")) {
        toast.error("Please verify your email before signing in.");
        return;
      }
      toast.error(errorMessage);
      return;
    }

    window.location.assign(next.startsWith("/") ? next : "/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="relative space-y-4" aria-busy={pending}>
      {pending ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-sm">
          <span className="size-10 animate-spin rounded-full border-4 border-primary/25 border-t-primary" />
          <p className="text-base font-medium text-foreground">Signing you in…</p>
          <p className="text-sm text-muted-foreground">Please wait while we secure your session.</p>
        </div>
      ) : null}
      <fieldset className="space-y-4" disabled={pending}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </fieldset>
    </form>
  );
}
