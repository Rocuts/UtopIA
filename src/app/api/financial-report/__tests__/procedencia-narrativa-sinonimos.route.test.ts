// ---------------------------------------------------------------------------
// Re-auditoría 2 de la fase 2 (2026-09-24) — procedencia-R2-01 y narrativa
// (N1, F1, F2) por las rutas reales
// ---------------------------------------------------------------------------
// Una cifra falsa en la prosa del JSON redactada con la terminología contable
// habitual ("la utilidad del ejercicio", "el resultado del periodo", "los
// activos suman", "el disponible", "distribuir entre los accionistas la suma
// de") pasaba el validador de prosa: /consolidate persistía la versión limpia
// y /export por referencia la entregaba 200 con X-Report-Provenance: verified.
// Y al revés, la aritmética honesta del acta ("el 10 % de la utilidad neta,
// es decir $200,00") o un subtotal de nota ("el total de activos financieros")
// sellaban la Parte y /export respondía 422. El servidor usa el mismo
// validador que la fase (paridad): aquí se prueba de punta a punta.
//
// Balance del fixture: activo $10.000, pasivo $4.000, patrimonio $6.000,
// utilidad neta $2.000, ingresos $7.000, efectivo $1.700. Alcance: `getDb()` es
// el fake de `provenance-fixture`; no acredita aislamiento real de tenants.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({ appendix: { validationWarnings: [] } })),
  renderEditorialReportToStream: vi.fn(),
}));
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});

import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { consolidateBody, makeProvenanceParts, makeReportsTableFake } from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';
let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Where = 'acta' | 'nota-gobierno' | 'nota-tecnica' | 'estrategia';

function parts(where: Where, sentence: string) {
  const p = makeProvenanceParts();
  if (where === 'acta') {
    const g = p.governance.json as GovernanceReportJson;
    g.shareholderMinutes!.developments = [{ itemNumber: 1, body: sentence }];
  } else if (where === 'nota-gobierno') {
    const g = p.governance.json as GovernanceReportJson;
    g.financialNotes[0].body = sentence;
  } else if (where === 'nota-tecnica') {
    const n = p.niifAnalysis.json as NiifReportJson;
    n.technicalNotes = [...n.technicalNotes, { ref: null, norma: 'NIIF para las PYMES 3.17', body: sentence }];
  } else {
    const s = p.strategicAnalysis.json as StrategyReportJson;
    s.executiveDashboard.executiveCommentary = sentence;
  }
  return p;
}

async function run(where: Where, sentence: string) {
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts(where, sentence) })));
  expect(res.status).toBe(200);
  const out = (await res.json()) as { report: FinancialReport; reportRef?: { reportId: string; reportHash: string } };
  const exp = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
  return { report: out.report, exp };
}

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-tests';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (previousDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDbUrl;
});

beforeEach(() => {
  vi.clearAllMocks();
  fake = makeReportsTableFake();
  state.db = fake.db;
  state.workspace = W1;
});

describe('control', () => {
  it('prosa honesta → 200 verificado; "la utilidad neta del ejercicio" falsa → 422', async () => {
    const ok = await run('acta', 'La utilidad neta del ejercicio fue de $2.000,00.');
    expect(ok.exp.status).toBe(200);
    expect(ok.exp.headers.get('X-Report-Provenance')).toBe('verified');
    const bad = await run('acta', 'La utilidad neta del ejercicio fue de $9.000.000,00.');
    expect(bad.exp.status).toBe(422);
  });
});

// Cifra falsa: $9.000.000,00 contradice la utilidad ($2.000), el activo ($10.000) y el efectivo ($1.700).
const ESCAPES: Array<[Where, string]> = [
  ['acta', 'La utilidad del ejercicio 2025 fue de $9.000.000,00, que la asamblea aprueba.'],
  ['acta', 'El resultado del ejercicio fue de $9.000.000,00.'],
  ['acta', 'La sociedad obtuvo utilidades por $9.000.000,00 en el ejercicio.'],
  ['acta', 'Se aprueba distribuir entre los accionistas la suma de $900.000,00 pagadera en efectivo.'],
  ['nota-gobierno', 'La utilidad del ejercicio asciende a $9.000.000,00.'],
  ['nota-tecnica', 'La utilidad del ejercicio asciende a $9.000.000,00.'],
  ['nota-tecnica', 'El resultado del periodo asciende a $9.000,00.'],
  ['nota-tecnica', 'El efectivo de la compañía al 31 de diciembre de 2025 era de $9.000.000,00.'],
  ['nota-tecnica', 'Los activos de la sociedad suman $9.000.000,00.'],
  ['estrategia', 'La utilidad del ejercicio fue de $9.000.000,00 y el disponible cerró en $9.000.000,00.'],
];

describe('procedencia-R2-01 / narrativa-09/10 — la terminología habitual con cifra falsa sella la Parte y /export responde 422', () => {
  for (const [where, sentence] of ESCAPES) it(`${where}: ${sentence}`, async () => {
    const { report, exp } = await run(where, sentence);
    const verdict =
      where === 'nota-tecnica'
        ? report.niifAnalysis.reconciliation?.clean
        : where === 'estrategia'
          ? report.strategicAnalysis.strategyQualifications?.clean
          : report.governance.actaQualifications?.clean;
    expect(verdict).toBe(false);
    expect(exp.status).toBe(422);
    expect(exp.headers.get('X-Report-Provenance')).not.toBe('verified');
  });
});

const HONEST: Array<[Where, string]> = [
  // narrativa-01 (F1): la aritmética del acta.
  ['acta', 'La utilidad neta del ejercicio fue de $2.000,00. El 10 % de la utilidad neta, es decir $200,00, se destina a la reserva legal.'],
  // narrativa-02 (F2): subtotales de una nota.
  ['nota-gobierno', 'El total patrimonio es $6.000,00. El total de activos financieros (cartera de clientes) asciende a $8.300,00.'],
  ['nota-tecnica', 'El total de activos financieros asciende a $8.300,00 (cartera de clientes, Sección 11).'],
  // Sinónimos con la cifra real.
  ['acta', 'La utilidad del ejercicio 2025 fue de $2.000,00, que la asamblea aprueba.'],
  ['nota-tecnica', 'Los activos de la sociedad suman $10.000,00 y el disponible al cierre fue de $1.700,00.'],
  ['estrategia', 'El resultado del ejercicio fue de $2.000,00 y los ingresos del ejercicio ascendieron a $7.000,00.'],
];

describe('narrativa-01/02 — la prosa honesta no sella: /export 200 verificado', () => {
  for (const [where, sentence] of HONEST) it(`${where}: ${sentence}`, async () => {
    const { report, exp } = await run(where, sentence);
    expect(report.governance.actaQualifications?.clean ?? true).toBe(true);
    expect(report.niifAnalysis.reconciliation?.clean ?? true).toBe(true);
    expect(report.strategicAnalysis.strategyQualifications?.clean ?? true).toBe(true);
    expect(exp.status).toBe(200);
    expect(exp.headers.get('X-Report-Provenance')).toBe('verified');
  });
});
