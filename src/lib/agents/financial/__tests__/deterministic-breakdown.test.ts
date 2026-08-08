// ---------------------------------------------------------------------------
// Desglose determinista del Balance — regresión (2026-08-08)
// ---------------------------------------------------------------------------
// Medido con LLM real: el modelo copia los totales sin error (9/9 anclas en tres
// corridas) y omite renglones del desglose de forma inestable (0,10% · 41,2% ·
// 99,9% del Activo según la corrida; en una, el Pasivo salió con los dos
// encabezados de sección y ningún renglón).
//
// Se probó primero reinvocar el pase con la brecha exacta en pesos inyectada en
// el prompt. El bucle dispara, cuesta ~110s, y el desglose sigue incompleto. Por
// eso el desglose lo construye el código desde el balance preprocesado.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PeriodSnapshot,
} from '@/lib/preprocessing/trial-balance';
import {
  buildDeterministicBreakdown,
  isNonCurrentGroup,
} from '../contracts/deterministic-breakdown';
import {
  reconcileAnchors,
  completeBreakdownFromSnapshot,
} from '../agents/reconcile-anchors';
import { buildReportAnchors } from '../contracts/anchors';
import type { NiifReportJson } from '../contracts/niif-report';

const FIXTURES = path.resolve(process.cwd(), 'src/lib/preprocessing/__fixtures__');

function snapshotFromFixture(): PeriodSnapshot {
  const csv = fs.readFileSync(path.join(FIXTURES, 'elite-pulido-diamante.csv'), 'utf8');
  return preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
}

function sum(rows: Array<{ cents: bigint }>): bigint {
  return rows.reduce((acc, r) => acc + r.cents, BigInt(0));
}

describe('buildDeterministicBreakdown', () => {
  it('el desglose del Activo suma EXACTAMENTE el total de la clase', () => {
    const snap = snapshotFromFixture();
    const rows = buildDeterministicBreakdown(snap, 'assets');
    const anchors = buildReportAnchors(snap, undefined).primary!;

    expect(rows.length).toBeGreaterThan(0);
    expect(sum(rows)).toBe(anchors.cents.activo!);
  });

  it('el desglose del Pasivo y del Patrimonio también cuadran al centavo', () => {
    const snap = snapshotFromFixture();
    const anchors = buildReportAnchors(snap, undefined).primary!;
    expect(sum(buildDeterministicBreakdown(snap, 'liabilities'))).toBe(anchors.cents.pasivo!);
    expect(sum(buildDeterministicBreakdown(snap, 'equity'))).toBe(anchors.cents.patrimonio!);
  });

  it('agrupa por grupo PUC de dos dígitos y etiqueta en NIIF', () => {
    const rows = buildDeterministicBreakdown(snapshotFromFixture(), 'assets');
    for (const row of rows) expect(row.account).toMatch(/^\d{2}$/);
    const efectivo = rows.find((r) => r.account === '11');
    expect(efectivo?.label).toBe('Efectivo y equivalentes de efectivo');
  });

  it('una correctora reduce su grupo en vez de aparecer como rubro propio', () => {
    // La 1592 (depreciación acumulada) vive dentro del grupo 15. Agregar por
    // grupo produce el importe en libros NETO que exigen NIC 16.73 y
    // NIIF PYMES 17.31, sin renglón negativo suelto que el lector no sepa dónde
    // encajar.
    const rows = buildDeterministicBreakdown(snapshotFromFixture(), 'assets');
    expect(rows.find((r) => r.account === '15')).toBeDefined();
    expect(rows.find((r) => r.account === '159')).toBeUndefined();
  });

  it('marca como no corriente sólo lo que lo es por naturaleza', () => {
    // PPE, intangibles y valorizaciones no dependen del caso. El resto sí, y
    // por eso el juicio se le deja al modelo.
    expect(isNonCurrentGroup('assets', '15')).toBe(true);
    expect(isNonCurrentGroup('assets', '16')).toBe(true);
    expect(isNonCurrentGroup('assets', '11')).toBe(false);
    expect(isNonCurrentGroup('assets', '13')).toBe(false);
    expect(isNonCurrentGroup('liabilities', '22')).toBe(false);
  });
});

