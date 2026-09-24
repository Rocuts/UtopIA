// ---------------------------------------------------------------------------
// prompts-normativa-25 — tarifas, umbrales y citas menores en módulos satélite
// ---------------------------------------------------------------------------
// Ítems de este paquete (los demás del hallazgo ya estaban corregidos o viven
// en prompts de otros módulos):
//   - Impuesto diferido: el asiento «contra 3705xx ORI» usa utilidades
//     acumuladas (PUC 3705) como ORI. El PUC no tiene grupo ORI bajo NIIF; se
//     usa la cuenta que la entidad tenga mapeada (grupo 38 en el PUC adaptado).
//   - Cumplimiento (planeación): SMMLV 2026 citado sólo con el Decreto
//     1469/2025, suspendido; la cifra la ratifica el Decreto transitorio 0159
//     de 2026 (src/modules/pyme/data/normativa2026.ts). Umbrales de precios de
//     transferencia atribuidos al Art. 260-1 (son de los Arts. 260-5 y 260-9).
//   - Tax Optimizer: 45.000 UVT presentado como umbral general de obligación
//     y 100.000/61.000 UVT con «>» (el Art. 260-5 dice «igual o superior»).
//   - Factibilidad: «Zona Franca — tarifa renta 20%» sin la proporción de
//     exportaciones del Art. 240-1 (mod. art. 11 Ley 2277/2022 —
//     src/data/tax_docs/ley_2277_2022.md); SMMLV/UVT escritos a mano.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildDeferredTaxCalculatorPrompt } from '../../tax-reconciliation/prompts/deferred-tax-calculator.prompt';
import { buildComplianceValidatorPrompt } from '../prompts/compliance-validator.prompt';
import { buildTaxOptimizerPrompt } from '../prompts/tax-optimizer.prompt';
import { buildFinancialModelerPrompt } from '../../feasibility/prompts/financial-modeler.prompt';
import { buildRiskAssessorPrompt } from '../../feasibility/prompts/risk-assessor.prompt';
import { buildMarketAnalystPrompt } from '../../feasibility/prompts/market-analyst.prompt';
import { SMMLV_2026 } from '@/lib/tax/taxCalculator';
import type { CompanyInfo } from '../../types';

const company: CompanyInfo = { name: 'Comercial SAS', nit: '900123456-1', fiscalPeriod: '2025' };
const smmlv = `$${SMMLV_2026.toLocaleString('es-CO')}`;

describe('impuesto diferido — el ORI no es la 3705 (utilidades acumuladas)', () => {
  const p = buildDeferredTaxCalculatorPrompt(company, 'es');
  it('no ordena asientos contra 3705xx como ORI', () => {
    expect(p).not.toMatch(/3705xx/);
    expect(p).toMatch(/nunca 3705/);
    expect(p).toMatch(/grupo 38/);
  });
});

describe('cumplimiento — SMMLV y umbrales de precios de transferencia', () => {
  const p = buildComplianceValidatorPrompt(company, 'es');
  it('SMMLV 2026 con el decreto transitorio que lo ratifica', () => {
    expect(p).toContain(smmlv);
    expect(p).toMatch(/Decreto (transitorio )?0159/);
    expect(p).toMatch(/1469\/2025[^.\n]*suspendid/);
  });
  it('los umbrales de precios de transferencia no se atribuyen al Art. 260-1', () => {
    expect(p).not.toMatch(/precios de transferencia Art\. 260-1\b/);
  });
});

describe('Tax Optimizer — umbrales de precios de transferencia', () => {
  const p = buildTaxOptimizerPrompt(company, 'es');
  it('100.000 / 61.000 UVT con «igual o superior» y 45.000 UVT por tipo de operación', () => {
    expect(p).not.toMatch(/umbral 45\.000 UVT operaciones vinculados/);
    expect(p).toMatch(/patrimonio bruto ≥ 100\.000 UVT/);
    expect(p).toMatch(/ingresos brutos ≥ 61\.000 UVT/);
    expect(p).toMatch(/45\.000 UVT por tipo de operación/);
    expect(p).toMatch(/Arts?\. 260-5 y 260-9/);
  });
});

describe('factibilidad — zona franca y constantes', () => {
  const base = { projectName: 'P', description: 'd', sector: 's' };
  const fm = buildFinancialModelerPrompt({ ...base, isZonaFranca: true }, 'es', { now: new Date('2026-09-24T12:00:00Z') });
  it('20% sólo sobre la renta proporcional a exportaciones del usuario industrial', () => {
    expect(fm).not.toMatch(/Tarifa renta: 20% \(Art\. 240-1 E\.T\.\)\./);
    expect(fm).toMatch(/usuario industrial/i);
    expect(fm).toMatch(/proporci[oó]n de ingresos por exportaci[oó]n/i);
    expect(fm).toMatch(/usuarios comerciales[^\n]*35%/i);
  });
  it('SMMLV 2026 sale de la constante verificada', () => {
    expect(fm).toContain(`SMMLV 2026 = ${smmlv}`);
    expect(buildRiskAssessorPrompt(base, 'es')).toContain(`SMMLV 2026 = ${smmlv}`);
    expect(buildMarketAnalystPrompt(base, 'es')).toContain(`SMMLV 2026 = ${smmlv}`);
  });
});
