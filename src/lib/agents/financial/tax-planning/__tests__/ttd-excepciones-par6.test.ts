// ---------------------------------------------------------------------------
// tributario-modulos-23 — Excepciones de la TTD (parágrafo 6, Art. 240 E.T.)
// ---------------------------------------------------------------------------
// El prompt del Tax Optimizer listaba como «excepciones del parág. 6» al RTE y
// al SIMPLE (que no tributan por el Art. 240, así que no son sujetos) y
// omitía a las personas jurídicas extranjeras sin residencia, las editoriales
// (par. 7), las sociedades del par. 1, el Art. 32 y la UD ≤ 0. Texto literal:
// src/data/tax_docs/ley_2277_2022.md (Art. 10, parágrafo 6: «salvo las
// personas jurídicas extranjeras sin residencia en el país»; «no aplica para:
// a) ZESE durante tarifa 0%, ZOMAC, parágrafos 5 y 7 […]; b) parágrafo 1 […]
// UD ≤ 0; c) artículo 32»).
// La tasa efectiva nullable (N/D) ya está en el contrato: aquí se fija.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildTaxOptimizerPrompt, EXCEPCIONES_TTD_PAR6 } from '../prompts/tax-optimizer.prompt';
import { CurrentDiagnosisSchema, DualCalculationSchema } from '../../contracts/tax-planning';
import type { CompanyInfo } from '../../types';

const company: CompanyInfo = { name: 'Comercial SAS', nit: '900123456-1', fiscalPeriod: '2025' };

describe('excepciones de la TTD según el texto del parágrafo 6', () => {
  const p = buildTaxOptimizerPrompt(company, 'es');

  it('incluye las exclusiones literales del parágrafo 6', () => {
    for (const e of EXCEPCIONES_TTD_PAR6) expect(p).toContain(e);
    const lista = EXCEPCIONES_TTD_PAR6.join(' | ');
    expect(lista).toMatch(/extranjeras sin residencia/);
    expect(lista).toMatch(/ZESE/);
    expect(lista).toMatch(/ZOMAC/);
    expect(lista).toMatch(/parágrafos 5 y 7/);
    expect(lista).toMatch(/parágrafo 1/);
    expect(lista).toMatch(/UD\) ≤ 0|UD ≤ 0/);
    expect(lista).toMatch(/Art\. 32/);
  });

  it('RTE y SIMPLE no se presentan como excepciones del parágrafo 6 ni aparece FNCER', () => {
    expect(p).not.toMatch(/excepción del parág\. 6 \(RTE/);
    expect(p).not.toMatch(/FNCER|Ley 1715/);
    const lista = EXCEPCIONES_TTD_PAR6.join(' | ');
    expect(lista).not.toMatch(/RTE|SIMPLE/);
  });

  it('el describe() del contrato no cita RTE/SIMPLE como excepción del parágrafo 6', () => {
    const d = DualCalculationSchema.shape.tmtExemptionReason.description ?? '';
    expect(d).not.toMatch(/Art\. 19 RTE/);
    expect(d).toMatch(/parágrafo 6/);
  });

  it('effectiveTaxRatePct admite null (N/D)', () => {
    expect(CurrentDiagnosisSchema.shape.effectiveTaxRatePct.safeParse(null).success).toBe(true);
  });
});
