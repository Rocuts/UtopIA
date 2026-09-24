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

// ---------------------------------------------------------------------------
// niif-preproceso-15 / -16 — EFE indirecto (R2) completo; R6 sólo redondeo
// ---------------------------------------------------------------------------
describe('niif-preproceso-15 — dividendos del EFE con traslado de la utilidad previa', () => {
  it('2024 con utilidad 100M trasladada en 2025 y dividendos de 60M: EFE exacto sin cierre forzado', () => {
    // 2024: NI 100 (P&L abierto). 2025: 3705 pasa de 100 a 140 (traslado de
    // 100 − dividendos pagados de 60), NI 2025 = 150, caja 500 → 590.
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,500000000,590000000',
        '236005,Dividendos por pagar,0,0',
        '310505,Capital,300000000,300000000',
        '370505,Utilidades acumuladas,100000000,140000000',
        '413505,Ventas,400000000,500000000',
        '513505,Gastos,300000000,350000000',
      ].join('\n'),
    ).primary;
    const efe = s.cashFlowIndirecto!;
    expect(efe.financing.dividendosEstimados).toBe(-60_000_000);
    expect(efe.operating.total).toBe(150_000_000);
    expect(efe.netChangeInCash).toBe(90_000_000);
    expect(efe.reconciled).toBe(true);
    // Nada se cerró "a la fuerza" en una línea operativa.
    expect(s.cashFlowClosureAdjustment).toBeUndefined();
    expect(s.curator?.cashFlowClosureAdjustment).toBeUndefined();
  });

  it('dividendos decretados y NO pagados (Δ2360): no son flujo operativo ni salida de caja', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,500000000,650000000',
        '236005,Dividendos por pagar,0,60000000',
        '310505,Capital,300000000,300000000',
        '370505,Utilidades acumuladas,100000000,140000000',
        '413505,Ventas,400000000,500000000',
        '513505,Gastos,300000000,350000000',
      ].join('\n'),
    ).primary;
    const efe = s.cashFlowIndirecto!;
    expect(efe.financing.dividendosEstimados).toBe(0);
    expect(efe.operating.varCuentasPorPagar).toBe(0);
    expect(efe.operating.total).toBe(150_000_000);
    expect(efe.netChangeInCash).toBe(150_000_000);
    expect(efe.reconciled).toBe(true);
  });
});

describe('niif-preproceso-16 — todos los grupos PUC entran al EFE', () => {
  it('compra de software (16), amortización 1698, provisión 26 y anticipos 28 quedan en su actividad', () => {
    // 2025: compra de intangible 100M (menos amortización 10M), provisión de
    // 5M (26) y anticipo recibido de 20M (28). Utilidad = −10 −5 = −15M.
    // Caja: 500 − 100 (compra) + 20 (anticipo) = 420.
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,500000000,420000000',
        '130505,Clientes,200000000,200000000',
        '160505,Software (intangible),0,100000000',
        '169805,Amortizacion acumulada intangibles,0,-10000000',
        '220505,Proveedores,100000000,100000000',
        '261005,Provision garantias,0,5000000',
        '280505,Anticipos recibidos,0,20000000',
        '310505,Capital,600000000,600000000',
        '413505,Ventas,0,0',
        '516505,Amortizacion,0,10000000',
        '519505,Provisiones,0,5000000',
      ].join('\n'),
    ).primary;
    const efe = s.cashFlowIndirecto!;
    expect(s.controlTotals.utilidadNeta).toBe(-15_000_000);
    expect(efe.operating.depreciacionAmortizacion).toBe(10_000_000);
    expect(efe.operating.varOtrosPasivosOperativos).toBe(25_000_000);
    expect(efe.operating.total).toBe(20_000_000);
    expect(efe.investing.otros).toBe(-100_000_000);
    expect(efe.investing.total).toBe(-100_000_000);
    expect(efe.netChangeInCash).toBe(-80_000_000);
    expect(efe.observedChangeInCash).toBe(-80_000_000);
    expect(efe.reconciled).toBe(true);
    expect(s.cashFlowClosureAdjustment).toBeUndefined();
  });

  it('R6 no esconde una brecha material en capital de trabajo: queda visible', () => {
    // El 2025 viene descuadrado en 30M (bloqueado por R8): el EFE no concilia
    // y R6 NO mueve la diferencia a una línea operativa.
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,500000000,530000000',
        '130505,Clientes,200000000,260000000',
        '220505,Proveedores,100000000,100000000',
        '310505,Capital,600000000,600000000',
        '413505,Ventas,0,100000000',
        '513505,Gastos,0,40000000',
      ].join('\n'),
    ).primary;
    const efe = s.cashFlowIndirecto!;
    expect(s.virtualCloseAdjustment?.blocking).toBe(true);
    expect(efe.reconciled).toBe(false);
    expect(Math.abs(efe.reconciliationGap)).toBe(30_000_000);
    expect(s.cashFlowClosureAdjustment).toBeUndefined();
    expect(efe.operating.varCuentasPorCobrar).toBe(-60_000_000);
    const r6 = (s.curator?.findings ?? []).find((f) => f.code === 'CUR-R6');
    expect(r6?.severity).toBe('alto');
  });
});

