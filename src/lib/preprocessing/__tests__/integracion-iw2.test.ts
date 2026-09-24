// ---------------------------------------------------------------------------
// Integración IW2 (auditoría 2026-09) — preprocesador de balances de prueba.
// ---------------------------------------------------------------------------
// Dependencias cruzadas de la ola 1 que caen en `trial-balance.ts`:
//   - ingesta-29: naturaleza PUC de las clases 8 y 9 compartida con el
//     importador de apertura (`isDebitNaturePuc`).
//   - niif-preproceso-24 / ratios-kpis-04: denominadores sobre ingresos
//     operacionales netos (41 − 4175), sin el grupo 42.
//   - ratios-kpis-18 / niif-preproceso-25: días sobre base 365 con cartera
//     neta (1305 + 1310 − 1399); anualización × 12/meses o N/D con motivo.
//   - ratios-kpis-24 / ratios-kpis-05: EBITDA (definición única de
//     `pillars/ebitda.ts`), capital de trabajo y ciclo de conversión.
//   - niif-preproceso-21: la clasificación corriente/no corriente por grupo
//     PUC se declara como supuesto.
//   - ingesta-09 (parcial): un comparativo que viene de la columna de saldo
//     inicial se marca como apertura y sus KPIs de resultados son N/D.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  isDebitNaturePuc,
  mesesDelPeriodo,
  parseTrialBalanceCSV,
  parseTrialBalanceCSVWithMeta,
  preprocessTrialBalance,
} from '@/lib/preprocessing/trial-balance';
import { computeEbitda } from '@/lib/pillars/ebitda';
import { isDebitNaturePuc as isDebitNaturePucApertura } from '@/lib/accounting/opening-balance/parser';

describe('ingesta-29 — naturaleza de las clases 8 y 9 en el parser (débito/crédito)', () => {
  const csv = [
    'codigo,nombre,debito,credito',
    '11050501,Caja,1000,0',
    '31050501,Capital,0,1000',
    '83050501,Bienes recibidos en custodia,5000,0',
    '86050501,Deudoras de control por contra,0,5000',
    '93050501,Acreedoras de control,0,7000',
    '94050501,Acreedoras de control por contra,7000,0',
  ].join('\n');

  it('clase 8 deudora (84-86 por contra acreedoras) y clase 9 acreedora (94-96 deudoras): saldo natural positivo', () => {
    const rows = parseTrialBalanceCSV(csv, { normalizeSignConvention: false });
    const saldo = (code: string) => rows.find((r) => r.code === code)?.balancesByPeriod.current;
    expect(saldo('83050501')).toBe(5000);
    expect(saldo('86050501')).toBe(5000);
    expect(saldo('93050501')).toBe(7000);
    expect(saldo('94050501')).toBe(7000);
  });

  it('el preprocesador y el importador de apertura comparten la misma regla', () => {
    expect(isDebitNaturePucApertura).toBe(isDebitNaturePuc);
  });
});

// ---------------------------------------------------------------------------
// KPIs derivados
// ---------------------------------------------------------------------------
// Libros cerrados (convención natural):
//   ingresos operacionales netos = 1.000 − 50 (4175) = 950M; grupo 42 = 100M
//   utilidad bruta = 950 − 600 = 350M; EBIT = 350 − 150 − 20 = 180M
//   D&A (5160) = 20M → EBITDA = 200M
//   utilidad neta = 1.050 − 600 − 150 − 20 − 30 − 50 = 200M = 3605
//   A 370M = P 100M + K 270M (70 + 200)
function balance(header: string): string {
  return [
    `codigo,nombre,nivel,transaccional,${header}`,
    '110505,Caja,Auxiliar,1,100000000',
    '130505,Clientes nacionales,Auxiliar,1,150000000',
    '131005,Cuentas corrientes comerciales,Auxiliar,1,20000000',
    '133005,Anticipos a proveedores,Auxiliar,1,30000000',
    '139905,Deterioro de clientes,Auxiliar,1,-10000000',
    '143505,Mercancías no fabricadas,Auxiliar,1,80000000',
    '220505,Proveedores nacionales,Auxiliar,1,60000000',
    '233595,Otros costos y gastos por pagar,Auxiliar,1,40000000',
    '311505,Aportes sociales,Auxiliar,1,70000000',
    '360505,Utilidad del ejercicio,Auxiliar,1,200000000',
    '413505,Ventas,Auxiliar,1,1000000000',
    '417505,Devoluciones en ventas,Auxiliar,1,-50000000',
    '421005,Intereses,Auxiliar,1,100000000',
    '613505,Costo de ventas,Auxiliar,1,600000000',
    '510506,Sueldos,Auxiliar,1,150000000',
    '516005,Depreciación de edificaciones,Auxiliar,1,20000000',
    '530505,Gastos bancarios,Auxiliar,1,30000000',
    '540505,Impuesto de renta,Auxiliar,1,50000000',
  ].join('\n');
}

