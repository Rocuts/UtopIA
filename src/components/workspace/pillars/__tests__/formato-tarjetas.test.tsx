// ratios-kpis-27 (parte UI) — tarjetas ejecutivas y proyección Futuro.
//
// Las tarjetas de los cuatro pilares, FuturoTrendBars y CapexEventsModal
// tenían formateadores propios con sufijo 'B' ("$2,4B", que en español se lee
// como dos BILLONES = 10^12), punto decimal ("15.6%", "1.25") y negativos con
// "−$". P6 corrigió lib/charts/format; aquí las vistas lo usan:
//   - es: "$2,4 mil M", "15,6%", "1,25", negativos "($1,5 M)".
//   - en: "$2.4B", "15.6%", "1.25" (B = 10^9 en inglés, sin ambigüedad).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import type { ExecutiveCard, PillarStatus } from '@/lib/pillars/types';
import type { CapexEvent, FuturoBarSeries } from '@/lib/pillars/futuro-bars';

const { chart, capex, lang } = vi.hoisted(() => ({
  chart: { option: null as null | Record<string, unknown> },
  capex: { events: [] as CapexEvent[] },
  lang: { current: 'es' as 'es' | 'en' },
}));

// CountUp anima desde 0 en el navegador; en el render estático mostraría 0.
vi.mock('@/components/ui/ParallaxWrapper', () => ({
  CountUp: ({ target }: { target: string }) => <span>{target}</span>,
}));
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: { option: Record<string, unknown> }) => {
    chart.option = props.option;
    return null;
  },
}));
vi.mock('@/lib/charts/setup', () => ({ echarts: { registerTheme: () => undefined } }));
vi.mock('@/hooks/useCapexEvents', () => ({
  useCapexEvents: () => ({ events: capex.events, addEvent: vi.fn(), removeEvent: vi.fn() }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({ language: lang.current }),
}));
vi.mock('@/components/ui/GlassModal', () => ({
  GlassModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

import { ValorExecutiveCards } from '../ValorExecutiveCards';
import { VerdadExecutiveCards } from '../VerdadExecutiveCards';
import { FuturoExecutiveCards } from '../FuturoExecutiveCards';
import { EscudoExecutiveCards } from '../EscudoExecutiveCards';
import { FuturoTrendBars } from '../FuturoTrendBars';
import { CapexEventsModal } from '../CapexEventsModal';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function card(key: string, unit: ExecutiveCard['unit'], value: number | null, delta: number | null): ExecutiveCard {
  return {
    key: key as ExecutiveCard['key'],
    labelEs: key,
    labelEn: key,
    value,
    unit,
    color: 'blue',
    status: 'healthy' as PillarStatus,
    deltaVsComparative: delta,
    descriptionEs: 'd',
    descriptionEn: 'd',
    formulaEs: 'f',
    formulaEn: 'f',
  };
}

/** Sufijo B pegado a un número ("2,4B", "$3.0B") o punto decimal en es. */
const B_SUFFIX = /\d\s?B\b/;

beforeEach(() => {
  chart.option = null;
  capex.events = [];
  lang.current = 'es';
});

describe('ValorExecutiveCards', () => {
  const cards = {
    ebitda: card('ebitda', 'cop', 2_400_000_000, 1_500_000_000),
    waoo: card('waoo', 'pct', 0.156, 0.021),
    ratio: card('ratio', 'ratio', 1.254, 0.05),
    fcf: card('fcf', 'cop', -1_500_000, null),
    audit: {} as never,
    generatedAt: '2026-09-24T00:00:00Z',
  };

  it('es: mil M, coma decimal y negativos entre paréntesis', () => {
    const t = text(<ValorExecutiveCards cards={cards} language="es" />);
    expect(t).toContain('$2,4 mil M');
    expect(t).toContain('+$1,5 mil M');
    expect(t).toContain('15,6%');
    expect(t).toContain('+2,1 pp');
    expect(t).toContain('1,25');
    expect(t).toContain('+0,05');
    expect(t).toContain('($1,5 M)');
    expect(t).not.toMatch(B_SUFFIX);
    expect(t).not.toMatch(/\d\.\d%|−\$/);
  });

  it('en: escalas inglesas y punto decimal', () => {
    const t = text(<ValorExecutiveCards cards={cards} language="en" />);
    expect(t).toContain('$2.4B');
    expect(t).toContain('+$1.5B');
    expect(t).toContain('15.6%');
    expect(t).toContain('1.25');
    expect(t).toContain('($1.5M)');
  });
});

describe('Verdad / Futuro / Escudo ExecutiveCards', () => {
  it('Verdad: ecuación maestra en COP sin B', () => {
    const cards = {
      ecuacion_maestra: card('ecuacion_maestra', 'cop', -3_000_000_000, 2_000_000_000),
      consistencia: card('consistencia', 'score', 90, null),
      anomalias: card('anomalias', 'count', 2, null),
      salud_contable: card('salud_contable', 'count', 1, null),
      audit: {} as never,
      generatedAt: '2026-09-24T00:00:00Z',
    };
    const t = text(<VerdadExecutiveCards cards={cards} language="es" />);
    expect(t).toContain('($3 mil M)');
    expect(t).toContain('+$2 mil M');
    expect(t).not.toMatch(B_SUFFIX);
  });

  it('Futuro: COP y porcentaje con formato es-CO', () => {
    const cards = {
      cagr: card('cagr', 'pct', 0.123, -0.01),
      punto_quiebre: card('punto_quiebre', 'months', 12, null),
      provision_tributaria: card('provision_tributaria', 'cop', 1_200_000_000, 150_000_000),
      capacidad_inversion: card('capacidad_inversion', 'ratio', 0.5, null),
      audit: {} as never,
      generatedAt: '2026-09-24T00:00:00Z',
    };
    const t = text(<FuturoExecutiveCards cards={cards} language="es" />);
    expect(t).toContain('12,3%');
    expect(t).toContain('−1,0 pp');
    expect(t).toContain('$1,2 mil M');
    expect(t).toContain('+$150 M');
    expect(t).toContain('0,50');
    expect(t).not.toMatch(B_SUFFIX);
  });

  it('Escudo: brecha negativa entre paréntesis y cobertura con coma', () => {
    const cards = {
      autonomia: card('autonomia', 'ratio', 45, null),
      cobertura_pasivos: card('cobertura_pasivos', 'ratio', 1.5, 0.25),
      reserva_fiscal: card('reserva_fiscal', 'cop', null, null),
      brecha_escudo: card('brecha_escudo', 'cop', -2_500_000_000, -500_000_000),
      audit: {} as never,
      generatedAt: '2026-09-24T00:00:00Z',
    };
    const t = text(<EscudoExecutiveCards cards={cards} language="es" />);
    expect(t).toContain('45 días');
    expect(t).toContain('1,50');
    expect(t).toContain('+0,25');
    expect(t).toContain('($2,5 mil M)');
    expect(t).toContain('−$500 M');
    expect(t).not.toMatch(B_SUFFIX);
  });
});

describe('FuturoTrendBars — eje, tooltip y eventos', () => {
  const series: FuturoBarSeries[] = [
    { label: 'M+1', monthIndex: 1, cajaBase: 2_400_000_000, cajaConservadora: -1_500_000, cajaAgresiva: 3_000_000_000, capexAplicado: 0 },
  ];

  function option() {
    return chart.option as unknown as {
      yAxis: { axisLabel: { formatter: (v: number) => string } };
      tooltip: { formatter: (p: unknown) => string };
    };
  }

  it('es: eje y tooltip con mil M y paréntesis', () => {
    renderToStaticMarkup(<FuturoTrendBars series={series} language="es" />);
    expect(option().yAxis.axisLabel.formatter(2_400_000_000)).toBe('$2,4 mil M');
    expect(option().yAxis.axisLabel.formatter(-1_500_000)).toBe('($1,5 M)');
    const tip = option().tooltip.formatter([{ dataIndex: 0 }]);
    expect(tip).toContain('$2,4 mil M');
    expect(tip).toContain('($1,5 M)');
    expect(tip).not.toMatch(B_SUFFIX);
  });

  it('en: escalas inglesas', () => {
    renderToStaticMarkup(<FuturoTrendBars series={series} language="en" />);
    expect(option().yAxis.axisLabel.formatter(2_400_000_000)).toBe('$2.4B');
  });

  it('es: el total de eventos y los factores de escenario con coma decimal', () => {
    capex.events = [
      { id: 'a', name: 'Maquinaria', monthOffset: 2, amountCop: 1_000_000_000 },
      { id: 'b', name: 'Préstamo', monthOffset: 3, amountCop: 500_000_000 },
    ];
    const t = text(<FuturoTrendBars series={series} language="es" />);
    expect(t).toContain('Total $1,5 mil M');
    expect(t).toContain('0,85×');
    expect(t).toContain('1,10×');
    expect(t).not.toMatch(B_SUFFIX);
  });
});

describe('CapexEventsModal', () => {
  const events: CapexEvent[] = [
    { id: 'a', name: 'Maquinaria', monthOffset: 2, amountCop: 1_200_000_000 },
    { id: 'b', name: 'Préstamo', monthOffset: 3, amountCop: 450_000 },
  ];
  const props = { open: true, onOpenChange: vi.fn(), events, onAdd: vi.fn(), onRemove: vi.fn() };

  it('es: montos de la lista y total sin B', () => {
    const t = text(<CapexEventsModal {...props} />);
    expect(t).toContain('$1,2 mil M');
    expect(t).toContain('$450 mil');
    expect(t).toContain('Total $1,2 mil M');
    expect(t).not.toMatch(B_SUFFIX);
  });

  it('en: escalas inglesas', () => {
    lang.current = 'en';
    const t = text(<CapexEventsModal {...props} />);
    expect(t).toContain('$1.2B');
    expect(t).toContain('$450K');
  });
});

// ratios-kpis-29 — el 4,5 % con que se indexan los gastos fijos es un supuesto
// de escenario (describeIpcAssumption, P6), pero ninguna vista lo mostraba: la
// proyección parecía usar un dato oficial. FuturoTrendBars lo rotula.
describe('FuturoTrendBars — supuesto de indexación rotulado', () => {
  const series: FuturoBarSeries[] = [
    { label: 'M+1', monthIndex: 1, cajaBase: 1_000_000, cajaConservadora: 900_000, cajaAgresiva: 1_100_000, capexAplicado: 0 },
  ];

  it('es: muestra el 4,5 % como supuesto de escenario, no dato DANE ni meta BanRep', () => {
    const t = text(<FuturoTrendBars series={series} language="es" />);
    expect(t).toContain('Gastos fijos indexados al 4,5 % anual: supuesto de escenario');
    expect(t).toContain('no es un dato del DANE ni la meta del Banco de la República');
  });

  it('en: rótulo en inglés', () => {
    const t = text(<FuturoTrendBars series={series} language="en" />);
    expect(t).toContain('Fixed expenses indexed at 4.5% per year: scenario assumption');
  });
});
