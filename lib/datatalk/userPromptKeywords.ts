import type { OrchestratorResult } from "@/lib/datatalk/orchestrator";
import { buildTrustReport } from "@/lib/datatalk/trust";

/**
 * Lightweight regex sweep over user text (similar in spirit to keyword guards elsewhere).
 * Tuned for obvious frustration / profanity — not exhaustive; pair with a calm product tone.
 */

const HAS_ANALYTICS_INTENT =
  /\b(revenue|sales|order|orders|sql|query|customer|customers|product|products|supplier|region|territor|count|total|top|show|list|chart|breakdown|data|metric|employee|shipper|category|by |group|trend|sum|avg|average|how many|which|where|when|northwind)\b/i;

/** Strong frustration / coarse language (abbreviations and clear phrases). */
const FRUSTRATION_PATTERNS: RegExp[] = [
  /\bwtf\b/i,
  /\bwth\b/i,
  /\bomfg\b/i,
  /\bfml\b/i,
  /\bstfu\b/i,
  /\bdumbass\b/i,
  /\bhorrible\b/i,
  /\bawful\b/i,
  /\bterrible\b/i,
  /\bsucks\b/i,
  /\bscrew\s+(?:this|you|it|that|off)\b/i,
  /\bgo\s+screw\b/i,
  /\b(piece\s+of\s+(?:sh[i1*]t|crap))\b/i,
  /\bf\s+u\b/i,
  /\bf+\s*you\b/i,
  /\bfuck(?:\s+you)?\b/i,
  /\bsh[i1*]t\b/i,
  /\bbull?sh[i1*]t\b/i,
  /\basshole\b/i,
  /\bbitch\b/i,
  /\b(?:damn\s+you|goddamn)\b/i,
  /\bhate\s+(?:this|you|it)\b/i,
];

function hasFrustrationSignals(text: string): boolean {
  const t = text.toLowerCase();
  return FRUSTRATION_PATTERNS.some((re) => re.test(t));
}

// Greeting: single regex for full-string match
const GREETING_ONLY =
  /^[\s]*(hi|hello|hey|howdy|greetings|yo|good\s+(?:morning|afternoon|evening|day)|what'?s\s+up|\bsup\b)(?:\s+(?:there|team|datatalk|all|everyone))?[.!,\s]*$/i;

const THANKS_ONLY = /^[\s]*(thanks|thank\s+you|thx|ty|much\s+appreciated)[.!,\s]*$/i;

function isGreetingOnly(text: string): boolean {
  const t = text.trim();
  if (t.length > 120) return false;
  if (HAS_ANALYTICS_INTENT.test(t)) return false;
  if (/[\n\r]/.test(t)) return false;
  return GREETING_ONLY.test(t);
}

/** Venting with no clear data question — respond without LLM. */
function isFrustrationOnlyRant(text: string): boolean {
  if (!hasFrustrationSignals(text)) return false;
  if (HAS_ANALYTICS_INTENT.test(text)) return false;
  const t = text.trim();
  if (t.length > 280) return false;
  if (/\b(what|how|why|show|list|count|which|where|compare|rank|top\s+\d+)\b/i.test(t)) return false;
  return true;
}

export type UserPromptClassification = {
  /** Skip model + SQL pipeline */
  skipLlm: boolean;
  canned?: "greeting" | "thanks" | "frustration";
  /** Appended to query-intelligence hints for the model */
  toneHints?: string[];
};

const TONE_HINT_FRUSTRATION =
  "User language may indicate frustration or strong emotion. Acknowledge briefly in a neutral, professional way; do not repeat or mirror profanity or insults. If they also asked an analytics question, answer it helpfully. Otherwise invite them to ask a concrete Northwind question.";

/**
 * Classify the raw user message for routing (canned reply vs model) and optional tone hints.
 */
export function classifyUserPrompt(message: string): UserPromptClassification {
  const t = message.trim();
  if (t.length <= 120 && !HAS_ANALYTICS_INTENT.test(t) && !/[\n\r]/.test(t) && THANKS_ONLY.test(t)) {
    return { skipLlm: true, canned: "thanks" };
  }
  if (isGreetingOnly(message)) {
    return { skipLlm: true, canned: "greeting" };
  }

  if (hasFrustrationSignals(message)) {
    if (isFrustrationOnlyRant(message)) {
      return { skipLlm: true, canned: "frustration" };
    }
    return { skipLlm: false, toneHints: [TONE_HINT_FRUSTRATION] };
  }

  return { skipLlm: false };
}

function skippedTrust(): OrchestratorResult["trust"] {
  return buildTrustReport({ pipeline: "canned" });
}

export function cannedGreetingResponse(kind: "hello" | "thanks" = "hello"): OrchestratorResult {
  const body =
    kind === "thanks"
      ? "You’re welcome — happy to help. Ask another Northwind question any time, or say what you’d like to explore next."
      : "Hello — I’m DataTalk, your assistant for exploring the Northwind sample database. Ask me anything in plain language: for example revenue by category, top customers by order total, or order counts by region. What would you like to look at first?";
  return {
    kind: "answer",
    assistant_message: body,
    trust: skippedTrust(),
    plan_summary: null,
    metric_ids: undefined,
    assumptions: undefined,
  };
}

export function cannedFrustrationResponse(): OrchestratorResult {
  return {
    kind: "answer",
    assistant_message:
      "I’m sorry you’re having a rough moment. I’m here to help with Northwind analytics — try asking for a specific report (for example “top 10 products by revenue” or “orders by month”), and I’ll work through it step by step.",
    trust: skippedTrust(),
    plan_summary: null,
    metric_ids: undefined,
    assumptions: undefined,
  };
}
