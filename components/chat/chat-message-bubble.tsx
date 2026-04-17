"use client";

import { memo, useMemo } from "react";
import { FileDownIcon, Loader2Icon, SquareIcon, Volume2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MessageRow } from "@/components/chat/types";
import type { TrustPipeline, TrustReport } from "@/lib/datatalk/types";
import { buildTrustReasoningSections, trustReasoningToneClass } from "@/lib/datatalk/trust-reasoning";
import { cn } from "@/lib/utils";

const PIPELINE_LABEL: Record<TrustPipeline, string> = {
  data: "Data-backed",
  conversational: "Informational",
  clarify: "Clarification",
  refused: "Declined",
  validation_failed: "SQL failed checks",
  execution_failed: "Run failed",
  canned: "Preset reply",
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

function extractWhatThisShows(text: string): string {
  const match = text.match(/\*\*What this shows:\*\*\s*([^\r\n]+)/i) ?? text.match(/What this shows:\s*([^\r\n]+)/i);
  return (match?.[1] ?? "").trim();
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border">
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

export const ChatMessageBubble = memo(
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
            "max-w-[min(92%,42rem)] rounded-2xl px-3 py-2 text-sm leading-relaxed tracking-[-0.01em] transition-[box-shadow,transform] duration-200 sm:px-4 sm:py-3 sm:text-[15px]",
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
                  void onDownloadTablePdf(sql, extractWhatThisShows(text).slice(0, 280));
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
