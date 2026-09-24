// valoracion-02 — La página de Macroeconomía mostraba constantes (TRM $4.120,
// IPC 5,2 %, tasa 9,25 %, PIB +1,8 %) y proyecciones atribuidas a "Banco de la
// República, DANE — Actualizado 9 jun 2026", más "~84bps" sin fuente.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { dict } from '@/lib/i18n/dictionaries';
import { MacroIndicatorsView } from '../shared/MacroIndicatorsView';
import type { MacroFactors } from '@/lib/pillars/types';

const data: MacroFactors = {
  trm: {
    value: 3208.66,
    source: 'superfinanciera',
    asOf: '2026-09-23',
    fetchedAt: '2026-09-24T10:00:00.000Z',
    stale: false,
    reason: null,
  },
  ipc: { value: null, source: null, asOf: null, fetchedAt: null, stale: false, reason: 'La respuesta no trae la variación ANUAL del IPC.' },
  tasaBanRep: {
    value: null,
    source: null,
    asOf: null,
    fetchedAt: null,
    stale: false,
    reason: 'Tasa de intervención de política monetaria: requiere la serie oficial del BanRep (SUAMECA).',
  },
  fechaActualizacion: '2026-09-24T10:00:00.000Z',
  fuente: 'por-campo',
};

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('MacroIndicatorsView', () => {
  it('pinta cada campo con su fuente y vigencia, o N/D con motivo', () => {
    const t = text(
      renderToStaticMarkup(
        <MacroIndicatorsView state={{ status: 'ready', data }} language="es" t={dict.es.elite.dataStatus} />,
      ),
    );
    expect(t).toContain('$3.208,66');
    expect(t).toContain('Superintendencia Financiera');
    expect(t).toMatch(/Vigencia: 23 (de )?sept?\.?( de)? 2026/);
    expect(t.match(/N\/D/g)?.length).toBe(2);
    expect(t).toContain('SUAMECA');
    for (const lit of ['4.120', '9,25', '5,2%', '+1,8']) expect(t).not.toContain(lit);
  });

  it('marca el último valor bueno como desactualizado', () => {
    const stale: MacroFactors = { ...data, trm: { ...data.trm, stale: true } };
    const t = text(
      renderToStaticMarkup(
        <MacroIndicatorsView state={{ status: 'ready', data: stale }} language="en" t={dict.en.elite.dataStatus} />,
      ),
    );
    expect(t).toContain('Last available value');
  });
});

describe('/workspace/futuro/macroeconomia', () => {
  it('no contiene indicadores, proyecciones, fuentes ni recomendaciones fijas', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../app/workspace/futuro/macroeconomia/page.tsx'),
      'utf8',
    );
    for (const lit of ['$4.120', '5,2%', '9,25%', '+1,8%', '84bps', 'Actualizado 9 jun', 'Proyección 2026']) {
      expect(src).not.toContain(lit);
    }
    expect(src).toContain('/api/macro/current');
  });
});
