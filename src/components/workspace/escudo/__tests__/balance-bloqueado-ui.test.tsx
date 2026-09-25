// ---------------------------------------------------------------------------
// UI del Escudo — el bloqueo del balance muestra sus razones (I4-escudo 1)
// ---------------------------------------------------------------------------
// /api/escudo-survival y /api/escudo/fiscal responden 422 (JSON) o un evento
// SSE `error` con `code: 'BALANCE_VALIDATION_FAILED'` y `reasons`. Los hooks
// mostraban sólo `error` (o el JSON crudo del 4xx) y el usuario no veía por
// qué no había cifras. Se prueban los extractores puros de los hooks y que
// ambos paneles listen las razones en es/en.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import { escudoErrorFromHttp, escudoErrorFromSse } from '../escudo-error';

const MOTIVO = '[2025] [CUR-R8] Residual no explicado por el resultado del ejercicio: $1.000.000,00.';

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
vi.mock('@/hooks/useFiscalAgentSSE', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useFiscalAgentSSE')>(
    '@/hooks/useFiscalAgentSSE',
  );
  return {
    ...actual,
    useFiscalAgentSSE: () => ({ state: state.hook, start: () => {}, abort: () => {}, reset: () => {} }),
  };
});
vi.mock('@/hooks/useEscudoSurvival', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useEscudoSurvival')>(
    '@/hooks/useEscudoSurvival',
  );
  return {
    ...actual,
    useEscudoSurvival: () => ({ state: state.hook, start: () => {}, cancel: () => {}, reset: () => {} }),
  };
});

import { FiscalAgentPanel } from '../FiscalAgentPanel';
import { SurvivalModePanel } from '../../areas/SurvivalModePanel';

function text(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

describe('extractores de error de los hooks del Escudo', () => {
  it('422 JSON: encabezado y razones, no el JSON crudo', () => {
    const body = JSON.stringify({
      error: 'El balance de prueba no se puede usar como base de las cifras fiscales.',
      code: 'BALANCE_VALIDATION_FAILED',
      reasons: [MOTIVO],
    });
    const info = escudoErrorFromHttp(422, body);
    expect(info.error).toBe('El balance de prueba no se puede usar como base de las cifras fiscales.');
    expect(info.reasons).toEqual([MOTIVO]);
    expect(info.error).not.toContain('{');
  });

  it('texto plano o vacío: se conserva el texto o el estado HTTP', () => {
    expect(escudoErrorFromHttp(502, 'Bad Gateway')).toEqual({ error: 'Bad Gateway', reasons: [] });
    expect(escudoErrorFromHttp(500, '')).toEqual({ error: 'HTTP 500', reasons: [] });
  });

  it('evento SSE error: razones cuando existen; genérico sin ellas', () => {
    const conRazones = escudoErrorFromSse(
      JSON.stringify({ error: 'Balance bloqueado', code: 'BALANCE_VALIDATION_FAILED', reasons: [MOTIVO] }),
      'fallback',
    );
    expect(conRazones).toEqual({ error: 'Balance bloqueado', reasons: [MOTIVO] });
    expect(escudoErrorFromSse(JSON.stringify({ error: 'Falló' }), 'fallback')).toEqual({
      error: 'Falló',
      reasons: [],
    });
    expect(escudoErrorFromSse('no-json', 'fallback')).toEqual({ error: 'fallback', reasons: [] });
  });
});

describe('paneles del Escudo — razones del bloqueo del balance', () => {
  const errorState = {
    status: 'error',
    error: 'El balance de prueba no se puede usar como base de las cifras fiscales.',
    reasons: [MOTIVO],
    progress: [],
  };

  it('Agente Fiscal (es/en): lista las razones con su título', () => {
    state.hook = errorState;
    state.lang = 'es';
    const es = text(<FiscalAgentPanel />);
    expect(es).toContain('Motivos por los que el balance no se puede usar');
    expect(es).toContain('Residual no explicado por el resultado del ejercicio');
    state.lang = 'en';
    const en = text(<FiscalAgentPanel />);
    expect(en).toContain('Why the trial balance cannot be used');
    expect(en).toContain('Residual no explicado');
  });

  it('Modo Supervivencia (es/en): lista las razones con su título', () => {
    state.hook = errorState;
    state.lang = 'es';
    const es = text(<SurvivalModePanel />);
    expect(es).toContain('Motivos por los que el balance no se puede usar');
    expect(es).toContain('Residual no explicado por el resultado del ejercicio');
    state.lang = 'en';
    expect(text(<SurvivalModePanel />)).toContain('Why the trial balance cannot be used');
  });

  it('error sin razones: no aparece el título de motivos', () => {
    state.hook = { status: 'error', error: 'Falló', progress: [] };
    state.lang = 'es';
    expect(text(<FiscalAgentPanel />)).not.toContain('Motivos por los que el balance');
    expect(text(<SurvivalModePanel />)).not.toContain('Motivos por los que el balance');
  });
});
