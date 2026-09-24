// ---------------------------------------------------------------------------
// I3-3 (riesgo de la revisión I1) — la reanudación usa el ledger del checkpoint
// ---------------------------------------------------------------------------
// Al reanudar Estrategia/Gobierno, `runPipeline` tomaba el `adjustmentLedger`
// del intake vigente antes que el del checkpoint. Secuencia real:
//   1. Corrida A: /niif OK sin ajustes, /strategy falla → checkpoint A.
//   2. El usuario confirma ajustes en el Doctor y regenera → /niif falla. El
//      checkpoint A (sin ajustes) sobrevive; la corrida pendiente es la
//      regeneración (con ajustes).
//   3. Recarga → el informe A se rehidrata con su checkpoint → "Completar
//      reporte (reintentar Estrategia)".
// /strategy recibía el preprocesado A (sin ajustes) con el ledger NUEVO, lo
// re-derivaba con ese ledger y respondía 422 PREPROCESSED_MISMATCH: un error
// seguro pero incomprensible. Ahora el balance y el ledger de una reanudación
// son los de la corrida que produjo el checkpoint (guardados con él).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
// El Director de Estrategia (LLM) no corre: si la petición pasa la verificación
// del preprocesado, la llamada al agente queda registrada y falla aquí.
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: vi.fn(async () => {
    throw new Error('LLM no disponible en la prueba');
  }),
}));

