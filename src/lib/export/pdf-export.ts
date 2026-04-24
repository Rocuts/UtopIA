// NOTE: `jspdf` is ~350kB and only needed when the user explicitly hits "Export PDF".
// We import the type statically (free at runtime) and load the real module on demand
// inside `exportConversationPDF`. This keeps the ~350kB out of the initial workspace
// bundle on first paint. Both call sites already fire-and-forget the result.
import type jsPDFType from 'jspdf';
import type { ConversationMessage } from '@/lib/storage/conversation-history';
import { redactPII } from '@/lib/security/pii-filter';

type jsPDF = jsPDFType;

interface ExportOptions {
  title: string;
  useCase: string;
  messages: ConversationMessage[];
  language: 'es' | 'en';
  date?: string;
}

// ---------- Markdown → PDF rendering ----------

interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Parse inline markdown (**bold**, *italic*, `code`) into styled segments. */
function parseInlineMarkdown(text: string): TextSegment[] {
  // Pre-process: convert markdown links [text](url) → plain text
  const processed = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  const segments: TextSegment[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(processed)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      segments.push({ text: processed.slice(lastIndex, match.index), bold: false, italic: false });
    }

    if (match[1] !== undefined) {
      segments.push({ text: match[1], bold: true, italic: false });
    } else if (match[2] !== undefined) {
      segments.push({ text: match[2], bold: false, italic: true });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], bold: true, italic: false });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last match
  if (lastIndex < processed.length) {
    segments.push({ text: processed.slice(lastIndex), bold: false, italic: false });
  }

  if (segments.length === 0) {
    return [{ text: processed, bold: false, italic: false }];
  }

  // Safety: strip any leftover ** markers from segment text
  return segments.map(seg => ({
    ...seg,
    text: seg.text.replace(/\*{2,}/g, ''),
  }));
}

interface PdfLine {
  segments: TextSegment[];
  fontSize: number;
  indent: number;
  spacingAfter: number;
}

/** Convert markdown text into structured PDF lines with formatting info. */
function markdownToPdfLines(markdown: string): PdfLine[] {
  const lines: PdfLine[] = [];
  const rawLines = markdown.split('\n');

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // --- Headers ---
    if (trimmed.startsWith('#### ')) {
      lines.push({
        segments: parseInlineMarkdown(trimmed.slice(5)).map(s => ({ ...s, bold: true })),
        fontSize: 9,
        indent: 0,
        spacingAfter: 2,
      });
    } else if (trimmed.startsWith('### ')) {
      lines.push({
        segments: parseInlineMarkdown(trimmed.slice(4)).map(s => ({ ...s, bold: true })),
        fontSize: 10,
        indent: 0,
        spacingAfter: 3,
      });
    } else if (trimmed.startsWith('## ')) {
      lines.push({
        segments: parseInlineMarkdown(trimmed.slice(3)).map(s => ({ ...s, bold: true })),
        fontSize: 11,
        indent: 0,
        spacingAfter: 3,
      });
    } else if (trimmed.startsWith('# ')) {
      lines.push({
        segments: parseInlineMarkdown(trimmed.slice(2)).map(s => ({ ...s, bold: true })),
        fontSize: 12,
        indent: 0,
        spacingAfter: 4,
      });
    }
    // --- Bullet/number lists ---
    else if (/^[-*•]\s/.test(trimmed)) {
      const content = trimmed.replace(/^[-*•]\s+/, '');
      lines.push({
        segments: [
          { text: '  •  ', bold: false, italic: false },
          ...parseInlineMarkdown(content),
        ],
        fontSize: 9,
        indent: 4,
        spacingAfter: 1.5,
      });
    } else if (/^\d+\.\s/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+\.)\s+(.*)/);
      if (numMatch) {
        lines.push({
          segments: [
            { text: `  ${numMatch[1]} `, bold: true, italic: false },
            ...parseInlineMarkdown(numMatch[2]),
          ],
          fontSize: 9,
          indent: 4,
          spacingAfter: 1.5,
        });
      }
    }
    // --- Horizontal rules ---
    else if (/^---+$/.test(trimmed)) {
      // skip, the PDF has its own dividers
    }
    // --- Regular paragraphs ---
    else {
      lines.push({
        segments: parseInlineMarkdown(trimmed),
        fontSize: 9,
        indent: 0,
        spacingAfter: 2,
      });
    }
  }

  return lines;
}

