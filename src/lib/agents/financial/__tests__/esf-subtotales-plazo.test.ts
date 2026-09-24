// ---------------------------------------------------------------------------
// E27 — subtotales corriente / no corriente del ESF contra controlTotals
// ---------------------------------------------------------------------------
// Integración I4 (objetivo 2). Cuando el modelo escribe el ESF con su propio
// desglose y éste cuadra con el total (sin lineGap), el completado determinista
// no corre y NINGÚN validador comparaba los subtotales impresos "Total activo /
// pasivo corriente" y "no corriente" contra `controlTotals.activoCorriente` /
// `activoNoCorriente` / `pasivoCorriente` / `pasivoNoCorriente`: las cifras de
// los KPIs de liquidez, el gate y X03. E21 ancla cada grupo PUC y E22 exige que
// el subtotal sea la suma de un bloque, así que un grupo colocado en el bloque
// equivocado (1205 declarado no corriente, presentado como corriente) salía con
// subtotales internamente coherentes y distintos de los KPIs.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callFinancialAgentMock = vi.fn();
vi.mock('@/lib/agents/financial/agents/runtime', () => ({
  callFinancialAgent: (opts: unknown) => callFinancialAgentMock(opts),
}));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: vi.fn(async () => '') }));

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { buildLedgerLeaves } from '../contracts/deterministic-breakdown';
import type { NiifReportJson } from '../contracts/niif-report';
import { informeHonesto, linea } from '../__fixtures__/perdida-comparativo-w4a';
import {
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
  reconcileAnchors,
} from '../agents/reconcile-anchors';
import { buildNiifValidatorOptions, runNiifPhase } from '../orchestrator';
import { validateNiifReportJson } from '../validators/niif-json-validator';

// Mismo balance de esf-vencimientos-declarados.test.ts.
// 2025: A 390.000 = P 150.000 + K 240.000; 2024: A 275.000 = P 75.000 + K 200.000.
const CSV_DOS_CORTES = [
  'Razón social: DEMO PERDIDAS SAS',
  'NIT: 900.123.456-8',
  'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
  '110505,Caja,Auxiliar,100000,140000',
  '120505,CDT a 18 meses,Auxiliar,10000,30000',
  '120510,Acciones negociables,Auxiliar,15000,20000',
  '152405,Equipo de oficina,Auxiliar,150000,200000',
  '210505,Crédito bancario a 3 años,Auxiliar,50000,80000',
  '220505,Proveedores,Auxiliar,25000,70000',
  '310505,Capital,Auxiliar,200000,200000',
  '413505,Ventas,Auxiliar,0,100000',
  '510506,Sueldos,Auxiliar,0,60000',
].join('\n');

function preprocess(vencimientos: Record<string, 'corriente' | 'no_corriente'> | null): PreprocessedBalance {
  const { rows, errores } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(CSV_DOS_CORTES).rows, vencimientos);
  expect(errores).toEqual([]);
  return preprocessTrialBalance(rows);
}

const c = (pesos: number) => String(BigInt(pesos) * BigInt(100));
const sub = (label: string, p: number, cmp: number | null) =>
  linea(null, label, c(p), cmp === null ? null : c(cmp), { level: 3, isAbsolute: true });
const det = (account: string, label: string, p: number, cmp: number) =>
  linea(account, label, c(p), c(cmp), { isAbsolute: true });

/**
 * Informe honesto (anclas, ERI, EFE y ECP deterministas) cuyo ESF lleva el
 * desglose propio del modelo por grupo PUC, con bloques por `termOfGroup` (12
 * corriente, 21 corriente) y subtotales que suman su bloque: cuadra con los
 * totales y no dispara el completado determinista.
 */
function esfDelModelo(pp: PreprocessedBalance, labels = {
  ac: 'Total activo corriente', anc: 'Total activo no corriente', pc: 'Total pasivo corriente',
}): NiifReportJson {
  const json = informeHonesto(pp);
  json.balanceSheet = {
    ...json.balanceSheet,
    assets: [
      det('11', 'Efectivo y equivalentes de efectivo', 140000, 100000),
      det('12', 'Inversiones', 50000, 25000),
      sub(labels.ac, 190000, 125000),
      det('15', 'Propiedades, planta y equipo', 200000, 150000),
      sub(labels.anc, 200000, 150000),
    ],
    liabilities: [
      det('21', 'Obligaciones financieras', 80000, 50000),
      det('22', 'Proveedores', 70000, 25000),
      sub(labels.pc, 150000, 75000),
    ],
  };
  return json;
}