describe('completeBreakdownFromSnapshot', () => {
  const snap = snapshotFromFixture();
  const anchors = buildReportAnchors(snap, undefined);

  function reportWithBrokenAssets(): NiifReportJson {
    const c = anchors.primary!.cents;
    return {
      company: { name: 'X', nit: '900', fiscalPeriod: '2025', comparativePeriod: null },
      balanceSheet: {
        // Reproduce la corrida medida: dos renglones menores bajo el total real.
        assets: [
          {
            account: '18',
            label: 'Otros activos',
            amountPrimary: '1000',
            amountComparative: null,
            level: 2,
            isAbsolute: true,
          },
        ],
        liabilities: [],
        equity: [],
        totalAssetsPrimary: c.activo!.toString(),
        totalAssetsComparative: null,
        totalLiabilitiesPrimary: c.pasivo!.toString(),
        totalLiabilitiesComparative: null,
        totalEquityPrimary: c.patrimonio!.toString(),
        totalEquityComparative: null,
        notes: [],
        modeBanner: null,
      },
      incomeStatement: {
        lines: [],
        grossProfitPrimary: '0',
        grossProfitComparative: null,
        operatingProfitPrimary: '0',
        operatingProfitComparative: null,
        netIncomePrimary: c.utilidadNeta!.toString(),
        netIncomeComparative: null,
        oriPrimary: '0',
        oriComparative: null,
        notes: [],
        modeBanner: null,
      },
    } as unknown as NiifReportJson;
  }

  it('cierra la brecha del desglose que el modelo dejó abierta', () => {
    const roto = reportWithBrokenAssets();
    const antes = reconcileAnchors(roto, anchors);
    expect(antes.lineGaps.length).toBeGreaterThan(0);

    const { json, completed } = completeBreakdownFromSnapshot(
      antes.json,
      antes.lineGaps,
      snap,
    );
    expect(completed).toContain('Activo');

    const despues = reconcileAnchors(json, anchors);
    expect(despues.lineGaps).toEqual([]);
    expect(despues.repairInstructions).toEqual([]);
  });

  it('conserva la etiqueta que escribió el modelo cuando el grupo coincide', () => {
    // La redacción NIIF es del modelo; la aritmética, no.
    const roto = reportWithBrokenAssets();
    roto.balanceSheet.assets = [
      {
        account: '11',
        label: 'Caja, bancos y equivalentes (redacción del analista)',
        amountPrimary: '1',
        amountComparative: null,
        level: 2,
        isAbsolute: true,
      },
    ] as typeof roto.balanceSheet.assets;

    const r = reconcileAnchors(roto, anchors);
    const { json } = completeBreakdownFromSnapshot(r.json, r.lineGaps, snap);
    const efectivo = json.balanceSheet.assets.find((l) => l.account === '11');
    expect(efectivo?.label).toBe('Caja, bancos y equivalentes (redacción del analista)');
  });

  it('no toca un estado cuyo desglose ya cuadra', () => {
    const rows = buildDeterministicBreakdown(snap, 'assets');
    const bueno = reportWithBrokenAssets();
    bueno.balanceSheet.assets = rows.map((r) => ({
      account: r.account,
      label: r.label,
      amountPrimary: r.cents.toString(),
      amountComparative: null,
      level: 2,
      isAbsolute: false,
    })) as typeof bueno.balanceSheet.assets;

    const r = reconcileAnchors(bueno, anchors);
    const gapActivo = r.lineGaps.find((g) => g.statement === 'Activo');
    expect(gapActivo).toBeUndefined();

    const { completed } = completeBreakdownFromSnapshot(r.json, r.lineGaps, snap);
    expect(completed).not.toContain('Activo');
  });

  it('es inocuo sin snapshot — no inventa renglones', () => {
    const roto = reportWithBrokenAssets();
    const r = reconcileAnchors(roto, anchors);
    const { json, completed } = completeBreakdownFromSnapshot(r.json, r.lineGaps, undefined);
    expect(completed).toEqual([]);
    expect(json.balanceSheet.assets).toHaveLength(1);
  });
});