/** Render parsed PDF lines to a jsPDF document with per-segment styling. */
function renderPdfLines(
  doc: jsPDF,
  pdfLines: PdfLine[],
  _startY: number,
  margin: number,
  contentWidth: number,
  checkPageBreak: (needed: number) => void,
  getY: () => number,
  setY: (v: number) => void,
) {
  const lineHeight = 4.5;

  for (const pdfLine of pdfLines) {
    checkPageBreak(6);
    doc.setFontSize(pdfLine.fontSize);

    const lineStart = margin + pdfLine.indent;
    const maxX = margin + contentWidth;
    let x = lineStart;

    for (const seg of pdfLine.segments) {
      const fontStyle =
        seg.bold && seg.italic ? 'bolditalic' :
        seg.bold ? 'bold' :
        seg.italic ? 'italic' :
        'normal';
      doc.setFont('helvetica', fontStyle);
      doc.setFontSize(pdfLine.fontSize);

      // Split segment text into words and spaces for wrapping
      const tokens = seg.text.split(/( +)/);

      for (const token of tokens) {
        if (!token) continue;

        const isSpace = /^ +$/.test(token);
        const tokenWidth = doc.getTextWidth(token);

        // Wrap to next line if this word exceeds the right margin
        if (!isSpace && x + tokenWidth > maxX && x > lineStart) {
          setY(getY() + lineHeight);
          checkPageBreak(5);
          x = lineStart;
        }

        // Skip leading spaces at line start
        if (isSpace && x <= lineStart) continue;

        doc.text(token, x, getY());
        x += tokenWidth;
      }
    }

    setY(getY() + lineHeight + pdfLine.spacingAfter);
  }
}

// ---------- Markdown table → PDF table ----------

interface TableData {
  headers: string[];
  rows: string[][];
}

/** Parse consecutive markdown table lines into structured data. */
function parseMarkdownTable(lines: string[]): TableData | null {
  if (lines.length < 3) return null;

  const parseRow = (line: string): string[] =>
    line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const isSeparator = (line: string): boolean =>
    /^\|[\s\-:|]+\|?$/.test(line.trim());

  const headers = parseRow(lines[0]).filter(h => h.length > 0);
  if (headers.length === 0) return null;

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (isSeparator(lines[i])) continue;
    const cells = parseRow(lines[i]);
    if (cells.some(c => c.length > 0)) {
      while (cells.length < headers.length) cells.push('');
      rows.push(cells.slice(0, headers.length));
    }
  }

  return rows.length > 0 ? { headers, rows } : null;
}

