import { retrieveSchemaSnippets } from "@/lib/northwind/schema-retrieval";

type ChatTurn = { role: "user" | "assistant"; text: string };

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
  const referentialFollowUp =
    recent.length > 0 &&
    (/\b(what|how) about (them|those|these|it|that)\b/i.test(lower) ||
      /\b(and|also) (them|those|it)\b/i.test(lower) ||
      /\b(them|those|these)\b/i.test(lower) ||
      /\bsame (thing|for|as|query|breakdown|chart|list)\b/i.test(lower) ||
      /\bthey\b/i.test(lower) ||
      (wordCount <= 8 && /\bit\b/i.test(lower)) ||
      /\bsame\b/i.test(lower));

  if (referentialFollowUp) {
    hints.push(
      "Referential follow-up: the user points at topics or entities already in this thread — usually the last assistant answer. Infer the referent(s); in assistant_message name who or what 'they/them/those' means. Reuse grain, filters, and time scope from that prior answer unless the user changes them. Prefer kind=answer with SQL that adds insight (drill-down, comparison, another dimension, or trend) for those entities — not a bare repeat. Use kind=clarify only if several interpretations are equally likely.",
    );
  }
  if (
    recent.length &&
    /\b(best|worst|winner|who(?:'s| is) (?:the )?best|which (?:one )?is (?:the )?best|top (?:one|person|customer|employee)|#\s*1|number one|who (?:wins|leads))\b/i.test(
      lower,
    )
  ) {
    hints.push(
      "Superlative question: interpret as an objective extremum on the numeric measure from the prior answer (usually 'best' = highest value). Reuse the same metric, grouping, and filters. Prefer SQL that returns the top row(s) with ORDER BY ... LIMIT, not a refusal for 'subjective' criteria.",
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
      "Broad umbrella request with little structure — either one targeted clarify (metric + by what dimension?) or one default answer plus explicit assumptions.",
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