const e27 = (json: NiifReportJson, pp: PreprocessedBalance) =>
  validateNiifReportJson(json, buildNiifValidatorOptions(pp)).errors.filter((e) => e.startsWith('E27.'));

const esfErrors = (json: NiifReportJson, pp: PreprocessedBalance) =>
  validateNiifReportJson(json, buildNiifValidatorOptions(pp)).errors;

beforeEach(() => {
  callFinancialAgentMock.mockReset();
});

describe('E27 — subtotales corriente / no corriente del ESF == controlTotals', () => {
  it('sin excepciones de vencimiento el ESF del modelo coincide con los controlTotals y no dispara E27', () => {
    const pp = preprocess(null);
    expect(pp.primary.controlTotals.activoCorriente).toBe(190000);
    expect(esfErrors(esfDelModelo(pp), pp)).toEqual([]);
  });

  it('1205 y 2105 declarados no corrientes: los subtotales del modelo por grupo PUC son error E27 en ambos periodos', () => {
    const pp = preprocess({ '1205': 'no_corriente', '2105': 'no_corriente' });
    expect(pp.primary.controlTotals.activoCorriente).toBe(140000);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(70000);
    const json = esfDelModelo(pp);
    // E21 (grupo a grupo) y E22 (subtotal = suma de su bloque) no lo ven.
    expect(esfErrors(json, pp).filter((e) => !e.startsWith('E27.'))).toEqual([]);
    expect(e27(json, pp)).toEqual([
      'E27. Estado de Situación Financiera — Activo (periodo 2025): "Total activo corriente" imprime $190.000,00 ' +
        'y el activo corriente del balance de prueba (controlTotals.activoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $140.000,00. Brecha: $50.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
      'E27. Estado de Situación Financiera — Activo (periodo 2025): "Total activo no corriente" imprime $200.000,00 ' +
        'y el activo no corriente del balance de prueba (controlTotals.activoNoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $250.000,00. Brecha: -$50.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
      'E27. Estado de Situación Financiera — Pasivo (periodo 2025): "Total pasivo corriente" imprime $150.000,00 ' +
        'y el pasivo corriente del balance de prueba (controlTotals.pasivoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $70.000,00. Brecha: $80.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
      'E27. Estado de Situación Financiera — Activo (periodo comparativo 2024): "Total activo corriente" imprime $125.000,00 ' +
        'y el activo corriente del balance de prueba (controlTotals.activoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $100.000,00. Brecha: $25.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
      'E27. Estado de Situación Financiera — Activo (periodo comparativo 2024): "Total activo no corriente" imprime $150.000,00 ' +
        'y el activo no corriente del balance de prueba (controlTotals.activoNoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $175.000,00. Brecha: -$25.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
      'E27. Estado de Situación Financiera — Pasivo (periodo comparativo 2024): "Total pasivo corriente" imprime $75.000,00 ' +
        'y el pasivo corriente del balance de prueba (controlTotals.pasivoCorriente: la cifra de los KPIs de liquidez, ' +
        'el gate y X03) es $25.000,00. Brecha: $50.000,00. La clasificación corriente / no corriente del ESF ' +
        'es la del preprocesador, con los vencimientos declarados (NIIF para las PYMES 4.4).',
    ]);
  });

  it('el ESF completado por el código con las excepciones no dispara E27 (sin falso positivo)', () => {
    const pp = preprocess({ '1205': 'no_corriente', '2105': 'no_corriente' });
    const base = informeHonesto(pp);
    base.balanceSheet.assets = [];
    base.balanceSheet.liabilities = [];
    base.balanceSheet.equity = [];
    const gaps = reconcileAnchors(base, { primary: null, comparative: null }).lineGaps;
    const { json: done } = completeBreakdownFromSnapshot(base, gaps, pp.primary);
    const filled = fillComparativeBreakdownFromSnapshot(done, pp.comparative ?? undefined).json;
    expect(filled.balanceSheet.assets.some((l) => l.label === 'Total activo corriente')).toBe(true);
    expect(esfErrors(filled, pp)).toEqual([]);
  });

  it('rótulos en inglés, en plural y encabezados con monto también se contrastan; una celda comparativa null no es $0', () => {
    const pp = preprocess({ '1205': 'no_corriente' });
    const en = esfDelModelo(pp, {
      ac: 'Total current assets', anc: 'Total non-current assets', pc: 'TOTAL PASIVOS CORRIENTES',
    });
    const msgs = e27(en, pp);
    expect(msgs.map((m) => m.slice(0, m.indexOf(' imprime')))).toEqual([
      'E27. Estado de Situación Financiera — Activo (periodo 2025): "Total current assets"',
      'E27. Estado de Situación Financiera — Activo (periodo 2025): "Total non-current assets"',
      'E27. Estado de Situación Financiera — Activo (periodo comparativo 2024): "Total current assets"',
      'E27. Estado de Situación Financiera — Activo (periodo comparativo 2024): "Total non-current assets"',
    ]);

    const header = esfDelModelo(pp);
    header.balanceSheet.assets.unshift(linea(null, 'ACTIVO CORRIENTE', c(190000), null, { level: 1 }));
    header.balanceSheet.assets[3] = { ...header.balanceSheet.assets[3], amountComparative: null };
    const m = e27(header, pp);
    expect(m.some((x) => x.includes('"ACTIVO CORRIENTE" imprime $190.000,00'))).toBe(true);
    // El subtotal comparativo null no se trata como $0: no hay E27 para él.
    expect(m.some((x) => x.includes('comparativo 2024): "Total activo corriente"'))).toBe(false);
  });

  it('sin hojas del balance (validación sin anclas) E27 no corre', () => {
    const pp = preprocess({ '1205': 'no_corriente' });
    const json = esfDelModelo(pp);
    expect(validateNiifReportJson(json, {}).errors.filter((e) => e.startsWith('E27.'))).toEqual([]);
    // Hojas construidas a mano, sin plazo: no determinable, no se contrasta.
    const leaves = buildLedgerLeaves(pp.primary).map((l) => ({ code: l.code, classCode: l.classCode, cents: l.cents }));
    expect(
      validateNiifReportJson(json, { ledgers: { primary: leaves, comparative: null } }).errors
        .filter((e) => e.startsWith('E27.')),
    ).toEqual([]);
  });
});

