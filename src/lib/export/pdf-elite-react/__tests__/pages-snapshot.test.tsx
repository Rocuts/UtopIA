// __tests__/pages-snapshot.test.tsx — minimal "renders without throwing + valid PDF" tests.
//
// We DO NOT snapshot full PDF bytes. The buffer would be huge, brittle, and
// flaky across font subsetting. We just verify:
//   1. Each page renders without throwing.
//   2. The resulting buffer starts with the PDF magic header `%PDF-1.`
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { Document, renderToBuffer } from '@react-pdf/renderer';
import type { EditorialReport } from '../types';
import { registerEditorialFonts } from '../fonts';

import { CoverPage } from '../pages/CoverPage';
import { SectionDivider } from '../pages/SectionDivider';
import { TocPage } from '../pages/TocPage';
import { DirectorLetter } from '../pages/DirectorLetter';
import { KPIGridPage } from '../pages/KPIGridPage';
import { WaterfallPnLPage } from '../pages/WaterfallPnLPage';
import { DialGaugePage } from '../pages/DialGaugePage';
import { OrbitalPillarsPage } from '../pages/OrbitalPillarsPage';
import { StatementsPages } from '../pages/StatementsPages';
import { NotesPage } from '../pages/NotesPage';
import { RecommendationsPage } from '../pages/RecommendationsPage';
import { NormativeAppendix } from '../pages/NormativeAppendix';
import { ClosingPage } from '../pages/ClosingPage';

