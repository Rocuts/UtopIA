// ---------------------------------------------------------------------------
// Consumidores del preprocesado del cliente (cross-dep de P1)
// ---------------------------------------------------------------------------
// /export y /html re-derivan el preprocesado que envía la UI desde sus filas
// (niif-preproceso-33), pero /strategy, /governance, /api/financial-quality,
// /api/financial-audit, /api/fiscal-audit-opinion, el respaldo de /niif y la
// ruta legacy lo aceptaban tal cual tras `revivePreprocessedBalance` (sólo la
// forma): un Total Activo alterado en todas sus copias, con centavos
// coherentes, se volvía ancla vinculante de la Parte II, del acta, de la
// auditoría y del dictamen. Ahora todas lo re-derivan con el ledger
// confirmado que acompaña la petición y responden 422 si no casa, sin llamar
// al LLM; el preprocesado honesto (con o sin ajustes) sigue pasando.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => null) }));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: vi.fn(async () => null) };
});
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => {
    throw new Error('SENTINEL: el LLM sólo se llama si el gate pasa');
  }),
}));
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({
  runNiifAnalyst: vi.fn(async () => {
    throw new Error('SENTINEL: el LLM sólo se llama si el gate pasa');
  }),
}));
vi.mock('@/lib/agents/financial/quality/agent', () => ({ runQualityAudit: vi.fn(async () => ({ grade: 'A' })) }));
vi.mock('@/lib/agents/financial/audit/orchestrator', () => ({ orchestrateAudit: vi.fn(async () => ({ overallScore: 90 })) }));
vi.mock('@/lib/agents/financial/fiscal-opinion/orchestrator', () => ({
  orchestrateFiscalOpinion: vi.fn(async () => ({ opinionType: 'favorable' })),
}));
vi.mock('@/lib/agents/financial/orchestrator', async (orig) => {
  const actual = await orig<typeof import('@/lib/agents/financial/orchestrator')>();
  return { ...actual, orchestrateFinancialReport: vi.fn() };
});

import { POST as strategyPOST } from '../strategy/route';
import { POST as governancePOST } from '../governance/route';
import { POST as niifPOST } from '../niif/route';
import { POST as legacyPOST } from '../route';
import { POST as qualityPOST } from '../../financial-quality/route';
import { POST as auditPOST } from '../../financial-audit/route';
import { POST as opinionPOST } from '../../fiscal-audit-opinion/route';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import { orchestrateAudit } from '@/lib/agents/financial/audit/orchestrator';
import { orchestrateFiscalOpinion } from '@/lib/agents/financial/fiscal-opinion/orchestrator';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { parseTrialBalanceCSV, preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,1700',
  '130505,Clientes,Auxiliar,1,8300',
  '220505,Proveedores,Auxiliar,1,4000',
  '311505,Capital,Auxiliar,1,3000',
  '330505,Reserva legal,Auxiliar,1,500',
  '370505,Utilidades acumuladas,Auxiliar,1,500',
  '360505,Utilidad del ejercicio,Auxiliar,1,2000',
  '410505,Ventas,Auxiliar,1,7000',
  '510505,Sueldos,Auxiliar,1,2000',
  '530505,Intereses,Auxiliar,1,1000',
  '613505,CMV,Auxiliar,1,2000',
].join('\n');
const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' };
const LEDGER: { adjustments: Adjustment[] } = {
  adjustments: [
    {
      id: 'adj-1',
      accountCode: '510505',
      accountName: 'Sueldos',
      amount: -500,
      rationale: 'Causación duplicada confirmada',
      status: 'applied',
      proposedAt: '2026-09-24T00:00:00Z',
      appliedAt: '2026-09-24T00:00:00Z',
    },
  ],
};

const upload = () => preprocessTrialBalance(parseTrialBalanceCSV(CSV));
/** Lo que /niif devuelve con el ledger aplicado (y la UI reenvía). */
const adjusted = () => applyAdjustments(upload(), LEDGER.adjustments).balance;

/** Total Activo alterado en TODAS sus copias, con centavos coherentes. */
function forged(pp: PreprocessedBalance): unknown {
  const wire = JSON.parse(JSON.stringify(toJsonSafe(pp))) as {
    primary: { period: string; controlTotals: { activo: number; cents: { activo: string } } };
    periods: Array<{ period: string; controlTotals: { activo: number; cents: { activo: string } } }>;
  };
  for (const snap of [wire.primary, ...wire.periods.filter((p) => p.period === wire.primary.period)]) {
    snap.controlTotals.activo = 99_999;
    snap.controlTotals.cents.activo = '9999900';
  }
  return wire;
}

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const phaseBody = (preprocessed: unknown, extra: Record<string, unknown> = {}) => ({
  niifResult: { fullContent: '## NIIF\nTotal Activo $10.000,00' },
  strategyResult: { fullContent: '## Estrategia' },
  bindingTotals: 'TOTALES VINCULANTES',
  preprocessed,
  company,
  language: 'es',
  ...extra,
});

