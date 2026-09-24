// ---------------------------------------------------------------------------
// W5-2 — TOTALES VINCULANTES: ingresos por bloque, variación sobre ingresos
// netos y rótulo único de créditos de renta (R16).
// ---------------------------------------------------------------------------
// recalculo-final-01: la línea 'Total Ingresos (bruto Clase 4)' publicaba
// `controlTotals.ingresos`, la Σ FIRMADA de la clase 4 (4175 incluida con el
// signo del ERP): el mismo balance daba 550 M o 450 M según la convención de
// signos cuando el bruto real era 500 M. La variación YoY de Ingresos usaba
// esa misma Σ y comparaba flujos de periodos de distinta duración. R16
// rotulaba la suma de TODOS los créditos de renta como «Anticipo PUC 135515».
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { prepareFinancialContext, renderSnapshotLines } from '@/lib/agents/financial/orchestrator';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { CSV_NM_ANUAL, csvNmConPeriodo } from '@/lib/pillars/__tests__/_fixture-nm';

const COMPANY = {
  name: 'Demo SAS',
  nit: '900123456-7',
  entityType: 'SAS',
  fiscalPeriod: '2025',
  niifGroup: 2 as const,
};

const lineOf = (t: string, prefix: string) => t.split('\n').find((l) => l.startsWith(prefix));
const token = (pesos: number) => `[MoneyCop: ${Math.round(pesos * 100)}]`;

/** 41 = 500 M, 4175 = 50 M (saldo débito positivo), 42 = 20 M. */
const CSV_DEVOLUCIONES = [
  'codigo,nombre,nivel,transaccional,saldo 2025',
  '110505,Caja,Auxiliar,1,470000000',
  '311505,Capital suscrito,Auxiliar,1,470000000',
  '413550,Ventas,Auxiliar,1,500000000',
  '417505,Devoluciones en ventas,Auxiliar,1,50000000',
  '421005,Intereses,Auxiliar,1,20000000',
].join('\n');

describe('W5-2 — ingresos del bloque vinculante por bloques, sin la Σ firmada', () => {
  const snap = preprocessTrialBalance(parseTrialBalanceCSV(CSV_DEVOLUCIONES)).primary;
  const ct = snap.controlTotals;
  const block = renderSnapshotLines(snap).join('\n');

  it('no publica la Σ firmada de la clase 4 como «bruto»', () => {
    // Precondición: la Σ firmada no es ninguna cifra de ingresos presentable.
    expect(ct.ingresos).not.toBe(ct.ingresosNetos);
    expect(block).not.toContain('Total Ingresos (bruto Clase 4)');
    expect(block).not.toContain(token(ct.ingresos));
  });

  it('publica ingresos operacionales netos (41 − 4175) y otros ingresos (42) por separado, y el total neto', () => {
    expect(ct.ingresosOperacionalesNetos).toBe(450_000_000);
    expect(ct.otrosIngresosNoOperacionales).toBe(20_000_000);
    expect(lineOf(block, '- Ingresos operacionales netos (grupo 41 − devoluciones 4175)')).toContain(
      token(450_000_000),
    );
    expect(lineOf(block, '- Otros ingresos no operacionales (grupo 42')).toContain(token(20_000_000));
    expect(lineOf(block, '- Total Ingresos Netos (neto de devoluciones 4175)')).toContain(token(470_000_000));
  });
});

describe('W5-2 — Variación YoY de Ingresos sobre ingresos netos y periodos de igual duración', () => {
  it('cierre anual vs cierre anual: variación sobre ingresos netos (1.920 M vs 1.810 M), no sobre la Σ firmada', async () => {
    const ctx = await prepareFinancialContext({ rawData: CSV_NM_ANUAL, company: COMPANY, language: 'es' }, {});
    const pp = ctx.ppForAgents!;
    expect(pp.primary.controlTotals.ingresosNetos).toBe(1_920_000_000);
    expect(pp.comparative!.controlTotals.ingresosNetos).toBe(1_810_000_000);
    const yoy = ctx.bindingTotalsBlock.slice(ctx.bindingTotalsBlock.indexOf('=== Variacion YoY'));
    const line = lineOf(yoy, '- Ingresos')!;
    expect(line).toContain('$110.000.000,00');
    expect(line).toContain('+6.08%');
    expect(line).toMatch(/netos/i);
  });

  it('acumulado 2025-Q2 vs año 2024: variación de ingresos N/D con motivo (duraciones distintas)', async () => {
    const ctx = await prepareFinancialContext(
      { rawData: csvNmConPeriodo('2025-Q2'), company: COMPANY, language: 'es' },
      {},
    );
    const yoy = ctx.bindingTotalsBlock.slice(ctx.bindingTotalsBlock.indexOf('=== Variacion YoY'));
    const line = lineOf(yoy, '- Ingresos')!;
    expect(line).toMatch(/N\/D/);
    expect(line).toMatch(/6 meses/);
    expect(line).toMatch(/12 meses/);
    expect(line).not.toMatch(/\$/);
    // Los saldos del ESF siguen siendo comparables.
    expect(lineOf(yoy, '- Activo:')).not.toMatch(/N\/?D/);
  });
});

describe('W5-2 — R16 rotula los créditos de renta con la regla única', () => {
  it('«Retenciones y anticipos de renta (1355/1805, regla única)», no «Anticipo PUC 135515»', () => {
    const pp = preprocessTrialBalance(
      parseTrialBalanceCSV(
        [
          'codigo,nombre,nivel,transaccional,Saldo 2025',
          '110505,Caja,Auxiliar,1,100000000',
          '135505,Anticipo de impuestos de renta y complementarios,Auxiliar,1,20000000',
          '135515,Retencion en la fuente,Auxiliar,1,25000000',
          '240405,Impuesto de renta,Auxiliar,1,60000000',
          '310505,Capital,Auxiliar,1,85000000',
        ].join('\n'),
      ),
    );
    const block = renderSnapshotLines(pp.primary).join('\n');
    expect(block).toContain('- (−) Retenciones y anticipos de renta (1355/1805, regla única): $45.000.000,00');
    expect(block).not.toContain('Anticipo PUC 135515');
    expect(block).toContain('NETO A PAGAR a la DIAN: $15.000.000,00');
  });
});
