// Verificación sobre el PDF RENDERIZADO (texto extraído), no sólo sobre el IR:
//   reportes-export-05 — el dial imprime la cifra real ("10,00", "N/D"), no el
//                        valor recortado ("5.00") ni "0.00".
//   reportes-export-18 — los 12 KPIs compuestos aparecen en la página.
//   reportes-export-14 / -13 — fecha de corte, moneda y leyendas en los estados.
import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Document, renderToBuffer } from '@react-pdf/renderer';
import { registerEditorialFonts } from '../fonts';
import { DialGaugePage } from '../pages/DialGaugePage';
import { KPIGridPage } from '../pages/KPIGridPage';
import { StatementsPages } from '../pages/StatementsPages';
import type { EditorialReport, KpiCell } from '../types';
import {
  niifJsonToCashFlowTable,
  niifJsonToEquityTable,
} from '../compose-statements-from-json';
import {
  informeTresCortes,
  preprocesarTresCortes,
} from '@/lib/agents/financial/__fixtures__/tres-cortes-comparativo';

async function pdfText(el: React.ReactElement): Promise<string> {
  const buf = await renderToBuffer(<Document>{el}</Document>);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  // pdf-parse devuelve a veces U+0004 en lugar de la "A" de las fuentes
  // subconjunto en negrita: es un artefacto de extracción, no del PDF.
  return (await parser.getText()).text.replace(/[\u0000-\u0008]/g, 'A');
}

const pageCount = (text: string): number => Number((text.match(/-- \d+ of (\d+) --/) ?? [])[1] ?? 0);

const table = { headers: ['Cuenta', '2025'], rows: [{ account: 'TOTAL', cells: ['$1,00'], emphasis: 'total' as const }] };

function doc(over: Partial<EditorialReport> = {}): EditorialReport {
  return {
    meta: { companyName: 'Demo SAS', nit: '900', fiscalPeriod: '2025', generatedAt: '2026-09-01', language: 'es', niifGroup: 2 },
    cover: { title: 't', subtitle: 's', accentArea: 'valor' },
    toc: { entries: [] },
    directorLetter: { portrait: { kind: 'initials', initials: 'EU', areaAccent: 'valor' }, bodyMarkdown: '', citations: [], signerName: 'x', signerRole: 'y' },
    kpiGrid: { kpis: [] },
    waterfall: { items: [] },
    dialGauges: { gauges: [] },
    statements: { balance: table, income: table, cashFlow: table, equity: table },
    notes: { blocks: [] },
    recommendations: { items: [] },
    appendix: {},
    signatureBlock: { rendered: '' },
    ...over,
  } as EditorialReport;
}

beforeAll(() => {
  registerEditorialFonts();
});

describe('PDF renderizado — diales, KPIs y estados', () => {
  it('reportes-export-05: el dial imprime la cifra real y N/D, no el recorte ni 0', async () => {
    const text = await pdfText(
      <DialGaugePage
        doc={doc({
          dialGauges: {
            gauges: [
              { label: 'Razón Corriente', value: 5, displayValue: '10,00', outOfScale: true, min: 0, max: 5, thresholds: [1, 1.5, 2.5], areaAccent: 'escudo' },
              { label: 'Prueba Ácida', value: 0, displayValue: 'N/D', noData: true, min: 0, max: 3, thresholds: [0.7, 1, 2], areaAccent: 'escudo', caption: 'Sin dato' },
              { label: 'Endeudamiento', value: 0.1, displayValue: '10,0%', min: 0, max: 1, thresholds: [0.3, 0.5, 0.7], areaAccent: 'verdad' },
            ],
          },
        })}
      />,
    );
    expect(text).toContain('10,00');
    expect(text).toContain('N/D');
    expect(text).toContain('10,0%');
    expect(text).not.toContain('5.00');
    expect(text).not.toContain('0.10');
  }, 30_000);

  it('reportes-export-18: los 13 KPIs posibles aparecen, agrupados por categoría, en una sola página', async () => {
    const cats: Array<KpiCell['category']> = [
      'estructura', 'estructura', 'estructura',
      'resultados', 'resultados', 'resultados', 'resultados',
      'rentabilidad', 'rentabilidad', 'rentabilidad',
      'liquidez', 'liquidez', 'liquidez',
    ];
    const kpis: KpiCell[] = cats.map((category, i) => ({
      label: `KPI${String(i + 1).padStart(2, '0')}`,
      value: '$1.880.000.000,00',
      note: '△ sobre patrimonio de cierre (sin promedio con el comparativo)',
      category,
    }));
    const text = await pdfText(<KPIGridPage doc={doc({ kpiGrid: { kpis } })} />);
    for (const k of kpis) expect(text).toContain(k.label);
    expect(text.replace(/\s+/g, '')).toMatch(/LIQUIDEZYSOLVENCI/i);
    expect(text.replace(/\s+/g, '')).not.toMatch(/EFICIENCIA/i);
    expect(pageCount(text)).toBe(1);
  }, 30_000);

  it('reportes-export-14 / -13: fecha de corte, moneda y leyenda de comparativo en los estados', async () => {
    const t = {
      ...table,
      subtitle: 'Al 31 de diciembre de 2025',
      currencyNote: 'Cifras expresadas en pesos colombianos (COP), con centavos',
      legends: ['Información comparativa 2024 no presentada en este estado'],
    };
    const pages = StatementsPages({ doc: doc({ statements: { balance: t, income: t, cashFlow: t, equity: t } }) });
    const text = await pdfText(<>{pages}</>);
    expect(text).toContain('31 de diciembre de 2025'); // la "A" inicial en negrita a veces no se extrae
    expect(text).toContain('pesos colombianos (COP)');
    expect(text).toContain('comparativa 2024 no presentada');
    expect(text).toContain('NIIF PYMES Secc. 7');
    expect(text).not.toMatch(/NIIF 7\b(?!\.)/);
  }, 30_000);

  it('pendiente #3: el EFE imprime la columna comparativa y el ECP los dos periodos (tres cortes)', async () => {
    const json = informeTresCortes(preprocesarTresCortes());
    const cashFlow = niifJsonToCashFlowTable(json);
    const equity = niifJsonToEquityTable(json);
    const pages = StatementsPages({ doc: doc({ statements: { balance: table, income: table, cashFlow, equity } }) });
    const text = await pdfText(<>{pages}</>);
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/2025 2024/); // encabezado del EFE: actual | comparativo
    expect(flat).toContain('$15.000.000,00'); // variación neta 2024
    expect(flat).toContain('PERIODO 2024');
    expect(flat).toContain('PERIODO 2025');
    expect(flat).not.toContain('no presentada');
  }, 30_000);
});
