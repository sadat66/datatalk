"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  ExternalLinkIcon,
  Loader2Icon,
  MicIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { parseSseEvents } from "@/components/chat/sse";
import type { ChatResponse, Conversation, MessageRow } from "@/components/chat/types";
import type { ConversationsPanelPayload } from "@/lib/conversations/panel-data";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { downloadResultTablePdf } from "@/lib/export-result-table-pdf";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function resolveBrowserSpeechCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function subscribeNoop() {
  return () => {};
}

function useBrowserSpeechSupported(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => Boolean(resolveBrowserSpeechCtor()),
    () => false,
  );
}

function useTtsSupported(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
}

type ChatPanelProps = {
  /** Right-rail layout for the dashboard (no left conversation column). */
  variant?: "default" | "embedded" | "page";
  /** When set, selects this thread on mount (e.g. `/dashboard/chat/[id]`). */
  initialConversationId?: string | null;
  /** When provided (e.g. from SSR), skips the initial client fetch to `/api/conversations`. */
  initialPanelData?: ConversationsPanelPayload;
};

export function ChatPanel({
  variant = "default",
  initialConversationId = null,
  initialPanelData,
}: ChatPanelProps) {
  const embedded = variant === "embedded";
  const pageVariant = variant === "page";
  const [conversations, setConversations] = useState<Conversation[]>(
    () => initialPanelData?.conversations ?? [],
  );
  const [conversationId, setConversationId] = useState<string | null>(() => initialConversationId ?? null);
  const [messages, setMessages] = useState<MessageRow[]>(() => initialPanelData?.messages ?? []);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(() => initialPanelData === undefined);
  const [loadingMessages, setLoadingMessages] = useState(() => {
    if (initialPanelData === undefined) return true;
    if (initialConversationId && initialPanelData.messages === undefined) return true;
    return false;
  });
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browserSpeechSupported = useBrowserSpeechSupported();
  const ttsSupported = useTtsSupported();
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const speakingMessageIdRef = useRef<string | null>(null);
  const receivedDeltaRef = useRef(false);
  const streamTextRef = useRef("");
  const assistantStreamIdRef = useRef<string | null>(null);
  const rafFlushScheduledRef = useRef(false);
  /** True while sendMessage is in flight (avoids tying message reload to `sending` state). */
  const isSendingRef = useRef(false);
  /** True when the in-flight send started with no conversation yet (SSE meta will assign id). */
  const isCreatingConversationRef = useRef(false);
  const sendMessageRef = useRef<
    | ((
        opts?: {
          strictVerification?: boolean;
          messageText?: string;
          resultOffset?: number;
        },
      ) => Promise<void>)
    | null
  >(null);

  const handleStrictVerify = useCallback(() => {
    void sendMessageRef.current?.({
      strictVerification: true,
      messageText: "Yes — use strict verification for my previous question.",
    });
  }, []);

  const handleNextPage = useCallback((nextOffset: number) => {
    void sendMessageRef.current?.({
      messageText: "Show the next 15 rows.",
      resultOffset: nextOffset,
    });
  }, []);

  const handleDownloadTablePdf = useCallback(async (sql: string, caption: string) => {
    setPdfExportBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/query-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        rows?: Record<string, unknown>[];
        truncated?: boolean;
        exportMaxRows?: number;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Export failed");
      }
      const rows = data.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        setError("No rows to export.");
        return;
      }
      let capNote = "";
      if (data.truncated) {
        capNote =
          typeof data.exportMaxRows === "number"
            ? `\n\nExport limited to the first ${data.exportMaxRows.toLocaleString()} rows.`
            : "\n\nExport was truncated.";
      }
      downloadResultTablePdf({
        rows,
        caption: `${caption.slice(0, 280)}${capNote}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setPdfExportBusy(false);
    }
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (rafFlushScheduledRef.current) return;
    rafFlushScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafFlushScheduledRef.current = false;
      const id = assistantStreamIdRef.current;
      if (!id) return;
      const nextText = streamTextRef.current;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: { type: "assistant", text: nextText } } : m)),
      );
      queueMicrotask(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    });
  }, []);

  /** One GET: list only, or list + messages when `messagesFor` is set (single auth round-trip vs two fetches). */
  const refreshConversationPanel = useCallback(async (messagesFor: string | null) => {
    setLoadingList(true);
    setLoadingMessages(Boolean(messagesFor));
    setError(null);
    try {
      const q = messagesFor ? `?messagesFor=${encodeURIComponent(messagesFor)}` : "";
      const res = await fetch(`/api/conversations${q}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg = typeof j.error === "string" ? j.error : res.statusText || "Request failed";
        throw new Error(msg);
      }
      const data = (await res.json()) as {
        conversations: Conversation[];
        messages?: MessageRow[];
      };
      setConversations(data.conversations ?? []);
      if (messagesFor && Array.isArray(data.messages)) {
        setMessages(data.messages);
      } else if (!messagesFor) {
        setMessages([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversations");
    } finally {
      setLoadingList(false);
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (initialPanelData !== undefined) {
      isCreatingConversationRef.current = false;
      if (initialConversationId) {
        setConversationId(initialConversationId);
      }
      return;
    }
    isCreatingConversationRef.current = false;
    if (initialConversationId) {
      setConversationId(initialConversationId);
    }
    void refreshConversationPanel(initialConversationId ?? null);
  }, [initialPanelData, initialConversationId, refreshConversationPanel]);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.stop();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (loadingMessages) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [loadingMessages, conversationId, messages.length]);

  const toggleSpeak = useCallback((messageId: string, text: string) => {
    if (!ttsSupported || typeof window === "undefined" || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (speakingMessageIdRef.current === messageId) {
      synth.cancel();
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
    };
    utterance.onerror = () => {
      speakingMessageIdRef.current = null;
      setSpeakingMessageId(null);
      setError("Text-to-speech failed in this browser.");
    };
    speakingMessageIdRef.current = messageId;
    setSpeakingMessageId(messageId);
    synth.speak(utterance);
  }, [ttsSupported]);

  async function toggleRecording() {
    if (sending) return;

    if (recording) {
      speechRecognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechCtor = resolveBrowserSpeechCtor();
    if (!SpeechCtor) {
      setError(
        "Voice input needs Web Speech API support. Try Chrome or Edge, or type your question.",
      );
      return;
    }

    try {
      setError(null);
      let transcript = "";
      const recognition = new SpeechCtor();
      speechRecognitionRef.current = recognition;
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const ev = event as {
          resultIndex?: number;
          results?: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>;
        };
        const results = ev.results;
        if (!results) return;
        for (let i = ev.resultIndex ?? 0; i < results.length; i += 1) {
          const result = results[i];
          if (result?.isFinal) {
            transcript += `${result[0]?.transcript ?? ""} `;
          }
        }
      };
      recognition.onerror = (event) => {
        const ev = event as { error?: string };
        setError(`Browser speech failed: ${ev.error ?? "unknown error"}`);
      };
      recognition.onend = () => {
        const text = transcript.trim();
        speechRecognitionRef.current = null;
        setRecording(false);
        if (text) {
          setDraft((prev) => {
            const prefix = prev.trim();
            return prefix ? `${prefix} ${text}` : text;
          });
        }
      };
      recognition.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Browser speech start failed");
    }
  }

  async function sendMessage(opts?: {
    strictVerification?: boolean;
    messageText?: string;
    resultOffset?: number;
  }) {
    const text = (opts?.messageText ?? draft).trim();
    if (!text || sending) return;
    const now = new Date().toISOString();
    const userTempId = `user-${Date.now()}`;
    const assistantTempId = `assistant-${Date.now()}`;
    const userConversationId = conversationId;
    const userMessage: MessageRow = {
      id: userTempId,
      role: "user",
      content: { type: "user", text },
      created_at: now,
    };
    const assistantPlaceholder: MessageRow = {
      id: assistantTempId,
      role: "assistant",
      content: { type: "assistant", text: "Thinking…" },
      created_at: now,
    };

    setSending(true);
    isSendingRef.current = true;
    isCreatingConversationRef.current = userConversationId === null;
    setError(null);
    setDraft("");
    receivedDeltaRef.current = false;
    streamTextRef.current = "";
    assistantStreamIdRef.current = assistantTempId;
    rafFlushScheduledRef.current = false;
    setStreamingMessageId(assistantTempId);
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          conversationId: userConversationId,
          message: text,
          ...(opts?.strictVerification ? { strictVerification: true } : {}),
          ...(typeof opts?.resultOffset === "number" ? { resultOffset: opts.resultOffset } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || res.statusText);
      }

      let finalPayload: ChatResponse | null = null;
      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parsed = parseSseEvents(buffer);
          buffer = parsed.rest;

          for (const evt of parsed.events) {
            if (!evt.data) continue;
            const payload = JSON.parse(evt.data) as Record<string, unknown>;

            if (evt.event === "meta" && typeof payload.conversationId === "string") {
              const nextConversationId = payload.conversationId;
              setConversationId(nextConversationId);
              setConversations((prev) => {
                const exists = prev.some((c) => c.id === nextConversationId);
                if (exists) return prev;
                return [
                  { id: nextConversationId, title: text.slice(0, 80), created_at: new Date().toISOString() },
                  ...prev,
                ];
              });
              continue;
            }

            if (evt.event === "assistant_delta" && typeof payload.delta === "string") {
              const delta = payload.delta;
              if (!receivedDeltaRef.current) {
                streamTextRef.current = delta;
                receivedDeltaRef.current = true;
              } else {
                streamTextRef.current += delta;
              }
              scheduleStreamFlush();
              continue;
            }

            if (evt.event === "status" && !receivedDeltaRef.current && typeof payload.stage === "string") {
              const statusText =
                payload.stage === "finalizing" ? "Finalizing answer…" : "Thinking…";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantTempId
                    ? {
                        ...m,
                        content: { type: "assistant", text: statusText },
                      }
                    : m,
                ),
              );
              continue;
            }

            if (evt.event === "error") {
              throw new Error(
                typeof payload.error === "string" ? payload.error : "Failed to process chat request",
              );
            }

            if (evt.event === "final") {
              finalPayload = payload as unknown as ChatResponse;
              setStreamingMessageId(null);
            }
          }
        }

        const id = assistantStreamIdRef.current;
        if (id && streamTextRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: { type: "assistant", text: streamTextRef.current } } : m,
            ),
          );
        }
        assistantStreamIdRef.current = null;
        streamTextRef.current = "";
        rafFlushScheduledRef.current = false;
      } else {
        finalPayload = (await res.json()) as ChatResponse;
      }

      if (!finalPayload) {
        throw new Error("Streaming ended before a final response was received");
      }

      setConversationId(finalPayload.conversationId);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantTempId) return m;
          return {
            ...m,
            content: {
              type: "assistant",
              text: finalPayload.assistant_message,
              trust: finalPayload.trust,
              sql: finalPayload.sql,
              rows: finalPayload.rows,
              plan_summary: finalPayload.plan_summary ?? undefined,
              metric_ids: finalPayload.metric_ids,
              assumptions: finalPayload.assumptions,
              trust_upgrade_suggestion: finalPayload.trust_upgrade_suggestion,
              result_has_more: finalPayload.result_has_more,
              result_next_offset: finalPayload.result_next_offset,
            },
          };
        }),
      );
      queueMicrotask(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== userTempId && m.id !== assistantTempId));
      setError(e instanceof Error ? e.message : "Send failed");
      setDraft(text);
    } finally {
      assistantStreamIdRef.current = null;
      streamTextRef.current = "";
      rafFlushScheduledRef.current = false;
      isSendingRef.current = false;
      isCreatingConversationRef.current = false;
      setSending(false);
      setStreamingMessageId(null);
    }
  }

  sendMessageRef.current = sendMessage;

  const startNewChat = useCallback(() => {
    isCreatingConversationRef.current = false;
    setConversationId(null);
    setMessages([]);
    setDraft("");
    setError(null);
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      setDeletingConversationId(id);
      setError(null);
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || res.statusText);
        }
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationId === id) {
          startNewChat();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete conversation");
      } finally {
        setDeletingConversationId(null);
      }
    },
    [conversationId, startNewChat],
  );

  const conversationList = (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={embedded ? "w-full" : "w-full"}
        onClick={startNewChat}
      >
        New chat
      </Button>
      <Separator />
      <ScrollArea className={embedded ? "h-[120px] pr-2" : "h-[320px] pr-2"}>
        {loadingList ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "flex items-stretch gap-0.5 rounded-md border border-transparent",
                  conversationId === c.id && "border-border bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    isCreatingConversationRef.current = false;
                    setConversationId(c.id);
                    void refreshConversationPanel(c.id);
                  }}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/80"
                >
                  <span className="line-clamp-2 font-medium">{c.title || "Untitled"}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground tabular-nums">
                    {formatRelativeTime(c.created_at)}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-0.5 mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={deletingConversationId === c.id}
                  aria-label={`Delete conversation ${c.title || "Untitled"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(c.id);
                  }}
                >
                  {deletingConversationId === c.id ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2Icon className="size-3.5" />
                  )}
                </Button>
              </div>
            ))}
            {!conversations.length ? (
              <p className="text-xs text-muted-foreground">No chats yet — start below.</p>
            ) : null}
          </div>
        )}
      </ScrollArea>
    </>
  );

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 flex-1 flex-col"
          : "grid min-h-0 flex-1 grid-rows-1 gap-6 lg:grid-cols-[220px_1fr]"
      }
    >
      {!embedded ? (
        <Card className="h-fit border-border lg:sticky lg:top-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Chats</CardTitle>
            <CardDescription className="text-xs">Your saved threads</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">{conversationList}</CardContent>
        </Card>
      ) : null}

      <Card
        className={
          embedded
            ? "flex min-h-0 flex-1 flex-col rounded-none border-0 border-l border-border bg-card shadow-none"
            : "flex min-h-0 h-full min-w-0 flex-1 flex-col border-border"
        }
      >
        <CardHeader className={embedded ? "border-b border-border pb-3 pt-4" : "border-b border-border pb-4"}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className={embedded ? "text-base" : "text-lg"}>
                {embedded ? "DataTalk" : pageVariant ? "Conversation" : "DataTalk"}
              </CardTitle>
              <CardDescription className={embedded ? "text-xs" : ""}>
                {embedded
                  ? "Natural language → validated SQL on the Northwind sample database."
                  : pageVariant
                    ? "Same thread as in the workspace; use the full height for longer answers."
                    : "Questions are validated and run against the read-only database when it is configured."}
              </CardDescription>
            </div>
            {!pageVariant && conversationId ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  href={`/dashboard/chat/${conversationId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "inline-flex gap-1.5",
                  )}
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open in new page
                </Link>
              </div>
            ) : null}
          </div>
          {embedded ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Threads</p>
              {conversationList}
            </div>
          ) : null}
        </CardHeader>
        <CardContent
          className={cn(
            "flex flex-1 flex-col gap-3 pt-4",
            (embedded || pageVariant) && "min-h-0 overflow-hidden pb-4",
          )}
        >
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ScrollArea
            className={cn(
              "min-h-[min(200px,28dvh)] flex-1 rounded-md border border-border bg-muted/20 p-3 sm:min-h-[min(260px,38dvh)]",
              (embedded || pageVariant) && "min-h-0 sm:min-h-0",
            )}
          >
            {loadingMessages ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading messages…
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <ChatMessageBubble
                    key={m.id}
                    message={m}
                    isStreamingAssistant={streamingMessageId === m.id}
                    ttsSupported={ttsSupported}
                    isSpeaking={speakingMessageId === m.id}
                    onSpeak={toggleSpeak}
                    onRequestStrictVerification={handleStrictVerify}
                    onNextPage={handleNextPage}
                    onDownloadTablePdf={handleDownloadTablePdf}
                    pdfExportBusy={pdfExportBusy}
                  />
                ))}
                <div ref={messagesEndRef} className="h-px shrink-0" aria-hidden />
                {!messages.length ? (
                  <p className="text-pretty text-sm text-muted-foreground">
                    Try: “Top 5 customers by revenue in 1997” or “Which shippers had late orders last
                    quarter?” Answers use the metrics catalog and your read-only connection when those
                    services are configured.
                  </p>
                ) : null}
              </div>
            )}
          </ScrollArea>
          <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-2 shadow-inner">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about orders, customers, revenue, or inventory…"
              rows={3}
              disabled={sending}
              className="min-h-[88px] resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex justify-end gap-2 px-1 pb-1">
              <Button
                type="button"
                variant={recording ? "destructive" : "outline"}
                onClick={() => void toggleRecording()}
                disabled={sending || !browserSpeechSupported}
                title={
                  browserSpeechSupported
                    ? "Speak your question (browser speech recognition)"
                    : "Voice needs Web Speech API (e.g. Chrome or Edge)"
                }
              >
                {recording ? (
                  <>
                    <SquareIcon className="size-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <MicIcon className="size-4" />
                    Voice
                  </>
                )}
              </Button>
              <Button
                type="button"
                className="bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90"
                onClick={() => void sendMessage()}
                disabled={sending}
              >
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
