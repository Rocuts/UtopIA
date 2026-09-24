/**
 * Punto de entrada del sistema de calendarios tributarios.
 *
 * ACTUALIZACIÓN ANUAL:
 * 1. Crear archivos nacional-YYYY.ts y municipal-YYYY.ts
 * 2. Actualizar CURRENT_YEAR y los imports aquí
 * 3. Ejecutar `npm run db:ingest` para actualizar RAG
 */

import type {
  YearCalendar,
  NationalDeadline,
  CityCalendar,
  CalendarTaxpayerType,
} from './types';
import { NACIONAL_2026 } from './nacional-2026';
import { MUNICIPAL_2026 } from './municipal-2026';

export type {
  YearCalendar,
  NationalDeadline,
  CityCalendar,
  CalendarTaxpayerType,
} from './types';
export {
  OBLIGACIONES_NACIONALES_NO_CUBIERTAS_2026,
  FAMILIAS_SOLO_ESTATICAS_2026,
} from './nacional-2026';

/** Año vigente del calendario. Actualizar al crear archivos del nuevo año. */
export const CURRENT_YEAR = 2026;

/** UVT vigente */
export const UVT_2026 = 52_374;

/** Calendario completo del año vigente */
export const CALENDAR_2026: YearCalendar = {
  year: 2026,
  nationalDecree: 'Decreto 2229 de 2023',
  uvt: UVT_2026,
  uvtResolution: 'Resolución DIAN 000238 del 15 de diciembre de 2025',
  lastUpdated: '2026-04-25',
  national: NACIONAL_2026,
  municipal: MUNICIPAL_2026,
};

// ── Funciones de consulta ──────────────────────────────

/**
 * Obtiene las obligaciones nacionales para un dígito NIT específico.
 * Si `nitLastDigit` es `undefined`, retorna TODAS las obligaciones del año
 * (útil para snapshot/seeding del calendario completo en `verified_calendars`).
 */
export function getNationalDeadlines(
  nitLastDigit?: number,
  year: number = CURRENT_YEAR,
): NationalDeadline[] {
  if (year !== CURRENT_YEAR) return []; // No hay datos locales para otros años
  if (nitLastDigit === undefined) return NACIONAL_2026;
  return NACIONAL_2026.filter(d => d.nitDigit === nitLastDigit);
}

/**
 * Obtiene el calendario municipal de una ciudad específica.
 * Búsqueda case-insensitive y con coincidencia parcial.
 */
export function getMunicipalCalendar(
  city: string,
  year: number = CURRENT_YEAR,
): CityCalendar | null {
  if (year !== CURRENT_YEAR) return null;
  const normalized = city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return MUNICIPAL_2026.find(c => {
    const cityNorm = c.city.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return cityNorm.includes(normalized) || normalized.includes(cityNorm);
  }) || null;
}

/**
 * Lista todas las ciudades disponibles en el calendario municipal.
 */
export function getAvailableCities(year: number = CURRENT_YEAR): string[] {
  if (year !== CURRENT_YEAR) return [];
  return MUNICIPAL_2026.map(c => c.city);
}

/**
 * ¿Aplica la obligación al tipo de contribuyente consultado?
 * Usa `taxpayerTypes` cuando la fila lo trae; las filas del snapshot del cron
 * (src/lib/scrapers/dian-scraper.ts) no lo traen, así que se infiere del
 * nombre. Sin indicio de tipo, aplica a todos.
 */
export function aplicaATipoContribuyente(
  d: NationalDeadline,
  tipo: CalendarTaxpayerType,
): boolean {
  const tipos = d.taxpayerTypes ?? inferirTiposPorNombre(d.obligation);
  return tipos === null || tipos.includes(tipo);
}

function inferirTiposPorNombre(obligation: string): CalendarTaxpayerType[] | null {
  if (/grandes contribuyentes/i.test(obligation)) return ['gran_contribuyente'];
  if (/personas jur[ií]dicas y naturales/i.test(obligation)) {
    return ['persona_juridica', 'persona_natural'];
  }
  if (/personas jur[ií]dicas/i.test(obligation)) return ['persona_juridica'];
  if (/personas naturales/i.test(obligation)) return ['persona_natural'];
  // Art. 292-3 E.T.: sujetos pasivos personas naturales y sucesiones ilíquidas.
  if (/impuesto al patrimonio/i.test(obligation)) return ['persona_natural'];
  return null;
}