/** Render a parsed table with styled header, alternating rows, and text wrapping. */
function renderTable(
  doc: jsPDF,
  table: TableData,
  margin: number,
  contentWidth: number,
  checkPageBreak: (needed: number) => void,
  getY: () => number,
  setY: (v: number) => void,
) {
  const cellPad = 2;
  const fontSize = 7.5;
  const lineH = 3.5;
  const numCols = table.headers.length;

  doc.setFontSize(fontSize);

  // Measure natural column widths
  doc.setFont('helvetica', 'bold');
  const naturalW = table.headers.map(h => doc.getTextWidth(h) + cellPad * 3);
  doc.setFont('helvetica', 'normal');
  for (const row of table.rows) {
    for (let i = 0; i < numCols; i++) {
      naturalW[i] = Math.max(naturalW[i], doc.getTextWidth(row[i] || '') + cellPad * 3);
    }
  }

  // Scale to fit contentWidth proportionally
  const totalNat = naturalW.reduce((a, b) => a + b, 0);
  const colWidths = totalNat <= contentWidth
    ? naturalW.map(w => w + (contentWidth - totalNat) / numCols)
    : naturalW.map(w => Math.max(15, (w / totalNat) * contentWidth));

  // Normalize to exactly fill contentWidth
  const colSum = colWidths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < numCols; i++) colWidths[i] = (colWidths[i] / colSum) * contentWidth;

  // --- Header row ---
  checkPageBreak(18);
  const hY = getY();
  doc.setFillColor(30, 58, 95);
  doc.rect(margin, hY - 4, contentWidth, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(fontSize);

  let x = margin;
  for (let i = 0; i < numCols; i++) {
    const txt = doc.splitTextToSize(table.headers[i] || '', colWidths[i] - cellPad * 2);
    doc.text(txt[0] || '', x + cellPad, hY);
    x += colWidths[i];
  }
  setY(hY + 4.5);

  // --- Data rows ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);

  for (let r = 0; r < table.rows.length; r++) {
    // Wrap text in each cell and find tallest
    const wrapped: string[][] = [];
    let maxLines = 1;
    for (let i = 0; i < numCols; i++) {
      const w = doc.splitTextToSize(table.rows[r][i] || '', colWidths[i] - cellPad * 2);
      wrapped.push(w);
      maxLines = Math.max(maxLines, w.length);
    }

    const rowH = maxLines * lineH + cellPad;
    checkPageBreak(rowH + 1);
    const rY = getY();

    // Alternating row background
    if (r % 2 === 0) {
      doc.setFillColor(245, 245, 250);
      doc.rect(margin, rY - lineH, contentWidth, rowH, 'F');
    }

    // Cell text
    doc.setTextColor(50, 50, 50);
    x = margin;
    for (let i = 0; i < numCols; i++) {
      let tY = rY;
      for (const line of wrapped[i]) {
        doc.text(line, x + cellPad, tY);
        tY += lineH;
      }
      x += colWidths[i];
    }

    // Row bottom border
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.15);
    const bY = rY - lineH + rowH;
    doc.line(margin, bY, margin + contentWidth, bY);
    setY(bY + 1);
  }

  setY(getY() + 3);
}

/**
 * Render assistant content, splitting into text blocks and table blocks.
 * Tables (consecutive lines starting with |) get proper column rendering.
 */
function renderAssistantContent(
  doc: jsPDF,
  content: string,
  margin: number,
  contentWidth: number,
  checkPageBreak: (needed: number) => void,
  getY: () => number,
  setY: (v: number) => void,
) {
  const rawLines = content.split('\n');
  let i = 0;
  let textBuffer: string[] = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const text = textBuffer.join('\n');
    if (text.trim()) {
      const pdfLines = markdownToPdfLines(text);
      renderPdfLines(doc, pdfLines, getY(), margin, contentWidth, checkPageBreak, getY, setY);
    }
    textBuffer = [];
  };

  while (i < rawLines.length) {
    // Look ahead for a markdown table block
    if (rawLines[i].trim().startsWith('|')) {
      let j = i;
      const tableLines: string[] = [];
      while (j < rawLines.length && rawLines[j].trim().startsWith('|')) {
        tableLines.push(rawLines[j].trim());
        j++;
      }

      // Valid table: 3+ lines and second line is a separator row (---|---|...)
      const hasSep = tableLines.length >= 2 && /^\|[\s\-:|]+\|?$/.test(tableLines[1]);
      if (tableLines.length >= 3 && hasSep) {
        flushText();
        const table = parseMarkdownTable(tableLines);
        if (table) {
          renderTable(doc, table, margin, contentWidth, checkPageBreak, getY, setY);
        }
        i = j;
        continue;
      }
    }

    // Not a table line — buffer as regular text
    textBuffer.push(rawLines[i]);
    i++;
  }

  flushText();
}

