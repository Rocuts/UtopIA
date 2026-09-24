// I3-4 — remanentes de UI de los pilares (fase 2, auditoría 2026-09-24).
//
//   (a) valoracion-24: el subtítulo del runway decía «conservador (−15%) y
//       agresivo (+10%)» a mano; ahora sale de RUNWAY_ESCENARIOS (los mismos
//       factores con que buildRunway calcula las series).
//   (b) ratios-kpis-27: ValorTrendBars y EscudoTrendBars llamaban formatBigCop
//       sin idioma (el eje en inglés salía "$2,4 mil M") y la solvencia con
//       toFixed(2) ("1.25" en español, que se lee como mil doscientos).
//   (c) CapexEventsModal: campos con text-n-100 sobre bg-n-900/60 (polaridad
//       invertida; placeholder fantasma) y tintas gold-300/gold-400/red-400
//       ilegibles en el vidrio del modal.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import type { CapexEvent } from '@/lib/pillars/futuro-bars';

const { chart, lang } = vi.hoisted(() => ({
  chart: { options: [] as Array<Record<string, unknown>> },
  lang: { current: 'es' as 'es' | 'en' },
}));

vi.mock('@/components/ui/ParallaxWrapper', () => ({
  CountUp: ({ target }: { target: string }) => <span>{target}</span>,
}));
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    chart.options.push(props.option);
    return null;
  },
}));
vi.mock('@/lib/charts/setup', () => ({ echarts: { registerTheme: () => undefined } }));
vi.mock('@/hooks/useCapexEvents', () => ({
  useCapexEvents: () => ({ events: [], addEvent: vi.fn(), removeEvent: vi.fn() }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: lang.current }),
}));
vi.mock('@/components/ui/GlassModal', () => ({
  GlassModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { RUNWAY_ESCENARIOS } from '@/lib/kpis/runway';
import { FuturoMicroDashboard, runwayScenarioSubtitle } from '../FuturoMicroDashboard';
import { ValorTrendBars } from '../ValorTrendBars';
import { EscudoTrendBars, formatEscudoAxis, formatEscudoValue } from '../EscudoTrendBars';
import { CapexEventsModal } from '../CapexEventsModal';
import { MOCK_ESCUDO_TREND, MOCK_PILLARS, MOCK_RUNWAY, MOCK_VALOR_TREND } from '../mock-data';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

type Opt = {
  yAxis: { axisLabel: { formatter: (v: number) => string } };
  tooltip: { formatter: (p: unknown) => string };
  series: Array<{ label: { formatter: (p: { dataIndex: number }) => string } }>;
};
const lastOption = () => chart.options[chart.options.length - 1] as unknown as Opt;

beforeEach(() => {
  chart.options = [];
  lang.current = 'es';
});

describe('(a) subtítulo del runway desde RUNWAY_ESCENARIOS (valoracion-24)', () => {
  it('es: cita los rótulos de los escenarios, no un porcentaje escrito a mano', () => {
    const s = runwayScenarioSubtitle('es');
    expect(s).toContain(RUNWAY_ESCENARIOS.conservador.rotulo);
    expect(s).toContain(RUNWAY_ESCENARIOS.agresivo.rotulo);
  });

  it('en: los porcentajes salen de los mismos factores', () => {
    const s = runwayScenarioSubtitle('en');
    const pct = (f: number) => Math.round(Math.abs(f - 1) * 100);
    expect(s).toContain(`revenue −${pct(RUNWAY_ESCENARIOS.conservador.factorIngresos)}%`);
    expect(s).toContain(`revenue +${pct(RUNWAY_ESCENARIOS.agresivo.factorIngresos)}%`);
    expect(s).toContain('not a forecast');
  });

  it('el dashboard Futuro muestra ese subtítulo (es/en)', () => {
    const es = text(<FuturoMicroDashboard metrics={MOCK_PILLARS.futuro} runway={MOCK_RUNWAY} />);
    expect(es).toContain(RUNWAY_ESCENARIOS.conservador.rotulo);
    expect(es).not.toContain('conservador (−15%) y agresivo (+10%)');
    lang.current = 'en';
    const en = text(<FuturoMicroDashboard metrics={MOCK_PILLARS.futuro} runway={MOCK_RUNWAY} />);
    expect(en).toContain('Cash Runway');
    expect(en).toContain('expenses unchanged (not a forecast)');
  });
});

describe('(b) formato por idioma en ValorTrendBars y EscudoTrendBars (ratios-kpis-27)', () => {
  it('ValorTrendBars: eje y etiquetas con la escala del idioma; N/D ↔ N/A', () => {
    renderToStaticMarkup(<ValorTrendBars series={MOCK_VALOR_TREND} language="en" />);
    expect(lastOption().yAxis.axisLabel.formatter(2_400_000_000)).toBe('$2.4B');
    expect(lastOption().series[0].label.formatter({ dataIndex: 0 })).toBe('$1.8B');
    renderToStaticMarkup(<ValorTrendBars series={MOCK_VALOR_TREND} language="es" />);
    expect(lastOption().yAxis.axisLabel.formatter(2_400_000_000)).toBe('$2,4 mil M');
    expect(lastOption().series[0].label.formatter({ dataIndex: 0 })).toBe('$1,8 mil M');
  });

  it('ValorTrendBars: una métrica no calculable dice N/A en inglés', () => {
    // El toggle arranca en EBITDA; se verifica el rótulo nulo con una serie sin EBITDA.
    const serie = [{ ...MOCK_VALOR_TREND[0], ebitda: null }];
    renderToStaticMarkup(<ValorTrendBars series={serie} language="en" />);
    expect(lastOption().series[0].label.formatter({ dataIndex: 0 })).toBe('N/A');
    renderToStaticMarkup(<ValorTrendBars series={serie} language="es" />);
    expect(lastOption().series[0].label.formatter({ dataIndex: 0 })).toBe('N/D');
  });

  it('EscudoTrendBars: eje de montos con la escala del idioma', () => {
    renderToStaticMarkup(<EscudoTrendBars series={MOCK_ESCUDO_TREND} language="en" />);
    expect(lastOption().yAxis.axisLabel.formatter(1_300_000_000)).toBe('$1.3B');
    renderToStaticMarkup(<EscudoTrendBars series={MOCK_ESCUDO_TREND} language="es" />);
    expect(lastOption().yAxis.axisLabel.formatter(1_300_000_000)).toBe('$1,3 mil M');
  });

  it('solvencia: razón con formatDecimal del idioma, no toFixed(2)', () => {
    expect(formatEscudoValue(1.254, 'solvencia', 'es')).toBe('1,25');
    expect(formatEscudoValue(1.254, 'solvencia', 'en')).toBe('1.25');
    expect(formatEscudoAxis(1.5, 'solvencia', 'es')).toBe('1,50');
    expect(formatEscudoAxis(1_300_000_000, 'efectivo', 'en')).toBe('$1.3B');
    expect(formatEscudoValue(1_300_000, 'efectivo', 'es')).toBe('$1.300.000');
  });
});

describe('(c) CapexEventsModal: tintas por rol (polaridad, CLAUDE.md)', () => {
  const events: CapexEvent[] = [{ id: 'a', name: 'Maquinaria', monthOffset: 2, amountCop: 1_200_000_000 }];
  const html = () =>
    renderToStaticMarkup(
      <CapexEventsModal open onOpenChange={vi.fn()} events={events} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );

  it('los campos usan tinta primaria sobre superficie de nivel n-0; placeholder no más tenue que n-400', () => {
    const inputs = html().match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input).toContain('text-n-1000');
      expect(input).toContain('bg-n-0/60');
      expect(input).not.toMatch(/bg-n-900|text-n-100\b/);
      const ph = /placeholder:text-n-(\d+)/.exec(input);
      expect(Number(ph?.[1])).toBeGreaterThanOrEqual(400);
    }
  });

  it('ninguna tinta legible usa peldaños de superficie ni acentos que se pierden en el vidrio', () => {
    const out = html();
    // n-100..n-400 como tinta (sin prefijo placeholder:) y los acentos claros.
    expect(out).not.toMatch(/(?<!placeholder:)(?<![a-z-])text-n-(?:100|200|300|400)\b/);
    expect(out).not.toMatch(/text-gold-(?:200|300|400)\b|text-red-400/);
    // Las filas de eventos: superficie n-100, no la n-900 invertida.
    expect(out).toContain('bg-n-100/60');
    expect(out).not.toContain('bg-n-900/40');
  });
});
