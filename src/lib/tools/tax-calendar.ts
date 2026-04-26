/**
 * Tax Calendar Tool — verified-source first, web supplement only on fallback.
 *
 * STRATEGY (post-cron-verified system):
 *   1. Pull national deadlines from `getVerifiedNational(year)` — single source
 *      of truth, in-memory cached. Resolves to one of:
 *         • 'edge-config'         — pushed by cron (fastest path)
 *         • 'postgres-verified'   — DB row marked `verified = true`
 *         • 'static-fallback'     — heuristic dataset in src/data/calendars
 *         • 'none'                — no data available for the year
 *   2. Pull municipal deadlines from the static city dataset (unchanged).
 *   3. Tavily web search ONLY when the verified source is NOT 'edge-config'
 *      or 'postgres-verified'. This saves latency + tokens once the cron
 *      has populated the DB, and preserves the safety net for years where
 *      we still rely on heuristics.
 *
 * The tool's contract with the LLM (TaxCalendarResult shape, function
 * signature) is unchanged for required fields. Three new optional fields —
 * `dataSource`, `decreeNumber`, `verifiedAt` — are surfaced so the model can
 * cite provenance when answering the user.
 */

import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import { getVerifiedNational } from '@/lib/calendars/source';
import {
  getMunicipalCalendar,
  getAvailableCities,
  type NationalDeadline,
  type CityCalendar,
} from '@/data/calendars';

/** Provenance tag exposed to the LLM so it can cite the source band correctly. */
export type TaxCalendarDataSource =
  | 'OFICIAL_DIAN_VERIFICADO'   // edge-config or postgres-verified
  | 'HEURISTICA_FALLBACK'       // static-fallback dataset
  | 'SIN_DATOS';                // 'none' from the source helper

export interface TaxCalendarResult {
  nitLastDigit: number;
  taxpayerType: string;
  year: number;
  city: string | null;
  /** Local structured data — national obligations for this NIT digit */
  localNational: string;
  /** Local structured data — municipal obligations for the city */
  localMunicipal: string;
  /** Web search results as supplement (empty string when not invoked) */
  webSupplement: string;
  /** Available cities in the local database */
  availableCities: string[];
  /** Instructions for the LLM */
  instruction: string;
  /** Provenance band — verified vs heuristic vs none */
  dataSource?: TaxCalendarDataSource;
  /** Decree number if known (e.g. "Decreto 2229 de 2023") */
  decreeNumber?: string | null;
  /** ISO timestamp of last verification (null if not verified) */
  verifiedAt?: string | null;
}

// ── Format local data for LLM consumption ──

