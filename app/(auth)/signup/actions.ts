"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { signupSchema } from "@/lib/auth-schema";
import { createClient } from "@/lib/supabase/server";

function resolveOrigin(h: Headers): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function signupAction(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    redirect(`/signup?error=${encodeURIComponent(msg)}`);
  }

  const headerStore = await headers();
  const origin = resolveOrigin(headerStore);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent("Unable to create account right now. Please try again.")}`);
  }

  redirect("/signup?success=1");
}