const report = () => ({ ...makeExportableReport(), company });

async function expectMismatch(res: Response) {
  expect(res.status).toBe(422);
  const body = (await res.json()) as { code?: string; details?: string[] };
  expect(body.code).toBe('PREPROCESSED_MISMATCH');
  expect(body.details?.join('\n')).toMatch(/Fuentes incoherentes/);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(orchestrateFinancialReport).mockResolvedValue(makeExportableReport());
});

describe('/strategy y /governance — el preprocesado de /niif se re-deriva con el ledger', () => {
  it('Total Activo alterado → 422 sin llamar al LLM', async () => {
    await expectMismatch(await strategyPOST(req('http://localhost/api/financial-report/strategy', phaseBody(forged(upload())))));
    await expectMismatch(await governancePOST(req('http://localhost/api/financial-report/governance', phaseBody(forged(upload())))));
  });

  it('el preprocesado ajustado por el Doctor pasa con su ledger (llega al LLM) y sin él no', async () => {
    const withLedger = await strategyPOST(
      req('http://localhost/api/financial-report/strategy', phaseBody(toJsonSafe(adjusted()), { adjustmentLedger: LEDGER })),
    );
    expect(withLedger.status).toBe(500); // el sentinela del LLM: el gate pasó
    await expectMismatch(
      await governancePOST(req('http://localhost/api/financial-report/governance', phaseBody(toJsonSafe(adjusted())))),
    );
  });
});

describe('Partes IV/V y dictamen — /api/financial-quality, /api/financial-audit, /api/fiscal-audit-opinion', () => {
  it('Total Activo alterado → 422 sin correr los agentes', async () => {
    await expectMismatch(await qualityPOST(req('http://localhost/api/financial-quality', { report: report(), preprocessed: forged(upload()) })));
    await expectMismatch(await auditPOST(req('http://localhost/api/financial-audit', { report: report(), preprocessed: forged(upload()) })));
    await expectMismatch(await opinionPOST(req('http://localhost/api/fiscal-audit-opinion', { report: report(), preprocessed: forged(upload()) })));
    expect(runQualityAudit).not.toHaveBeenCalled();
    expect(orchestrateAudit).not.toHaveBeenCalled();
    expect(orchestrateFiscalOpinion).not.toHaveBeenCalled();
  });

  it('el preprocesado honesto (ajustado, con su ledger) llega re-derivado a los agentes', async () => {
    const body = { report: report(), preprocessed: toJsonSafe(adjusted()), adjustmentLedger: LEDGER };
    expect((await qualityPOST(req('http://localhost/api/financial-quality', body))).status).toBe(200);
    expect((await auditPOST(req('http://localhost/api/financial-audit', body))).status).toBe(200);
    expect((await opinionPOST(req('http://localhost/api/fiscal-audit-opinion', body))).status).toBe(200);
    const pp = vi.mocked(runQualityAudit).mock.calls[0][0].preprocessed as PreprocessedBalance;
    expect(pp.primary.controlTotals.utilidadNeta).toBe(2500);
  });
});

describe('respaldo de /niif y ruta legacy — el preprocesado del upload', () => {
  it('/niif sin filas en rawData: un preprocesado alterado → 422 sin llamar al analista', async () => {
    const res = await niifPOST(
      req('http://localhost/api/financial-report/niif', {
        rawData: 'Estados financieros escaneados (texto OCR sin tabla de cuentas).',
        company,
        language: 'es',
        preprocessed: forged(upload()),
      }),
    );
    await expectMismatch(res);
    expect(runNiifAnalyst).not.toHaveBeenCalled();
  });

  it('legacy: un preprocesado alterado → 422; el honesto llega re-derivado al orquestador', async () => {
    await expectMismatch(await legacyPOST(req('http://localhost/api/financial-report', { rawData: CSV, company, language: 'es', preprocessed: forged(upload()) })));
    expect(orchestrateFinancialReport).not.toHaveBeenCalled();
    const ok = await legacyPOST(req('http://localhost/api/financial-report', { rawData: CSV, company, language: 'es', preprocessed: toJsonSafe(upload()) }));
    expect(ok.status).toBe(200);
    const pp = vi.mocked(orchestrateFinancialReport).mock.calls[0][1]?.preprocessed as PreprocessedBalance;
    expect(pp.primary.controlTotals.activo).toBe(10000);
  });
});
