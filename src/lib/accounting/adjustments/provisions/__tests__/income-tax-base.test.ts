// ---------------------------------------------------------------------------
// Base de la provisión de renta — el motor que POSTEA ASIENTOS
// ---------------------------------------------------------------------------
// Auditoría fiscal 2026-08 (superficie 2, defecto b). `computePretaxIncome`
// y su copia inline dentro de `calculateProvisions` calculaban la base así:
//   ingresos = Σ clase 4 clampeada por cuenta a ≥ 0  → las 4175 (devoluciones,
//              naturaleza débito) aportaban 0 en vez de restar;
//   gastos   = Σ clase 5 completa                    → incluía el grupo 54,
//              es decir el propio impuesto de renta;
//   costos   = Σ clase 6                             → la clase 7 (costos de
//              producción) se ignoraba por completo.
//
// Como este camino genera `proposedEntries` que se contabilizan, la base
// equivocada es dinero mal registrado en los libros.
//
// La identidad correcta es la del preprocesador canónico
// (`src/lib/preprocessing/trial-balance.ts`):
//   gastosTotales = clase5 + clase6 + clase7
//   UAI           = ingresosNetos − (gastosTotales − grupo 54)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  computePretaxIncome,
  computeIncomeTaxProvision,
} from '../income-tax';
import { calculateProvisions, type PeriodAccountBalance } from '../calculator';

/**
 * Escenario de la auditoría. Con la regla vieja daba $530.000.000 de base y
 * $185.500.000 de provisión; la norma da $300.000.000 y $105.000.000.
 *
 *   4135 ventas                       $1.000.000.000 crédito
 *   4175 devoluciones en ventas         $150.000.000 débito
 *   5135 gastos operacionales           $400.000.000 débito
 *   5405 impuesto de renta (grupo 54)    $20.000.000 débito
 *   6135 costo de ventas                 $50.000.000 débito
 *   7105 costos de producción           $100.000.000 débito
 */
const BALANCES: PeriodAccountBalance[] = [
  { code: '413505', totalDebit: '0.00', totalCredit: '1000000000.00' },
  { code: '417505', totalDebit: '150000000.00', totalCredit: '0.00' },
  { code: '513505', totalDebit: '400000000.00', totalCredit: '0.00' },
  { code: '540505', totalDebit: '20000000.00', totalCredit: '0.00' },
  { code: '613505', totalDebit: '50000000.00', totalCredit: '0.00' },
  { code: '710505', totalDebit: '100000000.00', totalCredit: '0.00' },
];

describe('computePretaxIncome — base de la provisión de renta', () => {
  it('las devoluciones 4175 restan del ingreso (NIIF 15 §47)', () => {
    expect(
      computePretaxIncome([
        { code: '413505', totalDebit: '0.00', totalCredit: '1000000000.00' },
        { code: '417505', totalDebit: '150000000.00', totalCredit: '0.00' },
      ]),
    ).toBe('850000000.00');
  });

  it('el grupo 54 no entra en su propia base', () => {
    expect(
      computePretaxIncome([
        { code: '413505', totalDebit: '0.00', totalCredit: '1000000000.00' },
        { code: '540505', totalDebit: '20000000.00', totalCredit: '0.00' },
      ]),
    ).toBe('1000000000.00');
  });

  it('la clase 7 (costos de producción) resta', () => {
    expect(
      computePretaxIncome([
        { code: '413505', totalDebit: '0.00', totalCredit: '1000000000.00' },
        { code: '710505', totalDebit: '100000000.00', totalCredit: '0.00' },
      ]),
    ).toBe('900000000.00');
  });

  it('escenario completo: UAI = $300.000.000 (antes $530.000.000)', () => {
    expect(computePretaxIncome(BALANCES)).toBe('300000000.00');
  });

  it('la pérdida se publica firmada, no se clampea a cero', () => {
    expect(
      computePretaxIncome([
        { code: '413505', totalDebit: '0.00', totalCredit: '100000000.00' },
        { code: '513505', totalDebit: '400000000.00', totalCredit: '0.00' },
      ]),
    ).toBe('-300000000.00');
  });
});

describe('computeIncomeTaxProvision — 35% Art. 240 E.T.', () => {
  it('provisión del escenario = $105.000.000 (antes $185.500.000)', () => {
    expect(computeIncomeTaxProvision(computePretaxIncome(BALANCES))).toBe(
      '105000000.00',
    );
  });

  it('sobre pérdida no hay provisión corriente', () => {
    expect(computeIncomeTaxProvision('-300000000.00')).toBe('0.00');
  });

  it('redondeo half-up al centavo (mismo criterio que F02 del Âncora)', () => {
    // 0,01 × 35% = 0,0035 → 0,00 ; 0,03 × 35% = 0,0105 → 0,01
    expect(computeIncomeTaxProvision('0.01')).toBe('0.00');
    expect(computeIncomeTaxProvision('0.03')).toBe('0.01');
  });
});

describe('calculateProvisions — el asiento que se contabiliza', () => {
  const preview = calculateProvisions({
    workspaceId: 'ws-test',
    period: { id: 'p1', year: 2025, month: 12 } as never,
    entryDate: new Date('2025-12-31'),
    configs: [
      {
        provisionType: 'income_tax',
        rate: '0.350000',
        active: true,
        baseAccountCodes: [],
        expenseAccountId: 'acc-5405',
        liabilityAccountId: 'acc-2404',
        expenseAccountCode: '540505',
        liabilityAccountCode: '240405',
      } as never,
    ],
    periodBalances: BALANCES,
    pretaxIncome: null,
  });

  it('usa la misma base que computePretaxIncome — sin copia divergente', () => {
    expect(preview.lines[0]?.baseAmountCop).toBe('300000000.00');
  });

  it('el asiento propuesto queda en $105.000.000', () => {
    expect(preview.lines[0]?.provisionAmountCop).toBe('105000000.00');
    const entry = preview.proposedEntries[0];
    expect(entry?.lines[0]?.debit).toBe('105000000.00');
    expect(entry?.lines[1]?.credit).toBe('105000000.00');
  });

  it('con pérdida no propone asiento', () => {
    const perdida = calculateProvisions({
      workspaceId: 'ws-test',
      period: { id: 'p1', year: 2025, month: 12 } as never,
      entryDate: new Date('2025-12-31'),
      configs: [
        {
          provisionType: 'income_tax',
          rate: '0.350000',
          active: true,
          baseAccountCodes: [],
          expenseAccountId: 'acc-5405',
          liabilityAccountId: 'acc-2404',
          expenseAccountCode: '540505',
          liabilityAccountCode: '240405',
        } as never,
      ],
      periodBalances: [
        { code: '413505', totalDebit: '0.00', totalCredit: '100000000.00' },
        { code: '513505', totalDebit: '400000000.00', totalCredit: '0.00' },
      ],
      pretaxIncome: null,
    });
    expect(perdida.proposedEntries).toHaveLength(0);
    expect(perdida.skipped[0]?.reason).toBe('zero_or_negative_base');
  });
});
