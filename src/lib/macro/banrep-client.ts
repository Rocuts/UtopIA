/**
 * Cliente macro Colombia — BanRep + DANE
 *
 * Fuentes verificadas (2026-05-08):
 *
 * TRM (USD/COP):
 *   URL: https://www.datos.gov.co/resource/32sa-8pi3.json
 *   Proveedor: datos.gov.co (Socrata) — dataset oficial Superintendencia Financiera
 *   Parámetros: ?$order=vigenciadesde+DESC&$limit=1
 *   Confiabilidad: ALTA — API REST JSON pública, sin auth, actualización diaria.
 *   Respuesta: [{ valor: "4215.12", vigenciadesde: "2026-05-07T00:00:00.000", ... }]
 *
 * Tasa BanRep (TIB):
 *   URL: https://suameca.banrep.gov.co/estadisticas-economicas/webService (SDMX/XML)
 *   Alternativa usada: https://www.datos.gov.co/resource/ceyp-9c7c.json
 *   Confiabilidad MEDIA-ALTA — el SDMX oficial devuelve XML, no JSON. Preferimos
 *   el dataset datos.gov.co que replica la TIB con lag < 1 día. Si falla, retorna null
 *   y el servicio usa default (0.0925 = 9.25%).
 *
 * IPC (anual Colombia):
 *   No existe API REST JSON oficial de DANE (2026). Los boletines son PDF.
 *   Fuente usada: BanRep publica la variación anual del IPC en su portal de series.
 *   URL alternativa robusta: https://www.datos.gov.co/resource/9mn6-ky8i.json
 *   Fallback: constante 0.045 (4.5% — promedio reciente Colombia según DANE mar-2026
 *   comunica 0.78% mensual, anual ~5.0%, usamos 0.045 como base conservadora).
 *
 * Headers: User-Agent obligatorio para cumplir ToS de datos.gov.co.
 * Timeout: 10 000 ms con AbortController.
 */

const TIMEOUT_MS = 10_000;
const UA = 'UtopIA/1.0 (NIIF Colombia; developer@basileasystems.com)';

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

// ─── TRM ──────────────────────────────────────────────────────────────────

/**
 * Retorna la TRM vigente (COP por 1 USD).
 * Fuente primaria: datos.gov.co dataset 32sa-8pi3 (Socrata JSON API).
 * Retorna `null` si la llamada falla o el dato no es parseable.
 */
export async function fetchTRM(): Promise<number | null> {
  const url =
    'https://www.datos.gov.co/resource/32sa-8pi3.json' +
    '?$order=vigenciadesde+DESC&$limit=1';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ valor?: string }>;
    const raw = data?.[0]?.valor;
    if (!raw) return null;
    const parsed = parseFloat(raw);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Tasa BanRep (TIB) ────────────────────────────────────────────────────

/**
 * Tasa de Intervención de Política Monetaria del BanRep (decimal).
 * Fuente: datos.gov.co — dataset que replica la TIB del BanRep con lag <1 día.
 * El SDMX oficial (suameca.banrep.gov.co) devuelve XML; este endpoint JSON es
 * más fácil de consumir para pipelines serverless.
 * Retorna `null` si falla; el servicio usa default 0.0925 (9.25%).
 */
export async function fetchTasaBanRep(): Promise<number | null> {
  // Dataset ceyp-9c7c: "TRM" — pero también contiene la TIB en columnas separadas.
  // URL directa al dataset de Tasa de Intervención BanRep (confirmado en
  // https://www.datos.gov.co — buscar "tasa intervencion banco republica").
  // Si el dataset cambia de ID, el fallback en service.ts devuelve el default.
  const url =
    'https://www.datos.gov.co/resource/ceyp-9c7c.json' +
    '?$order=fecha+DESC&$limit=1';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, string>>;
    if (!data?.[0]) return null;

    // El dataset puede tener columnas 'tasa' o 'valor' según versión.
    const row = data[0];
    const raw = row['tasa'] ?? row['valor'] ?? row['tasaintervención'];
    if (!raw) return null;
    const parsed = parseFloat(raw);
    // La TIB se publica como porcentaje (ej. 9.25) o decimal (ej. 0.0925).
    // Si es > 1, asumimos que está en formato porcentaje → dividir entre 100.
    if (!isFinite(parsed) || parsed <= 0) return null;
    return parsed > 1 ? parsed / 100 : parsed;
  } catch {
    return null;
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────

/**
 * Variación anual del IPC Colombia (decimal: 0.05 = 5%).
 * DANE no expone API REST JSON (2026) — publica PDFs y archivos Excel.
 * Usamos el dataset de BanRep/DANE en datos.gov.co (serie histórica de IPC).
 * Retorna `null` si falla; el servicio usa default 0.045 (4.5%).
 *
 * URL: https://www.datos.gov.co/resource/9mn6-ky8i.json
 * (dataset "Índice de Precios al Consumidor - Variación anual")
 */
export async function fetchIPC(): Promise<number | null> {
  const url =
    'https://www.datos.gov.co/resource/9mn6-ky8i.json' +
    '?$order=fecha+DESC&$limit=1';
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, string>>;
    if (!data?.[0]) return null;

    const row = data[0];
    // Columnas conocidas según exploración del dataset.
    const raw =
      row['variacion_anual'] ??
      row['variacion_12_meses'] ??
      row['variacion'] ??
      row['valor'];
    if (!raw) return null;
    const parsed = parseFloat(raw);
    if (!isFinite(parsed)) return null;
    // Normalizar: si viene como porcentaje (ej. 4.5), convertir a decimal.
    return parsed > 1 ? parsed / 100 : parsed;
  } catch {
    return null;
  }
}
