// ---------------------------------------------------------------------------
// El completado determinista del ESF conserva corriente / no corriente
// ---------------------------------------------------------------------------
// Hallazgo niif-contrato-07 (auditoría 2026-09): completeBreakdownFromSnapshot
// reemplazaba la sección por renglones de grupo PUC sin subtotales y la
// clasificación corriente / no corriente (NIIF PYMES 4.4) desaparecía.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import {
  completeBreakdownFromSnapshot,
  fillComparativeBreakdownFromSnapshot,
  reconcileAnchors,
} from '../agents/reconcile-anchors';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import { validateNiifReportJson } from '../validators/niif-json-validator';
import { NiifReportSchema } from '../contracts/niif-report';

type Acc = [code: string, balancePesos: number];
function snap(period: string, accs: Acc[]): PeriodSnapshot {
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
  return { period, classes, controlTotals: {} } as unknown as PeriodSnapshot;
}

const PRIMARY = snap('2025', [
  ['110505', 1000], ['130505', 2000], ['152405', 5000], ['159205', -1000],
  ['220505', 1500], ['280505', 500], ['310505', 5000],
]);
const COMPARATIVE = snap('2024', [
  ['110505', 800], ['130505', 1500], ['152405', 4000], ['159205', -500], ['160505', 200],
  ['220505', 1000], ['310505', 5000],
]);

function reportConDesgloseIncompleto() {
  const json = makeCoherentNiifReport();
  json.balanceSheet.assets = [];
  json.balanceSheet.liabilities = [];
  json.balanceSheet.equity = [];
  json.balanceSheet.totalAssetsPrimary = '700000';
  json.balanceSheet.totalLiabilitiesPrimary = '200000';
  json.balanceSheet.totalEquityPrimary = '500000';
  return json;
}

describe('completeBreakdownFromSnapshot — corriente / no corriente (niif-contrato-07)', () => {
  it('emite los subtotales de activo y pasivo corriente y no corriente', () => {
    const json = reportConDesgloseIncompleto();
    const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
    const { json: done } = completeBreakdownFromSnapshot(json, gaps, PRIMARY, COMPARATIVE);
    const assets = done.balanceSheet.assets.map((l) => [l.account, l.label, l.amountPrimary]);
    expect(assets).toEqual([
      ['11', 'Efectivo y equivalentes de efectivo', '100000'],
      ['13', 'Deudores comerciales y otras cuentas por cobrar', '200000'],
      [null, 'Total activo corriente', '300000'],
      ['15', 'Propiedades, planta y equipo', '400000'],
      [null, 'Total activo no corriente', '400000'],
    ]);
    const liabilities = done.balanceSheet.liabilities.map((l) => [l.account, l.amountPrimary]);
    expect(liabilities).toEqual([
      ['22', '150000'],
      [null, '150000'],
      ['28', '50000'],
      [null, '50000'],
    ]);
    // Los subtotales no alteran el cuadre del detalle.
    expect(reconcileAnchors(done, { primary: null, comparative: null }).lineGaps).toEqual([]);
    expect(NiifReportSchema.safeParse(done).success).toBe(true);
  });

  it('el validador acepta los subtotales generados (E15 sin avisos)', () => {
    const json = reportConDesgloseIncompleto();
    const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
    const { json: done } = completeBreakdownFromSnapshot(json, gaps, PRIMARY);
    const r = validateNiifReportJson(done);
    expect(r.warnings.filter((w) => w.startsWith('E15'))).toEqual([]);
  });

  it('el relleno comparativo recalcula los subtotales e incluye los grupos que desaparecieron', () => {
    const json = reportConDesgloseIncompleto();
    const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
    const { json: done } = completeBreakdownFromSnapshot(json, gaps, PRIMARY);
    const { json: filled } = fillComparativeBreakdownFromSnapshot(done, COMPARATIVE);
    const assets = filled.balanceSheet.assets.map((l) => [l.account, l.amountPrimary, l.amountComparative]);
    expect(assets).toEqual([
      ['11', '100000', '80000'],
      ['13', '200000', '150000'],
      [null, '300000', '230000'],
      ['15', '400000', '350000'],
      ['16', '0', '20000'],
      [null, '400000', '370000'],
    ]);
  });

  it('un grupo sin plazo determinable deja la sección sin subtotales y lo declara en notas', () => {
    const odd = snap('2025', [['110505', 1000], ['190505', 0], ['1A0505', 500], ['310505', 1500]]);
    const json = reportConDesgloseIncompleto();
    json.balanceSheet.totalAssetsPrimary = '150000';
    json.balanceSheet.totalLiabilitiesPrimary = '0';
    json.balanceSheet.totalEquityPrimary = '150000';
    const gaps = reconcileAnchors(json, { primary: null, comparative: null }).lineGaps;
    const { json: done } = completeBreakdownFromSnapshot(json, gaps, odd);
    expect(done.balanceSheet.assets.every((l) => l.account !== null)).toBe(true);
    expect(done.balanceSheet.notes.some((n) => n.norma === 'NIIF para PYMES, Sección 4.4')).toBe(true);
  });
});
