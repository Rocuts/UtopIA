// ---------------------------------------------------------------------------
// TOTALES VINCULANTES — KPIs con motivo, base y EBITDA único (W3-A)
// ---------------------------------------------------------------------------
// ratios-kpis-24 / -18 / -05, niif-preproceso-25 / -21, ingesta-09: el
// preprocesador ya calcula margen bruto, EBITDA (`computeEbitda`), capital de
// trabajo, ciclo de conversión del efectivo, cartera neta, la base de los KPIs
// (365 días / anualización), el supuesto de clasificación corriente y el
// motivo de cada KPI N/D — pero el bloque vinculante no los publicaba: el LLM
// veía "ND" a secas y derivaba EBITDA con su propia definición. Un comparativo
// leído de la columna de saldo inicial se presentaba como P&G comparativo.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { prepareFinancialContext, renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { computeEbitda } from '@/lib/pillars/ebitda';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

const FULL = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '130505,Clientes,Auxiliar,1,40000000',
  '139905,Deterioro clientes,Auxiliar,1,-4000000',
  '143505,Mercancías,Auxiliar,1,60000000',
  '152405,Equipo oficina,Auxiliar,1,54000000',
  '220505,Proveedores nacionales,Auxiliar,1,30000000',
  '230505,Cxp comerciales,Auxiliar,1,30000000',
  '240405,Renta,Auxiliar,1,20000000',
  '311505,Capital suscrito,Auxiliar,1,100000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,200000000',
  '417505,Devoluciones,Auxiliar,1,10000000',
  '510505,Sueldos,Auxiliar,1,15000000',
  '516005,Depreciación,Auxiliar,1,5000000',
  '530505,Intereses,Auxiliar,1,10000000',
  '613505,CMV,Auxiliar,1,140000000',
].join('\n');

/** Servicios sin clientes 1305/1310 ni costos: días de cartera / inventario N/D. */
const SIN_CLIENTES = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,100000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,50000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Honorarios,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

/** Sin grupo 41 (sólo ingresos no operacionales 42): EBITDA N/D con motivo. */
const SIN_GRUPO_41 = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,100000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,50000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '421005,Intereses recibidos,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,80000000',
].join('\n');

const text = (csv: string) =>
  renderSnapshotLines(preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary).join('\n');
const lineOf = (t: string, prefix: string) => t.split('\n').find((l) => l.startsWith(prefix));

describe('bloque vinculante — KPIs que ya calcula el preprocesador', () => {
  const pp = () => preprocessTrialBalance(parseTrialBalanceCSV(FULL));

  it('publica margen bruto, capital de trabajo, cartera neta, ciclo de conversión y base de los KPIs', () => {
    const snap = pp().primary;
    const ct = snap.controlTotals;
    const t = renderSnapshotLines(snap).join('\n');
    expect(lineOf(t, '- Margen Bruto')).toMatch(/%$/);
    expect(lineOf(t, '- Capital de Trabajo')).toContain(`[MoneyCop: ${Math.round(ct.capitalTrabajo! * 100)}]`);
    expect(lineOf(t, '- Cartera comercial neta')).toContain('[MoneyCop: 3600000000]');
    expect(lineOf(t, '- Ciclo de Conversión del Efectivo')).toMatch(/días$/);
    expect(t).toContain(`- Base de los KPIs: ${ct.kpiBaseNota}`);
    expect(t).toContain(ct.clasificacionSupuesta!);
  });

  it('EBITDA con la definición única de computeEbitda y su token MoneyCop', () => {
    const snap = pp().primary;
    const ebitda = computeEbitda(snap).ebitda!;
    const line = lineOf(renderSnapshotLines(snap).join('\n'), '- EBITDA');
    expect(line).toBeDefined();
    expect(line).toContain(`[MoneyCop: ${Math.round(ebitda * 100)}]`);
    expect(snap.controlTotals.ebitda).toBe(ebitda);
  });

  it('rotula los días de cartera con su base (cartera neta / ingresos operacionales netos)', () => {
    const line = lineOf(text(FULL), '- Días de Cartera');
    expect(line).toMatch(/1305 \+ 1310 − 1399/);
    expect(line).toMatch(/41 − 4175/);
    expect(line).toMatch(/\d+ días$/);
  });
});

describe('bloque vinculante — motivo junto a cada N/D (kpiNdMotivos)', () => {
  it('días de cartera, inventario, proveedores y ciclo N/D con el motivo del preprocesador', () => {
    const snap = preprocessTrialBalance(parseTrialBalanceCSV(SIN_CLIENTES)).primary;
    const m = snap.controlTotals.kpiNdMotivos!;
    const t = renderSnapshotLines(snap).join('\n');
    expect(m.diasCartera).toBeTruthy();
    expect(lineOf(t, '- Días de Cartera')).toContain(m.diasCartera!);
    expect(lineOf(t, '- Días de Inventario')).toContain(m.diasInventario!);
    expect(lineOf(t, '- Días de Proveedores')).toContain(m.diasProveedores!);
    expect(lineOf(t, '- Ciclo de Conversión del Efectivo')).toContain(m.cicloConversionEfectivo!);
  });

  it('EBITDA sin grupo 41: N/D con el motivo, sin token', () => {
    const snap = preprocessTrialBalance(parseTrialBalanceCSV(SIN_GRUPO_41)).primary;
    const line = lineOf(renderSnapshotLines(snap).join('\n'), '- EBITDA');
    expect(line).toContain(snap.controlTotals.kpiNdMotivos!.ebitda!);
    expect(line).not.toContain('MoneyCop');
    const margen = lineOf(renderSnapshotLines(snap).join('\n'), '- Margen Bruto');
    expect(margen).toContain(snap.controlTotals.kpiNdMotivos!.margenBruto!);
  });
});

describe('bloque vinculante — comparativo de saldos de apertura (ingesta-09)', () => {
  const OPENING_CSV = [
    'codigo,nombre,nivel,transaccional,saldo inicial 2025,saldo final 2025',
    '110505,Caja,Auxiliar,1,50000000,80000000',
    '130505,Clientes,Auxiliar,1,40000000,60000000',
    '220505,Proveedores,Auxiliar,1,30000000,40000000',
    '311505,Capital,Auxiliar,1,40000000,40000000',
    '360505,Utilidad del ejercicio,Auxiliar,1,0,40000000',
    '370505,Utilidades acumuladas,Auxiliar,1,20000000,20000000',
    '410505,Ventas,Auxiliar,1,0,150000000',
    '510505,Sueldos,Auxiliar,1,0,110000000',
  ].join('\n');
  const COMPANY = { name: 'Demo SAS', nit: '900123456-7', entityType: 'SAS', fiscalPeriod: '2025', niifGroup: 2 as const };

  it('Stage 0 marca el comparativo y el bloque declara su P&G y las variaciones de resultados N/D', async () => {
    const ctx = await prepareFinancialContext({ rawData: OPENING_CSV, company: COMPANY, language: 'es' }, {});
    expect(ctx.ppForAgents?.comparative?.saldosDeApertura).toBe(true);
    const block = ctx.bindingTotalsBlock;
    const comparativeSection = block.slice(block.indexOf('=== Periodo comparativo (2024)'));
    expect(comparativeSection).toMatch(/saldos de apertura/i);
    expect(lineOf(block, '- Utilidad Neta:')).toMatch(/^- Utilidad Neta: ND/);
    expect(lineOf(block, '- Ingresos:')).toMatch(/^- Ingresos: ND/);
    // Los saldos del ESF de apertura sí son comparables.
    expect(lineOf(block, '- Activo:')).not.toMatch(/ND/);
  });
});
