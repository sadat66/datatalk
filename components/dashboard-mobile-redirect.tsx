"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const LG_MIN_PX = 1024;

/** On viewports below `lg`, `/dashboard` (split overview + chat) is replaced with the full chat route. */
export function DashboardMobileRedirect() {
  const router = useRouter();

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${LG_MIN_PX}px)`);
    const apply = () => {
      if (!mq.matches) router.replace("/dashboard/chat");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [router]);

  return null;
}