const pp = (header: string) => preprocessTrialBalance(parseTrialBalanceCSV(balance(header))).primary;

describe('niif-preproceso-24 — denominadores sobre ingresos operacionales netos (41 − 4175)', () => {
  it('margen operativo, margen bruto y rotación usan 950M, no los 1.050M con el grupo 42', () => {
    const ct = pp('Saldo 2025').controlTotals;
    expect(ct.ingresosOperacionalesNetos).toBe(950_000_000);
    expect(ct.ingresosNetos).toBe(1_050_000_000);
    expect(ct.ebit).toBe(180_000_000);
    expect(ct.margenOperativo).toBeCloseTo((180 / 950) * 100, 6);
    expect(ct.margenBruto).toBeCloseTo((350 / 950) * 100, 6);
    expect(ct.rotacionActivos).toBeCloseTo(950 / 370, 6);
    // El margen neto conserva la base de ingresos netos totales (WP06).
    expect(ct.margenNeto).toBeCloseTo((200 / 1050) * 100, 6);
  });
});

describe('niif-preproceso-25 / ratios-kpis-18 — días sobre base 365 y anualización', () => {
  it('cierre anual: días con cartera neta (1305 + 1310 − 1399) y base 365, sin anualizar', () => {
    const ct = pp('Saldo 2025').controlTotals;
    expect(ct.clientesNetos).toBe(160_000_000);
    expect(ct.mesesPeriodo).toBe(12);
    expect(ct.diasPeriodo).toBe(365);
    expect(ct.diasCartera).toBeCloseTo((160 / 950) * 365, 6);
    expect(ct.diasInventario).toBeCloseTo((80 / 600) * 365, 6);
    expect(ct.diasProveedores).toBeCloseTo((60 / 600) * 365, 6);
    expect(ct.roe).toBeCloseTo((200 / 270) * 100, 6);
    expect(ct.roa).toBeCloseTo((200 / 370) * 100, 6);
    expect(ct.kpiBaseNota).toMatch(/365/);
    expect(ct.kpiBaseNota).toMatch(/12 meses/);
  });

  it('corte a junio (6 meses): ROE, ROA, rotación y días se anualizan × 12/6 y se declara', () => {
    const ct = pp('saldo [2025-06]').controlTotals;
    expect(ct.mesesPeriodo).toBe(6);
    expect(ct.roe).toBeCloseTo(((200 * 2) / 270) * 100, 6);
    expect(ct.roa).toBeCloseTo(((200 * 2) / 370) * 100, 6);
    expect(ct.rotacionActivos).toBeCloseTo((950 * 2) / 370, 6);
    expect(ct.diasCartera).toBeCloseTo((160 / (950 * 2)) * 365, 6);
    expect(ct.diasInventario).toBeCloseTo((80 / (600 * 2)) * 365, 6);
    expect(ct.diasProveedores).toBeCloseTo((60 / (600 * 2)) * 365, 6);
    // Los márgenes son flujo / flujo del mismo periodo: no se anualizan.
    expect(ct.margenOperativo).toBeCloseTo((180 / 950) * 100, 6);
    expect(ct.kpiBaseNota).toMatch(/anualizad/i);
    expect(ct.kpiBaseNota).toMatch(/12\/6/);
  });

  it('periodo sin duración determinable: N/D con motivo en ROE, ROA, rotación y días (no una cifra)', () => {
    const ct = pp('Saldo').controlTotals;
    expect(ct.mesesPeriodo).toBeNull();
    for (const k of ['roe', 'roa', 'rotacionActivos', 'diasCartera', 'diasInventario', 'diasProveedores'] as const) {
      expect(ct[k]).toBeNull();
      expect(ct.kpiNdMotivos?.[k]).toMatch(/periodo parcial no anualizado/);
    }
    // Liquidez, endeudamiento y márgenes no dependen de la duración.
    expect(ct.razonCorriente).toBeCloseTo(370 / 100, 6);
    expect(ct.margenOperativo).toBeCloseTo((180 / 950) * 100, 6);
  });

  it('meses del periodo desde la etiqueta', () => {
    expect(mesesDelPeriodo('2025')).toBe(12);
    expect(mesesDelPeriodo('2025-06')).toBe(6);
    expect(mesesDelPeriodo('2025-Q3')).toBe(9);
    expect(mesesDelPeriodo('2025-01-01..2025-03-31')).toBe(3);
    expect(mesesDelPeriodo('2025-04-01..2025-06-30')).toBe(3);
    expect(mesesDelPeriodo('2025-01-15..2025-03-31')).toBeNull();
    expect(mesesDelPeriodo('current')).toBeNull();
    expect(mesesDelPeriodo('Balance')).toBeNull();
  });
});

