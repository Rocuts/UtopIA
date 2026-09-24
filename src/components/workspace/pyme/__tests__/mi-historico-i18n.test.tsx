// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (ICU-08): MiHistoricoView pintaba «Cargando…» y «Sin
// datos» en text-n-400 (nivel de superficie, < 2:1 en modo claro; CLAUDE.md,
// polaridad de tokens) y sólo en español.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { dict } from '@/lib/i18n/dictionaries';
import { MonthRow, type MonthData } from '../MiHistoricoView';

const base: MonthData = { label: 'sep 26', ingresos: 0, egresos: 0, margen: 0, loading: false, error: false };

describe('MiHistoricoView — estado del mes legible y traducido (ICU-08)', () => {
  it.each(['es', 'en'] as const)('%s: «cargando» y «sin datos» del diccionario, en text-n-600', (lang) => {
    const labels = dict[lang].pyme.historico;
    const cargando = renderToStaticMarkup(<MonthRow data={{ ...base, loading: true }} labels={labels} />);
    const sinDatos = renderToStaticMarkup(<MonthRow data={{ ...base, error: true }} labels={labels} />);
    expect(cargando).toContain(labels.cargando);
    expect(sinDatos).toContain(labels.sinDatos);
    for (const html of [cargando, sinDatos]) {
      expect(html).not.toMatch(/text-n-[1-4]00\b/);
      expect(html).toMatch(/text-n-600/);
    }
  });

  it('el diccionario en inglés no repite los textos en español', () => {
    const es = dict.es.pyme.historico;
    const en = dict.en.pyme.historico;
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(en.cargando).toBe('Loading…');
    expect(en.sinDatos).toBe('No data');
    expect(en.locale).toBe('en-US');
  });

  it('la vista no usa text-n-100..400 como tinta de texto', () => {
    const src = readFileSync(join(__dirname, '..', 'MiHistoricoView.tsx'), 'utf8');
    expect(src).not.toMatch(/className=["'`{][^"'`}]*\btext-n-[1-4]00\b/);
    expect(src).not.toMatch(/>\s*(Cargando…|Sin datos|Actualizar|Histórico|Últimos 6 meses)\s*</);
  });
});
