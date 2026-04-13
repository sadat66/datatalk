"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2Icon, MicIcon, SquareIcon, Volume2Icon } from "lucide-react";

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
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

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
    if (sending) return;
    if (conversationId) {
      void loadMessages(conversationId);
    } else {
      setMessages([]);
    }
  }, [conversationId, loadMessages, sending]);

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

  function toggleSpeak(messageId: string, text: string) {
    if (!ttsSupported || typeof window === "undefined" || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (speakingMessageId === messageId) {
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
  }

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
      if (!res.ok || !data.text) {
        throw new Error(data.error || "Transcription failed");
      }
      setDraft((prev) => {
        const prefix = prev.trim();
        return prefix ? `${prefix} ${data.text}` : data.text;
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

  async function sendMessage() {
    const text = draft.trim();
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
      content: { type: "assistant", text: "" },
      created_at: now,
    };

    setSending(true);
    setError(null);
    setDraft("");
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ conversationId: userConversationId, message: text }),
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
        let receivedDelta = false;

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
              receivedDelta = true;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantTempId) return m;
                  const prior = messageText(m.role, m.content);
                  return {
                    ...m,
                    content: { type: "assistant", text: `${prior}${payload.delta}` },
                  };
                }),
              );
              continue;
            }

            if (evt.event === "status" && !receivedDelta && typeof payload.stage === "string") {
              const statusText =
                payload.stage === "finalizing" ? "Finalizing answer..." : "Thinking...";
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
            }
          }
        }
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
            },
          };
        }),
      );
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== userTempId && m.id !== assistantTempId));
      setError(e instanceof Error ? e.message : "Send failed");
      setDraft(text);
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
                        {!isUser && ttsSupported ? (
                          <div className="mt-1 flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSpeak(m.id, text)}
                            >
                              {speakingMessageId === m.id ? (
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
              disabled={sending || transcribing}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="flex justify-end gap-2">
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
              <Button type="button" onClick={() => void sendMessage()} disabled={sending || transcribing}>
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
