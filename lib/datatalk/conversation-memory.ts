type OrchestratorLikeResult = {
  kind: "answer" | "clarify" | "refuse";
  sql?: string;
  metric_ids?: string[];
  assumptions?: string[];
};

export type ConversationMemory = {
  intent?: "revenue" | "orders" | "units" | "freight" | "inventory" | "general";
  metric?: string;
  dimension?: string;
  timeWindow?: string;
  filters?: string[];
  entityRefs?: string[];
  lastUserQuestion?: string;
  lastAssistantKind?: "answer" | "clarify" | "refuse";
};

const EMPTY_MEMORY: ConversationMemory = {};

const ENTITY_KEYWORDS: { pattern: RegExp; entity: string }[] = [
  { pattern: /\bcustomer(s)?\b/i, entity: "customers" },
  { pattern: /\bproduct(s)?\b/i, entity: "products" },
  { pattern: /\bcategory|categories\b/i, entity: "categories" },
  { pattern: /\bsupplier(s)?\b/i, entity: "suppliers" },
  { pattern: /\bemployee(s)?\b/i, entity: "employees" },
  { pattern: /\bshipper(s)?\b/i, entity: "shippers" },
  { pattern: /\bregion(s)?|territor(?:y|ies)\b/i, entity: "regions" },
  { pattern: /\border(s)?\b/i, entity: "orders" },
];

const DIMENSION_KEYWORDS: { pattern: RegExp; dimension: string }[] = [
  { pattern: /\bby\s+category|category breakdown\b/i, dimension: "category" },
  { pattern: /\bby\s+customer|top customers?\b/i, dimension: "customer" },
  { pattern: /\bby\s+product|top products?\b/i, dimension: "product" },
  { pattern: /\bby\s+region|regional\b/i, dimension: "region" },
  { pattern: /\bby\s+supplier\b/i, dimension: "supplier" },
  { pattern: /\bby\s+employee\b/i, dimension: "employee" },
  { pattern: /\bby\s+shipper\b/i, dimension: "shipper" },
  { pattern: /\bmonthly|by month\b/i, dimension: "month" },
  { pattern: /\bquarterly|by quarter\b/i, dimension: "quarter" },
  { pattern: /\byearly|by year\b/i, dimension: "year" },
];

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function parseConversationMemory(raw: unknown): ConversationMemory {
  if (!raw || typeof raw !== "object") return EMPTY_MEMORY;
  const r = raw as Record<string, unknown>;
  return {
    intent:
      r.intent === "revenue" ||
      r.intent === "orders" ||
      r.intent === "units" ||
      r.intent === "freight" ||
      r.intent === "inventory" ||
      r.intent === "general"
        ? r.intent
        : undefined,
    metric: typeof r.metric === "string" ? r.metric : undefined,
    dimension: typeof r.dimension === "string" ? r.dimension : undefined,
    timeWindow: typeof r.timeWindow === "string" ? r.timeWindow : undefined,
    filters: Array.isArray(r.filters) ? r.filters.filter((v): v is string => typeof v === "string") : undefined,
    entityRefs: Array.isArray(r.entityRefs)
      ? r.entityRefs.filter((v): v is string => typeof v === "string")
      : undefined,
    lastUserQuestion: typeof r.lastUserQuestion === "string" ? r.lastUserQuestion : undefined,
    lastAssistantKind:
      r.lastAssistantKind === "answer" || r.lastAssistantKind === "clarify" || r.lastAssistantKind === "refuse"
        ? r.lastAssistantKind
        : undefined,
  };
}

function detectIntent(message: string, metricIds?: string[]): ConversationMemory["intent"] {
  const m = message.toLowerCase();
  if (metricIds?.includes("line_revenue") || /\b(revenue|sales)\b/i.test(m)) return "revenue";
  if (metricIds?.includes("order_count") || /\border(s)? count|number of orders?\b/i.test(m)) return "orders";
  if (metricIds?.includes("units_sold") || /\bunits?\b/i.test(m)) return "units";
  if (/\bfreight|shipping\b/i.test(m)) return "freight";
  if (/\bstock|inventory|reorder\b/i.test(m)) return "inventory";
  if (/\bdata|analysis|insight|report|breakdown|trend\b/i.test(m)) return "general";
  return undefined;
}

