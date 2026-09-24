'use client';

/**
 * reportPDF — genera el informe mensual PDF de Contabilidad Pyme.
 *
 * Recibe el payload del reporte (ya calculado por /api/pyme/reports/monthly)
 * y devuelve un jsPDF listo para .save(). El llamador decide el nombre del archivo.
 *
 * Paleta: verde oscuro #1A2E0D (cabecera), #357A28 (acento), blanco, gris claro.
 * Fuente: helvetica (embebida en jsPDF, no requiere assets externos).
 */

import jsPDF from 'jspdf';
// jspdf-autotable v5 ya no parchea `doc.autoTable` al importarse como efecto
// secundario (sólo lo hace con `window.jsPDF` global, que el bundle ESM no
// define): se usa la función `autoTable(doc, opts)`, que además deja
// `doc.lastAutoTable` con la tabla dibujada.
import { autoTable } from 'jspdf-autotable';
import type {
  MonthlyAlert,
  MonthlyReportPayload,
  MonthlySummaryTotals,
} from '@/components/workspace/pyme/types';
import { formatCop, formatPct } from '@/lib/charts/format';
import { formatCOP } from '@/lib/format/cop';

// Colour constants
const GREEN_DARK = [26, 46, 13] as const;
const GREEN_MID = [53, 122, 40] as const;
const GREEN_LIGHT = [240, 247, 234] as const;
const WHITE = [255, 255, 255] as const;
const GREY = [180, 180, 180] as const;
const RED = [168, 56, 56] as const;
const AMBER = [196, 138, 46] as const;

const INK = [40, 40, 40] as const;
/** Interlineado de las alertas (helvetica 8 pt ≈ 3,3 mm con factor 1,15). */
const ALERT_LINE_MM = 3.6;

/**
 * Pesos es-CO del informe: `$1.234.567` si el monto es entero y
 * `$1.234.567,50` si tiene centavos (nunca redondea un centavo en silencio);
 * negativos entre paréntesis como el resto de la plataforma. N/D si no es
 * finito.
 */
export function formatPymeCop(v: number): string {
  if (!Number.isFinite(v)) return 'N/D';
  return Math.round(v * 100) % 100 === 0 ? formatCop(v) : formatCOP(v);
}

export type PymeKpiTone = 'positive' | 'negative' | 'neutral';

/**
 * Margen del mes (reportes-export-22). Sin ingresos el margen no existe: la
 * API entrega `margenPct = 0` en ese caso (lib/db/pyme.ts) y el PDF lo
 * imprimía como "0.0%" en verde. Ahora es N/D con tono neutro, y el valor se
 * imprime con coma decimal ("12,5%").
 */
export function formatPymeMargin(
  totals: Pick<MonthlySummaryTotals, 'ingresos' | 'margen' | 'margenPct'>,
): { text: string; tone: PymeKpiTone } {
  if (!Number.isFinite(totals.ingresos) || totals.ingresos <= 0) {
    return { text: 'N/D', tone: 'neutral' };
  }
  const pct = Number.isFinite(totals.margenPct) ? totals.margenPct : totals.margen / totals.ingresos;
  if (!Number.isFinite(pct)) return { text: 'N/D', tone: 'neutral' };
  return { text: formatPct(pct), tone: pct >= 0 ? 'positive' : 'negative' };
}

/**
 * Ícono ASCII de la alerta: helvetica (WinAnsi) no tiene '⚠', que jsPDF
 * imprimía como un carácter ilegible.
 */
export function alertIcon(sev: MonthlyAlert['severity']): string {
  if (sev === 'critical') return '!!';
  if (sev === 'warning') return '!';
  return 'i';
}

function alertColor(sev: MonthlyAlert['severity']): readonly [number, number, number] {
  if (sev === 'critical') return RED;
  if (sev === 'warning') return AMBER;
  return GREEN_MID;
}

/**
 * Fondo de la alerta: el color de la severidad al 8 % sobre blanco, en RGB.
 * jsPDF no tiene alfa en `setFillColor`: con un cuarto argumento lo lee como
 * CMYK, y `(196, 138, 46, 0.08)` salía como `196 138 46 0.08 k`, que el visor
 * recorta a C = M = Y = 1 (casi negro) y dejaba el texto de la alerta ilegible.
 */
export function alertBackground(sev: MonthlyAlert['severity']): [number, number, number] {
  const [r, g, b] = alertColor(sev);
  const mix = (c: number) => Math.round(255 - (255 - c) * 0.08);
  return [mix(r), mix(g), mix(b)];
}

export interface ReportPDFOptions {
  businessName?: string;
  language?: string;
}

