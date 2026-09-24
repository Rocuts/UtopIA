// ratios-kpis-01 / ratios-kpis-02 / valoracion-01 — Las áreas Valor, Verdad,
// Futuro y Escudo pintaban cifras fijas del mockup (valor de salida $4.820M,
// EBITDA $1.180M, WACC 13,2 %, múltiplo 5,4×, "Grado A", opinión "Limpia",
// runway 28 meses, ROI 22 %, TEF 28,4 %, saldos a favor $1.240M, riesgo
// "Medio"…) aunque existiera un informe real y sin rótulo de demostración.
// Además el héroe de Valor rotulaba "VALOR DE SALIDA · DCF" un promedio de
// EV/EBIT × 6 y el patrimonio contable, y el de Escudo rotulaba F10 (cobertura
// de retenciones) como "Tasa Efectiva de Tributación".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import { deriveAncoraView } from '@/lib/ancora/derive-ancora-view';
import type { AncoraView } from '@/lib/ancora/ancora-view';
import { makeAncora, makeFiscalSnapshot } from '@/lib/ancora/__tests__/ancora.fixture';
import type { FiscalAnchorBlock } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';
import type { FiscalRiskScore } from '@/lib/agents/financial/types';

const state = vi.hoisted(() => ({
  lang: 'es' as 'es' | 'en',
  bundle: null as null | {
    view: AncoraView;
    loading: boolean;
    fiscalAnchor: FiscalAnchorBlock | undefined;
    riskScore: FiscalRiskScore | undefined;
    alertas: never[];
  },
}));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>(
    '@/lib/i18n/dictionaries',
  );
  return {
    useLanguage: () => ({ language: state.lang, t: dict[state.lang], setLanguage: () => {} }),
  };
});
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    setActiveCaseType: () => {},
    setActiveMode: () => {},
    openIntakeForType: () => {},
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/useAncoraView', () => ({ useAncoraView: () => state.bundle }));

import { ValorArea } from '../ValorArea';
import { VerdadArea } from '../VerdadArea';
import { FuturoArea } from '../FuturoArea';
import { EscudoArea } from '../EscudoArea';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function withData() {
  const snap = makeFiscalSnapshot();
  const anchor = {
    ...(snap.anchor as unknown as FiscalAnchorBlock),
    calendarioDian: {
      nit: '9017140146',
      ultimoDigito: 6,
      periodo: '2025',
      vencimientos: [],
      alertaAnticipacionDias: 15,
    },
    alertas: [],
    fuente: { periodo: '2025', balanceHash: 'x' },
  } as FiscalAnchorBlock;
  state.bundle = {
    view: deriveAncoraView(makeAncora(), snap),
    loading: false,
    fiscalAnchor: anchor,
    riskScore: snap.riskScore,
    alertas: [],
  };
}

function withoutData() {
  state.bundle = {
    view: deriveAncoraView(null, null),
    loading: false,
    fiscalAnchor: undefined,
    riskScore: undefined,
    alertas: [],
  };
}

beforeEach(() => {
  state.lang = 'es';
});

const MOCKUP_STATUS = ['Modelo al día', '52% completado', '2 en curso', '1 radicada', '4 vigentes', 'Conciliado'];

describe('ValorArea', () => {
  const MOCK = ['$4.820M', '$1.180M', '13,2%', '5,4×', '12%', '+$640M', '−$210M', 'VALOR DE SALIDA · DCF'];

  it('con datos reales: sin literales del mockup, valor de salida N/D y métodos por separado', () => {
    withData();
    const t = text(<ValorArea />);
    for (const m of [...MOCK, ...MOCKUP_STATUS]) expect(t).not.toContain(m);
    expect(t).toContain('Valor de salida (patrimonio)');
    expect(t).toMatch(/Valor de salida \(patrimonio\)\s+N\/D/);
    expect(t).toContain('EBIT operacional');
    // Formato es-CO de @/lib/charts/format (formatBigCop), no el «$100.00M COP»
    // con punto decimal del formatCop deprecado de exit-value (I4-escudo 6).
    expect(t).toContain('$100 M'); // A09
    expect(t).toContain('EV/EBIT 6× (heurístico)');
    expect(t).toContain('$600 M'); // EV de referencia
    expect(t).not.toMatch(/\d\.\d{2}M COP/);
  });

  it('con datos en inglés: formato compacto en/US del mismo helper', () => {
    withData();
    state.lang = 'en';
    const t = text(<ValorArea />);
    expect(t).toContain('$100M'); // A09
    expect(t).toContain('$600M'); // EV de referencia
    expect(t).not.toContain('COP');
  });

  it('sin datos: N/D y aviso, nunca cifras del mockup', () => {
    withoutData();
    const t = text(<ValorArea />);
    for (const m of [...MOCK, ...MOCKUP_STATUS]) expect(t).not.toContain(m);
    expect(t).toContain('N/D');
    expect(t).toContain('Sin datos de su empresa');
  });
});

describe('VerdadArea', () => {
  const MOCK = ['Grado A', '+6 pts', 'Limpia', '98/100', '94/100', '79/100', 'SAGRLAFT', 'Hallazgos menores'];

  it('con datos: muestra el score NIIF real rotulado como tal, sin opinión ni dictámenes fijos', () => {
    withData();
    const t = text(<VerdadArea />);
    for (const m of [...MOCK, ...MOCKUP_STATUS]) expect(t).not.toContain(m);
    expect(t).toContain('Score de calidad NIIF');
    expect(t).toMatch(/100\s*\/100/);
  });

  it('sin datos: N/D (no 94 del mockup)', () => {
    withoutData();
    const t = text(<VerdadArea />);
    for (const m of [...MOCK, ...MOCKUP_STATUS]) expect(t).not.toContain(m);
    expect(t).not.toMatch(/\b94\s*\/100/);
    expect(t).toContain('N/D');
  });
});

describe('FuturoArea', () => {
  const MOCK = ['34m', '19m', '22%', '10.000 corridas', 'P50 · 22%', '−8% ROI', '+48% ROI', 'Al día', 'En análisis'];

  it('sin runway ni Monte Carlo reales: estado vacío', () => {
    withData();
    const t = text(<FuturoArea />);
    for (const m of MOCK) expect(t).not.toContain(m);
    expect(t).not.toMatch(/\b28\s+meses/);
    expect(t).toContain('N/D');
    expect(t).toContain('Centro de Mando');
  });
});

describe('EscudoArea', () => {
  const MOCK = ['28,4%', '$1.240M', '3,1 pts', 'vs. trimestre anterior', 'Tasa Efectiva de Tributación'];

  it('con datos: tasa efectiva = F09 (gasto 54 / UAI), no F10; sin saldos ni riesgo fijos', () => {
    withData();
    const t = text(<EscudoArea />);
    for (const m of [...MOCK, ...MOCKUP_STATUS]) expect(t).not.toContain(m);
    expect(t).toContain('Tasa efectiva contable (gasto 54 / UAI)');
    expect(t).toContain('5,9%'); // F09 del fixture
    expect(t).not.toContain('28,6%'); // F10 (cobertura de retenciones)
    expect(t).not.toMatch(/Riesgo DIAN\s+Medio/);
  });

  it('sin datos: N/D en lugar de 28,4 %', () => {
    withoutData();
    const t = text(<EscudoArea />);
    for (const m of MOCK) expect(t).not.toContain(m);
    expect(t).toContain('N/D');
  });
});