function detectDimension(message: string): string | undefined {
  for (const d of DIMENSION_KEYWORDS) {
    if (d.pattern.test(message)) return d.dimension;
  }
  return undefined;
}

function detectTimeWindow(message: string): string | undefined {
  const yearRange = message.match(/\b(19\d{2})\s*(?:-|to|through)\s*(19\d{2})\b/i);
  if (yearRange) return `${yearRange[1]}-${yearRange[2]}`;
  const singleYear = message.match(/\b(19\d{2})\b/);
  if (singleYear) return singleYear[1];
  if (/\ball sample years?|all years?\b/i.test(message)) return "all_sample_years";
  if (/\bthis year|last year|last quarter|last month|ytd\b/i.test(message)) return "relative_window";
  return undefined;
}

function detectEntities(message: string): string[] {
  const entities: string[] = [];
  for (const e of ENTITY_KEYWORDS) {
    if (e.pattern.test(message)) entities.push(e.entity);
  }
  return uniqueNonEmpty(entities);
}

function detectFilters(message: string): string[] {
  const filters: string[] = [];
  const inYear = message.match(/\bin\s+(19\d{2})\b/i);
  if (inYear) filters.push(`year=${inYear[1]}`);
  const topN = message.match(/\btop\s+(\d+)\b/i);
  if (topN) filters.push(`top=${topN[1]}`);
  const country = message.match(/\b(?:in|for)\s+([a-z][a-z\s]+)\s+country\b/i);
  if (country) filters.push(`country=${country[1].trim()}`);
  return uniqueNonEmpty(filters);
}

export function buildMemoryHints(memory: ConversationMemory, newUserMessage: string): string[] {
  const hints: string[] = [];
  const lower = newUserMessage.toLowerCase();
  const referential = /\b(them|those|these|it|same thing|what about)\b/i.test(lower);

  if (memory.intent || memory.dimension || memory.timeWindow || (memory.entityRefs?.length ?? 0) > 0) {
    hints.push(
      `Structured memory: intent=${memory.intent ?? "unknown"}, metric=${memory.metric ?? "unknown"}, dimension=${memory.dimension ?? "unknown"}, time_window=${memory.timeWindow ?? "unknown"}, entities=${(memory.entityRefs ?? []).join(", ") || "none"}.`,
    );
  }

  if (referential && (!memory.entityRefs || memory.entityRefs.length === 0)) {
    hints.push(
      "Referential follow-up has no stored entity references. Use kind=clarify and ask who/what the user means before producing SQL.",
    );
  }

  if (referential && memory.entityRefs && memory.entityRefs.length > 0) {
    hints.push(
      `Referential follow-up likely points to prior entities: ${memory.entityRefs.join(", ")}. Reuse prior intent/dimension/time_window unless user overrides.`,
    );
  }

  return hints;
}

export function updateConversationMemory(input: {
  previous: ConversationMemory;
  userMessage: string;
  result: OrchestratorLikeResult;
}): ConversationMemory {
  const { previous, userMessage, result } = input;
  const next: ConversationMemory = {
    ...previous,
    lastUserQuestion: userMessage.trim().slice(0, 500),
    lastAssistantKind: result.kind,
  };

  // Do not overwrite strong context on clarify/refuse unless we can enrich.
  if (result.kind !== "answer") return next;

  const metric = result.metric_ids?.[0];
  const intent = detectIntent(userMessage, result.metric_ids);
  const dimension = detectDimension(userMessage);
  const timeWindow = detectTimeWindow(userMessage);
  const entities = detectEntities(userMessage);
  const filters = detectFilters(userMessage);

  if (intent) next.intent = intent;
  if (metric) next.metric = metric;
  if (dimension) next.dimension = dimension;
  if (timeWindow) next.timeWindow = timeWindow;
  if (entities.length > 0) next.entityRefs = entities;
  if (filters.length > 0) next.filters = filters;

  return next;
}
