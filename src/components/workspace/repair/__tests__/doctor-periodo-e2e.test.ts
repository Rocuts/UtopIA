// ---------------------------------------------------------------------------
// I3-1 (cross-dep I1-4) — el `period` del ajuste del Doctor de Datos, de punta
// a punta: Doctor → ledger del chat → autosave/rehidratación → intake → /niif.
// ---------------------------------------------------------------------------
// I1-4 hizo que /niif, /consolidate, /export y /html respeten `period`, pero el
// Doctor lo perdía antes de llegar al ledger:
//   - `useRepairChat` armaba el `Adjustment` sin `input.period`;
//   - los `adjustmentSchema` locales de /api/repair-chat y /api/repair-session
//     no declaraban `period` y Zod lo quitaba (el autosave lo descartaba y las
//     tools del chat lo aplicaban al primario).
// Un ajuste que corrige el comparativo 2024 llegaba a /niif sin periodo: se
// aplicaba a 2025, 2024 seguía descuadrado y la corrida terminaba en 422.
//
// Escenario: la pérdida con comparativo de la traza con la caja de 2024
// registrada $1.000.000 de menos. El Doctor (tool real) propone +$1.000.000 a
// 110505 en 2024; el usuario lo confirma; el ledger pasa por el autosave y la
// rehidratación (rutas reales, `persistence.ts` real sobre una BD falsa) y la
// regeneración (helpers reales de PipelineWorkspace) lo envía a /niif (ruta
// real, LLM mockeado).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const state = vi.hoisted(() => ({
  db: null as unknown,
  workspace: '11111111-1111-4111-8111-111111111111',
  chatRequests: [] as unknown[],
}));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: vi.fn(async () => state.workspace),
  getOrCreateWorkspace: vi.fn(async () => ({ id: state.workspace })),
}));
vi.mock('@/lib/db/activity-log', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/macro/prompt-snapshot', () => ({ getMacroSnapshotForPrompts: vi.fn(async () => null) }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/agents/financial/agents/niif-analyst', () => ({ runNiifAnalyst: vi.fn() }));
// El runner del chat (LLM) no corre: se captura la petición ya validada.
vi.mock('@/lib/agents/repair/agent', () => ({
  runRepairAgent: vi.fn(async (req: unknown) => {
    state.chatRequests.push(req);
  }),
}));

import { POST as niif } from '@/app/api/financial-report/niif/route';
import { POST as repairChat } from '@/app/api/repair-chat/route';
import { GET as getRepairSession, PUT as putRepairSession } from '@/app/api/repair-session/route';
import { runNiifAnalyst } from '@/lib/agents/financial/agents/niif-analyst';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeHonesto,
  preprocesarPerdidaComparativo,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { executeRepairTool } from '@/lib/agents/repair/tools';