import { POST as niif } from '@/app/api/financial-report/niif/route';
import { POST as strategyRoute } from '@/app/api/financial-report/strategy/route';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { callFinancialAgent } from '@/lib/agents/financial/agents/runtime';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import type { CompanyInfo, NiifAnalysisResult } from '@/lib/agents/financial/types';
import type { Adjustment, AdjustmentLedger } from '@/lib/agents/repair/types';
import type { NiifReportIntake } from '@/types/platform';
import { makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';
import { PREPROCESSED_MISMATCH_CODE } from '@/lib/reports/client-preprocessed';
import {
  buildNiifRequestBody,
  buildRegenerationIntake,
  clearCheckpointLedger,
  htmlLedgerField,
  loadCheckpointLedger,
  persistPreprocessedForResume,
  recallPreprocessedForResume,
  resolveResumeLedger,
  resolveRunSources,
  saveCheckpointLedger,
} from '../PipelineWorkspace';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    removeItem: (k: string) => {
      m.delete(k);
    },
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

const adj = (id: string, accountCode: string, amount: number, status: Adjustment['status'] = 'applied'): Adjustment => ({
  id,
  accountCode,
  accountName: `Cuenta ${accountCode}`,
  amount,
  rationale: 'Ajuste confirmado en el Doctor de Datos',
  status,
  proposedAt: '2026-09-24T10:00:00.000Z',
  ...(status === 'applied' ? { appliedAt: '2026-09-24T10:01:00.000Z' } : {}),
});

/** Regeneración: caja +$1.000.000 y proveedores +$1.000.000 en 2025 (cuadra, mueve totales). */
const LEDGER_REGEN: AdjustmentLedger = { adjustments: [adj('r1', '110505', 1_000_000), adj('r2', '220505', 1_000_000)] };

const INTAKE_A: NiifReportIntake = {
  caseType: 'niif_report',
  company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS' },
  niifGroup: 2,
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
  rawData: CSV_PERDIDA_COMPARATIVO,
  outputOptions: {
    financialStatements: true,
    kpiDashboard: true,
    cashFlowProjection: true,
    breakevenAnalysis: true,
    notesToFinancialStatements: true,
    shareholdersMinutes: true,
    auditPipeline: false,
    metaAudit: false,
    excelExport: true,
    comparativeAnalysis: true,
  },
};

const jsonReq = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(callFinancialAgent).mockClear();
  state.db = makeReportsTableFake().db;
  vi.mocked(runNiifAnalyst).mockResolvedValue({
    ...toNiifAnalysisResult(structuredClone(informeHonesto(preprocesarPerdidaComparativo()))),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
});

describe('fuentes de la corrida: completa vs reanudación', () => {
  const checkpoint = { rawData: 'csv del checkpoint', adjustmentLedger: null };

  it('corrida completa: balance y ledger del intake', () => {
    const regen = buildRegenerationIntake(INTAKE_A, LEDGER_REGEN.adjustments);
    expect(resolveRunSources('niif', regen, checkpoint)).toEqual({ rawData: CSV_PERDIDA_COMPARATIVO, adjustmentLedger: LEDGER_REGEN });
    expect(resolveRunSources('niif', INTAKE_A, null).adjustmentLedger).toBeUndefined();
  });

  it('reanudación: SIEMPRE los del checkpoint, aunque el intake vigente traiga otro ledger', () => {
    const regen = buildRegenerationIntake(INTAKE_A, LEDGER_REGEN.adjustments);
    for (const start of ['strategy', 'governance'] as const) {
      expect(resolveRunSources(start, regen, checkpoint)).toEqual({ rawData: 'csv del checkpoint', adjustmentLedger: undefined });
      // Checkpoint CON ajustes e intake nuevo sin ellos: el del checkpoint.
      expect(resolveRunSources(start, INTAKE_A, { rawData: 'x', adjustmentLedger: LEDGER_REGEN }).adjustmentLedger).toBe(LEDGER_REGEN);
      // Sin intake en memoria (recarga): igual.
      expect(resolveRunSources(start, null, checkpoint).rawData).toBe('csv del checkpoint');
    }
  });
});

describe('ledger guardado con el checkpoint NIIF (localStorage)', () => {
  it('se guarda por conversación (sólo confirmados) y distingue "sin ajustes" de "sin registro"', () => {
    const local = memoryStorage();
    const withProposed = { adjustments: [...LEDGER_REGEN.adjustments, adj('p1', '130505', 5, 'proposed')] };
    expect(saveCheckpointLedger('report-A', withProposed, local)).toBe(true);
    expect(loadCheckpointLedger('report-A', local)).toEqual({ found: true, adjustmentLedger: LEDGER_REGEN });
    expect(loadCheckpointLedger('report-B', local)).toEqual({ found: false });
    saveCheckpointLedger('report-B', undefined, local);
    expect(loadCheckpointLedger('report-B', local)).toEqual({ found: true, adjustmentLedger: null });
    clearCheckpointLedger(local);
    expect(loadCheckpointLedger('report-B', local)).toEqual({ found: false });
  });

  it('rehidratación: el registro del checkpoint manda; sin registro (checkpoint anterior) cae al de sessionStorage', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    persistPreprocessedForResume('report-A', { primary: { period: '2025' } }, session, LEDGER_REGEN);
    expect(resolveResumeLedger('report-A', local, session)).toEqual(LEDGER_REGEN);
    saveCheckpointLedger('report-A', null, local);
    expect(resolveResumeLedger('report-A', local, session)).toBeNull();
  });

  it('el ledger del checkpoint sobrevive aunque el preprocesado no quepa en sessionStorage (u otra pestaña)', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    saveCheckpointLedger('report-A', LEDGER_REGEN, local);
    const enorme = { primary: { period: '2025' }, relleno: 'x'.repeat(5_000_000) };
    expect(persistPreprocessedForResume('report-A', enorme, session, LEDGER_REGEN)).toBe(false);
    expect(resolveResumeLedger('report-A', local, session)).toEqual(LEDGER_REGEN);
    expect(resolveResumeLedger('report-A', local, memoryStorage())).toEqual(LEDGER_REGEN);
  });
});

