// reportes-export-21 (remanente) — paginación, índice y páginas en blanco del
// PDF Élite, verificados sobre el PDF RENDERIZADO (texto extraído por página):
//   - PaginationFooter / PageNumberBadge imprimían "00 / 00" (pageNumber={0})
//     o un índice por sección ("1", "1", "1"…): ahora, la página real;
//   - la tabla de contenido no tenía números: ahora, la página real de cada
//     sección presente, en orden y con los TEMA renumerados;
//   - la contraportada desbordaba y react-pdf emitía páginas en blanco antes de
//     ella; el balance dejaba otra casi vacía por un absoluto en el margen;
//   - la contraportada decía "Colombia 2026" fijo;
//   - Notas, Recomendaciones y Anexo salían en vertical (595×842) en un
//     documento apaisado.
import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Readable } from 'node:stream';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';

import { composeEditorialReport, renderEditorialReportToStream } from '../index';
import { registerEditorialFonts } from '../fonts';
import { resolveTocEntries } from '../toc';
import { closingCredit } from '../pages/ClosingPage';
import { PageNumberBadge, PaginationFooter } from '../primitives';
import type { EditorialReport, TocAnchorId, TocEntry } from '../types';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';

async function streamToBuffer(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

interface RenderedPdf {
  pages: string[];
  mediaBoxes: Array<[number, number]>;
}

async function render(doc: EditorialReport): Promise<RenderedPdf> {
  const buf = await streamToBuffer(await renderEditorialReportToStream(doc));
  const mediaBoxes = [...buf.toString('latin1').matchAll(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as [number, number],
  );
  const { PDFParse } = await import('pdf-parse');
  const res = await new PDFParse({ data: new Uint8Array(buf) }).getText();
  // pdf-parse devuelve a veces U+0004 en lugar de la "A" de las fuentes subconjunto en negrita.
  return { pages: res.pages.map((p: { text: string }) => p.text.replace(/[\u0000-\u0008]/g, 'A')), mediaBoxes };
}

const compact = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Texto de la página sin espacios, dígitos ni barras: lo que queda sin el número de página. */
const withoutPageNumber = (s: string) => s.replace(/[\s\d/]+/g, '');

function composeFixture(over: Partial<EditorialReport> = {}): EditorialReport {
  const doc = composeEditorialReport({
    report: makeExportableReport(),
    preprocessed: null,
    pillars: null,
    language: 'es',
  });
  return { ...doc, ...over };
}

beforeAll(() => registerEditorialFonts());

describe('PDF Élite renderizado — paginación y páginas en blanco (reportes-export-21)', () => {
  let pdf: RenderedPdf;
  beforeAll(async () => {
    pdf = await render(composeFixture());
  }, 60_000);

  it('ninguna página imprime "00 / 00" y el pie lleva el número real y el total', () => {
    const total = pdf.pages.length;
    expect(total).toBeGreaterThan(5);
    let conPie = 0;
    pdf.pages.forEach((text, i) => {
      expect(text).not.toMatch(/\b00\s*\/\s*00\b/);
      const m = /\b(\d{2})\s*\/\s*(\d{2})\b/.exec(text);
      if (m) {
        conPie++;
        expect({ page: i + 1, footer: [Number(m[1]), Number(m[2])] }).toEqual({ page: i + 1, footer: [i + 1, total] });
      }
    });
    // Carta, índice, separador, recomendaciones, anexo y contraportada.
    expect(conPie).toBeGreaterThanOrEqual(5);
  });

  it('las páginas con insignia circular imprimen su número real, no 0 ni un índice por sección', () => {
    // KPIs, estados, cascada y diales llevan PageNumberBadge: su página tiene
    // una línea con el número exacto.
    const conInsignia = pdf.pages
      .map((text, i) => ({ i: i + 1, text }))
      .filter(({ text }) => /Indicadores clave|ESTADO DE|CAMBIOS EN EL PATRIMONIO|Composición del Resultado|Indicadores de salud/.test(text));
    expect(conInsignia.length).toBeGreaterThanOrEqual(7);
    for (const { i, text } of conInsignia) {
      const lines = text.split('\n').map((l) => l.trim());
      expect({ page: i, has: lines.includes(String(i)) }).toEqual({ page: i, has: true });
    }
  });

  it('no hay páginas en blanco ni páginas con sólo el número', () => {
    pdf.pages.forEach((text, i) => {
      expect({ page: i + 1, chars: withoutPageNumber(text).length >= 20 }).toEqual({ page: i + 1, chars: true });
    });
  });

  it('la tabla de contenido numera cada sección con la página en la que empieza', () => {
    const tocIndex = pdf.pages.findIndex((t) => /T\s*A\s*B\s*L\s*A\s+D\s*E\s+C\s*O\s*N\s*T\s*E\s*N\s*I\s*D\s*O/.test(t));
    expect(tocIndex).toBeGreaterThan(0);
    const toc = pdf.pages[tocIndex];
    const pageOf = (label: RegExp): number => {
      const line = toc.split('\n').find((l) => label.test(l));
      const m = line ? /(\d+)\s*$/.exec(line.trim()) : null;
      return m ? Number(m[1]) : NaN;
    };
    const checks: Array<[RegExp, RegExp]> = [
      [/Carta del director/i, /Mensaje del Socio Director/],
      [/INDICADORES CLAVE/i, /Indicadores clave del período/],
      // Integración I4: la entrada apunta al separador "Estados financieros",
      // no a la página del ESF que le sigue.
      [/ESTADOS FINANCIEROS/i, /^(?![\s\S]*ESTADO DE SITUACIÓN FINANCIERA)[\s\S]*Estados\s+financieros/],
      [/CASCADA DE UTILIDAD/i, /Composición del Resultado Neto/],
      [/DIALES DE SALUD/i, /Indicadores de salud financiera/],
      [/RECOMENDACIONES/i, /H\s*O\s*J\s*A\s+D\s*E\s+R\s*U\s*T\s*A/],
      [/Apéndice normativo/i, /Anexo Normativo/],
    ];
    for (const [entry, pageMarker] of checks) {
      const page = pageOf(entry);
      expect({ entry: entry.source, page, marker: pdf.pages[page - 1] ? pageMarker.test(pdf.pages[page - 1]) : false }).toEqual({
        entry: entry.source,
        page,
        marker: true,
      });
    }
    // Sin secciones inexistentes ni guiones de marcador; TEMA 1..N sin saltos.
    expect(toc).not.toMatch(/Resumen ejecutivo/);
    expect(toc.split('\n').filter((l) => /—\s*$/.test(l))).toEqual([]);
    const temas = [...toc.matchAll(/TEMA (\d+)/g)].map((m) => Number(m[1]));
    expect(temas).toEqual(temas.map((_, i) => i + 1));
  });

  it('la contraportada cabe en una página y cita el año del ejercicio, no "Colombia 2026"', () => {
    const closing = pdf.pages[pdf.pages.length - 1];
    expect(closing).toMatch(/Gracias por confiar/);
    expect(compact(closing)).toContain('Ejercicio 2025');
    expect(compact(pdf.pages.join('\n'))).not.toMatch(/Colombia 2026/);
    // La firma y el aviso legal van en la misma página que el título.
    expect(closing).toMatch(/Revisor Fiscal/);
    expect(closing).toMatch(/Ley 43\/1990/);
  });

  it('todas las páginas son A4 apaisado (Notas, Recomendaciones y Anexo incluidas)', () => {
    expect(pdf.mediaBoxes.length).toBe(pdf.pages.length);
    for (const [w, h] of pdf.mediaBoxes) {
      expect(Math.round(w)).toBe(842);
      expect(Math.round(h)).toBe(595);
    }
  });
});

describe('Índice con secciones omitidas por el toggle del intake', () => {
  it('sin tablero de KPIs, el índice omite la sección y renumera los TEMA', async () => {
    const pdf = await render(
      composeFixture({
        outputOptions: {
          financialStatements: true,
          kpiDashboard: false,
          cashFlowProjection: true,
          breakevenAnalysis: true,
          notesToFinancialStatements: true,
          shareholdersMinutes: true,
          auditPipeline: true,
          metaAudit: true,
        } as EditorialReport['outputOptions'],
      }),
    );
    const toc = pdf.pages.find((t) => /T\s*A\s*B\s*L\s*A\s+D\s*E/.test(t)) ?? '';
    expect(toc).not.toMatch(/INDICADORES CLAVE|CASCADA DE UTILIDAD|DIALES DE SALUD/i);
    expect(toc).toMatch(/TEMA 1: ESTADOS FINANCIEROS/i);
    expect(toc).toMatch(/TEMA 2: RECOMENDACIONES/i);
  }, 60_000);
});

describe('resolveTocEntries', () => {
  const e = (label: string, anchor: TocAnchorId | undefined, uppercase = true): TocEntry => ({
    label,
    page: 1,
    uppercase,
    ...(anchor ? { anchor } : {}),
  });
  const entries = [
    e('Carta del director', 'director', false),
    e('TEMA 1: Indicadores clave', 'kpi'),
    e('TEMA 2: Estados financieros', 'statements'),
    e('TEMA 3: Pilares', 'pillars'),
    e('TEMA 4: Notas', 'notes'),
    e('Sin ancla', undefined, false),
  ];

  it('numera con la página real, omite lo que no se imprimió y renumera los TEMA en orden de página', () => {
    const pages = new Map<TocAnchorId, number>([
      ['director', 2],
      ['kpi', 4],
      ['statements', 6],
      ['notes', 12],
    ]);
    expect(resolveTocEntries(entries, pages).map((x) => [x.label, x.page])).toEqual([
      ['Carta del director', 2],
      ['TEMA 1: Indicadores clave', 4],
      ['TEMA 2: Estados financieros', 6],
      ['TEMA 3: Notas', 12],
    ]);
  });

  it('ordena por página aunque el orden de la lista sea otro', () => {
    const pages = new Map<TocAnchorId, number>([
      ['kpi', 9],
      ['statements', 5],
    ]);
    expect(resolveTocEntries(entries, pages).map((x) => x.label)).toEqual([
      'TEMA 1: Estados financieros',
      'TEMA 2: Indicadores clave',
    ]);
  });

  it('sin anclas medidas deja las entradas como estaban', () => {
    expect(resolveTocEntries(entries, new Map())).toEqual(entries);
  });
});

describe('closingCredit', () => {
  it('usa el año del ejercicio y no afirma ninguno si no lo hay', () => {
    expect(closingCredit('2025')).toMatch(/Colombia · Ejercicio 2025$/);
    expect(closingCredit('2024-06')).toMatch(/Ejercicio 2024$/);
    expect(closingCredit('')).not.toMatch(/\d{4}/);
  });
});

describe('PaginationFooter / PageNumberBadge con número fijo (vista aislada)', () => {
  it('imprime el número dado; 0 u omitido usa el número real del documento', async () => {
    const buf = await renderToBuffer(
      <Document>
        <Page size="A4" orientation="landscape">
          <PaginationFooter pageNumber={3} totalPages={42} sectionLabel="Tema" />
        </Page>
        <Page size="A4" orientation="landscape">
          <PaginationFooter pageNumber={0} totalPages={0} sectionLabel="Tema" />
          <PageNumberBadge pageNumber={7} right={200} />
        </Page>
      </Document>,
    );
    const { PDFParse } = await import('pdf-parse');
    const pages = (await new PDFParse({ data: new Uint8Array(buf) }).getText()).pages.map((p: { text: string }) =>
      compact(p.text),
    );
    expect(pages[0]).toMatch(/03 ?\/ ?42/);
    expect(pages[1]).toMatch(/02 ?\/ ?02/);
    expect(pages[1]).toMatch(/\b7\b/);
  }, 30_000);
});
