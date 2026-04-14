import { CHAT_RESULT_PAGE_SIZE } from "@/lib/datatalk/executor";

export function isReferentialFollowUpMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasPronoun = /\b(them|those|that|it|same|these|they)\b/i.test(trimmed);
  const hasRefinementCue =
    /\b(add|include|with|plus|split|break(?:\s+it)?\s+down|group(?:\s+it)?\s+by)\s+(?:by\s+)?(customer|customers|shipper|shippers|territor(?:y|ies)|region|regions|product|products|category|categories|employee|employees|month|quarter|year)\b/i.test(
      trimmed,
    );
  const hasCarryForwardCue =
    /\b(what|how) about (them|those|these|it|that)\b/i.test(trimmed) ||
    /\b(and|also) (them|those|it)\b/i.test(trimmed) ||
    /\bsame (thing|for|as|query|breakdown|chart|list)\b/i.test(trimmed) ||
    /\b(same|again|as before|based on|for those|for them)\b/i.test(trimmed);
  return words.length <= 14 && (hasPronoun || hasCarryForwardCue || hasRefinementCue);
}

export function isOverallAggregateRequest(message: string): boolean {
  return /\b(sum|total)\s+(?:of\s+)?all\b/i.test(message) || /\b(overall|grand total|across all)\b/i.test(message);
}

export function isUnderspecifiedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  const words = message.trim().split(/\s+/).filter(Boolean);
  const hasTimeWindow =
    /\b(19\d{2}|all years?|all sample years?|between|from|since|last year|this year|last quarter|last month|ytd)\b/i.test(
      lower,
    );
  const hasBreakdown =
    /\b(by|per|group by|category|customer|product|supplier|region|territor|shipper|month|quarter|year)\b/i.test(lower);
  const hasMetric = /\b(revenue|sales|orders?|count|units?|freight|inventory|stock|avg|average)\b/i.test(lower);
  const wantsOverall = isOverallAggregateRequest(message);
  if (words.length <= 4 && hasMetric) return true;
  if (hasMetric && wantsOverall) return !hasTimeWindow;
  return hasMetric && (!hasTimeWindow || !hasBreakdown);
}

export function buildTrustSpecNudge(message: string): string {
  if (isReferentialFollowUpMessage(message)) return "";
  if (!isUnderspecifiedMessage(message)) return "";
  const lower = message.toLowerCase();
  const wantsOverall = isOverallAggregateRequest(message);
  const suggestions: string[] = [];
  if (!/\b(19\d{2}|all years?|all sample years?|between|from|since|last year|this year|last quarter|last month|ytd)\b/i.test(lower)) {
    suggestions.push("time window (for example 1997, 1998, or all sample years)");
  }
  if (
    !wantsOverall &&
    !/\b(by|per|group by|category|customer|product|supplier|region|territor|shipper|month|quarter|year)\b/i.test(lower)
  ) {
    suggestions.push("breakdown dimension (for example by category, customer, product, or region)");
  }
  if (!/\b(where|for|in|country|city|shipper|employee|top\s+\d+)\b/i.test(lower)) {
    suggestions.push("filter scope (for example top 10, one country, or one shipper)");
  }
  const narrowed = suggestions.slice(0, 3);
  if (!narrowed.length) return "";
  return `\n\n**For higher-trust results, please specify:** ${narrowed.join("; ")}.`;
}

export function extractRequestedTopN(message: string): number | null {
  const m = message.toLowerCase();
  const patterns = [
    /\btop\s+(\d{1,3})\b/i,
    /\bfirst\s+(\d{1,3})\b/i,
    /\brank(?:ed|ing)?(?:\s+\w+){0,6}\s+1\s*(?:to|-)\s*(\d{1,3})\b/i,
    /\b(?:show|list|return|give)\s+(?:me\s+)?(\d{1,3})\s+(?:rows|items|products|customers|orders)\b/i,
  ];
  for (const re of patterns) {
    const match = m.match(re);
    const parsed = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= CHAT_RESULT_PAGE_SIZE) {
      return parsed;
    }
  }
  return null;
}

export function enforceRequestedTopN(sql: string, message: string): string {
  const requestedTopN = extractRequestedTopN(message);
  if (!requestedTopN) return sql;
  if (!/\border\s+by\b/i.test(sql)) return sql;
  if (/\blimit\s+\d+\b/i.test(sql)) return sql;
  return `${sql}\nLIMIT ${requestedTopN}`;
}
