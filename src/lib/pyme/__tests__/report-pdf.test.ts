// reportes-export-22 — informe mensual Pyme (reportPDF.ts).
//   - El margen se imprimía '12.5%' (punto decimal) y, sin ingresos, '0.0%' en
//     verde: la API entrega margenPct = 0 cuando ingresos = 0.
//   - Las alertas sólo imprimían la primera línea y el ícono '⚠' no existe en
//     helvetica (WinAnsi).
//   - Con jspdf-autotable v5 `doc.autoTable` no existe (el import por efecto
//     secundario ya no parchea jsPDF): el PDF fallaba al dibujar las tablas.
import { describe, expect, it } from 'vitest';

import type { MonthlyReportPayload } from '@/components/workspace/pyme/types';

import {
  alertIcon,
  formatPymeCop,
  formatPymeMargin,
  generateMonthlyReportPDF,
} from '../reportPDF';

function payload(over: Partial<MonthlyReportPayload['summary']['totals']> = {}, extra: Partial<MonthlyReportPayload> = {}): MonthlyReportPayload {
  const totals = { ingresos: 8_000_000, egresos: 7_000_000, margen: 1_000_000, margenPct: 0.125, ...over };
  return {
    bookId: 'b-1',
    year: 2026,
    month: 3,
    summary: {
      bookId: 'b-1',
      year: 2026,
      month: 3,
      totals,
      topIngresoCategories: [{ category: 'Ventas', amount: totals.ingresos }],
      topEgresoCategories: [{ category: 'Arriendo', amount: totals.egresos }],
      previous: null,
      entryCount: 4,
    },
    narrative: 'Mes estable.',
    alerts: [],
    generatedAt: '2026-04-01T00:00:00Z',
    ...extra,
  };
}

/** Textos dibujados con el operador Tj (jsPDF sin compresión). */
function pdfTexts(p: MonthlyReportPayload): string[] {
  const out = generateMonthlyReportPDF(p).output();
  return (out.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g) ?? []).map((t) =>
    t.replace(/\)\s*Tj$/, '').slice(1).replace(/\\([()\\])/g, '$1'),
  );
}

describe('formatPymeMargin', () => {
  it('coma decimal es-CO', () => {
    expect(formatPymeMargin({ ingresos: 8_000_000, margen: 1_000_000, margenPct: 0.125 })).toEqual({
      text: '12,5%',
      tone: 'positive',
    });
    expect(formatPymeMargin({ ingresos: 1_000, margen: -250, margenPct: -0.25 }).text).toBe('-25,0%');
  });
  it('sin ingresos el margen es N/D neutro, no 0 % en verde', () => {
    expect(formatPymeMargin({ ingresos: 0, margen: -500_000, margenPct: 0 })).toEqual({
      text: 'N/D',
      tone: 'neutral',
    });
  });
});

describe('formatPymeCop', () => {
  it('pesos enteros sin decimales y centavos cuando existen; negativos entre paréntesis', () => {
    expect(formatPymeCop(1_234_567)).toBe('$1.234.567');
    expect(formatPymeCop(500_000.5)).toBe('$500.000,50');
    expect(formatPymeCop(-500_000)).toBe('($500.000)');
    expect(formatPymeCop(Number.NaN)).toBe('N/D');
  });
});

describe('generateMonthlyReportPDF', () => {
  it('dibuja las tablas de categorías (autoTable v5) y el margen con coma', () => {
    const texts = pdfTexts(payload());
    expect(texts).toContain('Ventas');
    expect(texts).toContain('Arriendo');
    expect(texts).toContain('12,5%');
    expect(texts.join(' ')).not.toMatch(/\d\.\d%/);
  });

  it('sin ingresos imprime N/D en el margen', () => {
    const texts = pdfTexts(payload({ ingresos: 0, egresos: 500_000, margen: -500_000, margenPct: 0 }));
    const i = texts.indexOf('MARGEN');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(texts[i + 1]).toBe('N/D');
    expect(texts).not.toContain('0.0%');
    expect(texts).not.toContain('0,0%');
  });

  it('imprime el mensaje completo de cada alerta y sin el glifo ⚠', () => {
    const long = `${'Los egresos subieron frente al mes anterior. '.repeat(8)}FIN-DEL-MENSAJE`;
    const texts = pdfTexts(
      payload({}, { alerts: [{ severity: 'warning', message: long }, { severity: 'critical', message: 'Mes en pérdida.' }] }),
    );
    const joined = texts.join(' ');
    expect(joined).toContain('FIN-DEL-MENSAJE');
    expect(joined).toContain('Mes en pérdida.');
    expect(joined).not.toContain('⚠');
  });

  it('íconos de alerta dentro de WinAnsi', () => {
    for (const sev of ['info', 'warning', 'critical'] as const) {
      expect(alertIcon(sev)).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