export function generateMonthlyReportPDF(
  payload: MonthlyReportPayload,
  opts: ReportPDFOptions = {},
): jsPDF {
  const { businessName = 'Mi negocio', language = 'es' } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as any;

  const monthLabel = new Date(payload.year, payload.month - 1, 1).toLocaleDateString(
    language === 'es' ? 'es-CO' : 'en-US',
    { month: 'long', year: 'numeric' },
  );
  const monthTitle = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // ── Cover header ────────────────────────────────────────────────────────────
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, 210, 52, 'F');

  doc.setTextColor(...WHITE);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Informe Mensual', 14, 20);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text(businessName, 14, 30);
  doc.text(monthTitle, 14, 39);

  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(
    `Generado el ${new Date().toLocaleDateString('es-CO')} · 1+1 Contabilidad Pyme`,
    14,
    48,
  );

  // ── KPI summary band ────────────────────────────────────────────────────────
  const { totals, previous } = payload.summary;
  const margin = formatPymeMargin(totals);
  const kpis: Array<{ label: string; value: string; tone: PymeKpiTone }> = [
    { label: 'Total vendí', value: formatPymeCop(totals.ingresos), tone: 'positive' },
    { label: 'Total gasté', value: formatPymeCop(totals.egresos), tone: 'negative' },
    {
      label: 'Me quedó',
      value: formatPymeCop(totals.margen),
      tone: totals.margen >= 0 ? 'positive' : 'negative',
    },
    { label: 'Margen', value: margin.text, tone: margin.tone },
  ];

  kpis.forEach((kpi, i) => {
    const x = 14 + i * 46;
    doc.setFillColor(...GREEN_LIGHT);
    doc.roundedRect(x, 56, 43, 22, 2, 2, 'F');

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 130, 90);
    doc.text(kpi.label.toUpperCase(), x + 3, 62);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(
      ...(kpi.tone === 'positive' ? GREEN_DARK : kpi.tone === 'negative' ? RED : INK),
    );
    doc.text(kpi.value, x + 3, 71);
  });

  if (previous) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GREY);
    const prevText = `Mes anterior: ingresos ${formatPymeCop(previous.ingresos)} · margen ${formatPymeCop(previous.margen)}`;
    doc.text(prevText, 14, 83);
  }

  // ── Categories tables ───────────────────────────────────────────────────────
  const tableY = previous ? 90 : 84;

  const ingrRows = payload.summary.topIngresoCategories.map((c) => [c.category, formatPymeCop(c.amount)]);
  const egreRows = payload.summary.topEgresoCategories.map((c) => [c.category, formatPymeCop(c.amount)]);
  // Fin de las tablas: la más larga de las dos (las alertas no deben
  // superponerse a la columna de ingresos cuando es la más larga).
  let tablesEndY = tableY;

  if (ingrRows.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Top categorías de ingreso', 14, tableY);

    autoTable(doc, {
      startY: tableY + 4,
      head: [['Categoría', 'Monto']],
      body: ingrRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [...GREEN_MID], textColor: [...WHITE], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [...GREEN_LIGHT] },
      columnStyles: { 1: { halign: 'right', textColor: [...GREEN_DARK] } },
      margin: { left: 14, right: 110 },
      tableWidth: 86,
    });
    tablesEndY = Math.max(tablesEndY, doc.lastAutoTable?.finalY ?? tableY);
  }

  if (egreRows.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Top categorías de gasto', 110, tableY);

    autoTable(doc, {
      startY: tableY + 4,
      head: [['Categoría', 'Monto']],
      body: egreRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [...RED], textColor: [...WHITE], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 245, 245] },
      columnStyles: { 1: { halign: 'right', textColor: [...RED] } },
      margin: { left: 110, right: 14 },
      tableWidth: 86,
    });
    tablesEndY = Math.max(tablesEndY, doc.lastAutoTable?.finalY ?? tableY);
  }

  // Cursor vertical tras el último bloque impreso (alertas → narrativa).
  let cursorY = tablesEndY;

  // ── Alerts ──────────────────────────────────────────────────────────────────
  if (payload.alerts && payload.alerts.length > 0) {
    let y = tablesEndY + 12;
    if (y > 260) { doc.addPage(); y = 20; }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Alertas del mes', 14, y);
    y += 6;

    for (const alert of payload.alerts) {
      // Mensaje completo: antes sólo se imprimía la primera línea.
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(alert.message, 168) as string[];
      const boxH = Math.max(10, 6 + lines.length * ALERT_LINE_MM);
      if (y + boxH > 280) { doc.addPage(); y = 20; }

      const col = alertColor(alert.severity);
      doc.setFillColor(...alertBackground(alert.severity));
      doc.setDrawColor(...col);
      doc.roundedRect(14, y, 182, boxH, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...col);
      doc.text(alertIcon(alert.severity), 17, y + 6.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...INK);
      lines.forEach((line, i) => doc.text(line, 23, y + 6.5 + i * ALERT_LINE_MM));
      y += boxH + 3;
    }
    cursorY = y;
  }

  // ── Narrative ───────────────────────────────────────────────────────────────
  if (payload.narrative) {
    let y = cursorY + 12;
    if (y > 240) { doc.addPage(); y = 20; }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Análisis del mes', 14, y);
    y += 6;

    const stripped = payload.narrative.replace(/[*#_`>]/g, '').trim();
    const lines = doc.splitTextToSize(stripped, 182) as string[];

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    for (const line of lines.slice(0, 60)) {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(line, 14, y);
      y += 5;
    }
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const pageCount: number = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(`1+1 Contabilidad Pyme · ${monthTitle}`, 14, 291);
    doc.text(`Pág. ${i} / ${pageCount}`, 185, 291, { align: 'right' });
  }

  return doc as jsPDF;
}
