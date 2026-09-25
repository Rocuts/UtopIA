// ---------------------------------------------------------------------------
// Format helpers for chart axis labels, tooltips, and KPI values.
// ---------------------------------------------------------------------------
// Convención del proyecto: los KPIs llegan en PESOS (números planos), no en
// centavos. La capa DB usa BigInt centavos pero el preprocesador y los
// pilares devuelven pesos. Si en el futuro un widget necesita centavos,
// añade `formatCopFromCentavos`.
//
// Formato es-CO (ratios-kpis-27, reportes-export-19; spec v10.1 "Formato
// numérico estricto"):
//   - Decimal con COMA y miles con PUNTO: `$108,8 M`, `15,6%`. Un lector
//     colombiano lee "1.5" como mil quinientos.
//   - Escalas en español: `mil` (10^3), `M` (millones, 10^6) y `mil M`
//     (miles de millones, 10^9). NUNCA `B`: en español un billón es 10^12 y
//     `$2.4B` se lee como dos billones. Por encima de 10^12 se sigue en
//     `mil M` (`$4.000 mil M`) para no introducir otra abreviatura ambigua.
//   - Negativos monetarios entre PARÉNTESIS, la convención NIIF que ya usan
//     `formatCopFromCents` (contracts/money.ts), los estados del PDF Élite y
//     el formato del Excel: `($1.234.567)`, `($1,5 M)`.
//   - Porcentajes con signo `-` delante (`-4,1%`), sin espacio antes de `%`.
//   - No finito / null → `—` (el llamador decide si muestra "N/D").
//
// Idioma: `formatBigCop`, `formatPct` y `formatDecimal` aceptan un parámetro
// opcional `language` ('es' por defecto, sin cambio para los llamadores
// existentes). Con 'en' (UI en inglés) usan en-US y las escalas inglesas
// `K` / `M` / `B` / `T`, donde `B` = 10^9 sin ambigüedad (`$2.4B`). Los
// negativos monetarios van entre paréntesis en ambos idiomas.
// ---------------------------------------------------------------------------

/** Idioma de la UI para los formatos compactos. */
export type FormatLanguage = 'es' | 'en';

const COP_LOCALE = 'es-CO';

const LOCALES: Record<FormatLanguage, string> = { es: COP_LOCALE, en: 'en-US' };

function localeOf(language: FormatLanguage | undefined): string {
  return LOCALES[language === 'en' ? 'en' : 'es'];
}