// ─── Minimal stub fixture (ALL required IR fields filled) ────────────────────
const fixture: EditorialReport = {
  meta: {
    companyName: 'Acme Colombia S.A.S.',
    nit: '900.123.456-7',
    entityType: 'Pyme NIIF Grupo 2',
    fiscalPeriod: '2026',
    comparativePeriod: '2025',
    generatedAt: '2026-05-08',
    language: 'es',
  },
  cover: {
    title: 'Reporte NIIF',
    subtitle: 'Cierre 2026',
    accentArea: 'valor',
  },
  toc: {
    entries: [
      { label: 'TEMA 1: Estados', page: 5, uppercase: true },
      { label: 'Carta de la dirección', page: 3, uppercase: false },
      { label: 'TEMA 2: Notas', page: 12, uppercase: true },
      { label: 'TEMA 3: Recomendaciones', page: 18, uppercase: true },
    ],
  },
  directorLetter: {
    portrait: { kind: 'initials', initials: 'JR', areaAccent: 'valor' },
    bodyMarkdown:
      'Estimados accionistas:\n\nEl periodo cerró con resultados sólidos.\n\nLa estrategia se mantiene enfocada en NIIF Sección 17.\n\nSeguimos comprometidos con la transparencia.',
    citations: [{ label: 'NIIF Secc. 17' }, { label: 'Decreto 2420/2015' }],
    signerName: 'Vanessa Espinal',
    signerRole: 'Directora Financiera',
  },
  kpiGrid: {
    kpis: [
      {
        label: 'Ingresos',
        value: '$12.450M',
        unit: 'COP',
        deltaPct: 8.4,
        status: 'positive',
      },
      {
        label: 'EBITDA',
        value: '$2.300M',
        unit: 'COP',
        deltaPct: -2.1,
        status: 'warning',
      },
      {
        label: 'Margen neto',
        value: '11,2%',
        deltaPct: 1.5,
        status: 'positive',
      },
      { label: 'ROE', value: '15,8%', deltaPct: 0, status: 'neutral' },
    ],
  },
  waterfall: {
    items: [
      { label: 'Ingresos', amount: 12450000000, sign: 'pos' },
      { label: 'Costos', amount: 7200000000, sign: 'neg' },
      { label: 'Gastos', amount: 2900000000, sign: 'neg' },
      { label: 'Impuestos', amount: 850000000, sign: 'neg' },
      { label: 'Utilidad neta', amount: 1500000000, sign: 'total' },
    ],
  },
  dialGauges: {
    gauges: [
      {
        label: 'Liquidez',
        value: 1.8,
        min: 0,
        max: 3,
        thresholds: [1, 1.5, 2.5],
        areaAccent: 'valor',
        caption: 'Razón corriente',
      },
      {
        label: 'Endeudamiento',
        value: 0.4,
        min: 0,
        max: 1,
        thresholds: [0.3, 0.6, 0.9],
        areaAccent: 'escudo',
      },
    ],
  },
  pillars: {
    overall: 78,
    satellites: [
      {
        id: 'escudo',
        label: 'Escudo',
        score: 82,
        topKpi: 'Cobertura 1.6x',
        areaAccent: 'escudo',
      },
      {
        id: 'valor',
        label: 'Valor',
        score: 76,
        topKpi: 'EBITDA $2.3B',
        areaAccent: 'valor',
      },
      {
        id: 'verdad',
        label: 'Verdad',
        score: 88,
        topKpi: '0 hallazgos',
        areaAccent: 'verdad',
      },
      {
        id: 'futuro',
        label: 'Futuro',
        score: 65,
        topKpi: 'CAGR 12%',
        areaAccent: 'futuro',
      },
    ],
  },
  statements: {
    balance: {
      caption: 'Estado de situación financiera al 31-dic-2026',
      headers: ['Cuenta', '2026', '2025', 'Var %'],
      rows: [
        { account: 'Activos corrientes', cells: ['', '', ''] },
        { account: '  Efectivo', cells: ['$1.200M', '$900M', '+33%'] },
        {
          account: 'Total activos',
          cells: ['$15.000M', '$13.000M', '+15%'],
          emphasis: 'total',
        },
      ],
    },
    income: {
      headers: ['Cuenta', '2026'],
      rows: [
        { account: 'Ingresos', cells: ['$12.450M'] },
        {
          account: 'Utilidad neta',
          cells: ['$1.500M'],
          emphasis: 'total',
        },
      ],
    },
    cashFlow: {
      headers: ['Cuenta', '2026'],
      rows: [
        { account: 'Flujo operación', cells: ['$2.100M'] },
        { account: 'Flujo final', cells: ['$1.300M'], emphasis: 'total' },
      ],
    },
    equity: {
      headers: ['Cuenta', '2026'],
      rows: [
        { account: 'Capital', cells: ['$5.000M'] },
        { account: 'Total patrimonio', cells: ['$8.000M'], emphasis: 'total' },
      ],
    },
  },
  notes: {
    blocks: [
      {
        heading: 'Nota 1 - Bases de preparación',
        bodyMarkdown:
          'Los estados financieros se preparan bajo NIIF para Pymes.\n\nLa moneda funcional es el peso colombiano.',
        citations: [{ label: 'NIIF Secc. 3' }],
      },
    ],
  },
  recommendations: {
    items: [
      {
        title: 'Optimizar capital de trabajo',
        bodyMarkdown:
          'Reducir días de cartera a 45 mediante incentivos de pronto pago.',
        areaAccent: 'futuro',
      },
    ],
  },
  appendix: {
    adjustmentsTable: [
      {
        cuenta: '1305',
        descripcion: 'Provisión cartera vencida',
        ajuste: -45000000,
        norma: 'NIIF 9',
      },
    ],
    validationWarnings: ['Cuenta 1120 sin movimiento — verificar'],
    bindingTotalsBlock:
      'TOTAL ACTIVO: 15.000.000.000\nTOTAL PASIVO + PATRIM: 15.000.000.000\nDIFERENCIA: 0',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function renderPageToBuffer(
  pageElement: React.ReactElement,
): Promise<Buffer> {
  const docElement = <Document>{pageElement}</Document>;
  // renderToBuffer collects stream chunks into a real Node Buffer.
  return renderToBuffer(docElement);
}

function expectValidPdfHeader(buf: Buffer) {
  // A valid PDF starts with `%PDF-1.` (bytes 25 50 44 46 2D 31 2E)
  const head = buf.subarray(0, 7).toString('latin1');
  expect(head.startsWith('%PDF-1.')).toBe(true);
}

beforeAll(() => registerEditorialFonts());

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('pdf-elite-react · pages render valid PDF', () => {
  it('CoverPage', async () => {
    const buf = await renderPageToBuffer(<CoverPage doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('CoverPage (BLOQUEADO variant)', async () => {
    const blocked: EditorialReport = {
      ...fixture,
      meta: { ...fixture.meta, watermark: 'BLOQUEADO' },
    };
    const buf = await renderPageToBuffer(<CoverPage doc={blocked} />);
    expectValidPdfHeader(buf);
  });

  it('SectionDivider', async () => {
    const buf = await renderPageToBuffer(
      <SectionDivider
        areaAccent="valor"
        sectionTitle="Estados"
        sectionEmphasis="financieros"
      />,
    );
    expectValidPdfHeader(buf);
  });

  it('TocPage', async () => {
    const buf = await renderPageToBuffer(<TocPage doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('DirectorLetter', async () => {
    const buf = await renderPageToBuffer(<DirectorLetter doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('KPIGridPage', async () => {
    const buf = await renderPageToBuffer(<KPIGridPage doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('WaterfallPnLPage', async () => {
    const buf = await renderPageToBuffer(<WaterfallPnLPage doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('DialGaugePage', async () => {
    const buf = await renderPageToBuffer(<DialGaugePage doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('OrbitalPillarsPage (with pillars)', async () => {
    const page = <OrbitalPillarsPage doc={fixture} />;
    // Component returns null if pillars undefined; fixture has them.
    expect(page).not.toBeNull();
    const buf = await renderPageToBuffer(page);
    expectValidPdfHeader(buf);
  });

  it('OrbitalPillarsPage returns null when pillars undefined', () => {
    const noPillars: EditorialReport = { ...fixture, pillars: undefined };
    // Calling the component as a function (we can't render `null` into Document).
    const result = OrbitalPillarsPage({ doc: noPillars });
    expect(result).toBeNull();
  });

  it('StatementsPages renders 4 statement pages', async () => {
    const pages = StatementsPages({ doc: fixture });
    expect(pages.length).toBe(4);
    for (const p of pages) {
      const buf = await renderPageToBuffer(p);
      expectValidPdfHeader(buf);
    }
  });

  it('NotesPage renders one page per note block', async () => {
    const pages = NotesPage({ doc: fixture });
    expect(pages.length).toBe(fixture.notes.blocks.length);
    for (const p of pages) {
      const buf = await renderPageToBuffer(p);
      expectValidPdfHeader(buf);
    }
  });

  it('RecommendationsPage', async () => {
    const buf = await renderPageToBuffer(
      <RecommendationsPage doc={fixture} />,
    );
    expectValidPdfHeader(buf);
  });

  it('NormativeAppendix', async () => {
    const buf = await renderPageToBuffer(<NormativeAppendix doc={fixture} />);
    expectValidPdfHeader(buf);
  });

  it('ClosingPage', async () => {
    const buf = await renderPageToBuffer(<ClosingPage doc={fixture} />);
    expectValidPdfHeader(buf);
  });
});
