// ---------------------------------------------------------------------------
// NM-06 (re-auditoría normativa-metricas, 2026-09-24) — la regla ÚNICA de
// crédito de renta (`@/lib/accounting/renta-credit`) también en el curator
// (R4, R10, R16) y en la posición de renta del Dictamen 2
// (`audit/bindings.ts#computeRentaPosition`).
// ---------------------------------------------------------------------------
// Antes cada superficie tenía su lista blanca: R4/R10 contaban 135505 aunque
// fuera «industria y comercio» y exigían /renta/ en 135595 (dejaban fuera
// «Autorretenciones»); R16 sólo neteaba 135515 y lo rotulaba «Anticipo Renta»;
// bindings sumaba la 1805 con cualquier nombre de impuesto («Anticipo ICA»).
// El mismo balance publicaba posiciones de renta distintas (19 M, 25 M, 35 M).
// Arts. 365, 373 y 807 E.T.: sólo lo retenido o anticipado a título de renta
// se imputa a renta.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { componerActivosImpuesto } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/credito-renta';
import { computeRentaPosition } from '@/lib/agents/financial/audit/bindings';
import { renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { filtrarCreditoRenta } from '@/lib/accounting/renta-credit';

const HEADER = 'codigo,nombre,nivel,transaccional,Saldo 2025';
const pre = (rows: string[]) =>
  preprocessTrialBalance(parseTrialBalanceCSV([HEADER, ...rows].join('\n')));
const COP = (pesos: number) => BigInt(pesos) * BigInt(100);

/** Créditos del caso N2: sólo 135515 (25 M) y 135595 «Autorretenciones» (4 M) son de renta. */
const CREDITOS_N2 = [
  '135505,Anticipo de impuesto de industria y comercio,Auxiliar,1,7000000',
  '135515,Retencion en la fuente,Auxiliar,1,25000000',
  '135595,Autorretenciones,Auxiliar,1,4000000',
  '180505,Anticipo ICA,Auxiliar,1,3000000',
];

describe('NM-06 — mismo balance, misma posición de renta en todas las superficies', () => {
  it('créditos 29 M (135515 + autorretención; sin ICA) − 2404 10 M = +19 M en preprocesador, F03 y Dictamen 2', () => {
    const pp = pre([
      '110505,Caja,Auxiliar,1,100000000',
      ...CREDITOS_N2,
      '240405,Impuesto de renta,Auxiliar,1,10000000',
      '310505,Capital,Auxiliar,1,129000000',
    ]);
    const ct = pp.primary.controlTotals;
    const cls1 = pp.primary.classes.find((c) => c.code === 1)!;
    expect(ct.cents?.saldoAFavorImpuesto).toBe(COP(19_000_000));
    expect(componerActivosImpuesto(cls1.accounts).creditoRentaCents).toBe(COP(29_000_000));

    const pos = computeRentaPosition(pp.primary);
    expect(pos.saldo1355RentaCop).toBe(COP(29_000_000).toString());
    expect(pos.saldo1805FiscalCop).toBeNull(); // «Anticipo ICA» no es crédito de renta
    expect(pos.saldo2404Cop).toBe(COP(10_000_000).toString());
    expect(pos.posicionFiscalNetaCop).toBe(COP(19_000_000).toString());

    // R16: los créditos superan el pasivo → no hay neto a pagar (va por saldo a favor).
    expect(ct.impuestoRentaNeto?.anticipoActivo135515).toBe(29_000_000);
    expect(ct.impuestoRentaNeto?.applicable).toBe(false);
  });

  it('R16 netea 2404 contra TODOS los créditos de renta: 60 M − (20 M anticipo + 25 M retención) = 15 M = −posición', () => {
    const pp = pre([
      '110505,Caja,Auxiliar,1,100000000',
      '135505,Anticipo de impuestos de renta y complementarios,Auxiliar,1,20000000',
      '135515,Retencion en la fuente,Auxiliar,1,25000000',
      '240405,Impuesto de renta,Auxiliar,1,60000000',
      '310505,Capital,Auxiliar,1,85000000',
    ]);
    const irn = pp.primary.controlTotals.impuestoRentaNeto!;
    expect(irn.applicable).toBe(true);
    expect(irn.anticipoActivo135515).toBe(45_000_000);
    expect(irn.netoAPagar).toBe(15_000_000);
    expect(computeRentaPosition(pp.primary).posicionFiscalNetaCop).toBe((-COP(15_000_000)).toString());

    const bloque = renderSnapshotLines(pp.primary).join('\n');
    expect(bloque).toContain('NETO A PAGAR a la DIAN: $15.000.000,00');
    expect(bloque).not.toContain('$35.000.000,00');

    const r16 = (pp.primary.curator?.findings ?? []).find((f) => f.code === 'CUR-R16')!;
    expect(r16.description).toContain('$45.000.000');
    // 135515 es retención en la fuente, no «anticipo»; el anticipo de renta es 135505.
    expect(r16.description).not.toMatch(/135515 \(Anticipo/);
    expect(r16.description).toMatch(/retenci[oó]n en la fuente/i);
  });

  it('R4 (UAI sin grupo 54) informa los mismos créditos de renta: $29.000.000, no 32 M ni 25 M', () => {
    const pp = pre([
      '110505,Caja,Auxiliar,1,100000000',
      ...CREDITOS_N2,
      '240405,Impuesto de renta,Auxiliar,1,10000000',
      '310505,Capital,Auxiliar,1,29000000',
      '413550,Ventas,Auxiliar,1,200000000',
      '510506,Sueldos,Auxiliar,1,100000000',
    ]);
    const r4 = (pp.primary.curator?.findings ?? []).find((f) => f.code === 'CUR-R4')!;
    expect(r4.severity).toBe('informativo');
    expect(r4.description).toContain('$29.000.000');
  });

  it('R10: «Autorretenciones» (135595) explica la compensación del 2404 en cero; el anticipo de ICA no', () => {
    // 54 = 40 M, 24 = 0; créditos de renta 12 M + 10 M = 22 M ≥ 50 % → compensado.
    const compensado = pre([
      '110505,Caja,Auxiliar,1,100000000',
      '135515,Retencion en la fuente,Auxiliar,1,12000000',
      '135595,Autorretenciones,Auxiliar,1,10000000',
      '310505,Capital,Auxiliar,1,82000000',
      '413550,Ventas,Auxiliar,1,200000000',
      '510506,Sueldos,Auxiliar,1,110000000',
      '540505,Impuesto de renta,Auxiliar,1,40000000',
    ]);
    expect(compensado.primary.findings?.missingTaxCausation).toBe(false);

    // 54 = 60 M, 24 = 0; renta 25 M + autorretención 4 M = 29 M < 30 M (ICA 7 M no cuenta).
    const sinCausar = pre([
      '110505,Caja,Auxiliar,1,100000000',
      ...CREDITOS_N2,
      '310505,Capital,Auxiliar,1,89000000',
      '413550,Ventas,Auxiliar,1,200000000',
      '510506,Sueldos,Auxiliar,1,90000000',
      '540505,Impuesto de renta,Auxiliar,1,60000000',
    ]);
    expect(sinCausar.primary.findings?.missingTaxCausation).toBe(true);
  });

  it('una 1805 con nombre de renta suma en todas las superficies; «Impuesto corriente activo» no', () => {
    const pp = pre([
      '110505,Caja,Auxiliar,1,100000000',
      '135515,Retencion en la fuente,Auxiliar,1,5000000',
      '180510,Saldo a favor renta 2024,Auxiliar,1,2000000',
      '180520,Impuesto corriente activo,Auxiliar,1,800000',
      '240405,Impuesto de renta,Auxiliar,1,1000000',
      '310505,Capital,Auxiliar,1,106800000',
    ]);
    const cls1 = pp.primary.classes.find((c) => c.code === 1)!;
    expect(filtrarCreditoRenta(cls1.accounts).map((a) => a.code)).toEqual(['135515', '180510']);
    const pos = computeRentaPosition(pp.primary);
    expect(pos.saldo1805FiscalCop).toBe(COP(2_000_000).toString());
    expect(pos.posicionFiscalNetaCop).toBe(COP(6_000_000).toString());
    expect(pp.primary.controlTotals.cents?.saldoAFavorImpuesto).toBe(COP(6_000_000));
    expect(componerActivosImpuesto(cls1.accounts).creditoRentaCents).toBe(COP(7_000_000));
  });
});
