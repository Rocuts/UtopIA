// ---------------------------------------------------------------------------
// EFE determinista: movimientos patrimoniales, dividendos y correctoras
// ---------------------------------------------------------------------------
// Hallazgos niif-contrato-03, niif-contrato-04 y niif-contrato-05 (auditoría
// 2026-09). NIC 7 ¶43 / NIIF PYMES 7.18: las transacciones no monetarias
// (apropiación de reservas, capitalización de utilidades) se excluyen del EFE.
// NIC 7 ¶34 / NIIF PYMES 7.14-7.16: los dividendos pagados se presentan por
// separado; la política de la herramienta es actividades de financiación.
// NIC 7 ¶18(b): la depreciación/amortización/deterioro se devuelve a
// operación como partida no monetaria.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import { buildDeterministicCashFlow } from '../contracts/deterministic-breakdown';

type Acc = [code: string, balancePesos: number];

/** Snapshot mínimo: clases 1/2/3 con hojas en convención natural. */
function snap(
  period: string,
  accs: Acc[],
  utilidadNeta: number,
  findings?: PeriodSnapshot['findings'],
): PeriodSnapshot {
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
  const cash = accs.filter(([c]) => c.startsWith('11')).reduce((a, [, b]) => a + b, 0);
  return {
    period,
    classes,
    controlTotals: { utilidadNeta, efectivoCuenta11: cash },
    findings,
  } as unknown as PeriodSnapshot;
}

const cents = (pesos: number) => BigInt(Math.round(pesos * 100));
const section = (efe: NonNullable<ReturnType<typeof buildDeterministicCashFlow>>, s: string) =>
  efe.sections.find((x) => x.section === s)!;

// Comparativo 2024: caja 1.000, capital 500, utilidad 2024 en 3605 = 500.
const OPENING: Acc[] = [['110505', 1000], ['310505', 500], ['360505', 500]];

