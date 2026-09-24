// ---------------------------------------------------------------------------
// Crédito de renta — UNA regla para preprocesador, Âncora Fiscal, Âncora NIIF
// y Doctor de Datos (auditoría 2026-09, integración W3-B)
// ---------------------------------------------------------------------------
// Había dos implementaciones de «qué hoja de 1355/1805 es crédito imputable al
// impuesto de renta»: `isRentaCreditAccount` (preprocesador y Doctor de Datos)
// y `clasificarActivoImpuesto` (Âncora Fiscal y Âncora NIIF). Divergían en
// 1805 con nombre de impuesto que no es renta, en 135505/135515 con nombre de
// timbre/GMF/predial, en «retenciones en la fuente» (plural) y en la hoja 1355
// sin subcuenta: el mismo balance publicaba dos saldos a favor distintos.
//
// Criterio del coordinador:
//   · 135505 y 135515 cuentan, salvo nombre de IVA/ICA/predial/timbre/GMF/
//     contribuciones.
//   · 135595 y 1805 (en el PUC oficial «Bienes de arte y cultura») sólo si el
//     nombre es de renta.
//   · El resto de 1355 (135510, 135517, 135518, 135520, 135525, 135530…) no.
// Arts. 365, 373 y 807 E.T. (retenciones y anticipo imputables a renta);
// Art. 484-1 E.T. (el ReteIVA va contra IVA).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  clasificarActivoImpuesto,
  esCreditoRenta,
} from '@/lib/accounting/renta-credit';
import {
  isRentaCreditAccount,
  parseTrialBalanceCSV,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';
import { extractFiscalBaseFromTrialBalance } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/extractor';
import { buildFiscalAnchor } from '@/lib/agents/financial/escudo-survival/fiscal-anchor';
import { buildNiifAncora } from '@/lib/agents/financial/ancora/build-ancora';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';

/** [código, nombre, saldo en pesos, ¿crédito de renta?] */
const CATALOGO: ReadonlyArray<readonly [string, string, number, boolean]> = [
  ['13550501', 'Anticipo de renta', 5_000_000, true],
  ['13550502', 'Anticipo impuesto predial', 150_000, false],
  ['13551501', 'Retención en la fuente', 3_000_000, true],
  ['13551502', 'Retención en la fuente impuesto de timbre', 100_000, false],
  ['13551503', 'Retenciones GMF 4x1000', 50_000, false],
  ['13551504', 'Reteiva', 90_000, false],
  ['13551001', 'Anticipo de industria y comercio', 2_000_000, false],
  ['13551701', 'Impuesto a las ventas retenido', 1_000_000, false],
  ['13551801', 'ICA retenido', 700_000, false],
  ['13552001', 'Sobrantes en liquidación privada de impuestos', 600_000, false],
  ['13553001', 'Impuestos descontables', 500_000, false],
  ['13559501', 'Otros', 400_000, false],
  ['13559502', 'Retenciones en la fuente por rendimientos', 300_000, true],
  ['13559503', 'Autorretención especial de renta', 200_000, true],
  ['18050501', 'Obras de arte', 50_000_000, false],
  ['18051001', 'Anticipo de impuestos', 800_000, false],
  ['18052001', 'Saldo a favor renta 2024', 900_000, true],
];

const CREDITO_ESPERADO_PESOS = CATALOGO.filter(([, , , renta]) => renta).reduce(
  (s, [, , saldo]) => s + saldo,
  0,
); // 9.400.000
const CREDITO_ESPERADO_CENTS = BigInt(CREDITO_ESPERADO_PESOS * 100);

const TOTAL_1355_1805 = CATALOGO.reduce((s, [, , saldo]) => s + saldo, 0);
const CAJA = 100_000_000;

/** Balance cuadrado sin 2404: el saldo a favor del preprocesador = créditos. */
const CSV = [
  'codigo,nombre,nivel,transaccional,Saldo 2025',
  `110505,Caja general,Auxiliar,1,${CAJA}`,
  ...CATALOGO.map(([code, name, saldo]) => `${code},${name},Auxiliar,1,${saldo}`),
  `310505,Capital suscrito y pagado,Auxiliar,1,${CAJA + TOTAL_1355_1805}`,
].join('\n');

function neutral(id: string, accountCode: string, amount: number): Adjustment {
  return {
    id,
    accountCode,
    accountName: accountCode,
    amount,
    rationale: 'Ajuste confirmado por el contador',
    status: 'applied',
    proposedAt: '2026-09-24T00:00:00Z',
    appliedAt: '2026-09-24T00:00:00Z',
  };
}

describe('regla única de crédito de renta — clasificación por hoja', () => {
  it.each(CATALOGO)('%s «%s» → crédito de renta = %s', (code, name, _saldo, renta) => {
    expect(esCreditoRenta(code, [name])).toBe(renta);
    expect(clasificarActivoImpuesto(code, [name]) === 'credito_renta').toBe(renta);
    // El preprocesador delega en el módulo compartido: misma respuesta.
    expect(isRentaCreditAccount(code, name)).toBe(renta);
  });

  it('ReteIVA e ICA se separan (Art. 484-1 E.T. / tributo municipal); el resto de 1355 no es renta', () => {
    expect(clasificarActivoImpuesto('13551701', ['Impuesto a las ventas retenido'])).toBe('rete_iva');
    expect(clasificarActivoImpuesto('13551504', ['Reteiva'])).toBe('rete_iva');
    expect(clasificarActivoImpuesto('13551801', ['Rete ICA'])).toBe('rete_ica');
    expect(clasificarActivoImpuesto('13551001', ['Anticipo'])).toBe('rete_ica');
    expect(clasificarActivoImpuesto('13553001', ['Retención en la fuente renta'])).toBe('otro_no_renta');
    expect(clasificarActivoImpuesto('13552501', ['Contribuciones'])).toBe('otro_no_renta');
  });

  it('1355 sin subcuenta: sólo con nombre de renta; el nombre del PUC («contribuciones») no lo es', () => {
    expect(esCreditoRenta('1355', ['Anticipo de impuesto de renta'])).toBe(true);
    expect(esCreditoRenta('1355', ['Anticipo de impuestos y contribuciones o saldos a favor'])).toBe(false);
  });

  it('1805 y 135595 admiten el nombre de la cuenta padre como contexto', () => {
    expect(esCreditoRenta('18051001', ['Servicios 4%', 'Retención en la fuente a favor'])).toBe(true);
    expect(esCreditoRenta('18051001', ['Servicios 4%', 'Bienes de arte y cultura'])).toBe(false);
  });

  it('fuera de 1355/1805 no clasifica', () => {
    expect(clasificarActivoImpuesto('240405', ['Impuesto de renta'])).toBeNull();
    expect(esCreditoRenta('130505', ['Renta por cobrar'])).toBe(false);
  });
});

describe('paridad: preprocesador = Âncora Fiscal = Âncora NIIF = Doctor de Datos', () => {
  const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));

  it('preprocesador — saldo a favor de renta (sin 2404) = créditos de la lista blanca', () => {
    expect(pre.primary.controlTotals.cents!.saldoAFavorImpuesto).toBe(CREDITO_ESPERADO_CENTS);
  });

  it('Âncora Fiscal — F03 = mismos créditos', () => {
    expect(extractFiscalBaseFromTrialBalance(pre.primary).retencionesAFavorCents).toBe(
      CREDITO_ESPERADO_CENTS,
    );
    const anchor = buildFiscalAnchor({
      preprocessed: pre,
      company: { name: 'PYME SAS', nit: '900123456-1' },
      hoy: new Date('2026-09-24T12:00:00Z'),
    });
    expect(anchor.f03).toBe(CREDITO_ESPERADO_CENTS.toString());
  });

  it('Âncora NIIF — F03 = mismos créditos', () => {
    const ancora = buildNiifAncora(pre, { name: 'PYME SAS', nit: '900123456-1' } as never);
    expect(ancora.ccvFiscal.F03).toBe(CREDITO_ESPERADO_CENTS.toString());
  });

  it('Doctor de Datos — tras un ajuste neutro, el saldo a favor recalculado no cambia', () => {
    const { balance } = applyAdjustments(pre, [
      neutral('a1', '110505', 1_000_000),
      neutral('a2', '310505', 1_000_000),
    ]);
    expect(balance.primary.controlTotals.cents!.saldoAFavorImpuesto).toBe(CREDITO_ESPERADO_CENTS);
  });
});
