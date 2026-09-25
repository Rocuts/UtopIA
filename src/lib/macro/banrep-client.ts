/**
 * Cliente macro Colombia — TRM (Superfinanciera), IPC (DANE) y tasa de política.
 *
 * Auditoría valoracion-05: cada serie tiene columna y UNIDAD fijas, fecha de
 * vigencia obligatoria y rango plausible. Nada de heurísticas `x > 1 ? x/100`
 * (un 0,39 % mensual se leía como 39 %) ni de columnas genéricas 'tasa'/'valor'
 * de un dataset de otra serie. Lo que no cumple ⇒ `reading: null` con motivo.
 *
 * TRM (COP por USD):
 *   URL: https://www.datos.gov.co/resource/32sa-8pi3.json
 *   Dataset "Tasa de Cambio Representativa del Mercado" (Superintendencia
 *   Financiera). Columnas: `valor` (COP por USD) y `vigenciadesde` (fecha de
 *   vigencia). Rango aceptado: 1.000 – 10.000.
 *
 * IPC (variación anual, Colombia):
 *   URL: https://www.datos.gov.co/resource/9mn6-ky8i.json
 *   Sólo se aceptan columnas de variación ANUAL (`variacion_anual`,
 *   `variacion_12_meses`) expresadas en PORCENTAJE, con fecha/periodo
 *   (`fecha`, `periodo` o `mes`). Rango aceptado: −5 % a 30 %. Cualquier otra
 *   forma de respuesta ⇒ N/D.
 *
 * Tasa de intervención de política monetaria (BanRep):
 *   No se consulta. La serie oficial vive en SUAMECA (BanRep) y no está
 *   configurada; el dataset usado antes (ceyp-9c7c) no está verificado, el
 *   propio código lo describía como "TRM" y la TIB no es la tasa de
 *   intervención. ⇒ N/D con motivo hasta configurar la serie oficial.
 *
 * Headers: User-Agent obligatorio para cumplir ToS de datos.gov.co.
 * Timeout: 10 000 ms con AbortController.
 */

const TIMEOUT_MS = 10_000;
const UA = 'UtopIA/1.0 (NIIF Colombia; developer@basileasystems.com)';

export type MacroSource = 'superfinanciera' | 'dane' | 'banrep';

export interface MacroReading {
  value: number;
  /** Fecha de vigencia / periodo del dato (YYYY-MM-DD o YYYY-MM). */
  asOf: string;
  source: MacroSource;
}

export interface MacroFetch {
  reading: MacroReading | null;
  /** Motivo cuando `reading` es null. */
  reason: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      // Next.js: no-store para que cada invocación sea fresca (el servicio
      // maneja su propio cache en Postgres).
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Normaliza una fecha ISO/Socrata a YYYY-MM-DD (o YYYY-MM). null si no es fecha. */
function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(raw.trim());
  if (!m) return null;
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

function fail(reason: string): MacroFetch {
  return { reading: null, reason };
}

async function firstRow(url: string): Promise<Record<string, unknown> | string> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return `La fuente respondió HTTP ${res.status}.`;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !data[0] || typeof data[0] !== 'object') {
      return 'La fuente no devolvió filas.';
    }
    return data[0] as Record<string, unknown>;
  } catch {
    return 'No fue posible consultar la fuente.';
  }
}

// ─── TRM ──────────────────────────────────────────────────────────────────

export async function fetchTRM(): Promise<MacroFetch> {
  const row = await firstRow(
    'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde+DESC&$limit=1',
  );
  if (typeof row === 'string') return fail(row);
  const value = parseFloat(String(row['valor'] ?? ''));
  const asOf = normalizeDate(row['vigenciadesde']);
  if (!asOf) return fail('TRM sin fecha de vigencia (vigenciadesde).');
  if (!Number.isFinite(value) || value < 1_000 || value > 10_000) {
    return fail('TRM fuera del rango plausible (1.000 – 10.000 COP/USD).');
  }
  return { reading: { value, asOf, source: 'superfinanciera' }, reason: null };
}

// ─── Tasa de intervención BanRep ─────────────────────────────────────────

export async function fetchTasaBanRep(): Promise<MacroFetch> {
  return fail(
    'Tasa de intervención de política monetaria: requiere la serie oficial del BanRep ' +
      '(SUAMECA), no configurada. La TIB y el dataset consultado antes no son esa serie.',
  );
}

// ─── IPC ──────────────────────────────────────────────────────────────────

const IPC_ANNUAL_COLUMNS = ['variacion_anual', 'variacion_12_meses'] as const;
const IPC_DATE_COLUMNS = ['fecha', 'periodo', 'mes'] as const;

export async function fetchIPC(): Promise<MacroFetch> {
  const row = await firstRow(
    'https://www.datos.gov.co/resource/9mn6-ky8i.json?$order=fecha+DESC&$limit=1',
  );
  if (typeof row === 'string') return fail(row);
  const col = IPC_ANNUAL_COLUMNS.find((c) => row[c] !== undefined && row[c] !== null);
  if (!col) return fail('La respuesta no trae la variación ANUAL del IPC.');
  const asOf = IPC_DATE_COLUMNS.map((c) => normalizeDate(row[c])).find((d) => d !== null) ?? null;
  if (!asOf) return fail('IPC sin fecha/periodo del dato.');
  const pct = parseFloat(String(row[col]));
  // Unidad declarada: PORCENTAJE (6.24 = 6,24 %).
  if (!Number.isFinite(pct) || pct < -5 || pct > 30) {
    return fail('IPC anual fuera del rango plausible (−5 % a 30 %).');
  }
  return { reading: { value: pct / 100, asOf, source: 'dane' }, reason: null };
}
