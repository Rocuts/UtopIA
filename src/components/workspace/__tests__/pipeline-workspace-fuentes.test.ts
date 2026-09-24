// IW5a — contratos cliente → servidor del pipeline NIIF (auditoría 2026-09-24).
//
//   · pipeline-flujo-07: las exportaciones envían el preprocesado que usó /niif
//     (o el ledger del Doctor de Datos); sin ellos /export re-deriva el balance
//     ORIGINAL y rechaza (422) un informe con ajustes.
//   · pipeline-flujo-10 / -17: el HTML viaja con el preprocesado y su periodo
//     sale del balance, no de AAAA-01-01 / AAAA-12-31 fijos.
//   · pipeline-flujo-03: el preprocesado sobrevive a la recarga para reanudar
//     Gobierno sin que el acta con cifras quede sellada por falta de anclas.
//   · pipeline-flujo-05: la Parte II con salvedades apaga las descargas igual
//     que el acta con salvedades.
//   · auditoria-calidad-07 / -11: la Parte IV y la meta-auditoría reciben el
//     informe completo (Partes I-III) y el preprocesado.
//   · tributario-modulos-02: el contexto fiscal no rotula F04 como neto a
//     pagar / saldo a favor.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  buildFiscalContextBlock,
  exportSourceFields,
  derivePeriodBounds,
  foldReportQualifications,
  runAuditInBackground,
  buildQualityRequestBody,
  persistPreprocessedForResume,
  recallPreprocessedForResume,
  clearPreprocessedForResume,
} from '../PipelineWorkspace';
import { makeFiscalSnapshot } from '@/lib/ancora/__tests__/ancora.fixture';
import type {
  CompanyInfo,
  FinancialReport,
  FiscalSnapshot,
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';

const company = {
  name: 'Empresa Prueba SAS',
  nit: '900123456-1',
  entityType: 'SAS',
  fiscalPeriod: '2024',
} as CompanyInfo;

function niif(overrides: Partial<NiifAnalysisResult> = {}): NiifAnalysisResult {
  return {
    balanceSheet: '',
    incomeStatement: '',
    cashFlowStatement: '',
    equityChangesStatement: '',
    technicalNotes: '',
    fullContent: 'PARTE I — NIIF',
    reconciliation: { deviations: [], lineGaps: [], repairAttempted: false, clean: true },
    ...overrides,
  } as NiifAnalysisResult;
}

function strategy(extra: Record<string, unknown> = {}): StrategicAnalysisResult {
  return {
    kpiDashboard: '',
    breakEvenAnalysis: '',
    projectedCashFlow: '',
    strategicRecommendations: '',
    fullContent: 'PARTE II — ESTRATEGIA',
    ...extra,
  } as StrategicAnalysisResult;
}

function governance(extra: Record<string, unknown> = {}): GovernanceResult {
  return {
    financialNotes: '',
    shareholderMinutes: '',
    fullContent: 'PARTE III — ACTA',
    ...extra,
  } as GovernanceResult;
}

function fullReport(): FinancialReport {
  return {
    company,
    niifAnalysis: niif(),
    strategicAnalysis: strategy(),
    governance: governance(),
    consolidatedReport: 'PARTE I — NIIF\n\nPARTE II — ESTRATEGIA\n\nPARTE III — ACTA',
    generatedAt: '2026-09-24T00:00:00.000Z',
  };
}

const preprocessed = {
  primary: { period: '2024', periodoTipo: 'indeterminado', controlTotals: { activo: 100 } },
  periods: [{ period: '2024', summary: { equationBalanced: true } }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contexto fiscal automático (tributario-modulos-02)', () => {
  const snap = {
    ...makeFiscalSnapshot(),
    anchor: { ...makeFiscalSnapshot().anchor, alertas: [] },
  } as unknown as FiscalSnapshot;

  it('F04 es posición de referencia contable, no neto a pagar ni saldo a favor', () => {
    const es = buildFiscalContextBlock(snap, company, 'es');
    expect(es).toContain('F04 Posición de referencia contable (estimación, no liquidación)');
    expect(es).not.toMatch(/Neto a Pagar|Saldo a Favor/i);

    const en = buildFiscalContextBlock(snap, company, 'en');
    expect(en).toContain('F04 Accounting reference position (estimate, not an assessment)');
    expect(en).not.toMatch(/Neto a Pagar|Saldo a Favor/i);
  });
});

describe('exportSourceFields (pipeline-flujo-07)', () => {
  const ledger = {
    adjustments: [
      {
        id: 'a1',
        accountCode: '1105',
        accountName: 'Caja',
        amount: 1000,
        rationale: 'ajuste',
        status: 'applied' as const,
        proposedAt: '2026-09-24T00:00:00.000Z',
      },
    ],
  };

  it('prefiere el preprocesado de /niif (ya ajustado)', () => {
    expect(exportSourceFields(preprocessed, ledger)).toEqual({ preprocessed });
  });

  it('sin preprocesado envía el ledger con ajustes aplicados', () => {
    expect(exportSourceFields(null, ledger)).toEqual({ adjustmentLedger: ledger });
  });

  it('sin fuentes no inventa campos', () => {
    expect(exportSourceFields(null, null)).toEqual({});
    expect(exportSourceFields(undefined, { adjustments: [] })).toEqual({});
  });
});

describe('derivePeriodBounds (pipeline-flujo-17)', () => {
  it('año solo: ejercicio completo', () => {
    expect(derivePeriodBounds({ primary: { period: '2024' } }, '2025')).toEqual({
      periodYear: '2024',
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
    });
  });

  it('corte AAAA-MM: cierra en el último día de ese mes', () => {
    expect(
      derivePeriodBounds({ primary: { period: '2025-06', periodoTipo: 'parcial' } }, '2025'),
    ).toEqual({ periodYear: '2025', periodStart: '2025-01-01', periodEnd: '2025-06-30' });
    expect(derivePeriodBounds({ primary: { period: '2024-02' } }, null).periodEnd).toBe(
      '2024-02-29',
    );
  });

  it('mes textual: toma el último mes del rótulo', () => {
    expect(derivePeriodBounds({ primary: { period: 'Ene-Jun 2025' } }, null).periodEnd).toBe(
      '2025-06-30',
    );
    expect(derivePeriodBounds({ primary: { period: 'Saldo Ago-2024' } }, null).periodEnd).toBe(
      '2024-08-31',
    );
    expect(derivePeriodBounds({ primary: { period: 'Ene-Dic 2024' } }, null).periodEnd).toBe(
      '2024-12-31',
    );
  });

  it('sin preprocesado usa el año de respaldo', () => {
    expect(derivePeriodBounds(null, '2023')).toEqual({
      periodYear: '2023',
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
    });
  });

  it('el año del balance prevalece sobre el respaldo del intake', () => {
    expect(derivePeriodBounds({ primary: { period: '2024' } }, '2025').periodYear).toBe('2024');
  });
});

describe('foldReportQualifications (pipeline-flujo-05)', () => {
  it('Parte II con salvedades → reconciliación no limpia (descargas bloqueadas)', () => {
    const out = foldReportQualifications(
      niif(),
      strategy({ strategyQualifications: { clean: false, motivos: ['x'], noVerificables: [] } }),
      governance(),
    );
    expect(out.reconciliation?.clean).toBe(false);
  });

  it('acta con salvedades → reconciliación no limpia', () => {
    const out = foldReportQualifications(
      niif(),
      strategy(),
      governance({ actaQualifications: { clean: false, motivos: ['x'] } }),
    );
    expect(out.reconciliation?.clean).toBe(false);
  });

  it('sin salvedades conserva el resultado NIIF', () => {
    const n = niif();
    expect(foldReportQualifications(n, strategy(), governance())).toBe(n);
  });
});

describe('Parte IV sobre el informe completo (auditoria-calidad-07)', () => {
  it('envía Partes I-III y el preprocesado a /api/financial-audit', async () => {
    const auditPayload = {
      auditorResults: [{ domain: 'niif', findings: [] }],
    };
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(`event: result\ndata: ${JSON.stringify(auditPayload)}\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const report = fullReport();
    const outcome = await runAuditInBackground({
      report,
      preprocessed,
      language: 'es',
      signal: new AbortController().signal,
      callbacks: {
        onAuditorStarted: () => {},
        onAuditorComplete: () => {},
        onAllAuditorsComplete: () => {},
        onFindings: () => {},
      },
    });

    expect(outcome.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/financial-audit');
    const body = JSON.parse(String(init?.body));
    expect(body.report.strategicAnalysis.fullContent).toBe('PARTE II — ESTRATEGIA');
    expect(body.report.governance.fullContent).toBe('PARTE III — ACTA');
    expect(body.report.consolidatedReport).toContain('PARTE III — ACTA');
    expect(body.preprocessed).toEqual(preprocessed);
    expect(body.language).toBe('es');
  });

  it('sin preprocesado no envía el campo', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response('event: result\ndata: {"auditorResults":[]}\n\n', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await runAuditInBackground({
      report: fullReport(),
      preprocessed: null,
      language: 'en',
      signal: new AbortController().signal,
      callbacks: {
        onAuditorStarted: () => {},
        onAuditorComplete: () => {},
        onAllAuditorsComplete: () => {},
        onFindings: () => {},
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect('preprocessed' in body).toBe(false);
  });
});

describe('meta-auditoría con preprocesado (auditoria-calidad-11)', () => {
  it('incluye el preprocesado cuando existe', () => {
    const report = fullReport();
    expect(buildQualityRequestBody({ report, auditReport: null, language: 'es', preprocessed })).toEqual({
      report,
      auditReport: null,
      language: 'es',
      preprocessed,
    });
  });

  it('lo omite cuando no existe', () => {
    const body = buildQualityRequestBody({
      report: fullReport(),
      auditReport: null,
      language: 'es',
      preprocessed: null,
    });
    expect('preprocessed' in body).toBe(false);
  });
});

describe('preprocesado para reanudar tras recarga (pipeline-flujo-03)', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      removeItem: (k: string) => {
        m.delete(k);
      },
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
  }

  it('persiste y recupera por conversationId', () => {
    const s = memoryStorage();
    expect(persistPreprocessedForResume('report-1', preprocessed, s)).toBe(true);
    expect(recallPreprocessedForResume('report-1', s)).toEqual(preprocessed);
    expect(recallPreprocessedForResume('report-2', s)).toBeNull();
    clearPreprocessedForResume(s);
    expect(recallPreprocessedForResume('report-1', s)).toBeNull();
  });

  it('no persiste un preprocesado por encima del tope ni rompe si el storage falla', () => {
    const s = memoryStorage();
    const huge = { primary: { period: '2024' }, blob: 'x'.repeat(1_100_000) };
    expect(persistPreprocessedForResume('report-1', huge, s)).toBe(false);
    expect(recallPreprocessedForResume('report-1', s)).toBeNull();

    const failing = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      getItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(persistPreprocessedForResume('report-1', preprocessed, failing)).toBe(false);
    expect(recallPreprocessedForResume('report-1', failing)).toBeNull();
    expect(persistPreprocessedForResume('report-1', preprocessed, null)).toBe(false);
  });
});