const LABELS = {
  es: {
    header: '1+1 | Directorio Ejecutivo Digital — Consultoría Contable & Tributaria',
    reportTitle: 'Reporte de Consulta',
    caseType: 'Tipo de caso',
    date: 'Fecha',
    conversation: 'Conversación',
    user: 'Usuario',
    assistant: 'Asistente',
    disclaimer:
      'AVISO PROFESIONAL: Este documento fue generado por 1+1, una herramienta de asistencia profesional potenciada por IA. No constituye asesoría profesional certificada. Toda recomendación debe ser validada por un contador público certificado. Cumplimos con la Ley 1581 de Protección de Datos.',
    page: 'Página',
  },
  en: {
    header: '1+1 | Digital Executive Board — Accounting & Tax Consulting',
    reportTitle: 'Consultation Report',
    caseType: 'Case type',
    date: 'Date',
    conversation: 'Conversation',
    user: 'User',
    assistant: 'Assistant',
    disclaimer:
      'PROFESSIONAL NOTICE: This document was generated by 1+1, an AI-powered professional assistance tool. It does not constitute certified professional advice. All recommendations should be validated by a certified public accountant. We comply with Law 1581 on Data Protection.',
    page: 'Page',
  },
};

export async function exportConversationPDF(options: ExportOptions): Promise<void> {
  const { title, useCase, messages, language, date } = options;
  const l = LABELS[language];
  const exportDate = date ?? new Date().toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function addPageFooter(pageNum: number) {
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `${l.page} ${pageNum}`,
      pageWidth - margin,
      pageHeight - 10,
      { align: 'right' }
    );
    doc.text('utopia-ai.co', margin, pageHeight - 10);
  }

  function checkPageBreak(needed: number) {
    if (y + needed > pageHeight - 30) {
      addPageFooter(doc.getNumberOfPages());
      doc.addPage();
      y = margin;
    }
  }

  // ---- Header ----
  // Gold accent bar
  doc.setFillColor(212, 160, 23);
  doc.rect(0, 0, pageWidth, 3, 'F');

  // Brand
  doc.setFontSize(10);
  doc.setTextColor(212, 160, 23);
  doc.text(l.header, margin, y + 10);

  // Title
  y += 20;
  doc.setFontSize(18);
  doc.setTextColor(30, 58, 95);
  doc.text(l.reportTitle, margin, y);

  // Subtitle
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text(title, margin, y);

  // Meta info
  y += 10;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`${l.caseType}: ${useCase}`, margin, y);
  y += 5;
  doc.text(`${l.date}: ${exportDate}`, margin, y);

  // Divider
  y += 8;
  doc.setDrawColor(212, 160, 23);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ---- Conversation ----
  doc.setFontSize(12);
  doc.setTextColor(30, 58, 95);
  doc.text(l.conversation, margin, y);
  y += 8;

  // Y-position helpers for the markdown renderer
  const getY = () => y;
  const setY = (v: number) => { y = v; };

  for (const msg of messages) {
    const isUser = msg.role === 'user';
    const roleLabel = isUser ? l.user : l.assistant;

    checkPageBreak(20);

    // Role label
    doc.setFontSize(9);
    doc.setTextColor(isUser ? 212 : 30, isUser ? 160 : 58, isUser ? 23 : 95);
    doc.setFont('helvetica', 'bold');
    doc.text(roleLabel, margin, y);
    y += 5;

    // Message content — redact PII from ALL messages before export
    const safeContent = redactPII(msg.content);

    doc.setTextColor(50, 50, 50);

    if (isUser) {
      // User messages: plain text (no markdown)
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(safeContent, contentWidth);
      for (const line of lines) {
        checkPageBreak(5);
        doc.text(line, margin, y);
        y += 4.5;
      }
    } else {
      // Assistant messages: tables get proper rendering, rest uses markdown parser
      renderAssistantContent(doc, safeContent, margin, contentWidth, checkPageBreak, getY, setY);
    }

    y += 4;
  }

  // ---- Disclaimer Footer ----
  checkPageBreak(30);
  y += 5;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  const disclaimerLines = doc.splitTextToSize(l.disclaimer, contentWidth);
  for (const line of disclaimerLines) {
    checkPageBreak(4);
    doc.text(line, margin, y);
    y += 3.5;
  }

  // Page footers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(i);
  }

  // Download
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  doc.save(`1mas1_${safeTitle}_${Date.now()}.pdf`);
}
