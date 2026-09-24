// ---------------------------------------------------------------------------
// El ESF determinista parte el grupo PUC según el plazo del preprocesador
// ---------------------------------------------------------------------------
// Integración P4-b (auditoría integral 2026-09-24): el usuario puede declarar
// el vencimiento real de una cuenta (`1205` → no corriente) y el preprocesador
// lo aplica a `controlTotals.activoCorriente` / `pasivoCorriente`, que usan los
// KPIs de liquidez, el gate, X03 y los ratios del PDF. El completado del ESF
// (`completeBreakdownFromSnapshot` / `fillComparativeBreakdownFromSnapshot`)
// ubicaba cada grupo de dos dígitos por `termOfGroup` e imprimía subtotales
// corriente / no corriente distintos de esas anclas. Lo mismo ocurría sin
// excepciones con las virtuales de R1 (`2810ZZ-13xxxx`): pasivo corriente por
// su origen en el preprocesador, grupo 28 no corriente en el ESF.
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  aplicarVencimientosDeclarados,
  parseTrialBalanceCSV,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
  type PeriodSnapshot,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { pesosToCents } from '@/lib/preprocessing/curator-rules/sync-control-totals';
import {
  buildDeterministicBreakdown,
  buildDeterministicBreakdownByTerm,
  buildLedgerLeaves,
  termOfGroup,
  type BreakdownSection,
} from '../contracts/deterministic-breakdown';
import {
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
  reconcileAnchors,
} from '../agents/reconcile-anchors';
import { buildReportAnchors } from '../contracts/anchors';
import { NiifReportSchema, type NiifReportJson } from '../contracts/niif-report';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import { validateNiifReportJson } from '../validators/niif-json-validator';

const ZERO = BigInt(0);
const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

// A 390.000 = P 150.000 + K 240.000 (mismo balance de vencimientos-declarados.test.ts).
const CSV = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,140000',
  '120505,CDT a 18 meses,Auxiliar,30000',
  '120510,Acciones negociables,Auxiliar,20000',
  '152405,Equipo de oficina,Auxiliar,200000',
  '210505,Crédito bancario a 3 años,Auxiliar,80000',
  '220505,Proveedores,Auxiliar,70000',
  '310505,Capital,Auxiliar,200000',
  '413505,Ventas,Auxiliar,100000',
  '510506,Sueldos,Auxiliar,60000',
].join('\n');

