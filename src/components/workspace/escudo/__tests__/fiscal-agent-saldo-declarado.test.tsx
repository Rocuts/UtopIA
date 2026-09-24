// Cross-dep W3-B (tributario-modulos-02) — el saldo a favor LIQUIDADO en el
// Formulario 110 se puede declarar en el panel del Agente Fiscal y viaja al
// servidor en centavos MoneyCop (`saldoAFavorDeclaradoCents`). Sin él la
// devolución (Módulo 6) queda N/D: F04 es una estimación contable, no la
// declaración. Nunca se envía 0 ni F04 por defecto.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildFiscalAgentRequestBody } from '@/hooks/useFiscalAgentSSE';
import {
  buildFiscalAgentStartInput,
  parseSaldoDeclarado,
  type FiscalAgentFormState,
} from '../fiscal-agent-form';

const state = vi.hoisted(() => ({ lang: 'es' as 'es' | 'en' }));

vi.mock('@/context/LanguageContext', async () => {
  const { dict } = await vi.importActual<typeof import('@/lib/i18n/dictionaries')>('@/lib/i18n/dictionaries');
  return { useLanguage: () => ({ language: state.lang, t: dict[state.lang], setLanguage: () => {} }) };
});
vi.mock('@/hooks/useFiscalAgentSSE', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useFiscalAgentSSE')>('@/hooks/useFiscalAgentSSE');
  return {
    ...actual,
    useFiscalAgentSSE: () => ({ state: { status: 'idle' }, start: () => {}, abort: () => {}, reset: () => {} }),
  };
});

import { FiscalAgentPanel } from '../FiscalAgentPanel';

const FORM: FiscalAgentFormState = {
  rawData: '135515,Retencion,1000',
  mode: 'full',
  companyName: '',
  companyNit: '',
  language: 'es',
  instructions: '',
  dianText: '',
  saldoDeclarado: '',
};

describe('parseSaldoDeclarado — pesos es-CO → centavos MoneyCop', () => {
  it('interpreta formatos colombianos sin pasar por Number', () => {
    expect(parseSaldoDeclarado('$ 12.345.678,90')).toEqual({ ok: true, cents: '1234567890' });
    expect(parseSaldoDeclarado('1.500.000')).toEqual({ ok: true, cents: '150000000' });
    expect(parseSaldoDeclarado('98765432109876543')).toEqual({ ok: true, cents: '9876543210987654300' });
  });
  it('vacío = no declarado (null, nunca 0); negativo o ambiguo = inválido', () => {
    expect(parseSaldoDeclarado('   ')).toEqual({ ok: true, cents: null });
    expect(parseSaldoDeclarado('-5.000')).toEqual({ ok: false });
    expect(parseSaldoDeclarado('1,234,567')).toEqual({ ok: false });
  });
});

describe('buildFiscalAgentStartInput — el saldo declarado llega al cuerpo del request', () => {
  it('modo full/devolución: reenvía saldoAFavorDeclaradoCents', () => {
    for (const mode of ['full', 'devolucion'] as const) {
      const input = buildFiscalAgentStartInput({ ...FORM, mode, saldoDeclarado: '2.000.000,50' })!;
      expect(input.saldoAFavorDeclaradoCents).toBe('200000050');
      expect(buildFiscalAgentRequestBody(input).saldoAFavorDeclaradoCents).toBe('200000050');
    }
  });
  it('sin saldo declarado no viaja nada (ni 0 ni F04)', () => {
    const body = buildFiscalAgentRequestBody(buildFiscalAgentStartInput(FORM)!);
    expect(body).not.toHaveProperty('saldoAFavorDeclaradoCents');
  });
  it('modos sin Módulo 6 no envían el saldo; un saldo inválido bloquea el envío', () => {
    const quick = buildFiscalAgentStartInput({ ...FORM, mode: 'quick', saldoDeclarado: '1.000' })!;
    expect(quick.saldoAFavorDeclaradoCents).toBeNull();
    expect(buildFiscalAgentStartInput({ ...FORM, saldoDeclarado: '-1' })).toBeNull();
    expect(buildFiscalAgentStartInput({ ...FORM, rawData: '  ' })).toBeNull();
  });
});

describe('FiscalAgentPanel — campo opcional del saldo a favor declarado', () => {
  it('se muestra en el modo por defecto (full) con rótulo i18n es/en', () => {
    state.lang = 'es';
    const es = renderToStaticMarkup(<FiscalAgentPanel />);
    expect(es).toContain('id="fiscal-saldo-declarado"');
    expect(es).toContain('Saldo a favor declarado');
    expect(es).toContain('Formulario 110');
    state.lang = 'en';
    const en = renderToStaticMarkup(<FiscalAgentPanel />);
    expect(en).toContain('Declared refund balance');
    state.lang = 'es';
  });
});
