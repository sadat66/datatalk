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
  /^[\s]*(hi|hei|hello|hey|howdy|greetings|yo|good\s+(?:morning|afternoon|evening|day)|what'?s\s+up|\bsup\b)(?:\s+(?:there|team|datatalk|all|everyone))?[.!,\s]*$/i;

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
  canned?: "greeting" | "thanks" | "frustration" | "vague_guidance";
  /** Appended to query-intelligence hints for the model */
  toneHints?: string[];
};

const TONE_HINT_FRUSTRATION =
  "User language may indicate frustration or strong emotion. Acknowledge briefly in a neutral, professional way; do not repeat or mirror profanity or insults. If they also asked an analytics question, answer it helpfully. Otherwise invite them to ask a concrete Northwind question.";

const VAGUE_GUIDANCE_PATTERNS: RegExp[] = [
  /\b(help|start|starter|begin|guide|guidance|what should i ask|suggest|recommend)\b/i,
  /\b(insight|insights|analysis|analytics|something interesting|something useful)\b/i,
  /\b(show me (the )?(data|numbers|stats|trends?|overview))\b/i,
  /\b(what can i ask|what can you do|where do i start)\b/i,
];

const TOPIC_ANCHOR_PATTERN =
  /\b(revenue|sales|orders?|customers?|products?|categories?|suppliers?|employees?|regions?|territor(?:y|ies)|countries?|cities?|freight|shippers?|inventory|stock|trend|monthly|quarterly|yearly)\b/i;

const STRUCTURE_ANCHOR_PATTERN = /\b(by|for|between|from|in|where|top\s+\d+|last|month|quarter|year)\b/i;
const DIRECT_ANALYTICS_REQUEST_PATTERN =
  /\b(show|give|list|compare|rank|find|calculate|report|summarize|breakdown)\b/i;

function isVagueGuidancePrompt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (/[\n\r]/.test(trimmed)) return false;
  if (hasFrustrationSignals(trimmed)) return false;
  if (THANKS_ONLY.test(trimmed) || GREETING_ONLY.test(trimmed)) return false;
  if (!HAS_ANALYTICS_INTENT.test(trimmed) && !VAGUE_GUIDANCE_PATTERNS.some((re) => re.test(trimmed))) {
    return false;
  }
  // Route direct analytics asks (e.g. "show me sales") to orchestrator so we answer with defaults
  // and then append a high-trust specification nudge.
  if (TOPIC_ANCHOR_PATTERN.test(trimmed) && DIRECT_ANALYTICS_REQUEST_PATTERN.test(trimmed)) {
    return false;
  }
  if (TOPIC_ANCHOR_PATTERN.test(trimmed) && STRUCTURE_ANCHOR_PATTERN.test(trimmed)) return false;
  return VAGUE_GUIDANCE_PATTERNS.some((re) => re.test(trimmed));
}

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
  if (isVagueGuidancePrompt(message)) {
    return { skipLlm: true, canned: "vague_guidance" };
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
      : [
          "Hello — I’m DataTalk. I can run safe, read-only analytics across Northwind orders, revenue, customers, products, suppliers, shippers, and sales territories.",
          "For highest-trust answers, ask with this shape: metric + dimension + time window (+ optional filter).",
          "",
          "Try one of these high-trust starters:",
          "1) Revenue by category in 1997, highest first.",
          "2) Top 10 customers by order count in 1998.",
          "3) Monthly order count trend for 1997 and 1998.",
          "",
          "What do you need most right now: revenue, customers, or products?",
        ].join("\n");
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

export function cannedVagueGuidanceResponse(): OrchestratorResult {
  return {
    kind: "answer",
    assistant_message: [
      "Good question. Let’s turn this into a high-trust query so results are precise.",
      "",
      "Smart question tree:",
      "- Step 1 (goal): pick one focus -> revenue, order volume, customers, products, shipping, or region.",
      "- Step 2 (breakdown): choose one view -> by month, category, customer, product, employee, or region.",
      "- Step 3 (scope): set a time window -> all sample years or a specific year (for example 1997).",
      "",
      "You can paste one of these now:",
      "1) Show revenue by category in 1997.",
      "2) List top 10 customers by revenue for all sample years.",
      "3) Compare order count by region for 1998.",
    ].join("\n"),
    trust: skippedTrust(),
    plan_summary: null,
    metric_ids: undefined,
    assumptions: undefined,
  };
}