function formatNationalDeadlines(deadlines: NationalDeadline[], verified: boolean): string {
  if (deadlines.length === 0) return '';

  const anyUnverifiedFlag = deadlines.some((d) => d.verified !== true);
  const treatAsUnverified = !verified || anyUnverifiedFlag;

  // Group by obligation
  const grouped = new Map<string, NationalDeadline[]>();
  for (const d of deadlines) {
    const key = d.obligation;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  const headerLines = treatAsUnverified
    ? [
        '## Obligaciones Nacionales',
        '',
        '⚠️ **FECHAS ESTIMADAS — NO OFICIALES.** Las fechas marcadas con ⚠️ son ' +
          'inferencias por patrón histórico del calendario tributario y NO provienen del ' +
          'decreto oficial DIAN del año. Verifica SIEMPRE contra el decreto oficial antes de ' +
          'presentar declaraciones — presentar en fecha incorrecta acarrea sanción por ' +
          'extemporaneidad (Art. 641 E.T., 5% mensual sobre el impuesto a cargo).',
        '',
      ]
    : ['## Obligaciones Nacionales (verificadas contra decreto oficial)', ''];

  const lines: string[] = [...headerLines];
  for (const [obligation, entries] of grouped) {
    lines.push(`### ${obligation}`);
    for (const e of entries) {
      const verifiedFlag = e.verified === true ? '' : ' ⚠️';
      const dateStr = e.dueDate === 'pendiente' ? '⚠️ Pendiente de confirmar' : `${e.dueDate}${verifiedFlag}`;
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

  // ── Step 1: Verified source (edge-config → postgres-verified → static-fallback → none) ──
  const verifiedSource = await getVerifiedNational(year);
  const localNational = verifiedSource.deadlines.filter((d) => d.nitDigit === nitLastDigit);

  const isVerified =
    verifiedSource.source === 'edge-config' || verifiedSource.source === 'postgres-verified';
  const dataSource: TaxCalendarDataSource =
    verifiedSource.source === 'none'
      ? 'SIN_DATOS'
      : isVerified
        ? 'OFICIAL_DIAN_VERIFICADO'
        : 'HEURISTICA_FALLBACK';

  // ── Step 2: Municipal (still static — separate work item) ──
  const localMunicipal = city ? getMunicipalCalendar(city, year) : null;
  const cities = getAvailableCities(year);
  const hasLocalMunicipal = localMunicipal !== null;

  // ── Step 3: Web supplement — only when verified data is unavailable ──
  // Once the cron populates Postgres / Edge Config, we skip Tavily entirely
  // for the national calendar (saves ~600ms + 5 Tavily credits per call).
  const useWebSupplement = !isVerified;
  const searches: Promise<{ results: unknown[] }>[] = [];

  if (useWebSupplement) {
    if (verifiedSource.source === 'none') {
      // No data at all — full national web search
      searches.push(
        searchWeb(
          `decreto calendario tributario ${year} plazos DIAN declaración renta IVA retención ${typeLabel} último dígito NIT ${nitLastDigit}`,
          { maxResults: 5, searchDepth: 'advanced' },
        ),
      );
    } else {
      // Heuristic fallback in hand — light verification search
      searches.push(
        searchWeb(
          `calendario tributario ${year} DIAN plazos declaración renta ${typeLabel}`,
          { maxResults: 3, searchDepth: 'basic' },
        ),
      );
    }
  }

  // Municipal supplement — independent of national verification status,
  // because municipal data is still static-only.
  if (!hasLocalMunicipal && city) {
    searches.push(
      searchWeb(
        `calendario tributario ${city} ${year} ICA industria comercio predial plazos vencimiento`,
        { maxResults: 5, searchDepth: 'advanced' },
      ),
    );
  } else if (!city) {
    searches.push(
      searchWeb(
        `calendario tributario municipal ${year} ICA predial principales ciudades Colombia plazos`,
        { maxResults: 3, searchDepth: 'advanced' },
      ),
    );
  }

  const webResults = searches.length > 0 ? await Promise.all(searches) : [];
  const webSupplement = webResults
    .map((r) => formatSearchResultsForLLM(r.results as Parameters<typeof formatSearchResultsForLLM>[0]))
    .filter(Boolean)
    .join('\n\n---\n\n');

  // ── Step 4: Build instruction ──
  const cityLabel = city || 'no especificada';
  const verifiedAtIso = verifiedSource.verifiedAt ? verifiedSource.verifiedAt.toISOString() : null;
  const decreeRef =
    verifiedSource.decreeNumber ||
    (isVerified ? 'decreto oficial DIAN' : 'decreto calendario tributario');

  const sourceLabel = isVerified
    ? `DATOS OFICIALES VERIFICADOS contra ${decreeRef}` +
      (verifiedAtIso ? ` (verificado al ${verifiedAtIso})` : '') +
      (verifiedSource.source === 'edge-config'
        ? ' [Edge Config snapshot]'
        : ' [Postgres]')
    : verifiedSource.source === 'static-fallback'
      ? 'DATOS LOCALES HEURÍSTICOS (fechas inferidas por patrón, NO oficiales) + búsqueda web de respaldo'
      : 'BÚSQUEDA WEB (no hay datos locales para este año)';

  const verifiedInstruction = isVerified
    ? `✅ FECHAS VERIFICADAS: estas fechas están confirmadas contra ${decreeRef}` +
      (verifiedAtIso ? ` (snapshot tomado el ${verifiedAtIso})` : '') +
      `. CITA la fuente al usuario en tu respuesta (ej. "Según ${decreeRef}…"). Puedes presentarlas como definitivas.`
    : `⚠️ FECHAS HEURÍSTICAS: estas fechas son inferencias por patrón histórico y NO provienen del decreto oficial. DEBES advertir al usuario "Fecha estimada — confirmar con DIAN antes de comprometer al cliente" y recomendar verificar en https://www.dian.gov.co antes de presentar declaraciones.`;

  return {
    nitLastDigit,
    taxpayerType,
    year,
    city: city || null,
    localNational:
      localNational.length > 0
        ? formatNationalDeadlines(localNational, isVerified)
        : `No hay datos nacionales locales para el año ${year} (último dígito NIT ${nitLastDigit}). Usar resultados web.`,
    localMunicipal: hasLocalMunicipal
      ? formatMunicipalCalendar(localMunicipal)
      : city
        ? `No hay datos municipales locales para ${city} ${year}. Ciudades disponibles: ${cities.join(', ')}. Usar resultados web.`
        : `No se especificó ciudad. Ciudades con datos locales: ${cities.join(', ')}.`,
    webSupplement: webSupplement || (useWebSupplement ? 'No se encontraron resultados web adicionales.' : ''),
    availableCities: cities,
    instruction:
      `FUENTE DE DATOS: ${sourceLabel}\n\n` +
      `${verifiedInstruction}\n\n` +
      `INSTRUCCIÓN: Presenta el calendario tributario ${year} para último dígito NIT ${nitLastDigit} (${typeLabel}).\n` +
      `Ciudad: ${cityLabel}.\n\n` +
      `PRIORIDAD DE DATOS:\n` +
      (isVerified
        ? `1. Usa los DATOS OFICIALES VERIFICADOS como única fuente para el calendario nacional — están confirmados contra el decreto.\n` +
          `2. Para datos municipales, usa la sección local si existe; complementa con búsqueda web cuando falte.\n`
        : `1. La BÚSQUEDA WEB con fuente oficial DIAN tiene PRIORIDAD sobre los datos heurísticos.\n` +
          `2. Usa los datos locales solo como referencia secundaria y SIEMPRE marca la advertencia "fecha estimada".\n`) +
      `3. Si hay conflicto entre local y web, menciona ambos y recomienda verificar en dian.gov.co.\n\n` +
      `FORMATO: Presenta DOS tablas separadas:\n` +
      `1. **OBLIGACIONES NACIONALES (DIAN)**: Columnas: Mes | Obligación | Fecha Límite | Base Legal\n` +
      `2. **OBLIGACIONES MUNICIPALES${city ? ' — ' + city : ''}**: Columnas: Mes | Obligación | Fecha Límite | Régimen | Observaciones\n\n` +
      `REGLAS:\n` +
      `- Fechas marcadas como "pendiente" o con ⚠️ → indica "Pendiente de confirmar en la fuente oficial".\n` +
      `- Incluye régimen ICA (bimestral/anual, común/simplificado).\n` +
      `- Si no se especificó ciudad, muestra datos de las ciudades principales disponibles.\n` +
      `- Cita fuentes para datos de búsqueda web.`,
    dataSource,
    decreeNumber: verifiedSource.decreeNumber,
    verifiedAt: verifiedAtIso,
  };
}