// Dos cortes: el comparativo 2024 también tiene 12 y 21.
const CSV_DOS_CORTES = [
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

function preprocess(csv: string, vencimientos: Record<string, 'corriente' | 'no_corriente'> | null) {
  const { rows, errores } = aplicarVencimientosDeclarados(parseTrialBalanceCSVWithMeta(csv).rows, vencimientos);
  expect(errores).toEqual([]);
  return preprocessTrialBalance(rows);
}

/** Informe con el ESF sin desglose: dispara el completado determinista. */
function informeSinDesglose(snap: PeriodSnapshot, cmp: PeriodSnapshot | null): NiifReportJson {
  const anchors = buildReportAnchors(snap, cmp ?? undefined);
  const json = makeCoherentNiifReport();
  json.balanceSheet.assets = [];
  json.balanceSheet.liabilities = [];
  json.balanceSheet.equity = [];
  json.balanceSheet.totalAssetsPrimary = String(anchors.primary!.cents.activo);
  json.balanceSheet.totalLiabilitiesPrimary = String(anchors.primary!.cents.pasivo);
  json.balanceSheet.totalEquityPrimary = String(anchors.primary!.cents.patrimonio);
  if (cmp) {
    json.company.comparativePeriod = cmp.period;
    json.balanceSheet.totalAssetsComparative = String(anchors.comparative!.cents.activo);
    json.balanceSheet.totalLiabilitiesComparative = String(anchors.comparative!.cents.pasivo);
    json.balanceSheet.totalEquityComparative = String(anchors.comparative!.cents.patrimonio);
  }
  return json;
}

/** Completa el ESF como lo hacen el analista (actual) y el orquestador (comparativo). */
function completar(pp: PreprocessedBalance): NiifReportJson {
  const json = informeSinDesglose(pp.primary, pp.comparative);
  const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
  const { json: done } = completeBreakdownFromSnapshot(json, gaps, pp.primary);
  return fillComparativeBreakdownFromSnapshot(done, pp.comparative ?? undefined).json;
}

type Col = 'amountPrimary' | 'amountComparative';
function subtotal(json: NiifReportJson, section: 'assets' | 'liabilities', label: string, col: Col) {
  const line = json.balanceSheet[section].find((l) => l.account === null && l.label === label);
  return line ? line[col] : undefined;
}

/** Subtotales impresos del ESF vs controlTotals del snapshot, al centavo. */
function expectSubtotalsMatchControlTotals(json: NiifReportJson, snap: PeriodSnapshot, col: Col) {
  const ct = snap.controlTotals;
  const cents = (pesos: number) => pesosToCents(pesos);
  const pairs: Array<[BreakdownSection & ('assets' | 'liabilities'), string, number]> = [
    ['assets', 'Total activo corriente', ct.activoCorriente],
    ['assets', 'Total activo no corriente', ct.activoNoCorriente],
    ['liabilities', 'Total pasivo corriente', ct.pasivoCorriente],
    ['liabilities', 'Total pasivo no corriente', ct.pasivoNoCorriente],
  ];
  for (const [section, label, expected] of pairs) {
    const printed = subtotal(json, section, label, col);
    // Un bloque vacío no imprime subtotal: su ancla debe ser cero.
    if (printed === undefined || printed === null) expect({ label, cents: cents(expected) }).toEqual({ label, cents: ZERO });
    else expect({ label, cents: BigInt(printed) }).toEqual({ label, cents: cents(expected) });
  }
}

function validationErrors(json: NiifReportJson, pp: PreprocessedBalance): string[] {
  const r = validateNiifReportJson(json, {
    ledgers: {
      primary: buildLedgerLeaves(pp.primary),
      comparative: pp.comparative ? buildLedgerLeaves(pp.comparative) : null,
    },
  });
  // E15 (subtotales/columna comparativa del ESF), E21 y E22 del ESF. El ERI
  // del informe base es sintético y no se ancla a este balance.
  return [...r.errors, ...r.warnings].filter(
    (m) => /^E15/.test(m) || (/^E2[12]\b/.test(m) && /Situación Financiera/.test(m)),
  );
}

describe('ESF determinista con excepciones de vencimiento (integración P4-b)', () => {
  it('1205 y 2105 → no corriente: los subtotales del ESF son los controlTotals (AC $140.000 / PC $70.000)', () => {
    const pp = preprocess(CSV, { '1205': 'no_corriente', '2105': 'no_corriente' });
    expect(pp.primary.controlTotals.activoCorriente).toBe(140000);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(70000);
    const done = completar(pp);

    expect(done.balanceSheet.assets.map((l) => [l.account, l.amountPrimary])).toEqual([
      ['11', '14000000'],
      [null, '14000000'],
      ['12', '5000000'],
      ['15', '20000000'],
      [null, '25000000'],
    ]);
    expect(done.balanceSheet.liabilities.map((l) => [l.account, l.label, l.amountPrimary])).toEqual([
      ['22', 'Proveedores', '7000000'],
      [null, 'Total pasivo corriente', '7000000'],
      ['21', 'Obligaciones financieras', '8000000'],
      [null, 'Total pasivo no corriente', '8000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    expect(reconcileAnchors(done, buildReportAnchors(pp.primary, undefined)).lineGaps).toEqual([]);
    expect(NiifReportSchema.safeParse(done).success).toBe(true);
    expect(validationErrors(done, pp)).toEqual([]);
  });

  it('una excepción sobre parte del grupo lo parte en dos renglones con su código, uno por bloque', () => {
    const pp = preprocess(CSV, { '120505': 'no_corriente' });
    expect(pp.primary.controlTotals.activoCorriente).toBe(160000);
    const done = completar(pp);
    expect(done.balanceSheet.assets.map((l) => [l.account, l.label, l.amountPrimary])).toEqual([
      ['11', 'Efectivo y equivalentes de efectivo', '14000000'],
      ['12', 'Inversiones', '2000000'],
      [null, 'Total activo corriente', '16000000'],
      ['12', 'Inversiones', '3000000'],
      ['15', 'Propiedades, planta y equipo', '20000000'],
      [null, 'Total activo no corriente', '23000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    // E21 ancla el grupo 12 por la unión de sus dos renglones.
    expect(validationErrors(done, pp)).toEqual([]);
  });

  it('dos cortes: la columna comparativa se parte con los vencimientos de SU snapshot', () => {
    const pp = preprocess(CSV_DOS_CORTES, { '120505': 'no_corriente', '2105': 'no_corriente' });
    expect(pp.comparative).not.toBeNull();
    const done = completar(pp);
    expect(
      done.balanceSheet.assets.map((l) => [l.account, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      ['11', '14000000', '10000000'],
      ['12', '2000000', '1500000'],
      [null, '16000000', '11500000'],
      ['12', '3000000', '1000000'],
      ['15', '20000000', '15000000'],
      [null, '23000000', '16000000'],
    ]);
    expect(
      done.balanceSheet.liabilities.map((l) => [l.account, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      ['22', '7000000', '2500000'],
      [null, '7000000', '2500000'],
      ['21', '8000000', '5000000'],
      [null, '8000000', '5000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    expectSubtotalsMatchControlTotals(done, pp.comparative!, 'amountComparative');
    expect(validationErrors(done, pp)).toEqual([]);
  });

  it('un plazo que sólo existe en el comparativo entra en su bloque con importe actual 0', () => {
    // 2024 tenía 120505 (no corriente declarado); en 2025 la cuenta se canceló.
    const csv = [
      'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
      '110505,Caja,Auxiliar,100000,170000',
      '120505,CDT a 18 meses,Auxiliar,30000,0',
      '120510,Acciones negociables,Auxiliar,20000,20000',
      '220505,Proveedores,Auxiliar,50000,90000',
      '310505,Capital,Auxiliar,100000,100000',
    ].join('\n');
    const pp = preprocess(csv, { '120505': 'no_corriente' });
    const done = completar(pp);
    expect(
      done.balanceSheet.assets.map((l) => [l.account, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      ['11', '17000000', '10000000'],
      ['12', '2000000', '2000000'],
      [null, '19000000', '12000000'],
      ['12', '0', '3000000'],
      [null, '0', '3000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    expectSubtotalsMatchControlTotals(done, pp.comparative!, 'amountComparative');
    expect(validationErrors(done, pp)).toEqual([]);
  });

  it('sin excepciones, el ESF completado es idéntico al de la clasificación por grupo (no regresión)', () => {
    const pp = preprocess(CSV_DOS_CORTES, null);
    const done = completar(pp);
    expect(
      done.balanceSheet.assets.map((l) => [l.account, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      ['11', '14000000', '10000000'],
      ['12', '5000000', '2500000'],
      [null, '19000000', '12500000'],
      ['15', '20000000', '15000000'],
      [null, '20000000', '15000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    expectSubtotalsMatchControlTotals(done, pp.comparative!, 'amountComparative');
  });
});

describe('ESF determinista con virtuales de R1 (desajuste preexistente, niif-preproceso-22)', () => {
  // 133005 con saldo crédito material: R1 lo publica como pasivo `2810ZZ-133005`,
  // corriente por su origen (NIC 1 párr. 69-71) en controlTotals.
  const CSV_R1 = [
    'codigo,nombre,nivel,Saldo 2024,Saldo 2025',
    '110505,Caja,Auxiliar,450000,500000',
    '133005,Anticipos,Auxiliar,-50000,-100000',
    '220505,Proveedores,Auxiliar,80000,100000',
    '280505,Anticipos recibidos largo plazo,Auxiliar,20000,0',
    '310505,Capital,Auxiliar,300000,300000',
  ].join('\n');

  it('la virtual 2810ZZ-13xxxx se presenta en pasivo corriente, como en controlTotals', () => {
    const pp = preprocess(CSV_R1, null);
    const virtual = pp.primary.classes
      .find((c) => c.code === 2)!
      .accounts.find((a) => a.code.endsWith('-133005'));
    expect(virtual?.code.startsWith('28')).toBe(true);
    expect(pp.primary.controlTotals.pasivoCorriente).toBe(200000);
    expect(pp.primary.controlTotals.pasivoNoCorriente).toBe(0);

    const done = completar(pp);
    expect(
      done.balanceSheet.liabilities.map((l) => [l.account, l.label, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      ['22', 'Proveedores', '10000000', '8000000'],
      ['28', 'Otros pasivos', '10000000', '5000000'],
      [null, 'Total pasivo corriente', '20000000', '13000000'],
      ['28', 'Otros pasivos', '0', '2000000'],
      [null, 'Total pasivo no corriente', '0', '2000000'],
    ]);
    expectSubtotalsMatchControlTotals(done, pp.primary, 'amountPrimary');
    expectSubtotalsMatchControlTotals(done, pp.comparative!, 'amountComparative');
    expect(validationErrors(done, pp)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Barrido de fixtures: la partición por plazo del desglose determinista es la
// de controlTotals en todos los balances del repo, y sin excepciones ni
// virtuales de R1 es la agregación por grupo de siempre.
// ---------------------------------------------------------------------------

async function loadRealBalanceCsv(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(FIXTURES, 'grupo-empresarial-2tres-sas.xlsx'));
  const ws = wb.worksheets[0];
  const lines: string[] = [];
  const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  ws.eachRow((row) => {
    const values = row.values as unknown[];
    lines.push(
      values
        .slice(1)
        .map((v) => {
          if (v === null || v === undefined) return '';
          if (typeof v === 'string') return csvCell(v);
          if (typeof v === 'number') return String(v);
          const o = v as { text?: string; result?: unknown };
          return csvCell(o.text ?? (o.result !== undefined ? String(o.result) : String(v)));
        })
        .join(','),
    );
  });
  return lines.slice(7).join('\n');
}

function csvFixtures(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.csv')) out.push([path.relative(FIXTURES, full), fs.readFileSync(full, 'utf8')]);
    }
  };
  walk(FIXTURES);
  return out.sort(([a], [b]) => a.localeCompare(b));
}

function sumByTerm(snap: PeriodSnapshot, section: 'assets' | 'liabilities') {
  const acc = { current: ZERO, nonCurrent: ZERO, none: ZERO };
  for (const r of buildDeterministicBreakdownByTerm(snap, section)) acc[r.term ?? 'none'] += r.cents;
  return acc;
}

describe('buildDeterministicBreakdownByTerm — barrido de fixtures', () => {
  it('en cada snapshot de cada fixture, Σ por plazo = controlTotals y Σ por grupo = desglose por grupo', async () => {
    const fixtures = [...csvFixtures(), ['grupo-empresarial-2tres-sas.xlsx', await loadRealBalanceCsv()] as [string, string]];
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    let snapshots = 0;
    let conR1 = 0;
    for (const [name, csv] of fixtures) {
      let pp: PreprocessedBalance;
      try {
        pp = preprocessTrialBalance(parseTrialBalanceCSV(csv));
      } catch {
        continue; // p. ej. cifras > 2^53: el preprocesador rechaza el archivo.
      }
      for (const snap of pp.periods) {
        const ct = snap.controlTotals;
        if (![ct.activoCorriente, ct.activoNoCorriente, ct.pasivoCorriente, ct.pasivoNoCorriente].every(Number.isFinite)) continue;
        snapshots++;
        const a = sumByTerm(snap, 'assets');
        const p = sumByTerm(snap, 'liabilities');
        const ctx = `${name} [${snap.period}]`;
        expect({ ctx, a: a.current, b: a.nonCurrent }).toEqual({
          ctx,
          a: pesosToCents(ct.activoCorriente),
          b: pesosToCents(ct.activoNoCorriente),
        });
        expect({ ctx, a: p.current, b: p.nonCurrent }).toEqual({
          ctx,
          a: pesosToCents(ct.pasivoCorriente),
          b: pesosToCents(ct.pasivoNoCorriente),
        });

        const hasR1 = (snap.classes.find((c) => c.code === 2)?.accounts ?? []).some((x) => /-\d/.test(x.code));
        if (hasR1) conR1++;
        for (const section of ['assets', 'liabilities', 'equity'] as const) {
          const byGroup = buildDeterministicBreakdown(snap, section);
          const byTerm = buildDeterministicBreakdownByTerm(snap, section);
          const regrouped = new Map<string, bigint>();
          for (const r of byTerm) regrouped.set(r.account, (regrouped.get(r.account) ?? ZERO) + r.cents);
          expect({ ctx, section, rows: [...regrouped].filter(([, c]) => c !== ZERO) }).toEqual({
            ctx,
            section,
            rows: byGroup.map((r) => [r.account, r.cents]),
          });
          // Sin excepciones ni R1: los mismos renglones, en el bloque de su grupo.
          if (!hasR1 && !snap.vencimientosAplicados) {
            expect(byTerm).toEqual(
              byGroup.map((r) => ({ ...r, term: termOfGroup(section, r.account) })),
            );
          }
        }
      }
    }
    expect(snapshots).toBeGreaterThanOrEqual(12);
    expect(conR1).toBeGreaterThan(0);
  });
});

describe('fillComparativeBreakdownFromSnapshot — formas que no son el completado por plazo', () => {
  type Acc = [code: string, balancePesos: number];
  function snap(period: string, accs: Acc[], aplicados?: PeriodSnapshot['vencimientosAplicados']): PeriodSnapshot {
    const classes = [1, 2, 3].map((code) => ({
      code,
      name: `Clase ${code}`,
      auxiliaryTotal: 0,
      reportedTotal: null,
      discrepancy: 0,
      accounts: accs
        .filter(([c]) => c.startsWith(String(code)))
        .map(([c, b]) => ({ code: c, name: c, level: 'Auxiliar', balance: b, isLeaf: true })),
    }));
    return { period, classes, controlTotals: {}, ...(aplicados ? { vencimientosAplicados: aplicados } : {}) } as unknown as PeriodSnapshot;
  }

  it('si el comparativo tiene un grupo sin plazo, la sección vuelve a la agregación por grupo sin subtotales', () => {
    const primary = snap(
      '2025',
      [['110505', 1000], ['120505', 300], ['120510', 200], ['220505', 1500]],
      [{ codigo: '120505', seccion: 'activo', vencimiento: 'no_corriente', saldo: 300 }],
    );
    const comparative = snap('2024', [['110505', 800], ['120510', 100], ['1A0505', 50], ['220505', 950]]);
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    json.balanceSheet.assets = [];
    json.balanceSheet.totalAssetsPrimary = '150000';
    json.balanceSheet.totalAssetsComparative = '95000';
    const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps.filter(
      (g) => g.statement === 'Activo',
    );
    const { json: done } = completeBreakdownFromSnapshot(json, gaps, primary);
    expect(done.balanceSheet.assets.map((l) => [l.account, l.amountPrimary])).toEqual([
      ['11', '100000'],
      ['12', '20000'],
      [null, '120000'],
      ['12', '30000'],
      [null, '30000'],
    ]);
    const { json: filled } = fillComparativeBreakdownFromSnapshot(done, comparative);
    expect(
      filled.balanceSheet.assets.map((l) => [l.account, l.amountPrimary, l.amountComparative]),
    ).toEqual([
      // '1A0505' → dígitos 10505 → grupo 10, sin plazo determinable.
      ['10', '0', '5000'],
      ['11', '100000', '80000'],
      ['12', '50000', '10000'],
    ]);
  });

  it('un desglose por grupo con subtotales propios del modelo conserva la clasificación por grupo PUC', () => {
    const comparative = snap(
      '2024',
      [['110505', 800], ['120505', 300], ['160505', 200]],
      [{ codigo: '120505', seccion: 'activo', vencimiento: 'no_corriente', saldo: 300 }],
    );
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    const l = (account: string | null, label: string, amount: string, level: 2 | 3 = 2) => ({
      account, label, amountPrimary: amount, amountComparative: null, level,
      isAbsolute: false, confidence: null, anomalyFlag: null,
    });
    json.balanceSheet.assets = [
      l('11', 'Efectivo', '100000'),
      l('12', 'Inversiones', '30000'),
      l(null, 'Activos corrientes', '130000', 3),
    ];
    const { json: filled } = fillComparativeBreakdownFromSnapshot(json, comparative);
    // Comportamiento previo a P4-b: grupos por `termOfGroup`, comparativo por grupo.
    expect(
      filled.balanceSheet.assets.map((x) => [x.account, x.label, x.amountPrimary, x.amountComparative]),
    ).toEqual([
      ['11', 'Efectivo', '100000', '80000'],
      ['12', 'Inversiones', '30000', '30000'],
      [null, 'Total activo corriente', '130000', '110000'],
      ['16', 'Intangibles', '0', '20000'],
      [null, 'Total activo no corriente', '0', '20000'],
    ]);
  });

  // Revisión I2: el modelo rotula sus subtotales igual que el completado
  // ("Total activo corriente") y ubica un grupo en un bloque distinto del que
  // le da el snapshot comparativo (17 diferidos en corriente), con su columna
  // comparativa ya escrita. Antes el renglón conservaba la cifra del modelo y
  // el grupo se añadía otra vez en el bloque no corriente: comparativo doble.
  const lm = (account: string | null, label: string, amount: string, cmp: string | null, level: 2 | 3 = 2) => ({
    account, label, amountPrimary: amount, amountComparative: cmp, level,
    isAbsolute: false, confidence: null, anomalyFlag: null,
  });
  const comparativeSum = (lines: NiifReportJson['balanceSheet']['assets']) =>
    lines.filter((x) => x.account !== null).reduce((acc, x) => acc + BigInt(x.amountComparative ?? '0'), ZERO);

  it('revisión I2: un grupo que el modelo ubica en otro bloque y ya trae comparativo no se duplica', () => {
    const comparative = snap('2024', [['110505', 800], ['170505', 200]]);
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    json.balanceSheet.assets = [
      lm('11', 'Efectivo', '100000', '80000'),
      lm('17', 'Gastos pagados por anticipado', '30000', '20000'),
      lm(null, 'Total activo corriente', '130000', '100000', 3),
    ] as never;
    const { json: filled, filled: which } = fillComparativeBreakdownFromSnapshot(json, comparative);
    expect(which).toEqual([]);
    expect(filled.balanceSheet.assets).toEqual(json.balanceSheet.assets);
    expect(comparativeSum(filled.balanceSheet.assets)).toBe(BigInt(100000));
  });

  it('revisión I2: si otro grupo falta, el renglón recibe la cifra de su grupo y no aparece dos veces', () => {
    const comparative = snap('2024', [['110505', 800], ['130505', 50], ['170505', 200]]);
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    json.balanceSheet.assets = [
      lm('11', 'Efectivo', '100000', '80000'),
      lm('17', 'Gastos pagados por anticipado', '30000', '99999'),
      lm(null, 'Total activo corriente', '130000', '179999', 3),
    ] as never;
    const { json: filled } = fillComparativeBreakdownFromSnapshot(json, comparative);
    expect(
      filled.balanceSheet.assets.map((x) => [x.account, x.amountPrimary, x.amountComparative]),
    ).toEqual([
      ['11', '100000', '80000'],
      ['13', '0', '5000'],
      ['17', '30000', '20000'],
      [null, '130000', '105000'],
    ]);
    expect(comparativeSum(filled.balanceSheet.assets)).toBe(BigInt(105000));
  });

  it('revisión I2: un grupo que el modelo partió en dos renglones con comparativo propio se deja como vino', () => {
    // El 12 del comparativo no está en la sección: sin la salvaguarda, el
    // completado corría, ponía los $300 del 13 en el renglón corriente y
    // dejaba los $100 del modelo en el no corriente (13 contado dos veces).
    const comparative = snap('2024', [['110505', 800], ['120505', 40], ['130505', 300]]);
    const json = makeCoherentNiifReport();
    json.company.comparativePeriod = '2024';
    json.balanceSheet.assets = [
      lm('11', 'Efectivo', '100000', '80000'),
      lm('13', 'Deudores corto plazo', '20000', '20000'),
      lm(null, 'Total activo corriente', '120000', '100000', 3),
      lm('13', 'Deudores largo plazo', '10000', '10000'),
      lm(null, 'Total activo no corriente', '10000', '10000', 3),
    ] as never;
    const { json: filled, filled: which } = fillComparativeBreakdownFromSnapshot(json, comparative);
    expect(which).toEqual([]);
    expect(filled.balanceSheet.assets).toEqual(json.balanceSheet.assets);
  });
});
