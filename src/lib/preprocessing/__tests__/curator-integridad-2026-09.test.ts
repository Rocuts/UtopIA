// ---------------------------------------------------------------------------
// Auditoría de exactitud 2026-09 — paquete WP03 (curator NIIF)
// ---------------------------------------------------------------------------
// Regresiones de extremo a extremo sobre `preprocessTrialBalance` (y, cuando
// el hallazgo lo exige, sobre el gate 422 de `prepareFinancialContext`). Cada
// bloque cita el ID del hallazgo confirmado.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  BalanceValidationError,
  prepareFinancialContext,
} from '@/lib/agents/financial/orchestrator';
import { summarize } from '@/lib/api/trial-balances';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

function pp(csv: string) {
  return preprocessTrialBalance(parseTrialBalanceCSV(csv));
}

const COMPANY = {
  name: 'Empresa Prueba SAS',
  nit: '900123456-7',
  fiscalPeriod: '2025',
  niifGroup: 2 as const,
};

// ---------------------------------------------------------------------------
// niif-preproceso-06 — R8 no absorbe residuales en 3710VC
// ---------------------------------------------------------------------------
describe('niif-preproceso-06 — descuadre en origen con P&G', () => {
  const CSV_DESCUADRE = [
    'codigo,nombre,nivel,transaccional,Saldo 2025',
    '110505,Caja general,Auxiliar,1,50000000',
    '130505,Clientes nacionales,Auxiliar,1,300000000',
    '220505,Proveedores nacionales,Auxiliar,1,120000000',
    '310505,Capital suscrito y pagado,Auxiliar,1,60000000',
    '370505,Resultados de ejercicios anteriores,Auxiliar,1,10000000',
    '413505,Ventas,Auxiliar,1,100000000',
    '513505,Servicios,Auxiliar,1,90000000',
  ].join('\n');

  it('el residual queda visible y bloqueante; el API v1 lo publica como "unbalanced"', () => {
    const res = pp(CSV_DESCUADRE);
    const s = res.primary;
    const acc3 = s.classes.find((c) => c.code === 3)!.accounts;

    // 350 − 120 − (60 + 10 + 10) = 150M no explicados por la utilidad (10M).
    expect(acc3.find((a) => a.code === '3710VC')).toBeUndefined();
    expect(s.virtualCloseAdjustment?.centsAdjustment).toBe(0);
    expect(s.virtualCloseAdjustment?.unexplainedResidualRaw).toBe('150000000.00');
    expect(s.summary.equationBalanced).toBe(false);
    expect(s.validation.blocking).toBe(true);
    expect(s.validation.curatorBlockingReasons?.[0]).toContain('150.000.000,00');
    expect(summarize(res).status).toBe('unbalanced');
    expect(summarize(res).control_totals.equation_delta).not.toBe('0');
  });

  it('el orquestador responde con BalanceValidationError (422) citando el monto', async () => {
    await expect(
      prepareFinancialContext({ rawData: CSV_DESCUADRE, company: COMPANY, language: 'es' }),
    ).rejects.toBeInstanceOf(BalanceValidationError);
    try {
      await prepareFinancialContext({ rawData: CSV_DESCUADRE, company: COMPANY, language: 'es' });
    } catch (err) {
      expect((err as BalanceValidationError).reasons.join(' ')).toContain('150.000.000,00');
    }
  });

  it('un balance sin cerrar y cuadrado sigue sin bloqueo (el traslado sí se explica)', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,1000000000',
        '220505,Proveedores,400000000',
        '310505,Capital,300000000',
        '370505,Utilidades acumuladas,100000000',
        '413505,Ventas,900000000',
        '613505,Costo,500000000',
        '513505,Gastos,200000000',
      ].join('\n'),
    ).primary;
    expect(s.controlTotals.patrimonio).toBe(600_000_000);
    expect(s.summary.equationBalanced).toBe(true);
    expect(s.virtualCloseAdjustment?.blocking).toBe(false);
    expect(s.validation.curatorBlockingReasons ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recalculo-08 — R5 no ancla el patrimonio a un desglose parcial
// ---------------------------------------------------------------------------
describe('recalculo-08 — balance sin P&G con grupos 32/34/35/38 y otras 37xx', () => {
  it('el patrimonio publicado es Σ clase 3 y el desglose lo explica completo', () => {
    const res = pp(
      [
        'codigo,nombre,nivel,transaccional,Saldo 2025',
        '110505,Caja,Auxiliar,1,100000000',
        '152405,Maquinaria,Auxiliar,1,200000000',
        '220505,Proveedores,Auxiliar,1,50000000',
        '310505,Capital,Auxiliar,1,150000000',
        '320505,Prima en colocacion de acciones,Auxiliar,1,20000000',
        '340505,Revalorizacion del patrimonio,Auxiliar,1,5000000',
        '350505,Dividendos decretados en acciones,Auxiliar,1,3000000',
        '379505,Otros resultados anteriores,Auxiliar,1,-28000000',
        '380505,Superavit por valorizacion,Auxiliar,1,100000000',
      ].join('\n'),
    );
    const s = res.primary;
    expect(s.controlTotals.patrimonio).toBe(250_000_000);
    expect(s.controlTotals.cents!.patrimonio).toBe(BigInt(25_000_000_000));
    expect(s.summary.equationBalanced).toBe(true);
    expect(s.equityAnchorAdjustment).toBeUndefined();
    expect(s.curator?.convergenceAdjustment).toBeUndefined();
    expect(s.validation.curatorBlockingReasons ?? []).toHaveLength(0);
    expect(s.equityBreakdown).toMatchObject({
      capitalSuscritoPagado: 150_000_000,
      superavitCapital: 20_000_000,
      revalorizacionPatrimonio: 5_000_000,
      dividendosDecretadosEnAcciones: 3_000_000,
      utilidadesAcumuladas: -28_000_000,
      superavitValorizaciones: 100_000_000,
    });
    expect(summarize(res).status).toBe('balanced');
  });
});

// ---------------------------------------------------------------------------
// niif-preproceso-13 — 3105 es Capital suscrito y pagado (PUC)
// ---------------------------------------------------------------------------
describe('niif-preproceso-13 — mapeo de capital según el PUC', () => {
  it('3105 (neto de 310510) va a capitalSuscritoPagado; 310505 queda como dato informativo', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,800000000',
        '220505,Proveedores,300000000',
        '310505,Capital autorizado,500000000',
        '310510,Capital por suscribir,-100000000',
        '370505,Utilidades acumuladas,100000000',
      ].join('\n'),
    ).primary;
    expect(s.equityBreakdown.capitalSuscritoPagado).toBe(400_000_000);
    expect(s.equityBreakdown.capitalAutorizado).toBe(500_000_000);
    expect(s.controlTotals.patrimonio).toBe(500_000_000);
    expect(s.validation.curatorBlockingReasons ?? []).toHaveLength(0);
  });

  it('Ltda (3115 aportes sociales) y sucursal (3120 capital asignado) también son capital suscrito', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,300000000',
        '311505,Aportes sociales,200000000',
        '312005,Capital asignado,100000000',
      ].join('\n'),
    ).primary;
    expect(s.equityBreakdown.capitalSuscritoPagado).toBe(300_000_000);
    expect(s.equityBreakdown.capitalAutorizado).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// niif-preproceso-12 — 3610 (Pérdida del ejercicio)
