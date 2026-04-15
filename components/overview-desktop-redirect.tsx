"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const LG_MIN_PX = 1024;

/**
 * Keep `/dashboard/overview` reachable on phones, but prefer the split
 * overview+chat workspace (`/dashboard`) on desktop widths.
 */
export function OverviewDesktopRedirect() {
  const router = useRouter();

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${LG_MIN_PX}px)`);
    if (mq.matches) {
      router.replace("/dashboard");
    }
  }, [router]);

  return null;
}
