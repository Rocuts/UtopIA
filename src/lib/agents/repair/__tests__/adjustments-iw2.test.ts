// ---------------------------------------------------------------------------
// Doctor de Datos — integración IW2 (auditoría 2026-09)
// ---------------------------------------------------------------------------
// `applyAdjustments` recalculaba dos anclas con reglas propias, distintas de
// las del preprocesador:
//   - niif-preproceso-19: saldo a favor de renta con el detector antiguo
//     (5404 acreedor → 1805 → 1355 bruto). Una obra de arte (1805) o la
//     ReteIVA (135517) se publicaban como saldo a favor tras cualquier ajuste.
//   - niif-preproceso-13: desglose del patrimonio con 3105 como "capital
//     autorizado", sin los grupos 32/34/35/38 y con 3610 en acumuladas.
// Ahora ambos usan la regla exportada por `trial-balance.ts`.
// Además (IW2, ratios-kpis-04): el sub-bloque P&L (ingresos operacionales,
// utilidad bruta, EBIT) y los KPIs quedaban con su valor PRE-ajuste; los
// entregables que leen `ingresosOperacionalesNetos` se desfasaban.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { applyAdjustments } from '../adjustments';
import type { Adjustment } from '../types';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { revenueBreakdown } from '@/lib/export/revenue';

// Libros cerrados: A 545M = P 104M + K 441M; P&G 200 − 150 = 50M = 3605.
const CSV = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,500000000',
  '135515,Retención en la fuente,Auxiliar,1,10000000',
  '135517,Impuesto a las ventas retenido,Auxiliar,1,5000000',
  '180505,Obras de arte,Auxiliar,1,30000000',
  '220505,Proveedores,Auxiliar,1,100000000',
  '240405,Renta y complementarios vigencia actual,Auxiliar,1,4000000',
  '310505,Capital suscrito y pagado,Auxiliar,1,300000000',
  '320505,Prima en colocación de acciones,Auxiliar,1,20000000',
  '330505,Reserva legal,Auxiliar,1,11000000',
  '370505,Utilidades acumuladas,Auxiliar,1,50000000',
  '381505,Superávit por valorizaciones,Auxiliar,1,10000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,50000000',
  '410505,Ventas,Auxiliar,1,200000000',
  '510505,Gastos de personal,Auxiliar,1,150000000',
].join('\n');

function adj(id: string, accountCode: string, amount: number): Adjustment {
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

describe('applyAdjustments — misma regla de saldo a favor que el preprocesador (niif-preproceso-19)', () => {
  it('saldo a favor = créditos de renta − 2404, sin 1805 "Obras de arte" ni ReteIVA', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    expect(original.primary.controlTotals.cents!.saldoAFavorImpuesto).toBe(BigInt(600_000_000));

    const { balance } = applyAdjustments(original, [
      adj('a1', '110505', 1_000_000),
      adj('a2', '220505', 1_000_000),
    ]);
    const ct = balance.primary.controlTotals;
    expect(ct.cents!.saldoAFavorImpuesto).toBe(BigInt(600_000_000));
    expect(ct.raw!.saldoAFavorImpuesto).toBe('6000000.00');
  });

  it('un ajuste a la retención en la fuente mueve el saldo a favor; uno a 2404 lo netea', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const { balance } = applyAdjustments(original, [
      adj('a1', '135515', 2_000_000),
      adj('a2', '240405', 1_000_000),
      adj('a3', '220505', 1_000_000),
    ]);
    // (10M + 2M) − (4M + 1M) = 7M
    expect(balance.primary.controlTotals.cents!.saldoAFavorImpuesto).toBe(BigInt(700_000_000));
  });
});

describe('applyAdjustments — desglose del patrimonio del preprocesador (niif-preproceso-13)', () => {
  it('un ajuste que no toca la clase 3 conserva el desglose del preprocesador', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const { balance } = applyAdjustments(original, [
      adj('a1', '110505', 1_000_000),
      adj('a2', '220505', 1_000_000),
    ]);
    const eb = balance.primary.equityBreakdown;
    expect(eb).toEqual(original.primary.equityBreakdown);
    expect(eb.capitalSuscritoPagado).toBe(300_000_000);
    expect(eb.superavitCapital).toBe(20_000_000);
    expect(eb.superavitValorizaciones).toBe(10_000_000);
    expect(eb.utilidadesAcumuladas).toBe(50_000_000);
  });

  it('3610 (pérdida del ejercicio) queda en el resultado del ejercicio, no en acumuladas', () => {
    // Libros cerrados con pérdida: A 450M = P 100M + K 350M (300 + 55 − 5);
    // P&G 145 − 150 = −5M = 3610.
    const csvPerdida = [
      'codigo,nombre,nivel,transaccional,saldo 2025',
      '110505,Caja,Auxiliar,1,450000000',
      '220505,Proveedores,Auxiliar,1,100000000',
      '310505,Capital suscrito y pagado,Auxiliar,1,300000000',
      '370505,Utilidades acumuladas,Auxiliar,1,55000000',
      '361005,Pérdida del ejercicio,Auxiliar,1,-5000000',
      '410505,Ventas,Auxiliar,1,145000000',
      '510505,Gastos de personal,Auxiliar,1,150000000',
    ].join('\n');
    const original = preprocessTrialBalance(parseTrialBalanceCSV(csvPerdida));
    const { balance } = applyAdjustments(original, [
      adj('a1', '110505', 1_000_000),
      adj('a2', '220505', 1_000_000),
    ]);
    const eb = balance.primary.equityBreakdown;
    expect(eb).toEqual(original.primary.equityBreakdown);
    expect(eb.utilidadesAcumuladas).toBe(55_000_000);
    expect(eb.utilidadEjercicio).toBe(-5_000_000);
  });
});

describe('applyAdjustments — P&L de soporte y KPIs con la función del preprocesador (IW2)', () => {
  it('un ajuste al grupo 41 actualiza ingresos operacionales, EBIT, márgenes y la fuente de los entregables', () => {
    const original = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    expect(original.primary.controlTotals.ingresosOperacionalesNetos).toBe(200_000_000);

    const { balance } = applyAdjustments(original, [
      adj('a1', '413505', 100_000_000),
      adj('a2', '130505', 100_000_000),
    ]);
    const s = balance.primary;
    const ct = s.controlTotals;
    expect(ct.ingresosOperacionalesNetos).toBe(300_000_000);
    expect(ct.utilidadBruta).toBe(300_000_000);
    expect(ct.ebit).toBe(150_000_000);
    expect(ct.margenOperativo).toBeCloseTo(50, 6);
    expect(ct.clientesNetos).toBe(100_000_000);

    // Mismos valores que un preprocesado desde cero del balance ajustado.
    const fresh = preprocessTrialBalance(
      parseTrialBalanceCSV(
        CSV.replace('410505,Ventas,Auxiliar,1,200000000', '410505,Ventas,Auxiliar,1,200000000\n413505,Ventas mayoristas,Auxiliar,1,100000000')
          .concat('\n130505,Clientes,Auxiliar,1,100000000'),
      ),
    ).primary.controlTotals;
    for (const k of ['ingresosOperacionalesNetos', 'ebit', 'margenOperativo', 'margenBruto', 'rotacionActivos', 'diasCartera'] as const) {
      expect(ct[k]).toBeCloseTo(fresh[k] as number, 6);
    }
    expect(revenueBreakdown(s).operacionalesNetos).toBe(300_000_000);
  });
});