describe('ruta real — runNiifPhase con el LLM simulado', () => {
  function mockPasses(json: NiifReportJson) {
    callFinancialAgentMock.mockImplementation(async (opts: { agentName: string }) => {
      if (opts.agentName.startsWith('niif-analyst-pass1')) {
        return {
          json: {
            company: json.company,
            balanceSheet: json.balanceSheet,
            incomeStatement: json.incomeStatement,
            curatorFlags: json.curatorFlags,
            reportMode: json.reportMode,
          },
          meta: {},
        };
      }
      if (opts.agentName === 'niif-analyst-pass2') {
        return { json: { cashFlow: json.cashFlow, equityChanges: { rows: json.equityChanges.rows, notes: [] } }, meta: {} };
      }
      return { json: { technicalNotes: [] }, meta: {} };
    });
  }
  const fase = (pp: PreprocessedBalance) =>
    runNiifPhase(
      {
        rawData: CSV_DOS_CORTES,
        company: { name: 'Demo Perdidas SAS', nit: '900123456-8', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 },
        language: 'es',
      },
      { preprocessed: pp },
    );

  it('sin excepciones el mismo ESF del modelo sale limpio', async () => {
    const pp = preprocess(null);
    mockPasses(esfDelModelo(pp));
    const phase = await fase(pp);
    expect(phase.niif.fullContent).not.toMatch(/\[NIIF JSON validator\]/);
    expect(phase.niif.reconciliation?.clean).toBe(true);
  });

  it('un ESF del modelo con subtotales distintos de los KPIs sale sellado sólo por E27', async () => {
    const pp = preprocess({ '1205': 'no_corriente', '2105': 'no_corriente' });
    mockPasses(esfDelModelo(pp));
    const phase = await fase(pp);
    expect(phase.niif.reconciliation?.clean).toBe(false);
    const reasons = phase.niif.fullContent.match(/E\d+[a-z]?\. [^\n]*/g) ?? [];
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.startsWith('E27.'))).toBe(true);
    expect(phase.niif.fullContent).toMatch(/E27\. Estado de Situación Financiera — Activo \(periodo 2025\): "Total activo corriente"/);
  });
});
