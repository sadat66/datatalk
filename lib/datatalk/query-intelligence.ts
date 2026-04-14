import { retrieveSchemaSnippets } from "@/lib/northwind/schema-retrieval";
import { isReferentialFollowUpMessage } from "@/lib/datatalk/query-heuristics";

type ChatTurn = { role: "user" | "assistant"; text: string };

const ANALYTICS_TOPIC_PATTERN =
  /\b(revenue|sales|orders?|customers?|products?|categories?|suppliers?|employees?|regions?|territor(?:y|ies)|countries?|cities?|freight|shippers?|inventory|stock|trend|monthly|quarterly|yearly)\b/i;
const ANALYTICS_STRUCTURE_PATTERN = /\b(by|for|between|from|in|where|top\s+\d+|last|month|quarter|year)\b/i;

function hasConcretePriorUserIntent(turns: ChatTurn[]): boolean {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t.role !== "user") continue;
    const text = t.text.trim();
    if (!text) continue;
    const hasTopic = ANALYTICS_TOPIC_PATTERN.test(text);
    const hasStructure = ANALYTICS_STRUCTURE_PATTERN.test(text);
    if (hasTopic && hasStructure) return true;
  }
  return false;
}

/** Build a compact transcript for the model + lightweight reference hints. */
export function buildConversationContext(
  turns: ChatTurn[],
  newUserMessage: string,
  extraHints?: string[],
): string {
  const lines: string[] = [];
  const recent = turns.slice(-8);
  for (const t of recent) {
    lines.push(`${t.role === "user" ? "User" : "Assistant"}: ${t.text}`);
  }
  lines.push(`User: ${newUserMessage}`);

  const lower = newUserMessage.toLowerCase();
  const trimmed = newUserMessage.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const hints: string[] = [...(extraHints ?? [])];

  if (
    /\b(what (can|do) you|what insights|what data|capabilities|how does (this|it) work|what are you|who are you|help me (get started|understand))\b/i.test(
      lower,
    )
  ) {
    hints.push(
      "Discovery / meta question: kind=answer with sql null — briefly explain Northwind analytics scope and list several concrete example questions the user could ask next; do not refuse for being unspecific.",
    );
  }
  const referentialFollowUp = recent.length > 0 && isReferentialFollowUpMessage(newUserMessage);

  if (referentialFollowUp) {
    hints.push(
      "Referential follow-up: the user points at topics or entities already in this thread — usually the last assistant answer. Infer the referent(s); in assistant_message name who or what 'they/them/those' means. Reuse grain, filters, and time scope from that prior answer unless the user changes them. Prefer kind=answer with SQL that adds insight (drill-down, comparison, another dimension, or trend) for those entities — not a bare repeat. Use kind=clarify only if several interpretations are equally likely.",
    );
    if (!hasConcretePriorUserIntent(recent)) {
      hints.push(
        "Ambiguous referential follow-up: there is no concrete prior user question anchoring who/what 'them' refers to (for example a greeting followed by 'what about them'). Use kind=clarify and ask one direct question to identify the referent before writing SQL.",
      );
    }
  }
  if (
    recent.length &&
    /\b(best|worst|winner|who(?:'s| is) (?:the )?best|which (?:one )?is (?:the )?best|top (?:one|person|customer|employee)|#\s*1|number one|who (?:wins|leads))\b/i.test(
      lower,
    )
  ) {
    hints.push(
      "Superlative question: interpret as an objective extremum on the numeric measure from the prior answer (usually 'best' = highest value). Reuse the same metric, grouping, and filters. For highest/lowest requests, include all ties unless the user explicitly asks for one row (top 1/#1/single); avoid arbitrary LIMIT 1 tie truncation.",
    );
  }
  if (trimmed.length < 6) {
    hints.push("The latest message is very short — if intent is unclear, choose kind=clarify.");
  }

  if (recent.length && /^(and|also|what about|how about)\b/i.test(trimmed)) {
    hints.push(
      "Continuation-style message — anchor to the prior assistant answer (same metric, grain, filters) unless the user introduces a new dimension; if the link is ambiguous, one clarify question.",
    );
  }

  if (wordCount > 0 && wordCount <= 4 && trimmed.length >= 6 && !referentialFollowUp) {
    hints.push(
      "Very few words — if several SQL interpretations are plausible, kind=clarify with one concrete question; if one interpretation is clearly standard for Northwind, kind=answer and list assumptions (defaults, no date filter = full sample, etc.).",
    );
  }

  if (wordCount <= 5 && /\b(this year|last year|ytd|last quarter|last month|recently)\b/i.test(lower)) {
    hints.push(
      "User used relative calendar language — Northwind order dates are 1990s sample data; clarify or answer on full sample and state that in assumptions.",
    );
  }

  const namesBreakdownDimension =
    /\b(region|regional|territor|country|countries|city|cities|customer|product|supplier|categor|employee|shipper|month|quarter|year|geograph|state|states)\b/i.test(
      lower,
    );

  if (
    wordCount <= 6 &&
    /\b(sales|revenue|performance|numbers|stats|data|trends?|breakdown|overview)\b/i.test(lower) &&
    !/\b(by|per|for each|from|where|between|since)\b/i.test(lower) &&
    !namesBreakdownDimension
  ) {
    hints.push(
      "Broad umbrella request with little structure — prefer kind=answer with safe defaults when possible, and include assumptions plus a short trust-improvement nudge that suggests concrete missing specs in this shape: metric + dimension + time window (+ optional filter).",
    );
  }

  if (/\b(something interesting|anything useful|surprise me|you decide|whatever)\b/i.test(lower)) {
    hints.push(
      "Very open-ended prompt: avoid vague SQL. Offer 2-3 concrete high-trust choices based on Northwind (for example revenue by category, top customers by order count, or monthly order trend) and ask the user to pick one.",
    );
  }

  if (/\b(sum|total)\s+(?:of\s+)?all\b/i.test(lower) || /\b(overall|grand total|across all)\b/i.test(lower)) {
    hints.push(
      "User explicitly wants an overall aggregate total. Return one scalar total (no GROUP BY / no per-entity breakdown) unless they explicitly ask for a breakdown dimension.",
    );
  }

  if (/\b(region|regional|territor)\b/i.test(lower) && /\b(order|orders|count|breakdown|sales)\b/i.test(lower)) {
    hints.push(
      "User already pointed at a regional / geography-style breakdown — prefer kind=answer with SQL (sales region via employees → employee_territories → territories → region, unless they clearly mean ship-to fields ship_region/ship_country). Do not ask whether they meant region versus some other dimension.",
    );
  }

  const hintBlock = hints.length ? `\nHints:\n- ${hints.join("\n- ")}` : "";

  const retrievalText = [newUserMessage, ...recent.map((t) => t.text)].join("\n");
  const focus = retrieveSchemaSnippets(retrievalText);
  const focusBlock = focus ? `\n\nFocus for this turn (retrieved join recipes + columns):\n${focus}` : "";

  return `Conversation:\n${lines.join("\n")}${focusBlock}${hintBlock}`;
}