import type {
  Adjustment,
  ProposeAdjustmentInput,
  ProposeAdjustmentOutput,
  RepairChatRequest,
} from '@/lib/agents/repair/types';
import { repairAdjustments, repairSessions } from '@/lib/db/schema';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { NiifReportIntake } from '@/types/platform';
import { adjustmentFromProposal } from '../useRepairChat';
import { AdjustmentCard } from '../AdjustmentCard';
import { buildNiifRequestBody, buildRegenerationIntake } from '../../PipelineWorkspace';
import { makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';

/** Caja 2024 registrada $1.000.000 de menos: el comparativo no cuadra. */
const CSV_2024_DESCUADRADO = CSV_PERDIDA_COMPARATIVO.replace(
  '110505,Caja general,Auxiliar,1,30000000,5000000',
  '110505,Caja general,Auxiliar,1,29000000,5000000',
);
const HONEST = preprocesarPerdidaComparativo();
const CONVERSATION = 'repair-e2e-periodo';

/** Argumentos con los que el agente llama `propose_adjustment`. */
const PROPOSE_ARGS: ProposeAdjustmentInput = {
  accountCode: '110505',
  amount: 1_000_000,
  rationale: 'Arqueo de caja al cierre de 2024 no registrado en el balance',
  period: '2024',
};

const INTAKE: NiifReportIntake = {
  caseType: 'niif_report',
  company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS' },
  niifGroup: 2,
  fiscalPeriod: '2025',
  comparativePeriod: '2024',
  rawData: CSV_2024_DESCUADRADO,
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

// ─── BD falsa para `persistence.ts` (tablas repair_sessions / repair_adjustments)

function makeRepairDbFake() {
  const sessions: Array<Record<string, unknown>> = [];
  let adjustments: Array<Record<string, unknown>> = [];
  const rowsOf = (table: unknown) => (table === repairSessions ? sessions : adjustments);
  const thenable = <T>(value: () => T) => ({
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(value).then(res, rej),
  });
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async (n: number) => rowsOf(table).slice(0, n),
          ...thenable(() => [...rowsOf(table)]),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const row = v as Record<string, unknown>;
            const i = sessions.findIndex((s) => s.conversationId === row.conversationId);
            const next = { ...row, id: 'sess-1' };
            if (i >= 0) sessions[i] = next;
            else sessions.push(next);
            return [{ id: 'sess-1' }];
          },
        }),
        ...thenable(() => {
          if (table === repairAdjustments) adjustments.push(...(Array.isArray(v) ? v : [v]));
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () =>
        thenable(() => {
          if (table === repairAdjustments) adjustments = [];
        }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
  };
  return { db, adjustments: () => adjustments };
}

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const snapshot = (pp: PreprocessedBalance, period: string) => pp.periods.find((p) => p.period === period)!;

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  state.chatRequests = [];
  vi.mocked(runNiifAnalyst).mockResolvedValue({
    ...toNiifAnalysisResult(structuredClone(informeHonesto(HONEST))),
    reconciliation: { clean: true, deviations: [], lineGaps: [], repairAttempted: false },
  });
});

/** El Doctor propone (tool real) y el hook arma la entrada del ledger. */
async function proponerEnElDoctor(): Promise<Adjustment> {
  const result = (await executeRepairTool('propose_adjustment', { ...PROPOSE_ARGS }, {
    preprocessed: preprocesarPerdidaComparativo(CSV_2024_DESCUADRADO),
    language: 'es',
    adjustments: [],
  })) as ProposeAdjustmentOutput;
  expect(result.id).toBeTruthy();
  // El preview del Doctor se calculó sobre 2024: 29M → 30M.
  expect(result.preview.affectedAccount.oldBalance).toBe(29_000_000);
  expect(result.preview.affectedAccount.newBalance).toBe(30_000_000);
  return adjustmentFromProposal(PROPOSE_ARGS, result, '2026-09-24T10:00:00.000Z');
}