describe('EFE determinista — traslados internos del patrimonio (niif-contrato-03)', () => {
  it('la apropiación de la reserva legal no es flujo: FEO = utilidad del año, FEF = 0', () => {
    // De la utilidad 2024 (500): 50 a reserva legal 3305 y 450 a 3705. Utilidad 2025 = 300 en caja.
    const closing: Acc[] = [['110505', 1300], ['310505', 500], ['330505', 50], ['370505', 450], ['360505', 300]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    expect(efe.reconciled).toBe(true);
    expect(section(efe, 'operating').netFlowCents).toBe(cents(300));
    expect(section(efe, 'financing').netFlowCents).toBe(cents(0));
    expect(section(efe, 'financing').rows).toEqual([]);
    // Se revela como movimiento no monetario (NIC 7 ¶43).
    expect(efe.nonCashEquityMovements.some((r) => r.account === '33' && r.cents === cents(50))).toBe(true);
  });

  it('la capitalización de utilidades no aparece como "Aportes de capital"', () => {
    const closing: Acc[] = [['110505', 1300], ['310505', 700], ['370505', 300], ['360505', 300]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    expect(efe.reconciled).toBe(true);
    expect(section(efe, 'financing').netFlowCents).toBe(cents(0));
    expect(section(efe, 'financing').rows.some((r) => /Aportes/.test(r.label))).toBe(false);
    expect(section(efe, 'operating').netFlowCents).toBe(cents(300));
  });

  it('el traslado 3605 → 3705 no genera renglones de conciliación ±500 en operación', () => {
    const closing: Acc[] = [['110505', 1300], ['310505', 500], ['370505', 500], ['360505', 300]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    const op = section(efe, 'operating');
    expect(op.rows.map((r) => r.account)).toEqual(['36']);
    expect(op.netFlowCents).toBe(cents(300));
  });

  it('un aporte de capital en efectivo sí es flujo de financiación', () => {
    const closing: Acc[] = [['110505', 1500], ['310505', 700], ['370505', 500], ['360505', 300]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    expect(efe.reconciled).toBe(true);
    const fin = section(efe, 'financing');
    expect(fin.netFlowCents).toBe(cents(200));
    expect(efe.ownerFlows.classification).toBe('contribution');
  });
});

describe('EFE determinista — dividendos (niif-contrato-04)', () => {
  it('dividendo decretado y pagado en el mismo año (2360 neto 0) sale en financiación, no como partida no monetaria', () => {
    // De la utilidad 2024 (500) se pagan 200 en efectivo; 300 quedan en 3705.
    const closing: Acc[] = [['110505', 1100], ['310505', 500], ['370505', 300], ['360505', 300]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    expect(efe.reconciled).toBe(true);
    expect(efe.dividendEvidence.found).toBe(false);
    const fin = section(efe, 'financing');
    expect(fin.netFlowCents).toBe(cents(-200));
    expect(fin.rows).toHaveLength(1);
    expect(fin.rows[0].label).toMatch(/Distribuciones a socios/);
    expect(fin.rows[0].label).toMatch(/pendiente de soporte/);
    expect(efe.ownerFlows.classification).toBe('distribution_pending_support');
    const op = section(efe, 'operating');
    expect(op.rows.some((r) => /no monetaria/.test(r.label))).toBe(false);
    expect(op.netFlowCents).toBe(cents(300));
  });

  it('dividendo decretado y no pagado (2360 sube) no es salida de caja', () => {
    const closing: Acc[] = [
      ['110505', 1300], ['236005', 200], ['310505', 500], ['370505', 300], ['360505', 300],
    ];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', OPENING, 500))!;
    expect(efe.reconciled).toBe(true);
    expect(efe.dividendEvidence.found).toBe(true);
    expect(section(efe, 'financing').netFlowCents).toBe(cents(0));
    expect(section(efe, 'operating').netFlowCents).toBe(cents(300));
  });

  it('con el comparativo sin cierre (P&G posiblemente acumulado) la brecha se declara no conciliada, sin presumirla distribución ni no monetaria', () => {
    // Utilidad publicada 800 = 500 (2024, nunca trasladada) + 300 (2025).
    const closing: Acc[] = [['110505', 1300], ['310505', 500], ['360505', 800]];
    const efe = buildDeterministicCashFlow(
      snap('2025', closing, 800),
      snap('2024', OPENING, 500, { librosNoCerrados: true }),
    )!;
    expect(efe.reconciled).toBe(true);
    expect(efe.ownerFlows.classification).toBe('unreconciled');
    const op = section(efe, 'operating');
    const row = op.rows.find((r) => r.cents === cents(-500))!;
    expect(row.label).toMatch(/no conciliada/);
    expect(row.label).not.toMatch(/no monetaria/);
    expect(section(efe, 'financing').netFlowCents).toBe(cents(0));
  });
});

describe('EFE determinista — correctoras (niif-contrato-05)', () => {
  it('la amortización acumulada de intangibles (1698) se devuelve a operación', () => {
    const opening: Acc[] = [['110505', 1000], ['160505', 1000], ['169805', -100], ['310505', 1900]];
    const closing: Acc[] = [['110505', 1500], ['160505', 1000], ['169805', -200], ['310505', 1900], ['360505', 400]];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 400), snap('2024', opening, 0))!;
    expect(efe.reconciled).toBe(true);
    expect(section(efe, 'operating').netFlowCents).toBe(cents(500));
    expect(section(efe, 'investing').netFlowCents).toBe(cents(0));
  });

  it('la amortización 1597 y el deterioro 1599 del grupo 15 también vuelven a operación', () => {
    const opening: Acc[] = [['110505', 1000], ['152405', 1000], ['159705', -50], ['159905', 0], ['310505', 1950]];
    const closing: Acc[] = [
      ['110505', 1400], ['152405', 1000], ['159705', -100], ['159905', -50], ['310505', 1950], ['360505', 300],
    ];
    const efe = buildDeterministicCashFlow(snap('2025', closing, 300), snap('2024', opening, 0))!;
    expect(efe.reconciled).toBe(true);
    expect(section(efe, 'operating').netFlowCents).toBe(cents(400));
    expect(section(efe, 'investing').netFlowCents).toBe(cents(0));
  });
});
