/**
 * Regresiones tributario-calc-06 y tributario-calc-07 — tool get_tax_calendar.
 *
 * -06: el cron (calendar-sync) y db:seed-calendar guardan en Postgres el
 *      resultado de buildDeadlines2026(), cuyas filas son TODAS verified:false
 *      (fechas calculadas con la regla del 7º-16º día hábil, no leídas de la
 *      tabla oficial). La tool rotulaba cualquier fila de Postgres como
 *      'OFICIAL_DIAN_VERIFICADO', instruía "Puedes presentarlas como
 *      definitivas" y suprimía la búsqueda web de respaldo. Además no filtraba
 *      por tipo de contribuyente.
 * -07: el calendario nacional omitía el SIMPLE (anual y anticipos), la
 *      declaración informativa y documentación de precios de transferencia y el
 *      INC bimestral, sin advertir la omisión.
 *
 * Fechas re-derivadas del Decreto 2229 de 2023 (src/data/tax_docs/decreto_2229_2023.md,
 * arts. 1.6.1.13.2.26/.28/.29/.32/.50/.51/.52) con el 17-abr-2026 no hábil.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/search/web-search', () => ({
  searchWeb: vi.fn(async () => ({ results: [] })),
  formatSearchResultsForLLM: vi.fn(() => ''),
}));
vi.mock('@/lib/calendars/source', () => ({
  getVerifiedNational: vi.fn(),
}));

import { getVerifiedNational } from '@/lib/calendars/source';
import { searchWeb } from '@/lib/search/web-search';
import { buildDeadlines2026 } from '@/lib/scrapers/dian-scraper';
import { NACIONAL_2026, OBLIGACIONES_NACIONALES_NO_CUBIERTAS_2026 } from '@/data/calendars/nacional-2026';
import type { NationalDeadline } from '@/data/calendars/types';
import { getTaxCalendar } from '../tax-calendar';

function fuente(deadlines: NationalDeadline[], source: 'postgres-verified' | 'static-fallback') {
  vi.mocked(getVerifiedNational).mockResolvedValue({
    deadlines,
    source,
    verifiedAt: new Date('2026-09-01T00:00:00Z'),
    decreeNumber: 'Decreto 2229 de 2023',
  });
}

function fecha(fragmento: string, digit: number, period?: string): string {
  const m = NACIONAL_2026.filter(
    (d) =>
      d.obligation.includes(fragmento) &&
      d.nitDigit === digit &&
      (period === undefined || d.period.includes(period)),
  );
  expect(m.length, `${fragmento}/${digit}/${period}`).toBe(1);
  return m[0]!.dueDate;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tributario-calc-06 — procedencia de las fechas', () => {
  it('filas del cron (verified:false) en Postgres NO se rotulan como oficiales ni "definitivas"', async () => {
    fuente(buildDeadlines2026(), 'postgres-verified');
    const r = await getTaxCalendar(7, 2026, 'persona_juridica');
    expect(r.dataSource).not.toBe('OFICIAL_DIAN_VERIFICADO');
    expect(r.instruction).not.toMatch(/definitivas/i);
    expect(r.instruction).not.toMatch(/FECHAS VERIFICADAS/);
    expect(r.localNational).not.toMatch(/verificadas contra decreto oficial/);
    // Se mantiene la búsqueda web de respaldo para el calendario nacional.
    expect(vi.mocked(searchWeb).mock.calls.some(([q]) => /DIAN/i.test(String(q)))).toBe(true);
  });

  it('sólo un snapshot con TODAS las filas verified:true se presenta como oficial', async () => {
    // Snapshot con TODAS las familias y todas sus filas confrontadas.
    fuente(
      NACIONAL_2026.map((d) => ({ ...d, verified: true })),
      'postgres-verified',
    );
    const r = await getTaxCalendar(7, 2026, 'persona_juridica');
    expect(r.dataSource).toBe('OFICIAL_DIAN_VERIFICADO');
  });

  it('persona jurídica no recibe renta de grandes contribuyentes ni de personas naturales', async () => {
    fuente(buildDeadlines2026(), 'postgres-verified');
    const r = await getTaxCalendar(7, 2026, 'persona_juridica');
    expect(r.localNational).toMatch(/Personas Jurídicas/);
    expect(r.localNational).not.toMatch(/Grandes Contribuyentes/);
    expect(r.localNational).not.toMatch(/Declaración Renta — Personas Naturales/);
  });

  it('gran contribuyente recibe su renta y su exógena, no las de PJ/PN', async () => {
    fuente(NACIONAL_2026, 'static-fallback');
    const r = await getTaxCalendar(7, 2026, 'gran_contribuyente');
    expect(r.localNational).toMatch(/Renta Grandes Contribuyentes/);
    expect(r.localNational).not.toMatch(/Declaración Renta — Personas Jurídicas/);
    expect(r.localNational).not.toMatch(/Exógena[^\n]*Personas Jurídicas y Naturales/);
  });

  it('persona natural recibe renta PN y no la de personas jurídicas', async () => {
    fuente(NACIONAL_2026, 'static-fallback');
    const r = await getTaxCalendar(7, 2026, 'persona_natural');
    expect(r.localNational).toMatch(/Declaración Renta — Personas Naturales/);
    expect(r.localNational).not.toMatch(/Declaración Renta — Personas Jurídicas/);
    expect(r.localNational).not.toMatch(/Renta Grandes Contribuyentes/);
  });
});

describe('tributario-calc-07 — cobertura del calendario nacional 2026', () => {
  it('SIMPLE: declaración anual del 20 al 24-abr-2026 (11º-15º día hábil por pares de dígitos)', () => {
    expect(fecha('Régimen SIMPLE — Declaración Anual Consolidada', 1)).toBe('2026-04-20');
    expect(fecha('Régimen SIMPLE — Declaración Anual Consolidada', 2)).toBe('2026-04-20');
    expect(fecha('Régimen SIMPLE — Declaración Anual Consolidada', 0)).toBe('2026-04-24');
  });

  it('SIMPLE: anticipos bimestrales (Ene-Feb en mayo, Mar-Abr en junio)', () => {
    expect(fecha('Régimen SIMPLE — Anticipo Bimestral', 1, 'Ene-Feb 2026')).toBe('2026-05-12');
    expect(fecha('Régimen SIMPLE — Anticipo Bimestral', 0, 'Ene-Feb 2026')).toBe('2026-05-26');
    expect(fecha('Régimen SIMPLE — Anticipo Bimestral', 1, 'Mar-Abr 2026')).toBe('2026-06-10');
    expect(fecha('Régimen SIMPLE — Anticipo Bimestral', 1, 'Nov-Dic 2026')).toBe('2027-01-13');
  });

  it('INC bimestral con los mismos meses del IVA bimestral', () => {
    expect(fecha('Impuesto Nacional al Consumo', 1, 'Ene-Feb 2026')).toBe('2026-03-10');
    expect(fecha('Impuesto Nacional al Consumo', 0, 'Jul-Ago 2026')).toBe('2026-09-22');
  });

  it('precios de transferencia: declaración informativa 9 al 22-sep-2026; país por país 15-dic-2026', () => {
    expect(fecha('Precios de Transferencia — Declaración Informativa', 1)).toBe('2026-09-09');
    expect(fecha('Precios de Transferencia — Declaración Informativa', 0)).toBe('2026-09-22');
    expect(fecha('Precios de Transferencia — Documentación Comprobatoria', 0)).toBe('2026-09-22');
    expect(fecha('Precios de Transferencia — Informe País por País', 5)).toBe('2026-12-15');
  });

  it('activos en el exterior: grandes contribuyentes en abril, no en mayo', () => {
    expect(fecha('Activos en el Exterior — Grandes Contribuyentes', 1)).toBe('2026-04-13');
    expect(fecha('Activos en el Exterior — Personas Jurídicas', 1)).toBe('2026-05-12');
  });

  it('todas las nuevas fechas siguen marcadas verified:false', () => {
    expect(NACIONAL_2026.filter((d) => d.verified === true)).toEqual([]);
  });

  it('la tool completa con obligaciones que el snapshot del cron no trae y lista las no cubiertas', async () => {
    fuente(buildDeadlines2026(), 'postgres-verified');
    const r = await getTaxCalendar(7, 2026, 'persona_juridica');
    expect(r.localNational).toMatch(/Régimen SIMPLE/);
    expect(r.localNational).toMatch(/Precios de Transferencia/);
    expect(OBLIGACIONES_NACIONALES_NO_CUBIERTAS_2026.some((o) => /ingresos y patrimonio/i.test(o))).toBe(
      true,
    );
    expect(r.localNational).toMatch(/NO CUBIERTAS/i);
    expect(r.localNational).toMatch(/ingresos y patrimonio/i);
    expect(r.instruction).toMatch(/no cubiertas/i);
  });
});