describe('ratios-kpis-24 / ratios-kpis-05 — EBITDA, capital de trabajo y ciclo de conversión', () => {
  it('EBITDA = definición única de pillars/ebitda.ts (EBIT + D&A)', () => {
    const snap = pp('Saldo 2025');
    expect(snap.controlTotals.ebitda).toBe(200_000_000);
    expect(snap.controlTotals.ebitda).toBe(computeEbitda(snap).ebitda);
  });

  it('capital de trabajo = AC − PC y ciclo = días cartera + inventario − proveedores', () => {
    const ct = pp('Saldo 2025').controlTotals;
    expect(ct.capitalTrabajo).toBe(270_000_000);
    expect(ct.cicloConversionEfectivo).toBeCloseTo(
      (160 / 950) * 365 + (80 / 600) * 365 - (60 / 600) * 365,
      6,
    );
  });

  it('sin días de inventario el ciclo es N/D con motivo', () => {
    const ct = pp('Saldo').controlTotals;
    expect(ct.cicloConversionEfectivo).toBeNull();
    expect(ct.kpiNdMotivos?.cicloConversionEfectivo).toMatch(/N\/D/);
  });
});

describe('niif-preproceso-21 — la clasificación corriente/no corriente se declara como supuesto', () => {
  it('controlTotals.clasificacionSupuesta explica que es por grupo PUC sin vencimientos', () => {
    const ct = pp('Saldo 2025').controlTotals;
    expect(ct.clasificacionSupuesta).toMatch(/grupo PUC/);
    expect(ct.clasificacionSupuesta).toMatch(/vencimiento/);
  });
});

describe('ingesta-09 (parcial) — comparativo desde la columna de saldo inicial', () => {
  const csv = [
    'codigo,nombre,nivel,transaccional,Saldo Inicial 2025,Saldo Final 2025',
    '110505,Caja,Auxiliar,1,300000000,450000000',
    '130505,Clientes,Auxiliar,1,100000000,150000000',
    '311505,Aportes,Auxiliar,1,400000000,400000000',
    '370505,Utilidades acumuladas,Auxiliar,1,0,0',
    '360505,Utilidad del ejercicio,Auxiliar,1,0,200000000',
    '413505,Ventas,Auxiliar,1,0,500000000',
    '510506,Sueldos,Auxiliar,1,0,300000000',
  ].join('\n');

  it('con openingPeriods el snapshot de apertura publica N/D (no $0 ni 0 %) en los KPIs de resultados', () => {
    const meta = parseTrialBalanceCSVWithMeta(csv);
    const openingPeriods = meta.balanceColumns.filter((c) => c.kind === 'opening').map((c) => c.period);
    expect(openingPeriods).toEqual(['2024']);

    const pre = preprocessTrialBalance(meta.rows, { openingPeriods });
    const apertura = pre.comparative!;
    expect(apertura.period).toBe('2024');
    expect(apertura.saldosDeApertura).toBe(true);
    const ct = apertura.controlTotals;
    for (const k of ['margenOperativo', 'roe', 'roa', 'rotacionActivos', 'diasCartera'] as const) {
      expect(ct[k]).toBeNull();
      expect(ct.kpiNdMotivos?.[k]).toMatch(/saldo inicial\/anterior/);
    }
    expect(ct.margenNeto).toBeNull();
    expect(ct.ebitda).toBeNull();
    // El ESF de apertura sí vale.
    expect(ct.razonCorriente).toBeNull(); // sin pasivo corriente
    expect(ct.capitalTrabajo).toBe(400_000_000);

    // El periodo actual no se ve afectado.
    expect(pre.primary.saldosDeApertura).toBeUndefined();
    expect(pre.primary.controlTotals.margenOperativo).toBeCloseTo((200 / 500) * 100, 6);
  });

  it('sin la opción el comportamiento previo se conserva (retrocompatible)', () => {
    const pre = preprocessTrialBalance(parseTrialBalanceCSV(csv));
    expect(pre.comparative!.saldosDeApertura).toBeUndefined();
  });
});
