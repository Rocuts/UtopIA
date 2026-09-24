// ---------------------------------------------------------------------------
// recalculo-11 — una sola fuente vinculante del EFE en TOTALES VINCULANTES
// ---------------------------------------------------------------------------
// El bloque vinculante imprimía el EFE del curator R2 con "AUTORIDAD: estos
// valores son VINCULANTES", mientras el prompt del Analista NIIF declaraba que
// el EFE determinista lo reemplaza. En el balance real R2 daba una variación
// neta de $2.409.290.083,74 contra $850.192.334,63 observados (arranca de la
// utilidad acumulada); el determinista concilia con brecha $0. Estrategia y
// Gobierno recibían sólo el bloque vinculante, sin la regla de derogación.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { prepareFinancialContext, renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildDeterministicCashFlow } from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { moneyCopToken } from '@/lib/agents/financial/contracts/anchors';

const COMPANY = { name: 'X SAS', nit: '900123456-7', fiscalPeriod: '2025' };

const TWO_PERIODS = [
  'codigo,nombre,nivel,transaccional,saldo 2024,saldo 2025',
  '110505,Caja,Auxiliar,1,50000000,80000000',
  '130505,Clientes,Auxiliar,1,40000000,60000000',
  '220505,Proveedores,Auxiliar,1,30000000,40000000',
  '311505,Capital,Auxiliar,1,40000000,40000000',
  '360505,Utilidad del ejercicio,Auxiliar,1,20000000,60000000',
  '410505,Ventas,Auxiliar,1,100000000,150000000',
  '510505,Sueldos,Auxiliar,1,80000000,110000000',
].join('\n');

describe('TOTALES VINCULANTES — EFE único', () => {
  it('no publica el EFE R2 como vinculante', () => {
    const pp = preprocessTrialBalance(parseTrialBalanceCSV(TWO_PERIODS));
    expect(pp.primary.cashFlowIndirecto).toBeDefined();
    const text = renderSnapshotLines(pp.primary).join('\n');
    expect(text).not.toContain('EFE INDIRECTO PRECALCULADO (Curator R2)');
    expect(text).not.toMatch(/AUTORIDAD: estos valores son VINCULANTES para el Estado de Flujos/);
    expect(text).not.toMatch(/Dividendos estimados/);
  });

  it('publica el EFE determinista (el mismo que concilia) como única fuente', async () => {
    const ctx = await prepareFinancialContext({ rawData: TWO_PERIODS, company: COMPANY, language: 'es' });
    const pp = ctx.ppForAgents!;
    const efe = buildDeterministicCashFlow(pp.primary, pp.comparative ?? undefined)!;
    expect(efe.reconciled).toBe(true);
    const block = ctx.bindingTotalsBlock;
    expect(block).toContain('## EFE DETERMINISTA');
    expect(block).toContain(moneyCopToken(efe.netChangeCents));
    expect(block).toMatch(/Reconciliado: sí/);
    expect(block).not.toContain('Curator R2');
  });

  it('sin comparativo declara que el EFE no es calculable en vez de imprimir cifras parciales', async () => {
    const single = TWO_PERIODS.split('\n')
      .map((l) => l.split(',').filter((_, i) => i !== 4).join(','))
      .join('\n');
    const ctx = await prepareFinancialContext({ rawData: single, company: COMPANY, language: 'es' });
    expect(ctx.ppForAgents?.comparative ?? null).toBeNull();
    expect(ctx.bindingTotalsBlock).toMatch(/EFE[^\n]*no es calculable/);
    expect(ctx.bindingTotalsBlock).not.toContain('MODO PARCIAL');
  });
});