describe('ajuste del Doctor anclado al comparativo: el periodo llega al ledger y a /niif', () => {
  it('el hook conserva el periodo del ajuste propuesto (recortado); sin periodo va al primario', async () => {
    const adj = await proponerEnElDoctor();
    expect(adj).toMatchObject({ accountCode: '110505', amount: 1_000_000, status: 'proposed', period: '2024' });

    const result = { id: 'x', preview: { affectedAccount: { code: '110505', name: 'Caja', oldBalance: 0, newBalance: 0, isNewAccount: false } } } as ProposeAdjustmentOutput;
    expect(adjustmentFromProposal({ ...PROPOSE_ARGS, period: ' 2024 ' }, result, 'x').period).toBe('2024');
    expect('period' in adjustmentFromProposal({ ...PROPOSE_ARGS, period: undefined }, result, 'x')).toBe(false);
    expect('period' in adjustmentFromProposal({ ...PROPOSE_ARGS, period: '  ' }, result, 'x')).toBe(false);
  });

  it('/api/repair-chat entrega el ledger al agente con el periodo (preview y recheck sobre 2024)', async () => {
    const adj = await proponerEnElDoctor();
    const res = await repairChat(
      jsonReq('/api/repair-chat', 'POST', {
        messages: [{ role: 'user', content: 'Recalcula con el ajuste' }],
        context: { errorMessage: 'Ecuación descuadrada en 2024', rawCsv: CSV_2024_DESCUADRADO, language: 'es', conversationId: CONVERSATION },
        adjustments: [{ ...adj, status: 'applied', appliedAt: '2026-09-24T10:01:00.000Z' }],
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    const req = state.chatRequests[0] as RepairChatRequest;
    expect(req.adjustments?.[0].period).toBe('2024');
  });

  it('Doctor → confirmación → autosave → rehidratación → regeneración → /niif: 2024 cuadra y 2025 no se mueve', async () => {
    // 1. Doctor: propuesta y confirmación del usuario.
    const proposed = await proponerEnElDoctor();
    const applied: Adjustment = { ...proposed, status: 'applied', appliedAt: '2026-09-24T10:01:00.000Z' };

    // 2. Autosave (PUT) y rehidratación (GET) con `persistence.ts` real.
    const repairDb = makeRepairDbFake();
    state.db = repairDb.db;
    const put = await putRepairSession(
      jsonReq('/api/repair-session', 'PUT', {
        conversationId: CONVERSATION,
        errorMessage: 'Ecuación descuadrada en 2024',
        rawCsv: CSV_2024_DESCUADRADO,
        language: 'es',
        status: 'open',
        adjustments: [applied],
      }),
    );
    expect(put.status, await put.clone().text()).toBe(200);
    expect(repairDb.adjustments()[0].period).toBe('2024');
    const get = await getRepairSession(jsonReq(`/api/repair-session?conversationId=${CONVERSATION}`, 'GET'));
    const { session } = (await get.json()) as { session: { adjustments: Adjustment[] } };
    expect(session.adjustments[0].period).toBe('2024');

    // 3. Regeneración: el chat entrega los confirmados y el pipeline arma /niif.
    const rehydrated = session.adjustments.filter((a) => a.status === 'applied');
    const body = buildNiifRequestBody({ intake: buildRegenerationIntake(INTAKE, rehydrated), language: 'es' });
    expect((body.adjustmentLedger as { adjustments: Adjustment[] }).adjustments[0].period).toBe('2024');

    // 4. /niif real: el ajuste se aplica al comparativo.
    state.db = makeReportsTableFake().db;
    const niifRes = await niif(jsonReq('/api/financial-report/niif', 'POST', body));
    const niifText = await niifRes.text();
    expect(niifRes.status, niifText).toBe(200);
    const pp = (JSON.parse(niifText) as { context: { preprocessed: PreprocessedBalance } }).context.preprocessed;
    expect(snapshot(pp, '2024').controlTotals.efectivoCuenta11).toBe(snapshot(HONEST, '2024').controlTotals.efectivoCuenta11);
    expect(snapshot(pp, '2025').controlTotals.efectivoCuenta11).toBe(snapshot(HONEST, '2025').controlTotals.efectivoCuenta11);
  });

  it('la tarjeta del ajuste muestra el periodo al que se ancla (es/en)', async () => {
    const adj = await proponerEnElDoctor();
    const es = renderToStaticMarkup(createElement(AdjustmentCard, { adjustment: adj, language: 'es' }));
    const en = renderToStaticMarkup(createElement(AdjustmentCard, { adjustment: adj, language: 'en' }));
    expect(es).toContain('Periodo');
    expect(es).toContain('2024');
    expect(en).toContain('Period');
    const { period: _omit, ...sinPeriodo } = adj;
    void _omit;
    expect(renderToStaticMarkup(createElement(AdjustmentCard, { adjustment: sinPeriodo, language: 'es' }))).not.toContain('Periodo');
  });
});
