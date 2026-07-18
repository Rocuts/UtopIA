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
import 'jspdf-autotable';
import type { MonthlyReportPayload, MonthlyAlert } from '@/components/workspace/pyme/types';

// Colour constants
const GREEN_DARK = [26, 46, 13] as const;
const GREEN_MID = [53, 122, 40] as const;
const GREEN_LIGHT = [240, 247, 234] as const;
const WHITE = [255, 255, 255] as const;
const GREY = [180, 180, 180] as const;
const RED = [168, 56, 56] as const;
const AMBER = [196, 138, 46] as const;

function fmtCOP(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(v);
}

function alertIcon(sev: MonthlyAlert['severity']): string {
  if (sev === 'critical') return '!';
  if (sev === 'warning') return '⚠';
  return 'i';
}

function alertColor(sev: MonthlyAlert['severity']): readonly [number, number, number] {
  if (sev === 'critical') return RED;
  if (sev === 'warning') return AMBER;
  return GREEN_MID;
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
  const kpis = [
    { label: 'Total vendí', value: fmtCOP(totals.ingresos), positive: true },
    { label: 'Total gasté', value: fmtCOP(totals.egresos), positive: false },
    { label: 'Me quedó', value: fmtCOP(totals.margen), positive: totals.margen >= 0 },
    { label: 'Margen', value: `${(totals.margenPct * 100).toFixed(1)}%`, positive: totals.margenPct >= 0 },
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
    doc.setTextColor(...(kpi.positive ? GREEN_DARK : RED));
    doc.text(kpi.value, x + 3, 71);
  });

  if (previous) {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...GREY);
    const prevText = `Mes anterior: ingresos ${fmtCOP(previous.ingresos)} · margen ${fmtCOP(previous.margen)}`;
    doc.text(prevText, 14, 83);
  }

  // ── Categories tables ───────────────────────────────────────────────────────
  const tableY = previous ? 90 : 84;

  const ingrRows = payload.summary.topIngresoCategories.map((c) => [c.category, fmtCOP(c.amount)]);
  const egreRows = payload.summary.topEgresoCategories.map((c) => [c.category, fmtCOP(c.amount)]);

  if (ingrRows.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Top categorías de ingreso', 14, tableY);

    doc.autoTable({
      startY: tableY + 4,
      head: [['Categoría', 'Monto']],
      body: ingrRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: GREEN_MID, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: GREEN_LIGHT },
      columnStyles: { 1: { halign: 'right', textColor: GREEN_DARK } },
      margin: { left: 14, right: 110 },
      tableWidth: 86,
    });
  }

  if (egreRows.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Top categorías de gasto', 110, tableY);

    const ingrFinalY = ingrRows.length > 0
      ? doc.lastAutoTable.finalY
      : tableY + 4;

    doc.autoTable({
      startY: tableY + 4,
      head: [['Categoría', 'Monto']],
      body: egreRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: RED, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 245, 245] as const },
      columnStyles: { 1: { halign: 'right', textColor: RED } },
      margin: { left: 110, right: 14 },
      tableWidth: 86,
    });

    void ingrFinalY; // used above for potential future alignment
  }

  // ── Alerts ──────────────────────────────────────────────────────────────────
  const alertStartY = doc.lastAutoTable?.finalY ?? tableY + 50;

  if (payload.alerts && payload.alerts.length > 0) {
    let y = alertStartY + 12;
    if (y > 260) { doc.addPage(); y = 20; }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GREEN_DARK);
    doc.text('Alertas del mes', 14, y);
    y += 6;

    for (const alert of payload.alerts) {
      const col = alertColor(alert.severity);
      doc.setFillColor(col[0], col[1], col[2], 0.08);
      doc.setDrawColor(...col);
      doc.roundedRect(14, y, 182, 10, 1, 1, 'FD');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...col);
      doc.text(alertIcon(alert.severity), 18, y + 6.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      const lines = doc.splitTextToSize(alert.message, 168) as string[];
      doc.text(lines[0] ?? '', 23, y + 6.5);
      y += 13;

      if (y > 265) { doc.addPage(); y = 20; }
    }
  }

  // ── Narrative ───────────────────────────────────────────────────────────────
  if (payload.narrative) {
    const narrativeY = (doc.lastAutoTable?.finalY ?? tableY + 50) + (payload.alerts?.length ? payload.alerts.length * 13 + 24 : 12);
    let y = Math.max(narrativeY, 130);
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
