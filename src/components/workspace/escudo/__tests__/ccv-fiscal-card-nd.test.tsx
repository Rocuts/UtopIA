// Tarjeta del Módulo 1 (CCV): una eficiencia fiscal null es N/D (es) / N/A
// (en) con su motivo, en un distintivo neutro. Sin rama propia, null caía en
// el else del distintivo y se pintaba como "Baja" en rojo.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { dict } from '@/lib/i18n/dictionaries';
import type { CcvModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';
import { CcvFiscalCard } from '../cards/CcvFiscalCard';

function result(eficienciaFiscal: CcvModuleResult['data']['eficienciaFiscal']): CcvModuleResult {
  return {
    markdown: '',
    warnings: [],
    data: {
      f01: '-500000', f02: '0', f03: '0', f04: '0', f05: '0', f06: '0', f07: '0', f08: '0',
      f09Pct: 0,
      f10Pct: 0,
      alertaTasaMinima: { aplica: null, f09Actual: 0, brechaPp: null, impuestoAdicionalEstimado: null, norma: 'Art. 240 par. 6 E.T.' },
      eficienciaFiscal,
    },
  };
}

function render(language: 'es' | 'en', eficiencia: CcvModuleResult['data']['eficienciaFiscal']): string {
  const t = dict[language].elite.areas.escudo.fiscalAgent.cards.ccv;
  return renderToStaticMarkup(<CcvFiscalCard data={result(eficiencia)} t={t} language={language} />);
}

/** El distintivo de eficiencia: el último <span> redondeado de la tarjeta. */
function badge(html: string): string {
  const spans = html.match(/<span class="inline-flex items-center gap-1\.5[^"]*rounded-full[^"]*">[\s\S]*?<\/span>/g) ?? [];
  expect(spans.length).toBeGreaterThan(0);
  return spans[spans.length - 1];
}

describe('CcvFiscalCard — eficiencia fiscal N/D', () => {
  it('es: null se muestra N/D, neutro y con su motivo', () => {
    const html = render('es', null);
    const b = badge(html);
    expect(b).toContain('N/D');
    expect(b).not.toMatch(/Baja|Media|Alta/);
    expect(b).not.toContain('text-danger');
    expect(b).not.toContain('text-warning');
    expect(b).toContain('text-n-800');
    expect(html).toContain('No determinable: el impuesto de referencia (F02) no es positivo');
  });

  it('en: null se muestra N/A, no la etiqueta en español ni una clase', () => {
    const html = render('en', null);
    const b = badge(html);
    expect(b).toContain('N/A');
    expect(b).not.toContain('N/D');
    expect(b).not.toMatch(/Low|Medium|High/);
    expect(html).toContain('Not determinable: the reference tax (F02) is not positive');
  });

  it.each([
    ['alta', 'Alta', 'text-success'],
    ['media', 'Media', 'text-warning'],
    ['baja', 'Baja', 'text-danger'],
  ] as const)('una clase determinada (%s) se sigue mostrando igual y sin motivo N/D', (clase, etiqueta, color) => {
    const html = render('es', clase);
    const b = badge(html);
    expect(b).toContain(etiqueta);
    expect(b).toContain(color);
    expect(html).not.toContain('No determinable');
  });
});
