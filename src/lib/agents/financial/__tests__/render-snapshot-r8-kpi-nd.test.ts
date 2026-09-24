// ---------------------------------------------------------------------------
// renderSnapshotLines — R8 sin absorción y KPIs N/D con motivo
// ---------------------------------------------------------------------------
// niif-preproceso-16: desde la auditoría 2026-09 R8 no absorbe residuales
//   (centsAdjustment = 0). El bloque vinculante seguía describiendo el
//   "Ajuste residual absorbido" y callaba el descuadre que R8 deja bloqueante.
// ratios-kpis-07: ROE / apalancamiento publicados como N/D por patrimonio no
//   positivo salían como "ND" sin causa, aunque el preprocesador la trae en
//   `controlTotals.kpiNdMotivos`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';

/** Cuadra SIN el P&G (3605 = $20M) y el resultado de las clases 4-7 es $10M. */
const R8_RESIDUAL = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,100000000',
  '220505,Proveedores,Auxiliar,1,30000000',
  '311505,Capital,Auxiliar,1,50000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000',
  '410505,Ventas,Auxiliar,1,100000000',
  '510505,Sueldos,Auxiliar,1,90000000',
].join('\n');

/** Patrimonio negativo: 50 = 100 + (10 − 60). */
const PATRIMONIO_NEGATIVO = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000',
  '220505,Proveedores,Auxiliar,1,100000000',
  '311505,Capital,Auxiliar,1,10000000',
  '361005,Pérdida del ejercicio,Auxiliar,1,-60000000',
  '410505,Ventas,Auxiliar,1,40000000',
  '510505,Sueldos,Auxiliar,1,100000000',
].join('\n');

describe('niif-preproceso-16 — sección R8 del bloque vinculante', () => {
  it('residual no explicado por el resultado: se declara bloqueante, sin "absorbido"', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(R8_RESIDUAL));
    const vc = pp.primary.virtualCloseAdjustment;
    expect(vc?.blocking).toBe(true);
    const text = renderSnapshotLines(pp.primary).join('\n');
    expect(text).toContain('## Cierre Virtual aplicado (Curator R8)');
    expect(text).toMatch(/Descuadre NO explicado por el resultado del ejercicio: .*\(bloqueante\)/);
    expect(text).not.toContain('Ajuste residual absorbido');
  });
});

describe('ratios-kpis-07 — KPIs N/D con su motivo', () => {
  it('ROE y apalancamiento con patrimonio ≤ 0 muestran la causa, no "ND" a secas', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(PATRIMONIO_NEGATIVO));
    const ct = pp.primary.controlTotals;
    expect(ct.roe ?? null).toBeNull();
    expect(ct.kpiNdMotivos?.roe).toBeTruthy();
    expect(ct.kpiNdMotivos?.apalancamientoFinanciero).toBeTruthy();
    const lines = renderSnapshotLines(pp.primary);
    const roe = lines.find((l) => l.startsWith('- ROE:'));
    const apal = lines.find((l) => l.startsWith('- Apalancamiento Financiero:'));
    expect(roe).toBe(`- ROE: ${ct.kpiNdMotivos!.roe}`);
    expect(apal).toBe(`- Apalancamiento Financiero: ${ct.kpiNdMotivos!.apalancamientoFinanciero}`);
    expect(roe).toMatch(/patrimonio/);
  });
});
