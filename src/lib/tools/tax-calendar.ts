/**
 * Tax Calendar Tool — Hybrid: local structured data + web search.
 *
 * STRATEGY:
 * 1. Check local calendar data first (src/data/calendars/)
 * 2. If local data exists, use it as the PRIMARY source
 * 3. Supplement with web search for verification and gaps
 * 4. If no local data (unsupported year), fall back entirely to web search
 *
 * This ensures fast, reliable answers from curated data while
 * staying current via web search for recent changes.
 */

import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import {
  getNationalDeadlines,
  getMunicipalCalendar,
  getAvailableCities,
  CURRENT_YEAR,
  type NationalDeadline,
  type CityCalendar,
} from '@/data/calendars';

export interface TaxCalendarResult {
  nitLastDigit: number;
  taxpayerType: string;
  year: number;
  city: string | null;
  /** Local structured data — national obligations for this NIT digit */
  localNational: string;
  /** Local structured data — municipal obligations for the city */
  localMunicipal: string;
  /** Web search results as supplement */
  webSupplement: string;
  /** Available cities in the local database */
  availableCities: string[];
  /** Instructions for the LLM */
  instruction: string;
}

// ── Format local data for LLM consumption ──

function formatNationalDeadlines(deadlines: NationalDeadline[]): string {
  if (deadlines.length === 0) return '';

  // Group by obligation
  const grouped = new Map<string, NationalDeadline[]>();
  for (const d of deadlines) {
    const key = d.obligation;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  const lines: string[] = ['## Obligaciones Nacionales (datos locales verificados)\n'];
  for (const [obligation, entries] of grouped) {
    lines.push(`### ${obligation}`);
    for (const e of entries) {
      const dateStr = e.dueDate === 'pendiente' ? '⚠️ Pendiente de confirmar' : e.dueDate;
      lines.push(`- **${e.period}**: ${dateStr} | Base: ${e.legalBasis}${e.notes ? ` | ${e.notes}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatMunicipalCalendar(cal: CityCalendar): string {
  const lines: string[] = [
    `## Obligaciones Municipales — ${cal.city} (${cal.department})`,
    `Fuente oficial: ${cal.officialUrl}`,
    `Última verificación: ${cal.lastVerified}\n`,
  ];

  // Group by obligation
  const grouped = new Map<string, typeof cal.deadlines>();
  for (const d of cal.deadlines) {
    const key = d.obligation;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  for (const [obligation, entries] of grouped) {
    lines.push(`### ${obligation}`);
    for (const e of entries) {
      const dateStr = e.dueDate === 'pendiente' ? '⚠️ Pendiente de confirmar' : e.dueDate;
      const extra = [e.regime ? `Régimen: ${e.regime}` : '', e.notes || ''].filter(Boolean).join(' | ');
      lines.push(`- **${e.period}**: ${dateStr}${extra ? ` | ${extra}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main function ──

export async function getTaxCalendar(
  nitLastDigit: number,
  year: number,
  taxpayerType: 'persona_juridica' | 'persona_natural' | 'gran_contribuyente',
  city?: string,
): Promise<TaxCalendarResult> {
  const typeLabels: Record<string, string> = {
    persona_juridica: 'personas jurídicas',
    persona_natural: 'personas naturales',
    gran_contribuyente: 'grandes contribuyentes',
  };
  const typeLabel = typeLabels[taxpayerType] || 'personas jurídicas';

  // ── Step 1: Check local structured data ──
  const localNational = getNationalDeadlines(nitLastDigit, year);
  const localMunicipal = city ? getMunicipalCalendar(city, year) : null;
  const cities = getAvailableCities(year);

  const hasLocalNational = localNational.length > 0;
  const hasLocalMunicipal = localMunicipal !== null;

  // ── Step 2: Web search to supplement gaps ──
  // If we have good local data, do fewer searches; if not, do more
  const searches: Promise<any>[] = [];

  if (!hasLocalNational) {
    // No local data — full web search for national dates
    searches.push(
      searchWeb(
        `decreto calendario tributario ${year} plazos DIAN declaración renta IVA retención ${typeLabel} último dígito NIT ${nitLastDigit}`,
        { maxResults: 5, searchDepth: 'advanced' }
      )
    );
  } else {
    // Have local data — light verification search
    searches.push(
      searchWeb(
        `calendario tributario ${year} DIAN plazos declaración renta ${typeLabel}`,
        { maxResults: 3, searchDepth: 'basic' }
      )
    );
  }

  if (!hasLocalMunicipal && city) {
    // No local data for this city — targeted search
    searches.push(
      searchWeb(
        `calendario tributario ${city} ${year} ICA industria comercio predial plazos vencimiento`,
        { maxResults: 5, searchDepth: 'advanced' }
      )
    );
  } else if (!city) {
    // No city specified — general municipal search
    searches.push(
      searchWeb(
        `calendario tributario municipal ${year} ICA predial principales ciudades Colombia plazos`,
        { maxResults: 3, searchDepth: 'advanced' }
      )
    );
  }

  const webResults = await Promise.all(searches);
  const webSupplement = webResults
    .map(r => formatSearchResultsForLLM(r.results))
    .filter(Boolean)
    .join('\n\n---\n\n');

  // ── Step 3: Build result ──
  const cityLabel = city || 'no especificada';
  const dataSource = hasLocalNational
    ? 'DATOS LOCALES VERIFICADOS (fuente primaria) + búsqueda web (verificación)'
    : 'BÚSQUEDA WEB (no hay datos locales para este año)';

  return {
    nitLastDigit,
    taxpayerType,
    year,
    city: city || null,
    localNational: hasLocalNational
      ? formatNationalDeadlines(localNational)
      : 'No hay datos nacionales locales para el año ' + year + '. Usar resultados web.',
    localMunicipal: hasLocalMunicipal
      ? formatMunicipalCalendar(localMunicipal)
      : city
        ? `No hay datos municipales locales para ${city} ${year}. Ciudades disponibles: ${cities.join(', ')}. Usar resultados web.`
        : `No se especificó ciudad. Ciudades con datos locales: ${cities.join(', ')}.`,
    webSupplement: webSupplement || 'No se encontraron resultados web adicionales.',
    availableCities: cities,
    instruction:
      `FUENTE DE DATOS: ${dataSource}\n\n` +
      `INSTRUCCIÓN: Presenta el calendario tributario ${year} para último dígito NIT ${nitLastDigit} (${typeLabel}).\n` +
      `Ciudad: ${cityLabel}.\n\n` +
      `PRIORIDAD DE DATOS:\n` +
      `1. Usa los DATOS LOCALES como fuente principal (ya están filtrados para este NIT).\n` +
      `2. Usa la BÚSQUEDA WEB para verificar o complementar datos faltantes.\n` +
      `3. Si hay conflicto entre local y web, menciona ambos y recomienda verificar en dian.gov.co.\n\n` +
      `FORMATO: Presenta DOS tablas separadas:\n` +
      `1. **OBLIGACIONES NACIONALES (DIAN)**: Columnas: Mes | Obligación | Fecha Límite | Base Legal\n` +
      `2. **OBLIGACIONES MUNICIPALES${city ? ' — ' + city : ''}**: Columnas: Mes | Obligación | Fecha Límite | Régimen | Observaciones\n\n` +
      `REGLAS:\n` +
      `- Fechas marcadas como "pendiente" → indica "Pendiente de confirmar en la fuente oficial".\n` +
      `- Incluye régimen ICA (bimestral/anual, común/simplificado).\n` +
      `- Si no se especificó ciudad, muestra datos de las ciudades principales disponibles.\n` +
      `- Cita fuentes para datos de búsqueda web.`,
  };
}