// ---------------------------------------------------------------------------
describe('niif-preproceso-12 — pérdida registrada en 3610 con P&G presente', () => {
  it('no duplica la pérdida ni crea una utilidad acumulada ficticia', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,800000000',
        '220505,Proveedores,400000000',
        '310505,Capital,500000000',
        '361005,Perdida del ejercicio,-100000000',
        '413505,Ventas,400000000',
        '613505,Costo,300000000',
        '513505,Gastos,200000000',
      ].join('\n'),
    ).primary;
    const acc3 = s.classes.find((c) => c.code === 3)!.accounts.map((a) => [a.code, a.balance]);
    expect(s.controlTotals.patrimonio).toBe(400_000_000);
    expect(acc3).toContainEqual(['361005', 0]);
    expect(acc3).toContainEqual(['3605VC', -100_000_000]);
    expect(acc3.find(([c]) => c === '3710VC')).toBeUndefined();
    expect(s.equityBreakdown.utilidadEjercicio).toBe(-100_000_000);
    expect(s.equityBreakdown.utilidadesAcumuladas).toBeUndefined();
    expect(
      (s.curator?.findings ?? []).filter(
        (f) => f.code === 'CUR-R8' && (f.severity === 'alto' || f.severity === 'critico'),
      ),
    ).toHaveLength(0);
  });
});
