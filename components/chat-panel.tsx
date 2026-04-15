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
  ChevronDownIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MicIcon,
  SquareIcon,
} from "lucide-react";

import { ChatMessageBubble } from "@/components/chat/chat-message-bubble";
import { ConversationList } from "@/components/chat/conversation-list";
import { parseSseEvents } from "@/components/chat/sse";
import type { ChatResponse, Conversation, MessageRow } from "@/components/chat/types";
import type { ConversationsPanelPayload } from "@/lib/conversations/panel-data";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { downloadResultTablePdf } from "@/lib/export-result-table-pdf";
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
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
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

  const selectConversation = useCallback(
    (id: string) => {
      isCreatingConversationRef.current = false;
      setConversationId(id);
      void refreshConversationPanel(id);
    },
    [refreshConversationPanel],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      void deleteConversation(id);
    },
    [deleteConversation],
  );

  return (
    <div
      className={
        embedded
          ? "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col"
          : "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:grid-rows-1 lg:items-stretch lg:gap-6"
      }
    >
      {!embedded ? (
        <Card className="hidden h-fit shrink-0 flex-col overflow-hidden border-border lg:flex lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] lg:min-h-0 lg:overflow-y-auto">
          <CardHeader className="!flex !flex-col gap-1 pb-3">
            <CardTitle className="text-sm">Chats</CardTitle>
            <CardDescription className="text-xs leading-normal">Your saved threads</CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 space-y-2">
            <ConversationList
              embedded={embedded}
              scrollAreaClassName="h-[min(220px,38dvh)] sm:h-[320px]"
              loadingList={loadingList}
              conversations={conversations}
              activeConversationId={conversationId}
              deletingConversationId={deletingConversationId}
              onStartNewChat={startNewChat}
              onSelectConversation={selectConversation}
              onDeleteConversation={handleDeleteConversation}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card
        className={
          embedded
            ? "flex min-h-0 flex-1 flex-col rounded-none border-0 border-l border-border bg-card shadow-none"
            : "relative z-10 flex min-h-0 min-w-0 flex-1 flex-col border-border bg-card shadow-sm lg:min-h-0 lg:overflow-hidden"
        }
      >
        {!embedded ? (
          <div className="isolate border-b border-border bg-muted/30 px-3 py-2 lg:hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between py-0.5"
              onClick={() => setMobileThreadsOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Threads
                {conversations.length > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {conversations.length}
                  </span>
                ) : null}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  mobileThreadsOpen && "rotate-180",
                )}
              />
            </button>
            {mobileThreadsOpen ? (
              <div className="mt-2 space-y-2">
                <ConversationList
                  embedded={embedded}
                  scrollAreaClassName="h-[min(140px,26dvh)]"
                  loadingList={loadingList}
                  conversations={conversations}
                  activeConversationId={conversationId}
                  deletingConversationId={deletingConversationId}
                  onStartNewChat={startNewChat}
                  onSelectConversation={selectConversation}
                  onDeleteConversation={handleDeleteConversation}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <CardHeader
          className={cn(
            "!flex !flex-col gap-2 border-border pb-2 pt-2 sm:pb-4 sm:pt-4 [&]:grid-rows-none",
            embedded ? "border-b pb-3 pt-4" : "border-b",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className={embedded ? "text-base" : "text-lg"}>
                {embedded ? "DataTalk" : pageVariant ? "Conversation" : "DataTalk"}
              </CardTitle>
              <CardDescription
                className={cn(
                  "text-sm leading-relaxed text-muted-foreground",
                  embedded ? "text-xs" : "hidden sm:block max-lg:text-[13px] max-lg:leading-snug",
                )}
              >
                {embedded
                  ? "Natural language → validated SQL on the Northwind sample database."
                  : pageVariant
                    ? "Same thread as in the workspace; use the full height for longer answers."
                    : (
                        <>
                          <span className="lg:hidden">
                            Ask in plain English — validated SQL against your database.
                          </span>
                          <span className="hidden lg:inline">
                            Questions are validated and run against the read-only database when it is configured.
                          </span>
                        </>
                      )}
              </CardDescription>
            </div>
            {!pageVariant && conversationId ? (
              <div className="hidden shrink-0 flex-wrap items-center gap-2 sm:flex">
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
              <ConversationList
                embedded={embedded}
                scrollAreaClassName=""
                loadingList={loadingList}
                conversations={conversations}
                activeConversationId={conversationId}
                deletingConversationId={deletingConversationId}
                onStartNewChat={startNewChat}
                onSelectConversation={selectConversation}
                onDeleteConversation={handleDeleteConversation}
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden pt-2 pb-2 sm:gap-3 sm:pt-4 sm:pb-4"
        >
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <ScrollArea
            className={cn(
              "min-h-0 flex-1 rounded-md border border-border bg-muted/20 p-2 sm:min-h-[min(200px,30dvh)] sm:p-3",
              embedded || pageVariant ? "sm:min-h-0" : "",
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
                  <div className="rounded-lg border border-border/80 bg-background/80 p-3 text-pretty text-xs leading-relaxed text-muted-foreground sm:p-4 sm:text-sm">
                    <p className="font-medium text-foreground">Try asking</p>
                    <p className="mt-2">
                      e.g. “Top 5 customers by revenue in 1997” or “Which shippers had late orders last
                      quarter?”
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground/90 sm:text-xs">
                      Answers use the metrics catalog when your database connection is configured.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </ScrollArea>
          <div className="shrink-0 space-y-1.5 rounded-2xl border border-border/60 bg-muted/30 p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-inner sm:space-y-2 sm:p-2 sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about orders, customers, revenue, or inventory…"
              rows={2}
              disabled={sending}
              className="min-h-[52px] resize-none border-0 bg-transparent px-2 py-1.5 text-[15px] shadow-none focus-visible:ring-0 sm:min-h-[88px] sm:py-2"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex flex-wrap justify-end gap-2 px-1 pb-1 sm:flex-nowrap">
              <Button
                type="button"
                variant={recording ? "destructive" : "outline"}
                size="sm"
                className="shrink-0"
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
                size="sm"
                className="shrink-0 bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90"
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
