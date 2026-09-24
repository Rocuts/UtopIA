// ---------------------------------------------------------------------------
// Duración de un periodo contable a partir de su etiqueta — fuente ÚNICA.
// ---------------------------------------------------------------------------
// Módulo puro y sin dependencias (lo importan también componentes cliente y el
// view-model del Âncora). `trial-balance.ts` lo re-exporta: la función que
// anualiza los KPIs del preprocesador (`controlTotals.mesesPeriodo`) es la
// misma que usan pilares, tarjetas, Sentinel, PDF y Âncora (auditoría
// 2026-09-24, normativa-metricas NM-01). Antes los pilares tenían su propia
// regla (`monthsCovered`) que sólo entendía `AAAA-MM`: un corte "2025-Q2" o un
// rango incompleto se trataban como 12 meses.
// ---------------------------------------------------------------------------

// Wave 2.F4 — inferencia del tipo de período (Parte 2.1 VERIFICACIÓN 4).
// El parser actual sólo guarda el año en `period` ("2024"). Sin embargo, una
// cadena más rica del header (por ejemplo "Saldo Final 2024-12" o "Ene-Dic
// 2024") es comúnmente accesible vía `forcePeriod` u opciones del CSV. La
// función inspecciona la cadena `period` (post-resolución del parser) y
// devuelve:
//   - 'cerrado'      cuando hay evidencia de año completo (mes 12 / "Dic" /
//                    "Ene-Dic" / "Enero-Diciembre" / "Jan-Dec").
//   - 'parcial'      cuando hay un mes específico distinto a 12 / un rango
//                    incompleto (e.g. "2024-06", "Ene-Jun 2024").
//   - 'indeterminado' cuando sólo se reconoce el año (caso más común hoy).
// La inferencia NUNCA falla — si el patrón es ambiguo, devuelve
// 'indeterminado' (fallback seguro: R8 emite la nota EXPLICATIVA suave).
const MONTH_NUMERIC_REGEX = /\b(20\d{2})[-_/](\d{1,2})\b/;
const FULL_YEAR_HINT_REGEX =
  /\b(ene[-_/\s]*(?:a[-_/\s]*)?dic|enero[-_/\s]*(?:a[-_/\s]*)?diciembre|jan[-_/\s]*(?:to[-_/\s]*)?dec|january[-_/\s]*(?:to[-_/\s]*)?december|cierre|fin\s+de\s+año|full\s*year)\b/i;
const PARTIAL_MONTH_HINT_REGEX =
  /\b(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|jan(?:uary)?|feb(?:ruary)?|march|april|june|july|august|september|october|november)\b/i;

export function inferPeriodoTipo(
  periodLabel: string | null | undefined,
): 'cerrado' | 'parcial' | 'indeterminado' {
  if (!periodLabel) return 'indeterminado';
  const s = String(periodLabel).trim();
  if (s.length === 0) return 'indeterminado';

  // Patrón numérico "YYYY-MM" — chequea el mes específico.
  const num = s.match(MONTH_NUMERIC_REGEX);
  if (num) {
    const month = parseInt(num[2], 10);
    if (!Number.isNaN(month) && month >= 1 && month <= 12) {
      return month === 12 ? 'cerrado' : 'parcial';
    }
  }

  // Patrones textuales de año completo (mayor prioridad que match parcial).
  if (FULL_YEAR_HINT_REGEX.test(s)) return 'cerrado';

  // Mes textual aislado → parcial (e.g. "Junio 2024", "Saldo Ago-2024").
  if (PARTIAL_MONTH_HINT_REGEX.test(s) && !/dic|dec/i.test(s)) {
    return 'parcial';
  }

  // Solo el año detectado, sin contexto de mes → indeterminado.
  return 'indeterminado';
}

/**
 * Meses de resultados que cubre un periodo, derivados de su etiqueta
 * (ratios-kpis-18). `null` cuando la etiqueta no determina la duración.
 *   - "AAAA"                    → 12 (cierre anual: convención del parser,
 *                                 que ordena "AAAA" como el cierre AAAA-12).
 *   - "AAAA-MM"                 → MM (P&G acumulado desde el 1 de enero).
 *   - "AAAA-Qn"                 → 3·n (acumulado al cierre del trimestre).
 *   - "AAAA-MM-DD..AAAA-MM-DD"  → meses completos del rango (1..12).
 *   - etiqueta de año completo ("ene-dic 2025", "cierre 2025") → 12.
 */
export function mesesDelPeriodo(periodLabel: string | null | undefined): number | null {
  if (!periodLabel) return null;
  const s = String(periodLabel).trim();
  if (/^20\d{2}$/.test(s)) return 12;
  let m = s.match(/^20\d{2}-(0[1-9]|1[0-2])$/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/^20\d{2}-Q([1-4])$/i);
  if (m) return parseInt(m[1], 10) * 3;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [y1, mo1, d1, y2, mo2, d2] = m.slice(1).map((x) => parseInt(x, 10));
    const ultimoDia = new Date(Date.UTC(y2, mo2, 0)).getUTCDate();
    if (d1 !== 1 || d2 !== ultimoDia) return null;
    const meses = (y2 - y1) * 12 + (mo2 - mo1) + 1;
    return meses >= 1 && meses <= 12 ? meses : null;
  }
  return inferPeriodoTipo(s) === 'cerrado' ? 12 : null;
}

/**
 * `true` sólo si ambos periodos tienen duración derivable y es la misma
 * (año vs año, o el mismo corte acumulado). Base del crecimiento de ingresos:
 * comparar un acumulado a junio con un año completo no es un crecimiento.
 */
export function periodosDeIgualDuracion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ma = mesesDelPeriodo(a);
  const mb = mesesDelPeriodo(b);
  return ma !== null && mb !== null && ma === mb;
}
