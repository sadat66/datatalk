import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";

import { QUERY_RESULT_EXPORT_MAX_ROWS } from "@/lib/datatalk/query-export-limits";

const MARGIN = 48;
const FOOTER_GAP = 32;
/** Aligns with app accent (teal) for header bar */
const HEAD_FILL: [number, number, number] = [13, 148, 136];
const HEAD_TEXT: [number, number, number] = [255, 255, 255];
const STRIPE: [number, number, number] = [248, 250, 252];
const MUTED: [number, number, number] = [100, 116, 139];

/** Aligns with server export cap — extra guard if rows are passed from elsewhere. */
const MAX_ROWS = QUERY_RESULT_EXPORT_MAX_ROWS;
/** Per-cell cap before truncation (wrapped cells can still be large) */
const MAX_CELL_CHARS = 2000;

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS - 1)}…` : s;
    } catch {
      return "[object]";
    }
  }
  const s = String(v);
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS - 1)}…` : s;
}

function addPageFooters(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.text(`Page ${i} of ${total}`, pageWidth / 2, pageHeight - 22, { align: "center" });
    doc.text("DataTalk — query results", MARGIN, pageHeight - 22);
  }
  doc.setTextColor(0, 0, 0);
}

/** PDF containing only the SQL result table (answers where the database returned rows). */
export function downloadResultTablePdf(opts: {
  rows: Record<string, unknown>[];
  /** Short note under the title (optional). */
  caption?: string;
}): void {
  const { rows, caption } = opts;
  if (!rows.length) return;

  const cols = Object.keys(rows[0] ?? {});
  if (!cols.length) return;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxTextWidth = pageWidth - MARGIN * 2;

  let y = MARGIN;

  if (caption?.trim()) {
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const capLines = doc.splitTextToSize(caption.trim().slice(0, 500), maxTextWidth);
    for (const line of capLines) {
      doc.text(line, MARGIN, y);
      y += 12;
    }
    y += 8;
  }

  const limit = Math.min(rows.length, MAX_ROWS);
  const body: string[][] = [];
  for (let i = 0; i < limit; i += 1) {
    body.push(cols.map((c) => formatCell(rows[i]![c])));
  }

  const head = [cols.map((c) => c.replace(/_/g, " "))];

  const foot: CellDef[][] | undefined =
    rows.length > limit
      ? [
          [
            {
              content: `… ${rows.length - limit} additional row${rows.length - limit === 1 ? "" : "s"} not included (PDF row cap ${MAX_ROWS}).`,
              colSpan: cols.length,
              styles: { halign: "left", fillColor: [255, 251, 235] },
            },
          ],
        ]
      : undefined;

  autoTable(doc, {
    startY: y,
    head,
    body,
    foot,
    showFoot: foot ? "lastPage" : "never",
    theme: "striped",
    tableWidth: "auto",
    showHead: "everyPage",
    margin: { left: MARGIN, right: MARGIN, bottom: MARGIN + FOOTER_GAP },
    styles: {
      font: "helvetica",
      fontStyle: "normal",
      fontSize: 8,
      cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
      overflow: "linebreak",
      cellWidth: "wrap",
      valign: "top",
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      font: "helvetica",
      fontStyle: "bold",
      fillColor: HEAD_FILL,
      textColor: HEAD_TEXT,
      halign: "left",
      valign: "middle",
      fontSize: 8.5,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [15, 23, 42],
    },
    alternateRowStyles: {
      fillColor: STRIPE,
    },
    footStyles: {
      font: "helvetica",
      fontStyle: "italic",
      fontSize: 8,
      textColor: MUTED,
      fillColor: [255, 251, 235],
    },
    horizontalPageBreak: true,
    horizontalPageBreakBehaviour: "afterAllRows",
  });

  addPageFooters(doc);

  const safe = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  doc.save(`datatalk-query-results-${safe}.pdf`);
}
