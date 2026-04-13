"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const clickLockRef = useRef(false);

  async function onSignOut() {
    if (clickLockRef.current) return;
    clickLockRef.current = true;
    setPending(true);

    let didSignOut = false;
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      didSignOut = true;
      window.location.assign("/");
    } finally {
      if (!didSignOut) {
        setPending(false);
        clickLockRef.current = false;
      }
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground"
      onClick={onSignOut}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
