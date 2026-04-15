"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { signupAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signupSchema } from "@/lib/auth-schema";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const [pending, setPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const submitLockRef = useRef(false);

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

    const parsed = signupSchema.safeParse({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Invalid input");
      setPending(false);
      submitLockRef.current = false;
      return;
    }

    let errorMessage: string | null = null;
    let signUpSucceeded = false;
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
        },
      });
      if (error) {
        errorMessage = error.message;
      } else {
        signUpSucceeded = true;
      }
    } finally {
      if (!signUpSucceeded) {
        setPending(false);
        submitLockRef.current = false;
      }
    }

    if (errorMessage) {
      const normalized = errorMessage.toLowerCase();
      const looksLikeAccountExists =
        normalized.includes("already") ||
        normalized.includes("registered") ||
        normalized.includes("exists");

      if (looksLikeAccountExists) {
        setConfirmationSent(true);
        setPending(false);
        submitLockRef.current = false;
        toast.success("If this email can receive signup verification, a link will be sent.");
        return;
      }

      toast.error("Unable to create account right now. Please try again.");
      setPending(false);
      submitLockRef.current = false;
      return;
    }

    setConfirmationSent(true);
    toast.success("If this email can receive signup verification, a link will be sent.");
  }

  if (confirmationSent) {
    return (
      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-5 text-sm">
        <p className="text-base font-semibold">Check your email.</p>
        <p className="text-muted-foreground">
          If this address is eligible for signup verification, you will receive a confirmation link
          shortly. Then sign in from the login page.
        </p>
        <Link href="/login" className="inline-block font-medium text-primary underline-offset-4 hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={signupAction} onSubmit={onSubmit} className="relative space-y-4" aria-busy={pending}>
      {pending ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-sm">
          <span className="size-10 animate-spin rounded-full border-4 border-primary/25 border-t-primary" />
          <p className="text-base font-medium text-foreground">Creating your account…</p>
          <p className="text-sm text-muted-foreground">Please wait while we process your signup.</p>
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
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </fieldset>
    </form>
  );
}
