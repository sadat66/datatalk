"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLinkIcon,
  FileDownIcon,
  Loader2Icon,
  MicIcon,
  SquareIcon,
  Trash2Icon,
  Volume2Icon,
} from "lucide-react";

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
import type { TrustPipeline, TrustReport } from "@/lib/datatalk/types";
import { buildTrustReasoningSections, trustReasoningToneClass } from "@/lib/datatalk/trust-reasoning";

const PIPELINE_LABEL: Record<TrustPipeline, string> = {
  data: "Data-backed",
  conversational: "Informational",
  clarify: "Clarification",
  refused: "Declined",
  validation_failed: "SQL failed checks",
  execution_failed: "Run failed",
  canned: "Preset reply",
};
import { downloadResultTablePdf } from "@/lib/export-result-table-pdf";
import { formatRelativeTime } from "@/lib/format-relative-time";
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
  trust_upgrade_suggestion?: string;
  result_has_more?: boolean;
  result_next_offset?: number | null;
};

type ParsedSseEvent = {
  event: string;
  data: string;
};

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

function parseSseEvents(buffer: string): { events: ParsedSseEvent[]; rest: string } {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  const events: ParsedSseEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    let event = "message";
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    events.push({ event, data: dataLines.join("\n") });
  }

  return { events, rest };
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
  const reasoningSections = buildTrustReasoningSections(trust);
  return (
    <Collapsible className="mt-2 rounded-md border border-border bg-muted/40">
      <CollapsibleTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "flex h-auto w-full items-center justify-between gap-2 whitespace-normal px-3 py-2 text-left",
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium">Why this answer? — trust and reasoning</span>
          <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
            Validation · confidence · graceful failure · hallucination checks
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
          {trust.pipeline
            ? `${PIPELINE_LABEL[trust.pipeline]} · ${trust.level} trust`
            : `${trust.level} trust`}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3 pt-0">
        <div className="space-y-2">
          {reasoningSections.map((s) => (
            <div
              key={s.id}
              className={cn(
                "rounded-md border px-2.5 py-2 text-xs leading-snug",
                trustReasoningToneClass(s.tone),
              )}
            >
              <p className="font-medium text-foreground">{s.title}</p>
              {s.bullets && s.bullets.length > 0 ? (
                <ul className="mt-1.5 list-inside list-disc space-y-1 text-muted-foreground">
                  {s.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              ) : s.body ? (
                <p className="mt-1 text-muted-foreground">{s.body}</p>
              ) : null}
            </div>
          ))}
        </div>
        {planSummary ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Plan: </span>
            {planSummary}
          </p>
        ) : null}
        <div>
          <p className="text-[11px] font-medium text-foreground">Additional pipeline signals</p>
          <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
            {trust.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        {sql ? (
          <div>
            <p className="text-[11px] font-medium text-foreground">Validated SQL</p>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-background p-2 text-[11px] leading-snug text-foreground">
              {sql}
            </pre>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

const ChatMessageBubble = memo(
  function ChatMessageBubble({
    message: m,
    isStreamingAssistant,
    ttsSupported,
    isSpeaking,
    onSpeak,
    onRequestStrictVerification,
    onNextPage,
    onDownloadTablePdf,
    pdfExportBusy,
  }: {
    message: MessageRow;
    isStreamingAssistant: boolean;
    ttsSupported: boolean;
    isSpeaking: boolean;
    onSpeak: (messageId: string, text: string) => void;
    onRequestStrictVerification?: () => void;
    onNextPage?: (nextOffset: number) => void;
    onDownloadTablePdf?: (sql: string, caption: string) => Promise<void>;
    pdfExportBusy?: boolean;
  }) {
    const text = messageText(m.role, m.content);
    const trust = m.content.trust as TrustReport | undefined;
    const sql = typeof m.content.sql === "string" ? m.content.sql : undefined;
    const rows = Array.isArray(m.content.rows)
      ? (m.content.rows as Record<string, unknown>[])
      : undefined;
    const plan = typeof m.content.plan_summary === "string" ? m.content.plan_summary : null;
    const trustUpgradeSuggestion =
      typeof m.content.trust_upgrade_suggestion === "string"
        ? m.content.trust_upgrade_suggestion
        : undefined;
    const resultHasMore = m.content.result_has_more === true;
    const resultNextOffset =
      typeof m.content.result_next_offset === "number" ? m.content.result_next_offset : null;
    const isUser = m.role === "user";
    const showThinkingPulse =
      !isUser &&
      isStreamingAssistant &&
      (text === "Thinking…" || text === "Finalizing answer…");

    return (
      <div
        className={cn(
          "flex gap-2",
          isUser ? "justify-end" : "justify-start",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:slide-in-from-bottom-1",
        )}
      >
        <div
          className={cn(
            "max-w-[min(92%,42rem)] rounded-2xl px-4 py-3 text-[15px] leading-relaxed tracking-[-0.01em] transition-[box-shadow,transform] duration-200",
            isUser
              ? "rounded-br-md bg-[var(--dt-teal)] text-white shadow-sm shadow-black/10"
              : "rounded-bl-md border border-border/60 bg-gradient-to-b from-card to-muted/20 text-card-foreground shadow-sm shadow-black/[0.04]",
          )}
        >
          <div className="flex items-end gap-0.5">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {showThinkingPulse ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin opacity-70" />
                  <span>{text}</span>
                </span>
              ) : (
                text
              )}
            </p>
            {isStreamingAssistant && !showThinkingPulse ? (
              <span
                className="mb-0.5 inline-block h-4 w-px shrink-0 animate-pulse bg-[var(--dt-teal)]/80"
                aria-hidden
              />
            ) : null}
          </div>
          {!isUser && ttsSupported && !isStreamingAssistant ? (
            <div className="mt-2 flex justify-end border-t border-border/50 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground hover:text-foreground"
                onClick={() => onSpeak(m.id, text)}
              >
                {isSpeaking ? (
                  <>
                    <SquareIcon className="size-4" />
                    Stop audio
                  </>
                ) : (
                  <>
                    <Volume2Icon className="size-4" />
                    Speak
                  </>
                )}
              </Button>
            </div>
          ) : null}
          {!isUser && trust && !isStreamingAssistant ? (
            <TrustBlock trust={trust} sql={sql} planSummary={plan} />
          ) : null}
          {!isUser && rows?.length && !isStreamingAssistant ? <ResultTable rows={rows} /> : null}
          {!isUser &&
          resultHasMore &&
          resultNextOffset != null &&
          onNextPage &&
          !isStreamingAssistant ? (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                onClick={() => onNextPage(resultNextOffset)}
              >
                Next 15 rows
              </Button>
            </div>
          ) : null}
          {!isUser && trustUpgradeSuggestion && onRequestStrictVerification && !isStreamingAssistant ? (
            <div className="mt-3 rounded-lg border border-[var(--dt-teal)]/30 bg-[var(--dt-teal)]/5 px-3 py-2 text-xs leading-relaxed text-foreground">
              <p className="text-muted-foreground">{trustUpgradeSuggestion}</p>
              <Button
                type="button"
                size="sm"
                className="mt-2 bg-[var(--dt-teal)] text-white hover:bg-[var(--dt-teal)]/90"
                onClick={onRequestStrictVerification}
              >
                Confirm strict verification
              </Button>
            </div>
          ) : null}
          {!isUser &&
          rows?.length &&
          sql &&
          !isStreamingAssistant &&
          (trust == null || trust.execution?.skipped !== true) ? (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={pdfExportBusy || !onDownloadTablePdf}
                onClick={() => {
                  if (!sql || !onDownloadTablePdf) return;
                  void onDownloadTablePdf(sql, text.trim().slice(0, 280));
                }}
              >
                <FileDownIcon className="size-3.5" />
                {pdfExportBusy ? "Preparing PDF…" : "Download table (PDF)"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreamingAssistant === next.isStreamingAssistant &&
    prev.ttsSupported === next.ttsSupported &&
    prev.isSpeaking === next.isSpeaking &&
    prev.onSpeak === next.onSpeak &&
    prev.onRequestStrictVerification === next.onRequestStrictVerification &&
    prev.onNextPage === next.onNextPage &&
    prev.onDownloadTablePdf === next.onDownloadTablePdf &&
    prev.pdfExportBusy === next.pdfExportBusy,
);

type ChatPanelProps = {
  /** Right-rail layout for the dashboard (no left conversation column). */
  variant?: "default" | "embedded" | "page";
  /** When set, selects this thread on mount (e.g. `/dashboard/chat/[id]`). */
  initialConversationId?: string | null;
};

export function ChatPanel({ variant = "default", initialConversationId = null }: ChatPanelProps) {
  const embedded = variant === "embedded";
  const pageVariant = variant === "page";
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
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
    isCreatingConversationRef.current = false;
    if (initialConversationId) {
      setConversationId(initialConversationId);
    }
    void refreshConversationPanel(initialConversationId ?? null);
  }, [initialConversationId, refreshConversationPanel]);

  useEffect(() => {
    setBrowserSpeechSupported(Boolean(resolveBrowserSpeechCtor()));
    setTtsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (loadingMessages) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [loadingMessages, conversationId, messages.length]);

  useEffect(() => {
    speakingMessageIdRef.current = speakingMessageId;
  }, [speakingMessageId]);

  const toggleSpeak = useCallback((messageId: string, text: string) => {
    if (!ttsSupported || typeof window === "undefined" || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (speakingMessageIdRef.current === messageId) {
      synth.cancel();
      setSpeakingMessageId(null);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => {
      setSpeakingMessageId(null);
      setError("Text-to-speech failed in this browser.");
    };
    setSpeakingMessageId(messageId);
    synth.speak(utterance);
  }, [ttsSupported]);

  async function transcribeAudio(audioBlob: Blob) {
    setTranscribing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "question.webm");
      const res = await fetch("/api/stt", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { text?: string; error?: string };
      const text = data.text;
      if (!res.ok || !text) {
        throw new Error(data.error || "Transcription failed");
      }
      setDraft((prev) => {
        const prefix = prev.trim();
        return prefix ? `${prefix} ${text}` : text;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecording() {
    if (transcribing || sending) return;

    if (recording) {
      speechRecognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    const SpeechCtor = resolveBrowserSpeechCtor();
    if (SpeechCtor) {
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
        return;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Browser speech start failed");
      }
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = chunksRef.current[0]?.type || "audio/webm";
        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (audioBlob.size > 0) {
          void transcribeAudio(audioBlob);
        }
      };

      recorder.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone access failed");
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
          : "grid min-h-0 flex-1 gap-6 lg:grid-cols-[220px_1fr]"
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
            : pageVariant
              ? "flex min-h-[min(720px,calc(100vh-11rem))] flex-1 flex-col border-border"
              : "flex min-h-[520px] flex-col border-border"
        }
      >
        <CardHeader className={embedded ? "border-b border-border pb-3 pt-4" : "border-b border-border pb-4"}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className={embedded ? "text-base" : "text-lg"}>
                {embedded ? "DataTalk Agent" : pageVariant ? "Chat" : "Ask DataTalk"}
              </CardTitle>
              <CardDescription className={embedded ? "text-xs" : ""}>
                {embedded
                  ? "Ask natural-language questions about your warehouse."
                  : pageVariant
                    ? "Full-page view of this conversation."
                    : "Questions run through validation and a read-only database connection when configured."}
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
              <p className="text-xs font-medium text-muted-foreground">Your chats</p>
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
              "min-h-[280px] flex-1 rounded-md border border-border bg-muted/20 p-3",
              (embedded || pageVariant) && "min-h-0",
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
                  <p className="text-sm text-muted-foreground">
                    Ask something like: “Top 5 customers by line revenue in 1997.” (Requires LLM and
                    read-only DB env vars.)
                  </p>
                ) : null}
              </div>
            )}
          </ScrollArea>
          <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-2 shadow-inner">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask in plain language…"
              rows={3}
              disabled={sending || transcribing}
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
                disabled={sending || transcribing}
                title={
                  browserSpeechSupported
                    ? "Use browser speech recognition"
                    : "Fallback to server speech-to-text"
                }
              >
                {recording ? (
                  <>
                    <SquareIcon className="size-4" />
                    Stop
                  </>
                ) : transcribing ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Transcribing
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
                disabled={sending || transcribing}
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