// ---------------------------------------------------------------------------
// niif-preproceso-22 — R1: sobregiros y anticipos son pasivo CORRIENTE
// ---------------------------------------------------------------------------
describe('niif-preproceso-22 — reclasificación de saldos crédito de activo corriente', () => {
  it('sobregiro (1110 crédito): pasivo corriente, destino PUC 2105 y ancla de efectivo recalculada', () => {
    const res = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,100000000',
        '111005,Bancos (sobregiro),-50000000',
        '130505,Clientes,200000000',
        '220505,Proveedores,100000000',
        '310505,Capital,150000000',
        '413505,Ventas,100000000',
        '513505,Gastos,100000000',
      ].join('\n'),
    );
    const ct = res.primary.controlTotals;
    expect(ct.pasivoCorriente).toBe(150_000_000);
    expect(ct.pasivoNoCorriente).toBe(0);
    // Las cuentas 11 que quedan en el activo suman 100M (el sobregiro es pasivo).
    expect(ct.efectivoCuenta11).toBe(100_000_000);
    expect(ct.cents!.efectivoCuenta11).toBe(BigInt(10_000_000_000));
    expect(ct.raw!.efectivoCuenta11).toBe('100000000.00');
    expect(ct.razonCorriente).toBeCloseTo(2, 5);
    expect(res.reclasificacionesNoCompensacion.map((r) => r.cuenta_destino_pasivo)).toEqual([
      '2105',
    ]);
  });

  it('anticipo de cliente en 1305 con saldo crédito: pasivo corriente y destino PUC 2805', () => {
    const res = pp(
      [
        'codigo,nombre,Saldo 2025',
        '110505,Caja,300000000',
        '130505,Clientes,100000000',
        '130510,Clientes con anticipo,-40000000',
        '220505,Proveedores,100000000',
        '310505,Capital,260000000',
      ].join('\n'),
    );
    const ct = res.primary.controlTotals;
    expect(ct.pasivoCorriente).toBe(140_000_000);
    expect(ct.pasivoNoCorriente).toBe(0);
    expect(ct.deudoresCuenta13).toBe(100_000_000);
    expect(res.reclasificacionesNoCompensacion[0]?.cuenta_destino_pasivo).toBe('2805');
  });
});

// ---------------------------------------------------------------------------
// niif-preproceso-26 — R12 respeta periodoTipo
// ---------------------------------------------------------------------------
describe('niif-preproceso-26 — cortes parciales no se sellan por libros abiertos', () => {
  it('corte 2025-06 de una empresa nueva: nota explicativa, sin V12', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo [2025-06]',
        '110505,Caja,400000000',
        '220505,Proveedores,100000000',
        '310505,Capital,200000000',
        '413505,Ventas,500000000',
        '513505,Gastos,400000000',
      ].join('\n'),
    ).primary;
    expect(s.periodoTipo).toBe('parcial');
    expect(s.findings?.librosNoCerrados).toBe(false);
    const r12 = (s.curator?.findings ?? []).filter((f) => f.code === 'CUR-R12');
    expect(r12.map((f) => f.severity)).toEqual(['medio']);
    expect(s.virtualCloseAdjustment?.justification).toMatch(/NOTA EXPLICATIVA/);
  });

  it('año 2025-12 sin 3605 pero con 3705 de años anteriores: SÍ marca libros no cerrados', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo [2025-12]',
        '110505,Caja,900000000',
        '220505,Proveedores,100000000',
        '310505,Capital,200000000',
        '370505,Utilidades acumuladas,500000000',
        '413505,Ventas,500000000',
        '513505,Gastos,400000000',
      ].join('\n'),
    ).primary;
    expect(s.periodoTipo).toBe('cerrado');
    expect(s.findings?.librosNoCerrados).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recalculo-03 — P&G acumulado cuando el comparativo no se cerró
