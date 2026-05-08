// route-integration.test.ts — exercises the export route's pdf-elite branch
// in-process by mocking the orchestrator. Asserts content-type and PDF magic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the orchestrator so the test never touches OpenAI.
vi.mock('@/lib/agents/financial/orchestrator', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agents/financial/orchestrator')
  >('@/lib/agents/financial/orchestrator');
  return {
    ...actual,
    orchestrateFinancialReport: vi.fn(),
  };
});

// Mock pillars aggregation — we don't need real numbers for a smoke render.
vi.mock('@/lib/pillars/service', () => {
  return {
    aggregatePillars: vi.fn(() => null),
  };
});

import { orchestrateFinancialReport, BalanceValidationError } from '@/lib/agents/financial/orchestrator';
import { POST } from '@/app/api/financial-report/export/route';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { registerEditorialFonts } from '../fonts';

const mockedOrchestrate = vi.mocked(orchestrateFinancialReport);

function buildHappyReport(): FinancialReport {
  return {
    company: {
      name: 'Demo SAS',
      nit: '900123456-7',
      entityType: 'SAS',
      fiscalPeriod: '2026',
    },
    niifAnalysis: {
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

const validBody = {
  rawData: 'Codigo,Nombre,Saldo\n1,Activo,1000000000\n',
  company: {
    name: 'Demo SAS',
    nit: '900123456-7',
    entityType: 'SAS',
    fiscalPeriod: '2026',
  },
  language: 'es' as const,
  format: 'pdf-elite' as const,
};

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
    mockedOrchestrate.mockResolvedValueOnce(buildHappyReport());

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

  it('still returns a PDF when the orchestrator throws BalanceValidationError', async () => {
    mockedOrchestrate.mockImplementationOnce(async () => {
      throw new BalanceValidationError(
        ['Activo != Pasivo + Patrimonio'],
        ['1105', '3605'],
      );
    });

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
});
