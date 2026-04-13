/** Compact relative labels, e.g. "30 minutes ago", "3 days ago". */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffSec) < 60) {
    return rtf.format(-diffSec, "second");
  }
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(-diffHours, "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return rtf.format(-diffDays, "day");
  }
  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 5) {
    return rtf.format(-diffWeeks, "week");
  }
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(-diffMonths, "month");
  }
  const diffYears = Math.round(diffDays / 365);
  return rtf.format(-diffYears, "year");
}
