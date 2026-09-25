// ---------------------------------------------------------------------------
// valoracion-24 (resto) — rótulos del gráfico de runway
// ---------------------------------------------------------------------------
// P5 extrajo el runway a src/lib/kpis/runway.ts con RUNWAY_ESCENARIOS, cuyos
// rótulos aclaran que conservador y agresivo son SUPUESTOS DE SENSIBILIDAD
// sobre los ingresos (no pronósticos). El subtítulo por defecto de
// RunwayProjection seguía escribiendo a mano «conservador (−15%) y agresivo
// (+10%)», sin esa aclaración y sólo en español. Ahora el texto sale de
// RUNWAY_ESCENARIOS, en es/en.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RUNWAY_ESCENARIOS } from '@/lib/kpis/runway';
import { runwayProjectionTexts } from '../RunwayProjection';

describe('RunwayProjection — rótulos de los escenarios', () => {
  it('el subtítulo por defecto usa los rótulos de RUNWAY_ESCENARIOS (es)', () => {
    const t = runwayProjectionTexts('es');
    expect(t.subtitle).toContain(RUNWAY_ESCENARIOS.conservador.rotulo);
    expect(t.subtitle).toContain(RUNWAY_ESCENARIOS.agresivo.rotulo);
    expect(t.subtitle).toMatch(/no es un pronóstico/);
  });

  it('en inglés usa los rótulos en inglés y no mezcla español', () => {
    const t = runwayProjectionTexts('en');
    expect(t.subtitle).toContain(RUNWAY_ESCENARIOS.conservador.rotuloEn);
    expect(t.subtitle).toContain(RUNWAY_ESCENARIOS.agresivo.rotuloEn);
    expect(t.subtitle).not.toMatch(/Supuesto|conservador|agresivo/);
    expect(t.series).toEqual({ base: 'Base', conservador: 'Conservative', agresivo: 'Aggressive' });
    expect(t.title).toMatch(/Cash runway/);
  });

  it('el componente no vuelve a escribir los porcentajes a mano', () => {
    const src = readFileSync(resolve(__dirname, '../RunwayProjection.tsx'), 'utf8');
    expect(src).not.toMatch(/conservador \(−15%\) y agresivo \(\+10%\)/);
    expect(src).toMatch(/RUNWAY_ESCENARIOS/);
  });
});
