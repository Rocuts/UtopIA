// ---------------------------------------------------------------------------
// Prompt del Director de Estrategia — EBITDA vinculante (cross-dep W3-A)
// ---------------------------------------------------------------------------
// ratios-kpis-05 / ratios-kpis-24 (W3-A): TOTALES VINCULANTES publica la línea
// EBITDA con la definición única del preprocesador (computeEbitda). El prompt
// seguía diciendo "El EBITDA no es cifra vinculante (el bloque no lo
// publica)" y ordenaba derivarlo, lo que invitaba a una segunda definición.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { buildStrategyDirectorPrompt } from '../strategy-director.prompt';

const company = { name: 'Demo SAS', nit: '900123456-8', fiscalPeriod: '2025' } as never;

describe('buildStrategyDirectorPrompt — EBITDA de TOTALES VINCULANTES', () => {
  const prompt = buildStrategyDirectorPrompt(company, 'es');

  it('no dice que el EBITDA no es vinculante ni ordena derivarlo', () => {
    expect(prompt).not.toMatch(/EBITDA no es cifra vinculante/);
    expect(prompt).not.toMatch(/el bloque no lo publica/);
  });

  it('ordena copiar la línea EBITDA del bloque y declarar N/D con su motivo', () => {
    expect(prompt).toMatch(/El EBITDA es la línea EBITDA de TOTALES VINCULANTES/);
    expect(prompt).toMatch(/si el bloque lo publica N\/D, se declara N\/D con su motivo/);
  });

  it('declara que las tendencias las recalcula el sistema', () => {
    expect(prompt).toMatch(/variaciones interanuales \(trends\) las recalcula el sistema/);
  });
});
