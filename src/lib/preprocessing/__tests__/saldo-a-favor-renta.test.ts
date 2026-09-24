// ---------------------------------------------------------------------------
// niif-preproceso-19 — detector de saldo a favor del impuesto de renta
// ---------------------------------------------------------------------------
// Decisión del coordinador (fase 3):
//   - 1805 es "Bienes de arte y cultura" en el PUC oficial: sólo cuenta como
//     crédito de impuesto si el NOMBRE lo indica (impuesto / anticipo /
//     retención / saldo a favor / sobrante).
//   - De 1355 sólo cuentan las subcuentas de renta: 135505 (anticipo de
//     renta), 135515 (retención en la fuente) y 135595 cuando su nombre es de
//     renta. 135510/135517/135518/135520/135525/135530 no.
//   - 5404 no existe en el PUC (grupo 54 = 5405): no alimenta el detector.
//   - Saldo a favor = créditos de renta − pasivo 2404, sólo si es positivo.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { preprocessTrialBalance, type RawAccountRow } from '@/lib/preprocessing/trial-balance';

function aux(code: string, name: string, balance: number): RawAccountRow {
  return { code, name, level: 'Auxiliar', transactional: true, balancesByPeriod: { '2025': balance } };
}

function saldoAFavor(extra: RawAccountRow[]): bigint {
  const rows: RawAccountRow[] = [
    aux('11050501', 'Caja', 100_000_000),
    aux('31050501', 'Capital', 100_000_000),
    ...extra,
  ];
  const pp = preprocessTrialBalance(rows);
  const cents = pp.primary.controlTotals.cents;
  if (!cents) throw new Error('sin cents');
  return cents.saldoAFavorImpuesto;
}

const M = (pesos: number) => BigInt(pesos * 100);

describe('saldo a favor de renta — cuentas elegibles', () => {
  it('1805 "Bienes de arte y cultura" NO es saldo a favor', () => {
    expect(saldoAFavor([aux('18050501', 'Obras de arte', 50_000_000)])).toBe(BigInt(0));
  });

  it('1805 cuyo nombre indica anticipo de impuestos sí cuenta (catálogo propio)', () => {
    expect(saldoAFavor([aux('18050501', 'Anticipo de impuestos renta', 10_000_000)])).toBe(M(10_000_000));
  });

  it('1355: sólo 135505, 135515 y 135595 con nombre de renta', () => {
    const v = saldoAFavor([
      aux('13550501', 'Anticipo de renta', 5_000_000),
      aux('13551501', 'Retención en la fuente', 3_000_000),
      aux('13551001', 'Anticipo de industria y comercio', 2_000_000),
      aux('13551701', 'Impuesto a las ventas retenido', 1_000_000),
      aux('13551801', 'ICA retenido', 700_000),
      aux('13552001', 'Sobrantes en liquidación privada', 600_000),
      aux('13553001', 'Impuestos descontables', 500_000),
      aux('13559501', 'Otros', 400_000),
      aux('13559502', 'Autorretención especial de renta', 300_000),
    ]);
    expect(v).toBe(M(8_300_000));
  });

  it('retención en la fuente practicada sobre ventas (135515) sí es crédito de renta', () => {
    const v = saldoAFavor([
      aux('13551505', 'Retención en la fuente por ventas', 2_000_000),
      aux('13551506', 'Reteiva', 900_000),
    ]);
    expect(v).toBe(M(2_000_000));
  });

  it('una obra de arte en 1805 no anula el sobrante de renta en 1355', () => {
    const v = saldoAFavor([
      aux('18050501', 'Obras de arte', 1_000_000),
      aux('13551501', 'Retención en la fuente', 49_000_000),
    ]);
    expect(v).toBe(M(49_000_000));
  });

  it('5404 (inexistente en el PUC) no alimenta el detector', () => {
    expect(saldoAFavor([aux('54040501', 'Impuesto', -7_000_000)])).toBe(BigInt(0));
  });
});

describe('saldo a favor de renta — neto del pasivo 2404', () => {
  it('créditos 8M − impuesto por pagar 6M = saldo a favor 2M', () => {
    const v = saldoAFavor([
      aux('13550501', 'Anticipo de renta', 5_000_000),
      aux('13551501', 'Retención en la fuente', 3_000_000),
      aux('24040501', 'Renta y complementarios', 6_000_000),
    ]);
    expect(v).toBe(M(2_000_000));
  });

  it('impuesto por pagar mayor que los créditos → sin saldo a favor', () => {
    const v = saldoAFavor([
      aux('13551501', 'Retención en la fuente', 3_000_000),
      aux('24040501', 'Renta y complementarios', 10_000_000),
    ]);
    expect(v).toBe(BigInt(0));
  });
});
