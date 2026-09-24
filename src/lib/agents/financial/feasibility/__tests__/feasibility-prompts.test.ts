// Regresión valoracion-17 / 18 / 19 — ZOMAC por año gravable y tamaño, macro
// con fecha/fuente o N/D, clasificación MIPYME del Decreto 957/2019.
import { describe, it, expect } from 'vitest';
import { buildFinancialModelerPrompt } from '@/lib/agents/financial/feasibility/prompts/financial-modeler.prompt';
import { buildMarketAnalystPrompt } from '@/lib/agents/financial/feasibility/prompts/market-analyst.prompt';
import { buildZomacSchedule, zomacFractionOfGeneralRate } from '@/lib/agents/financial/feasibility/tax/zomac';
import { buildDcfModelerPrompt } from '@/lib/agents/financial/valuation/prompts/dcf-modeler.prompt';
import { buildMacroVigenteBlock } from '@/lib/agents/financial/valuation/macro-context';

const NOW = new Date('2026-09-24T12:00:00Z');
const base = { projectName: 'P', description: 'd', sector: 's' };

describe('valoracion-17 — ZOMAC (Art. 237 Ley 1819/2016)', () => {
  it('tarifa por año gravable y tamaño: micro/pequeña 50% hasta 2027; mediana/grande 75% hasta 2027; 2028+ general', () => {
    expect(zomacFractionOfGeneralRate(2026, 'micro')).toBe(0.5);
    expect(zomacFractionOfGeneralRate(2027, 'pequena')).toBe(0.5);
    expect(zomacFractionOfGeneralRate(2024, 'micro')).toBe(0.25);
    expect(zomacFractionOfGeneralRate(2026, 'mediana')).toBe(0.75);
    expect(zomacFractionOfGeneralRate(2027, 'grande')).toBe(0.75);
    expect(zomacFractionOfGeneralRate(2028, 'micro')).toBe(1);
    expect(zomacFractionOfGeneralRate(2020, 'micro')).toBeNull();
    expect(buildZomacSchedule('micro', 2026, 4).map((r) => r.ratePercent)).toEqual([17.5, 17.5, 35, 35]);
    expect(buildZomacSchedule('mediana', 2026, 3).map((r) => r.ratePercent)).toEqual([26.25, 26.25, 35]);
  });

  it('el prompt ya no usa "años 1-5: 0%" del proyecto; tabla calendario con año de inicio supuesto rotulado', () => {
    const fm = buildFinancialModelerPrompt({ ...base, isZomac: true, companySize: 'mediana', evaluationHorizon: 3 }, 'es', { now: NOW });
    expect(fm).not.toContain('Anos 1-5: 0%');
    expect(fm).toContain('AÑO GRAVABLE CALENDARIO');
    expect(fm).toContain('SUPUESTO: año siguiente a la evaluación 2026');
    expect(fm).toContain('| 1 | 2027 | 75% | 26,25% |');
    expect(fm).toContain('| 2 | 2028 | 100% | 35% |');
    expect(fm).toContain('Art. 236 Ley 1819/2016, activos totales');
    expect(fm).toContain('DUR 1625/2016, Sección 1.2.1.23.1');
  });

  it('año de inicio declarado y tamaño no informado ⇒ tarifa ZOMAC N/D (general 35%)', () => {
    const micro = buildFinancialModelerPrompt({ ...base, isZomac: true, companySize: 'micro', startYear: 2026, evaluationHorizon: 3 }, 'es', { now: NOW });
    expect(micro).toContain('año gravable 2026 (declarado)');
    expect(micro).toContain('| 1 | 2026 | 50% | 17,5% |');
    expect(micro).toContain('| 3 | 2028 | 100% | 35% |');
    const noSize = buildFinancialModelerPrompt({ ...base, isZomac: true }, 'es', { now: NOW });
    expect(noSize).toContain('tarifa ZOMAC N/D');
  });
});

describe('valoracion-18 — parámetros macro con fecha y fuente o N/D', () => {
  it('los prompts de factibilidad y DCF no fijan TRM/IBR/DTF/TES/EMBI/inflación', () => {
    const fm = buildFinancialModelerPrompt(base, 'es', { now: NOW });
    for (const stale of ['TRM ~$4.200-$4.500', 'IBR ~9-10%', 'actual 5-6%', 'Rf (TES 10Y): 11-13%', '200-300 bps']) {
      expect(fm).not.toContain(stale);
    }
    const dcf = buildDcfModelerPrompt({ name: 'A', nit: '1', fiscalPeriod: '2025' } as never, 'es');
    for (const stale of ['~12-13% nominal', '~2.0-3.0%', 'Inflación objetivo Banco de la República: 3% ± 1pp']) {
      expect(dcf).not.toContain(stale);
    }
    expect(fm).toContain('<macro_vigente>');
    expect(fm).toContain('- TRM: N/D (sin dato verificado con fecha de vigencia y fuente)');
    expect(dcf).toContain('- TES 10Y COP (rendimiento bruto): N/D');
  });

  it('un dato macro con valor, fecha y fuente se publica etiquetado; sin fecha o fuente queda N/D', () => {
    const block = buildMacroVigenteBlock({
      trmCopPerUsd: { value: 3208.66, asOf: '2026-09-23', source: 'Superfinanciera — TRM' },
      inflationCopYoYPercent: { value: 6.24, asOf: '', source: 'DANE' },
    });
    expect(block).toContain('- TRM: $3.208,66 COP/USD (vigencia 2026-09-23; fuente: Superfinanciera — TRM)');
    expect(block).toContain('- Inflación anual Colombia (IPC): N/D');
    const fm = buildFinancialModelerPrompt(base, 'es', { now: NOW, macro: { trmCopPerUsd: { value: 3208.66, asOf: '2026-09-23', source: 'Superfinanciera' } } });
    expect(fm).toContain('vigencia 2026-09-23');
  });
});

describe('valoracion-19 — clasificación MIPYME por ingresos en UVT (Decreto 957/2019)', () => {
  it('reemplaza "500 SMMLV ($711.750.000)" por los topes en UVT por macrosector', () => {
    const ma = buildMarketAnalystPrompt(base, 'es');
    expect(ma).not.toContain('711.750.000');
    expect(ma).not.toContain('Ley 590/2000, Ley 905/2004');
    expect(ma).toContain('Manufactura: micro <= 23.563 UVT ($1.234.088.562)');
    expect(ma).toContain('Servicios: micro <= 32.988 UVT ($1.727.713.512)');
    expect(ma).toContain('Comercio: micro <= 44.769 UVT ($2.344.731.606)');
    expect(ma).toContain('mediana <= 2.160.692 UVT');
    const withSize = buildMarketAnalystPrompt({ ...base, companySize: 'micro', isZomac: true }, 'es');
    expect(withSize).toContain('Microempresa (Decreto 957/2019)');
    expect(withSize).toContain('Art. 236 Ley 1819/2016');
  });
});
