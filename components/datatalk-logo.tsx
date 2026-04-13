import { BarChart3Icon } from "lucide-react";

import { cn } from "@/lib/utils";

type DataTalkLogoProps = {
  className?: string;
  iconClassName?: string;
  size?: "sm" | "md";
  /** Light text for dark backgrounds (e.g. sidebar). */
  variant?: "default" | "inverse";
};

export function DataTalkLogo({
  className,
  iconClassName,
  size = "md",
  variant = "default",
}: DataTalkLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        className={cn(
          "flex items-center justify-center rounded-lg bg-[var(--dt-teal)] text-white shadow-sm",
          size === "sm" ? "size-8" : "size-9",
        )}
      >
        <BarChart3Icon className={cn(size === "sm" ? "size-4" : "size-[18px]", iconClassName)} />
      </span>
      <span
        className={cn(
          size === "sm" ? "text-sm" : "text-base",
          variant === "inverse" ? "text-white" : "text-foreground",
        )}
      >
        DataTalk
      </span>
    </span>
  );
}
