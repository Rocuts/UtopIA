// ---------------------------------------------------------------------------
// Wave 2.F4 — smoke test del bloque vinculante orchestrator-side.
// ---------------------------------------------------------------------------
// Verifica que `renderSnapshotLines` (helper que el orquestador financiero
// usa para construir el bloque "TOTALES VINCULANTES" que el LLM consume)
// emite las nuevas líneas Wave 2.F4:
//   - "Tipo de período"
//   - "Total Ingresos (bruto Clase 4)"
//   - "Total Ingresos Netos (neto de devoluciones 4175)"
//   - Sección "## KPIs PRE-CALCULADOS" con los 13 ratios.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { renderSnapshotLines } from '@/lib/agents/financial/orchestrator';

import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';

function buildPreprocessed() {
  // Mini fixture: empresa comercializadora con devoluciones 4175 y suficiente
  // P&L para que TODOS los KPIs estén disponibles (no ND).
  const csv = [
    'codigo,nombre,nivel,saldo 2025',
    // Activo
    '1,Activos,Clase,200000000',
    '11,Disponible,Grupo,50000000',
    '110505,Caja,Auxiliar,50000000',
    '13,Deudores,Grupo,40000000',
    '130505,Clientes,Auxiliar,40000000',
    '14,Inventarios,Grupo,60000000',
    '143505,Mercancías,Auxiliar,60000000',
    '15,PPE,Grupo,50000000',
    '152405,Equipo oficina,Auxiliar,50000000',
    // Pasivo
    '2,Pasivos,Clase,80000000',
    '22,Proveedores,Grupo,30000000',
    '220505,Proveedores nacionales,Auxiliar,30000000',
    '23,Cxp,Grupo,30000000',
    '230505,Cxp comerciales,Auxiliar,30000000',
    '24,Impuestos,Grupo,20000000',
    '240405,Renta,Auxiliar,20000000',
    // Patrimonio
    '3,Patrimonio,Clase,120000000',
    '311505,Capital suscrito,Auxiliar,100000000',
    // P&L con devoluciones 4175.
    '4,Ingresos,Clase,210000000',
    '410505,Ventas,Auxiliar,200000000',
    '417505,Devoluciones rebajas,Auxiliar,10000000',
    '5,Gastos,Clase,30000000',
    '510505,Sueldos,Auxiliar,20000000',
    '530505,Intereses,Auxiliar,10000000',
    '6,Costos,Clase,150000000',
    '613505,CMV,Auxiliar,150000000',
  ].join('\n');

  const rows = parseTrialBalanceCSV(csv);
  return preprocessTrialBalance(rows);
}

describe('Wave 2.F4 — bindingTotals: nuevas líneas Wave 2.F4', () => {
  it('Emite "Tipo de período" para el LLM (Parte 2.1 VERIFICACIÓN 4)', () => {
    const pre = buildPreprocessed();
    const lines = renderSnapshotLines(pre.primary);
    const text = lines.join('\n');
    expect(text).toContain('Tipo de período:');
    // El periodo "2025" → indeterminado (sólo año, sin contexto de mes).
    expect(text).toContain('indeterminado');
  });

  it('Emite "Total Ingresos (bruto Clase 4)" + "Total Ingresos Netos (neto de devoluciones 4175)"', () => {
    const pre = buildPreprocessed();
    const lines = renderSnapshotLines(pre.primary);
    const text = lines.join('\n');
    expect(text).toContain('Total Ingresos (bruto Clase 4)');
    expect(text).toContain('Total Ingresos Netos (neto de devoluciones 4175)');
    expect(text).toContain('NIIF 15 §47');
  });

  it('Emite la sección "## KPIs PRE-CALCULADOS" con los 13 ratios', () => {
    const pre = buildPreprocessed();
    const lines = renderSnapshotLines(pre.primary);
    const text = lines.join('\n');
    expect(text).toContain('## KPIs PRE-CALCULADOS');
    expect(text).toContain('Razón Corriente');
    expect(text).toContain('Prueba Ácida');
    expect(text).toContain('Endeudamiento Total');
    expect(text).toContain('Apalancamiento Financiero');
    expect(text).toContain('Cobertura de Intereses');
    expect(text).toContain('Margen Operativo');
    expect(text).toContain('Margen Neto');
    expect(text).toContain('ROE');
    expect(text).toContain('ROA');
    expect(text).toContain('Rotación de Activos');
    expect(text).toContain('Días de Cartera');
    expect(text).toContain('Días de Inventario');
    expect(text).toContain('Días de Proveedores');
    expect(text).toContain('AUTORIDAD');
    expect(text).toContain('NO los recalcules');
  });

  it('KPI con denominador anómalo emite "ND" explícito (sin invención silenciosa)', () => {
    // CSV con ingresos pero sin gasto financiero 5305 → Cobertura intereses = ND.
    const csv = [
      'codigo,nombre,nivel,saldo 2025',
      '4,Ingresos,Clase,100000000',
      '410505,Ventas,Auxiliar,100000000',
      '6,Costos,Clase,50000000',
      '613505,CMV,Auxiliar,50000000',
    ].join('\n');
    const rows = parseTrialBalanceCSV(csv);
    const pre = preprocessTrialBalance(rows);
    const lines = renderSnapshotLines(pre.primary);
    const text = lines.join('\n');
    expect(text).toMatch(/Cobertura de Intereses:\s+ND/);
  });
});
