// ---------------------------------------------------------------------------
// I5-niif 7 — leyenda del runway por idioma desde RUNWAY_ESCENARIOS
// ---------------------------------------------------------------------------
// La leyenda ('Base / Conservador / Agresivo') la escribía el componente a
// mano; ahora los nombres de las series salen de RUNWAY_ESCENARIOS /
// RUNWAY_SERIE_BASE (src/lib/kpis/runway.ts) en es/en, como el subtítulo.
// El idioma lo decide el llamador con `language` (patrón de los gráficos).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { chart } = vi.hoisted(() => ({ chart: { options: [] as Array<Record<string, unknown>> } }));

vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    chart.options.push(props.option);
    return null;
  },
}));
vi.mock('@/lib/charts/setup', () => ({ echarts: { registerTheme: () => undefined } }));

import { RUNWAY_ESCENARIOS, RUNWAY_SERIE_BASE } from '@/lib/kpis/runway';
import { RunwayProjection, runwayProjectionTexts } from '../RunwayProjection';

const MESES = [
  { month: 'M+1', base: 100, conservador: 90, agresivo: 110 },
  { month: 'M+2', base: 80, conservador: 60, agresivo: 100 },
];

type Opt = { legend: { data: string[] }; series: Array<{ name: string }> };
const ultima = () => chart.options[chart.options.length - 1] as unknown as Opt;

beforeEach(() => {
  chart.options = [];
});

describe('RunwayProjection — leyenda desde RUNWAY_ESCENARIOS', () => {
  it('los nombres de las series son los de RUNWAY_ESCENARIOS en cada idioma', () => {
    expect(runwayProjectionTexts('es').series).toEqual({
      base: RUNWAY_SERIE_BASE.nombre,
      conservador: RUNWAY_ESCENARIOS.conservador.nombre,
      agresivo: RUNWAY_ESCENARIOS.agresivo.nombre,
    });
    expect(runwayProjectionTexts('en').series).toEqual({
      base: RUNWAY_SERIE_BASE.nombreEn,
      conservador: RUNWAY_ESCENARIOS.conservador.nombreEn,
      agresivo: RUNWAY_ESCENARIOS.agresivo.nombreEn,
    });
    expect(RUNWAY_ESCENARIOS.conservador.nombreEn).toBe('Conservative');
    expect(RUNWAY_ESCENARIOS.agresivo.nombreEn).toBe('Aggressive');
  });

  it('el subtítulo por defecto no cambia de contenido y sale del mismo catálogo', () => {
    expect(runwayProjectionTexts('es').subtitle).toBe(
      `Base: tendencia del periodo · Conservador: ${RUNWAY_ESCENARIOS.conservador.rotulo} · ` +
        `Agresivo: ${RUNWAY_ESCENARIOS.agresivo.rotulo}`,
    );
    expect(runwayProjectionTexts('en').subtitle).toBe(
      `Base: period trend · Conservative: ${RUNWAY_ESCENARIOS.conservador.rotuloEn} · ` +
        `Aggressive: ${RUNWAY_ESCENARIOS.agresivo.rotuloEn}`,
    );
  });

  it('con language="en" la leyenda y las series del gráfico salen en inglés', () => {
    const html = renderToStaticMarkup(<RunwayProjection months={MESES} language="en" />);
    expect(ultima().legend.data).toEqual(['Base', 'Conservative', 'Aggressive']);
    expect(ultima().series.map((s) => s.name).sort()).toEqual(['Aggressive', 'Base', 'Conservative']);
    expect(html).not.toMatch(/Conservador|Agresivo|Supuesto de sensibilidad/);
  });

  it('sin language el gráfico queda en español: el idioma lo pasa el llamador', () => {
    renderToStaticMarkup(<RunwayProjection months={MESES} />);
    expect(ultima().legend.data).toEqual(['Base', 'Conservador', 'Agresivo']);
  });
});