// ---------------------------------------------------------------------------
describe('recalculo-03 — P&G del periodo principal posiblemente acumulado', () => {
  // 2024 nunca se cerró: las cuentas de resultado de 2025 traen el acumulado
  // 2024 + 2025 y el patrimonio no recibió el resultado de 2024.
  //   2024: ventas 800, gastos 300 → resultado 500; A 1.000 = P 400 + K 100 + 500
  //   2025: ventas 1.500 (800 + 700), gastos 600 (300 + 300) → 900 acumulado
  //         A 1.500 = P 500 + K 100 + 900. Movimiento del ejercicio = 400.
  const CSV_ACUMULADO = [
    'codigo,nombre,Saldo 2024,Saldo 2025',
    '110505,Caja,1000000000,1500000000',
    '220505,Proveedores,400000000,500000000',
    '310505,Capital,100000000,100000000',
    '413505,Ventas,800000000,1500000000',
    '513505,Gastos,300000000,600000000',
  ].join('\n');

  it('no transforma cifras: detecta el caso, bloquea y ofrece la cifra alternativa', () => {
    const res = pp(CSV_ACUMULADO);
    const s = res.primary;

    // Las cifras publicadas NO se reescriben automáticamente.
    expect(s.controlTotals.utilidadNeta).toBe(900_000_000);
    expect(s.controlTotals.ingresosNetos).toBe(1_500_000_000);

    // Hallazgo explícito con el movimiento del ejercicio (variación).
    const hallazgo = (s.curator?.findings ?? []).find(
      (f) => f.code === 'CUR-R12' && /acumulad/i.test(f.title),
    );
    expect(hallazgo?.severity).toBe('critico');
    expect(hallazgo?.description).toContain('400.000.000,00');
    expect(hallazgo?.description).toContain('700.000.000,00');
    expect(hallazgo?.description).toContain('2024');

    // Bloqueo post-curator con la cifra alternativa + bandera del gate (V12).
    const blocker = (s.validation.curatorBlockingReasons ?? []).find((r) =>
      r.startsWith('[CUR-R12]'),
    );
    expect(blocker).toBeDefined();
    expect(blocker).toContain('400.000.000,00');
    expect(s.validation.blocking).toBe(true);
    expect(s.findings?.librosNoCerrados).toBe(true);
    expect(s.closingDetectorAudit?.pygAcumulado?.utilidadMovimientoRaw).toBe('400000000.00');
  });

  it('control: si 2024 se cerró (resultado en 3705) y el P&G 2025 es del ejercicio, no dispara', () => {
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,1000000000,1500000000',
        '220505,Proveedores,400000000,500000000',
        '310505,Capital,100000000,100000000',
        '370505,Utilidades acumuladas,0,500000000',
        '413505,Ventas,800000000,700000000',
        '513505,Gastos,300000000,300000000',
      ].join('\n'),
    ).primary;
    expect(
      (s.curator?.findings ?? []).some((f) => f.code === 'CUR-R12' && /acumulad/i.test(f.title)),
    ).toBe(false);
    expect(s.closingDetectorAudit?.pygAcumulado).toBeUndefined();
  });

  it('con evidencia de dividendos (2360) el caso es ambiguo: hallazgo explícito sin bloqueo', () => {
    // 2024 cerrado y distribuido íntegramente (2360 pagado) produce el mismo
    // patrimonio que un 2024 sin cerrar: se informa con ambas lecturas.
    const s = pp(
      [
        'codigo,nombre,Saldo 2024,Saldo 2025',
        '110505,Caja,1000000000,1000000000',
        '220505,Proveedores,400000000,500000000',
        '236005,Dividendos por pagar,0,0',
        '310505,Capital,100000000,100000000',
        '413505,Ventas,800000000,700000000',
        '513505,Gastos,300000000,300000000',
      ].join('\n'),
    ).primary;
    const hallazgo = (s.curator?.findings ?? []).find(
      (f) => f.code === 'CUR-R12' && /acumulad/i.test(f.title),
    );
    expect(hallazgo?.severity).toBe('alto');
    expect(
      (s.validation.curatorBlockingReasons ?? []).some((r) => r.startsWith('[CUR-R12]')),
    ).toBe(false);
  });
});
