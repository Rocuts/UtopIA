// tributario-calc-01 (integración W3-B, auditoría 2026-09) — la tarjeta de
// reserva ya distinguía la reserva legal obligatoria (S.A. Art. 452 C.Co.;
// Ltda. Art. 371 C.Co.) de la de la S.A.S. (sólo por estatutos, Supersociedades
// 220-069664/2017), pero el panel nunca le pasaba el tipo societario: toda
// brecha salía como «sin tipo societario». Ahora el panel lo recibe (props o
// formulario) y lo reenvía a la tarjeta y al análisis.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import type { EscudoSurvivalReport } from '@/lib/agents/financial/escudo-survival/types';

const state = vi.hoisted(() => ({
  lang: 'es' as 'es' | 'en',
  hook: { status: 'idle' } as unknown,
}));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>(
    '@/lib/i18n/dictionaries',
  );
  return {
    useLanguage: () => ({ language: state.lang, t: dict[state.lang], setLanguage: () => {} }),
  };
});
vi.mock('@/hooks/useEscudoSurvival', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useEscudoSurvival')>(
    '@/hooks/useEscudoSurvival',
  );
  return {
    ...actual,
    useEscudoSurvival: () => ({
      state: state.hook,
      start: () => {},
      cancel: () => {},
      reset: () => {},
    }),
  };
});

import { SurvivalModePanel } from '../SurvivalModePanel';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

const REPORT: EscudoSurvivalReport = {
  tet: {
    markdown: 'tet',
    warnings: [],
    data: { tet: 0.3, ttd: null, nivelAlerta: 'amarillo', impuestoProyectado: 30_000_000, uai: 100_000_000, sugerenciasOptimizacion: [] },
  },
  retentionShield: {
    markdown: 'ret',
    warnings: [],
    data: { retencionesAcumuladas: 20_000_000, impuestoProyectado: 35_000_000, saldoAFavorProyectado: null, acciones: [] },
  },
  antiDian: {
    markdown: 'anti',
    warnings: [],
    data: { pagosEfectivoTotal: null, pagosNoDeduciblesIndividuales: [], excesoNoDeducibleGeneral: null, crucesExogenaSospechosos: [], mayorImpuestoEstimado: null },
  },
  contingencyReserve: {
    markdown: 'reserva',
    warnings: [],
    data: {
      utilidadNeta: 100_000_000,
      reservaSugerida: 10_000_000,
      pctUtilidad: 0.1,
      cuentaSugerida: '11 - Caja y Bancos',
      reservaLegalActual: 5_000_000,
      gapReservaLegal: 20_000_000,
    },
  },
  dividendOptimizer: {
    markdown: 'div',
    warnings: [],
    data: {
      utilidadDistribuible: 90_000_000,
      escenarios: {
        distribuirTotal: { ahorroSocio: 0, impuestoSocio: 1, netoSocio: 1, fortPatrimonio: null },
        capitalizarTotal: { ahorroSocio: 0, impuestoSocio: 1, netoSocio: 0, fortPatrimonio: 1 },
        hibrido50_50: { ahorroSocio: 0, impuestoSocio: 1, netoSocio: 1, fortPatrimonio: 1 },
      },
      recomendacion: 'Distribuir.',
      norma: 'Art. 242 E.T.',
    },
  },
  synthesis: {
    markdown: 'Dictamen... requiere validación de revisor fiscal.',
    topRecommendations: [{ orden: 1, titulo: 'x', impacto: 1, norma: 'Art. 240 E.T.' }],
  },
  metadata: { uvt: 52_374, period: '2025', generatedAt: '2026-09-24T00:00:00Z', partial: false, durationMs: 1 },
} as unknown as EscudoSurvivalReport;

describe('SurvivalModePanel — tipo societario hacia la tarjeta de reserva', () => {
  beforeEach(() => {
    state.lang = 'es';
    state.hook = { status: 'done', report: REPORT, progress: [] };
  });

  it('S.A.S. sin estatutos: la brecha no se presenta como reserva obligatoria', () => {
    const t = text(<SurvivalModePanel entityType="SAS" />);
    expect(t).toMatch(/En la SAS la reserva legal no es obligatoria/);
    expect(t).not.toMatch(/Brecha reserva legal obligatoria/);
  });

  it('S.A.: brecha frente a la reserva obligatoria (Art. 452 C.Co.)', () => {
    const t = text(<SurvivalModePanel entityType="S.A." />);
    expect(t).toMatch(/Brecha reserva legal obligatoria \(Art\. 452 C\.Co\.\)/);
  });

  it('S.A.S. con estatutos que la prevén: brecha estatutaria', () => {
    const t = text(<SurvivalModePanel entityType="SAS" bylawsRequireLegalReserve />);
    expect(t).toMatch(/Brecha reserva legal estatutaria/);
  });

  it('sin tipo societario no se evalúa cumplimiento', () => {
    const t = text(<SurvivalModePanel />);
    expect(t).toMatch(/Sin el tipo societario no se evalúa su cumplimiento/);
  });

  it('el formulario ofrece declarar el tipo societario', () => {
    state.hook = { status: 'idle' };
    const html = renderToStaticMarkup(<SurvivalModePanel />);
    expect(html).toMatch(/id="survival-entity-type"/);
    expect(text(<SurvivalModePanel />)).toMatch(/Tipo societario/);
  });
});
