// valoracion-23 — La página de Escenarios anunciaba "Simulaciones tipo Monte
// Carlo" sobre un cálculo determinista, mostraba "P=XX%" construido con
// probabilidades base arbitrarias (20/50/30 %) y penalizaciones ad hoc por
// inflación y TRM, rotulaba "Caja final 5Y" a Σ(EBITDA − capex 8 %) y citaba
// un "consenso BanRep" sin fuente, con TRM por defecto 4.120.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const langRef = vi.hoisted(() => ({ value: 'es' as 'es' | 'en' }));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>(
    '@/lib/i18n/dictionaries',
  );
  return {
    useLanguage: () => ({ language: langRef.value, t: dict[langRef.value], setLanguage: () => {} }),
  };
});
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    setActiveCaseType: () => {},
    setActiveMode: () => {},
    startNewConsultation: () => {},
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

import EscenariosPage from '../futuro/escenarios/page';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Escenarios: deterministas e ilustrativos', () => {
  it('es: sin Monte Carlo, sin probabilidad inventada, caja renombrada y rótulo ilustrativo', () => {
    langRef.value = 'es';
    const t = text(renderToStaticMarkup(<EscenariosPage />));
    for (const lit of ['Monte Carlo', 'P=', 'Caja final', 'consenso BanRep', '4.120', 'Probabilidad de éxito']) {
      expect(t).not.toContain(lit);
    }
    expect(t).toContain('Escenarios deterministas ilustrativos');
    expect(t).toContain('EBITDA − capex acumulado (5 años)');
    expect(t).toContain('no son datos de su empresa');
  });

  it('en: mismos rótulos en inglés', () => {
    langRef.value = 'en';
    const t = text(renderToStaticMarkup(<EscenariosPage />));
    expect(t).not.toContain('Monte Carlo');
    expect(t).not.toContain('P=');
    expect(t).toContain('Illustrative deterministic scenarios');
    expect(t).toContain('EBITDA − capex, cumulative (5 years)');
  });
});
