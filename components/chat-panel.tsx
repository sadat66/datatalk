"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TrustReport } from "@/lib/datatalk/types";
import { cn } from "@/lib/utils";

type Conversation = { id: string; title: string | null; created_at: string };
type MessageRow = {
  id: string;
  role: string;
  content: Record<string, unknown>;
  created_at: string;
};

type ChatResponse = {
  conversationId: string;
  kind: string;
  assistant_message: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  trust: TrustReport;
  plan_summary?: string | null;
  metric_ids?: string[];
  assumptions?: string[];
};

function messageText(role: string, content: Record<string, unknown>): string {
  if (role === "user" && content.type === "user" && typeof content.text === "string") {
    return content.text;
  }
  if (role === "assistant" && content.type === "assistant" && typeof content.text === "string") {
    return content.text;
  }
  return "";
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 50).map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c} className="max-w-[240px] truncate text-xs">
                  {formatCell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function TrustBlock({
  trust,
  sql,
  planSummary,
}: {
  trust: TrustReport;
  sql?: string;
  planSummary?: string | null;
}) {
  return (
    <Collapsible className="mt-2 rounded-md border border-border bg-muted/40">
      <CollapsibleTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "flex h-auto w-full items-center justify-between gap-2 whitespace-normal px-3 py-2 text-left",
        )}
      >
        <span className="text-xs font-medium">Why this answer?</span>
        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
          {trust.level} trust
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3 pt-0">
        <ul className="list-inside list-disc text-xs text-muted-foreground">
          {trust.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {planSummary ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Plan: </span>
            {planSummary}
          </p>
        ) : null}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Validation: </span>
          {trust.validation.passed ? "passed" : "failed"} — {trust.validation.details.join(" · ")}
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Execution: </span>
          {trust.execution.skipped
            ? "skipped"
            : `${trust.execution.rowCount} rows in ${trust.execution.ms}ms`}
          {trust.execution.limited ? " (limited)" : ""}
        </div>
        {sql ? (
          <pre className="max-h-40 overflow-auto rounded bg-background p-2 text-[11px] leading-snug text-foreground">
            {sql}
          </pre>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChatPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || res.statusText);
      }
      const data = (await res.json()) as { conversations: Conversation[] };
      setConversations(data.conversations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || res.statusText);
      }
      const data = (await res.json()) as { messages: MessageRow[] };
      setMessages(data.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversationId) {
      void loadMessages(conversationId);
    } else {
      setMessages([]);
    }
  }, [conversationId, loadMessages]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setDraft("");
      setConversationId(data.conversationId);
      await loadConversations();
      await loadMessages(data.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setError(null);
  }

  return (
    <div className="grid flex-1 gap-6 lg:grid-cols-[220px_1fr]">
      <Card className="h-fit border-border lg:sticky lg:top-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Chats</CardTitle>
          <CardDescription className="text-xs">Your saved threads</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={startNewChat}>
            New chat
          </Button>
          <Separator />
          <ScrollArea className="h-[320px] pr-2">
            {loadingList ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                Loading…
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setConversationId(c.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
                      conversationId === c.id ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <span className="line-clamp-2">{c.title || "Untitled"}</span>
                  </button>
                ))}
                {!conversations.length ? (
                  <p className="text-xs text-muted-foreground">No chats yet — start below.</p>
                ) : null}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex min-h-[520px] flex-col border-border">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-lg">Ask DataTalk</CardTitle>
          <CardDescription>
            Questions run through validation and a read-only database connection when configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 pt-4">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ScrollArea className="min-h-[280px] flex-1 rounded-md border border-border bg-muted/20 p-3">
            {loadingMessages ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading messages…
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m) => {
                  const text = messageText(m.role, m.content);
                  const trust = m.content.trust as TrustReport | undefined;
                  const sql = typeof m.content.sql === "string" ? m.content.sql : undefined;
                  const rows = Array.isArray(m.content.rows)
                    ? (m.content.rows as Record<string, unknown>[])
                    : undefined;
                  const plan =
                    typeof m.content.plan_summary === "string" ? m.content.plan_summary : null;
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                          isUser
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-card text-card-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{text}</p>
                        {!isUser && trust ? (
                          <TrustBlock trust={trust} sql={sql} planSummary={plan} />
                        ) : null}
                        {!isUser && rows?.length ? <ResultTable rows={rows} /> : null}
                      </div>
                    </div>
                  );
                })}
                {!messages.length ? (
                  <p className="text-sm text-muted-foreground">
                    Ask something like: “Top 5 customers by line revenue in 1997.” (Requires LLM and
                    read-only DB env vars.)
                  </p>
                ) : null}
              </div>
            )}
          </ScrollArea>
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask in plain language…"
              rows={3}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => void sendMessage()} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Sending
                  </>
                ) : (
                  "Send"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
