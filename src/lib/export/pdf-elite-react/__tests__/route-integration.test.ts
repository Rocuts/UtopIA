import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
// route-integration.test.ts — exercises the export route's pdf-elite branch
// in-process by mocking the orchestrator. Asserts content-type and PDF magic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/db/financial-report-versions', () => ({
  requireReportWorkspace: async () => ({}),
  loadFinancialVersion: vi.fn(),
  ReportVersionError: class extends Error {},
}));
import { loadFinancialVersion } from '@/lib/db/financial-report-versions';

// Mock pillars aggregation — we don't need real numbers for a smoke render.
vi.mock('@/lib/pillars/service', () => {
  return {
    aggregatePillars: vi.fn(() => null),
  };
});

import { POST } from '@/app/api/financial-report/export/route';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { registerEditorialFonts } from '../fonts';

const mockedLoad = vi.mocked(loadFinancialVersion);

function buildHappyReport(): FinancialReport {
  return {
    company: {
      name: 'Demo SAS',
      nit: '900123456-7',
      entityType: 'SAS',
      fiscalPeriod: '2026',
    },
    niifAnalysis: {
      ...makeExportableReport().niifAnalysis,
      balanceSheet:
        '## Balance\n\n| Cuenta | 2026 |\n|---|---|\n| Activo | $1.000.000.000 |\n',
      incomeStatement:
        '## Resultado\n\n| Cuenta | 2026 |\n|---|---|\n| Ingresos | $1.500.000.000 |\n',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: 'Resumen ejecutivo bajo NIIF Secc. 17.',
    },
    strategicAnalysis: {
      kpiDashboard: '',
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '1. **Mejorar caja**\n   Detalle.\n',
      fullContent: 'Análisis estratégico (Art. 240 ET).',
    },
    governance: {
      financialNotes: '## Nota 1\nBajo Decreto 2420/2015.',
      shareholderMinutes: '',
      fullContent: 'Gobierno corporativo Ley 222/1995.',
    },
    consolidatedReport: '# REPORTE\n\nContenido consolidado.',
    generatedAt: '2026-05-08T12:00:00.000Z',
  };
}

const validBody = { reportVersionId: '11111111-1111-4111-8111-111111111111', format: 'pdf-elite' };

async function bodyStartsWithPdfMagic(res: Response): Promise<boolean> {
  const ab = await res.arrayBuffer();
  const head = new Uint8Array(ab.slice(0, 5));
  // "%PDF-"
  return (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  );
}

beforeAll(() => {
  registerEditorialFonts();
});

describe('POST /api/financial-report/export — pdf-elite branch', () => {
  it('returns a real PDF stream on the happy path', async () => {
    mockedLoad.mockResolvedValueOnce({ stage: 'complete', report: buildHappyReport(), preprocessed: null, language: 'es' } as never);

    const req = new Request('http://localhost/api/financial-report/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(await bodyStartsWithPdfMagic(res)).toBe(true);
  }, 60_000);

  it('does not render a PDF from a persisted report with blocking qualifications', async () => {
    const report = buildHappyReport();
    report.niifAnalysis.reconciliation!.clean = false;
    mockedLoad.mockResolvedValueOnce({ stage: 'complete', report, preprocessed: null } as never);
    const res = await POST(new Request('http://localhost/api/financial-report/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody),
    }));
    expect(res.status).toBe(422);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});
