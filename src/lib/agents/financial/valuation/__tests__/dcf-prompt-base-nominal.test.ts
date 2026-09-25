// ---------------------------------------------------------------------------
// valoracion-21 — DCF: g, base nominal de FCF/WACC y puntos adicionales del
// Art. 240 E.T. en el prompt del Modelador DCF
// ---------------------------------------------------------------------------
// El hallazgo: g "3-4% nominal alineado con PIB" mezclaba nominal y real; no se
// exigía que FCF, WACC y g estuvieran en la misma base; la tarifa t sólo
// admitía desviaciones por ZF, ZOMAC o SIMPLE y omitía los puntos adicionales
// del Art. 240 E.T. que cambian el escudo fiscal de Kd.
//
// Fuente del repo: src/data/tax_docs/estatuto_tributario_completo.md, Art. 240
// (mod. Ley 2277/2022): par. 2 (sector financiero, 5 puntos, 40 %, 2023-2027,
// renta gravable ≥ 120.000 UVT; nota de vigencia: los 15 puntos del Decreto
// Legislativo 1474/2025 están suspendidos por el Auto A-084-26), par. 3
// (carbón 0/5/10 y petróleo 0/5/10/15 puntos según percentil de precios,
// renta gravable ≥ 50.000 UVT) y par. 4 (hidroeléctricas, 3 puntos, 38 %,
// 2023-2026, renta gravable ≥ 30.000 UVT; no aplica a PCH ≤ 1.000 kW).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { buildDcfModelerPrompt } from '@/lib/agents/financial/valuation/prompts/dcf-modeler.prompt';

const company = { name: 'ACME SAS', nit: '900123456-7', fiscalPeriod: '2025' } as never;

describe('valoracion-21 — prompt del Modelador DCF', () => {
  const p = buildDcfModelerPrompt(company, 'es');

  it('g no se justifica con el PIB y FCF/WACC/g van en la misma base nominal', () => {
    expect(p).not.toMatch(/alinead[oa] con (el )?PIB/i);
    expect(p).toContain('FCF, WACC y g se expresan en la MISMA base: COP nominales');
    expect(p).toContain('(1 + g) = (1 + g real) × (1 + inflación de largo plazo)');
    expect(p).toMatch(/If un supuesto de crecimiento .* llega en términos reales, then conviértelo a nominal/);
  });

  it('la tarifa t contempla los puntos adicionales del Art. 240 E.T. (par. 2, 3 y 4) con su vigencia', () => {
    expect(p).toMatch(/par\. 2 — .*5 puntos \(40%\) en 2023-2027.*120\.000 UVT/);
    expect(p).toMatch(/par\. 3 — .*carbón.*petróleo crudo.*50\.000 UVT/);
    expect(p).toMatch(/par\. 4 — .*hidroeléctric.*3 puntos \(38%\) en 2023-2026.*30\.000 UVT/);
    expect(p).toMatch(/Decreto Legislativo 1474\/2025.*suspendidos.*A-084-26/);
    expect(p).toMatch(/Zona Franca, ZOMAC, SIMPLE o puntos adicionales del Art\. 240 par\. 2-4 E\.T\./);
    // Sobretasa temporal: t de perpetuidad y los años con sobretasa declarados.
    expect(p).toMatch(/If la entidad está en un supuesto de puntos adicionales que vencen dentro del horizonte/);
  });
});
