// tributario-modulos-05 — el Score DIAN sin base gravable (F01 = $0) llega con
// `publicable: false`. El gauge y la fila KPI de El Escudo pintaban igual
// "0/100 · Riesgo Bajo": una afirmación de bajo riesgo que el balance no
// soporta. Ahora dicen «No determinable» con el motivo.
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

import { EscudoArea } from '../EscudoArea';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function withScore(riskScore: FiscalRiskScore) {
  const snap = makeFiscalSnapshot();
  const anchor = {
    ...(snap.anchor as unknown as FiscalAnchorBlock),
    f01: '0',
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
    riskScore,
    alertas: [],
  };
}

const MOTIVO = 'Sin base gravable en el periodo (F01 = $0): el score no mide nada.';

const noPublicable = {
  score: 0,
  nivel: 'bajo',
  factores: [{ factor: 'x', descripcion: 'Factor de prueba', puntos: 0 }],
  publicable: false,
  noPublicableMotivo: MOTIVO,
} as unknown as FiscalRiskScore;

beforeEach(() => {
  state.lang = 'es';
});

describe('EscudoArea — Score DIAN no publicable', () => {
  it('es: «No determinable» con motivo; sin 0/100 ni «Riesgo Bajo»', () => {
    withScore(noPublicable);
    const t = text(<EscudoArea />);
    expect(t).toContain('No determinable');
    expect(t).toContain(MOTIVO);
    expect(t).not.toMatch(/Riesgo Bajo/);
    expect(t).not.toMatch(/\b0\s*\/100/);
    expect(t).not.toMatch(/Riesgo DIAN\s+BAJO/);
  });

  it('en: «Not determinable»', () => {
    state.lang = 'en';
    withScore(noPublicable);
    const t = text(<EscudoArea />);
    expect(t).toContain('Not determinable');
    expect(t).not.toMatch(/Low risk/);
    expect(t).not.toMatch(/\b0\s*\/100/);
  });

  it('score publicable: sigue mostrando la cifra y el nivel', () => {
    withScore({ score: 68, nivel: 'muy_alto', factores: [] } as FiscalRiskScore);
    const t = text(<EscudoArea />);
    expect(t).toMatch(/68\s*\/100/);
    expect(t).toContain('Riesgo Alto');
    expect(t).not.toContain('No determinable');
  });
});