const INTEGER = new Intl.NumberFormat(COP_LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INTEGER_BY_LANG: Record<FormatLanguage, Intl.NumberFormat> = {
  es: INTEGER,
  en: new Intl.NumberFormat(LOCALES.en, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
};

/** Hasta un decimal (`1,5`, `108,8`, `3`, `4.000`; en inglés `1.5`, `4,000`). */
const UP_TO_ONE_DECIMAL_BY_LANG: Record<FormatLanguage, Intl.NumberFormat> = {
  es: new Intl.NumberFormat(COP_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
  en: new Intl.NumberFormat(LOCALES.en, { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
};

/** Envuelve un monto ya formateado según su signo (paréntesis NIIF). */
function withMoneySign(formatted: string, negative: boolean): string {
  return negative ? `(${formatted})` : formatted;
}

/**
 * `$1.234.567` (sin decimales); negativos entre paréntesis `($500.000)`.
 * Apto para tooltips y labels donde la precisión céntima distrae.
 */
export function formatCop(amount: number | null | undefined, language: FormatLanguage = 'es'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const rounded = Math.round(Math.abs(amount));
  // Un -0,4 redondea a $0: sin paréntesis (no hay monto negativo que mostrar).
  // Separadores del idioma de la interfaz (re-auditoría 2026-09-24, ICU-07).
  const integer = INTEGER_BY_LANG[language === 'en' ? 'en' : 'es'];
  return withMoneySign(`$${integer.format(rounded)}`, amount < 0 && rounded !== 0);
}

/** Escalas compactas por idioma, de menor a mayor. */
const COMPACT_SCALES_BY_LANG: Record<FormatLanguage, ReadonlyArray<{ factor: number; suffix: string }>> = {
  es: [
    { factor: 1_000, suffix: ' mil' },
    { factor: 1_000_000, suffix: ' M' },
    { factor: 1_000_000_000, suffix: ' mil M' },
  ],
  en: [
    { factor: 1_000, suffix: 'K' },
    { factor: 1_000_000, suffix: 'M' },
    { factor: 1_000_000_000, suffix: 'B' },
    { factor: 1_000_000_000_000, suffix: 'T' },
  ],
};

/** Redondea a un decimal (la precisión que imprime `UP_TO_ONE_DECIMAL_BY_LANG`). */
function roundOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * `$2,4 mil M` / `$345 M` / `$12,5 mil` / `$450` — para etiquetas de eje y
 * KPIs compactos. Negativos entre paréntesis: `($1,5 M)`. Con
 * `language = 'en'`: `$2.4B` / `$345M` / `$12.5K`.
 */
export function formatBigCop(
  amount: number | null | undefined,
  language: FormatLanguage = 'es',
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const lang: FormatLanguage = language === 'en' ? 'en' : 'es';
  const scales = COMPACT_SCALES_BY_LANG[lang];
  const abs = Math.abs(amount);

  let body: string;
  const units = Math.round(abs);
  if (units < 1_000) {
    body = `$${INTEGER_BY_LANG[lang].format(units)}`;
  } else {
    // Escala mayor cuyo factor no supera el monto; si el redondeo a un
    // decimal llega a 1.000 (p. ej. 999.960 → "1.000 mil") se promueve a la
    // escala siguiente ("$1 M").
    let idx = 0;
    for (let i = scales.length - 1; i >= 0; i--) {
      if (units >= scales[i].factor) {
        idx = i;
        break;
      }
    }
    let scaled = roundOneDecimal(abs / scales[idx].factor);
    if (scaled >= 1_000 && idx < scales.length - 1) {
      idx += 1;
      scaled = roundOneDecimal(abs / scales[idx].factor);
    }
    body = `$${UP_TO_ONE_DECIMAL_BY_LANG[lang].format(scaled)}${scales[idx].suffix}`;
  }
  return withMoneySign(body, amount < 0 && body !== '$0');
}

/**
 * Número con `digits` decimales fijos y signo `-` delante: `1,25` (es-CO) /
 * `1.25` (en). Sin "-0,00". Para razones y puntos porcentuales de la UI.
 */
export function formatDecimal(
  n: number | null | undefined,
  digits = 2,
  language: FormatLanguage = 'es',
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const fmt = new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const body = fmt.format(Math.abs(n));
  return `${n < 0 && body !== fmt.format(0) ? '-' : ''}${body}`;
}

/**
 * `15,6%` — formato de porcentaje es-CO. Acepta el valor como decimal (0.156).
 * Negativos con signo: `-4,1%`. Con `language = 'en'`: `15.6%`.
 */
export function formatPct(
  decimal: number | null | undefined,
  digits = 1,
  language: FormatLanguage = 'es',
): string {
  if (decimal === null || decimal === undefined || !Number.isFinite(decimal)) return '—';
  // Sin "-0,0%": formatDecimal no pone signo si el valor redondeado es cero.
  return `${formatDecimal(decimal * 100, digits, language)}%`;
}

/**
 * `12 meses` / `8 m` según `style`.
 */
export function formatMonths(n: number | null | undefined, style: 'long' | 'short' = 'long'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  if (style === 'short') return `${rounded} m`;
  return `${rounded} ${rounded === 1 ? 'mes' : 'meses'}`;
}

/**
 * `45 días` — lo mismo para días.
 */
export function formatDays(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n);
  return `${rounded} ${rounded === 1 ? 'día' : 'días'}`;
}
