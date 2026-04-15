import type { TrustReport } from "@/lib/datatalk/types";

export type Conversation = { id: string; title: string | null; created_at: string };

export type MessageRow = {
  id: string;
  role: string;
  content: Record<string, unknown>;
  created_at: string;
};

export type ChatResponse = {
  conversationId: string;
  kind: string;
  assistant_message: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  trust: TrustReport;
  plan_summary?: string | null;
  metric_ids?: string[];
  assumptions?: string[];
  trust_upgrade_suggestion?: string;
  result_has_more?: boolean;
  result_next_offset?: number | null;
};

export type ParsedSseEvent = {
  event: string;
  data: string;
};