describe('reanudar tras una regeneración con ajustes que falló en /niif', () => {
  it('/strategy recibe el preprocesado del checkpoint con SU ledger: pasa la verificación (antes 422 PREPROCESSED_MISMATCH)', async () => {
    const local = memoryStorage();
    const session = memoryStorage();

    // 1. Corrida A: /niif real sin ajustes; checkpoint como lo escribe runPipeline.
    const sourcesA = resolveRunSources('niif', INTAKE_A, null);
    const niifRes = await niif(jsonReq('/api/financial-report/niif', buildNiifRequestBody({ intake: INTAKE_A, language: 'es' })));
    const niifText = await niifRes.text();
    expect(niifRes.status, niifText).toBe(200);
    const phase = JSON.parse(niifText) as {
      niif: NiifAnalysisResult;
      context: { bindingTotals: string; preprocessed: unknown; company: CompanyInfo };
    };
    saveCheckpointLedger('report-A', sourcesA.adjustmentLedger, local);
    persistPreprocessedForResume('report-A', phase.context.preprocessed, session, sourcesA.adjustmentLedger);

    // 2. Regeneración con ajustes: /niif falla → la corrida pendiente es ésta.
    const pendiente = buildRegenerationIntake(INTAKE_A, LEDGER_REGEN.adjustments);

    // 3. Recarga: checkpoint A rehidratado.
    const checkpoint = {
      rawData: CSV_PERDIDA_COMPARATIVO,
      preprocessed: recallPreprocessedForResume('report-A', session),
      adjustmentLedger: resolveResumeLedger('report-A', local, session),
    };
    expect(checkpoint.adjustmentLedger).toBeNull();

    // 4. Reanudación de Estrategia con las fuentes del checkpoint.
    const sources = resolveRunSources('strategy', pendiente, checkpoint);
    const handoff = {
      niifResult: phase.niif,
      bindingTotals: phase.context.bindingTotals,
      preprocessed: checkpoint.preprocessed,
      company: phase.context.company,
      language: 'es',
    };
    const ok = await strategyRoute(jsonReq('/api/financial-report/strategy', { ...handoff, ...htmlLedgerField(sources.adjustmentLedger) }));
    const okBody = (await ok.json()) as { code?: string };
    expect(okBody.code).not.toBe(PREPROCESSED_MISMATCH_CODE);
    expect(ok.status).not.toBe(422);
    expect(vi.mocked(callFinancialAgent)).toHaveBeenCalled();

    // Contraste: el ledger del intake pendiente (comportamiento anterior) es el 422 confuso.
    vi.mocked(callFinancialAgent).mockClear();
    const antes = await strategyRoute(
      jsonReq('/api/financial-report/strategy', { ...handoff, ...htmlLedgerField(pendiente.adjustmentLedger) }),
    );
    expect(antes.status).toBe(422);
    expect(((await antes.json()) as { code?: string }).code).toBe(PREPROCESSED_MISMATCH_CODE);
    expect(vi.mocked(callFinancialAgent)).not.toHaveBeenCalled();
  });
});

describe('contrato: el componente usa estas fuentes (no el intake vigente)', () => {
  // Las funciones de arriba son el único camino; si el componente vuelve a
  // leer el ledger del intake en una reanudación, esta guarda lo detecta.
  const src = readFileSync(resolve(__dirname, '../PipelineWorkspace.tsx'), 'utf8');

  it('runPipeline toma balance y ledger de resolveRunSources', () => {
    expect(src).toContain('resolveRunSources(start, intakeWithExtras, resumeCheckpoint)');
    expect(src).toContain('const runRawData = runSources.rawData;');
    expect(src).not.toMatch(/intakeWithExtras\?\.adjustmentLedger\s*\?\?/);
  });

  it('el checkpoint guarda y rehidrata su propio ledger', () => {
    expect(src).toContain('saveCheckpointLedger(nextConvId, adjustmentLedger)');
    expect(src).toContain('adjustmentLedger: resolveResumeLedger(lastCompletedReport.conversationId)');
    expect(src.match(/clearCheckpointLedger\(\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('/export y /html usan el ledger emparejado con el preprocesado en caché', () => {
    expect(src).toContain('const effectiveAdjustmentLedger = cachedSource.adjustmentLedger;');
    expect(src).toContain('setCachedSource(pairCachedSource(niifContext.preprocessed, adjustmentLedger));');
    expect(src).not.toContain('resolveEffectiveAdjustmentLedger');
  });
});
