// ---------------------------------------------------------------------------
// Precios de transferencia — cálculos deterministas (cero LLM)
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-09, -10, -17). El LLM producía:
//   - los umbrales de obligatoriedad con UVT 2026 fija para cualquier periodo
//     y los booleanos isObligated / *MeetsThreshold sin verificación;
//   - el rango intercuartil, «dentro del rango» y «CUMPLE», incluso con
//     comparables simulados;
//   - los topes de las sanciones del Art. 260-11 con cifras que no son las del
//     texto vigente.
// Este módulo recalcula todo eso en código y los agentes sobrescriben la
// salida del modelo DESPUÉS de la llamada.
//
// Fuentes (textos del corpus `src/data/tax_docs/`):
//   - Arts. 260-5 y 260-9 E.T.: patrimonio bruto al último día del año
//     gravable ≥ 100.000 UVT o ingresos brutos del respectivo año ≥ 61.000 UVT,
//     con operaciones con vinculados (Arts. 260-1 y 260-2).
//   - Art. 260-7 par. 2 E.T.: operaciones con jurisdicciones no cooperantes /
//     de baja o nula imposición → régimen de PT sin importar los topes.
//   - DUR 1625/2016 art. 1.2.2.2.5 (Decreto 3030/2013 art. 8): metodología
//     del rango intercuartil (posiciones e interpolación).
//   - Art. 260-11 E.T. (texto corregido por el Decreto 939 de 2017).
// ---------------------------------------------------------------------------

import { uvtToCopByYear } from '@/lib/accounting/tax-engine/constants';
import type {
  ComparableAnalysisReportJson,
  TpAnalysisReportJson,
} from '../../contracts/transfer-pricing';

// ---------------------------------------------------------------------------
// Año gravable y umbrales de obligatoriedad (Arts. 260-5 / 260-9)
// ---------------------------------------------------------------------------

export const TP_UMBRAL_PATRIMONIO_UVT = 100_000;
export const TP_UMBRAL_INGRESOS_UVT = 61_000;

/**
 * Año gravable a partir de la etiqueta del periodo ("2025", "AG 2025",
 * "2025-12"). Sin un año de cuatro dígitos se lanza un error explícito: los
 * umbrales dependen de la UVT del año gravable y no se sustituyen por otro.
 */
export function taxYearFromFiscalPeriod(fiscalPeriod: string | undefined | null): number {
  const m = /(19|20)\d{2}/.exec(fiscalPeriod ?? '');
  if (!m) {
    throw new Error(
      `Precios de transferencia: el periodo fiscal "${fiscalPeriod ?? ''}" no identifica el año gravable; los umbrales de los Arts. 260-5 y 260-9 E.T. se calculan con la UVT de ese año.`,
    );
  }
  return Number(m[0]);
}

export interface TpObligationThresholds {
  year: number;
  /** UVT oficial del año gravable (COP). */
  uvtCop: number;
  /** 100.000 UVT en centavos (string MoneyCop). */
  grossEquityThresholdCents: string;
  /** 61.000 UVT en centavos (string MoneyCop). */
  grossIncomeThresholdCents: string;
}

/** Lanza `RangeError` si la UVT del año no está registrada (tax-engine/constants). */
export function tpObligationThresholds(year: number): TpObligationThresholds {
  const uvtCop = uvtToCopByYear(1, year);
  return {
    year,
    uvtCop,
    grossEquityThresholdCents: (BigInt(uvtToCopByYear(TP_UMBRAL_PATRIMONIO_UVT, year)) * BigInt(100)).toString(),
    grossIncomeThresholdCents: (BigInt(uvtToCopByYear(TP_UMBRAL_INGRESOS_UVT, year)) * BigInt(100)).toString(),
  };
}

/**
 * Sobrescribe los umbrales y las conclusiones de obligatoriedad del LLM con el
 * cálculo determinista. Los montos de patrimonio e ingresos del contribuyente
 * son los que el modelo extrajo del texto de entrada (no hay balance
 * estructurado en esta ruta); la comparación y la conclusión se hacen aquí.
 */
export function enforceTpObligation(
  json: TpAnalysisReportJson,
  thresholds: TpObligationThresholds,
): TpAnalysisReportJson {
  const o = json.obligation;
  const equityMeets = BigInt(o.grossEquityCop) >= BigInt(thresholds.grossEquityThresholdCents);
  const incomeMeets = BigInt(o.grossIncomeCop) >= BigInt(thresholds.grossIncomeThresholdCents);
  const hasControlled = json.controlledTransactions.length > 0 || json.relatedParties.length > 0;
  const isObligated = (hasControlled && (equityMeets || incomeMeets)) || o.hasTaxHavenTransactions;
  const notes = [...json.technicalNotes];
  if (isObligated !== o.isObligated || equityMeets !== o.grossEquityMeetsThreshold || incomeMeets !== o.grossIncomeMeetsThreshold) {
    notes.push(
      `Obligatoriedad recalculada en código con la UVT ${thresholds.year} ($${thresholds.uvtCop.toLocaleString('es-CO')}); la conclusión del modelo no coincidía y se descartó.`,
    );
  }
  return {
    ...json,
    obligation: {
      ...o,
      grossEquityThresholdCop: thresholds.grossEquityThresholdCents,
      grossIncomeThresholdCop: thresholds.grossIncomeThresholdCents,
      grossEquityMeetsThreshold: equityMeets,
      grossIncomeMeetsThreshold: incomeMeets,
      isObligated,
    },
    technicalNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// Rango intercuartil — DUR 1625/2016 art. 1.2.2.2.5
// ---------------------------------------------------------------------------

export interface InterquartileStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** Valor en la posición (base 1) con interpolación lineal de la parte decimal. */
function valorEnPosicion(sorted: readonly number[], pos: number): number {
  const entero = Math.floor(pos);
  const decimal = pos - entero;
  const base = sorted[Math.min(Math.max(entero, 1), sorted.length) - 1];
  if (decimal === 0 || entero >= sorted.length) return base;
  const siguiente = sorted[entero];
  return base + decimal * (siguiente - base);
}

/**
 * Metodología del literal a) a h) del art. 1.2.2.2.5 DUR 1625/2016:
 *   mediana = posición (n + 1) / 2
 *   P25     = posición (mediana + 1) / 2
 *   P75     = posición (mediana − 1) + P25
 * con interpolación cuando la posición tiene decimales. `null` sin datos.
 */
export function interquartileRangeDur1625(values: readonly number[]): InterquartileStats | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const posMediana = (n + 1) / 2;
  const posP25 = (posMediana + 1) / 2;
  const posP75 = posMediana - 1 + posP25;
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return {
    n,
    min: r(sorted[0]),
    q1: r(valorEnPosicion(sorted, posP25)),
    median: r(valorEnPosicion(sorted, posMediana)),
    q3: r(valorEnPosicion(sorted, posP75)),
    max: r(sorted[n - 1]),
  };
}

export interface TpRangeCheck {
  stats: InterquartileStats | null;
  observedPliPercent: number | null;
  /** `null` = no determinable (sin comparables o sin PLI observado). */
  isWithinRange: boolean | null;
  /** Ajuste relativo a la mediana (pp). `null` si no determinable. */
  requiredAdjustmentPercent: number | null;
  simulatedCount: number;
  /** false ⇒ escenario ilustrativo: no se emite «CUMPLE» ni filas 1125 definitivas. */
  conclusive: boolean;
  /** Motivo en español cuando `conclusive === false` (lo lee también el prompt del Agente 3). */
  reason: string | null;
  /** El mismo motivo en inglés (informe con `language: 'en'`). */
  reasonEn: string | null;
}

/** Motivo del escenario ilustrativo en el idioma del informe; `null` si es concluyente. */
export function tpMotivoRango(check: TpRangeCheck, language: 'es' | 'en'): string | null {
  return language === 'en' ? check.reasonEn : check.reason;
}

export function computeTpRangeCheck(json: ComparableAnalysisReportJson): TpRangeCheck {
  const comparables = json.selectedComparables;
  const stats = interquartileRangeDur1625(comparables.map((c) => c.pliPercent));
  const observed = json.interquartileRange.observedPliPercent;
  const simulatedCount = comparables.filter((c) => c.isSimulated).length;
  let isWithinRange: boolean | null = null;
  let requiredAdjustmentPercent: number | null = null;
  if (stats && observed !== null && Number.isFinite(observed)) {
    isWithinRange = observed >= stats.q1 && observed <= stats.q3;
    requiredAdjustmentPercent = isWithinRange ? 0 : Math.round((stats.median - observed) * 100) / 100;
  }
  const motivos: string[] = [];
  const motivosEn: string[] = [];
  if (!stats) {
    motivos.push('no hay comparables seleccionados');
    motivosEn.push('no comparables were selected');
  }
  if (observed === null) {
    motivos.push('el PLI observado de la parte analizada no está determinado');
    motivosEn.push('the observed PLI of the tested party is not determined');
  }
  if (simulatedCount > 0) {
    motivos.push(`${simulatedCount} de ${comparables.length} comparables son simulados (sin base de datos verificable)`);
    motivosEn.push(`${simulatedCount} of ${comparables.length} comparables are simulated (no verifiable database)`);
  }
  return {
    stats,
    observedPliPercent: observed,
    isWithinRange,
    requiredAdjustmentPercent,
    simulatedCount,
    conclusive: motivos.length === 0,
    reason: motivos.length === 0 ? null : `Escenario ilustrativo, no concluyente: ${motivos.join('; ')}.`,
    reasonEn: motivosEn.length === 0 ? null : `Illustrative scenario, not conclusive: ${motivosEn.join('; ')}.`,
  };
}

/**
 * Motivo del ajuste en COP no determinable. El contrato no trae la base del
 * PLI en COP por operación (el denominador del indicador: costos, ventas o
 * activos de la parte analizada), así que (mediana − PLI observado) × base no
 * se puede calcular en código y la cifra del modelo no se publica (fase 2 de la
 * auditoría 2026-09-24, pendiente #8).
 */
export const TP_AJUSTE_COP_SIN_BASE_MOTIVO =
  'Ajuste en COP no determinable: el análisis no trae la base del PLI en COP por operación (denominador del indicador), por lo que (mediana − PLI observado) × base no se calcula en código. El ajuste porcentual a la mediana es el calculado; su valor en pesos requiere la base verificada.';

/** El mismo motivo para un informe en inglés. */
export const TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN =
  'COP adjustment not determinable: the analysis does not include the PLI base in COP per transaction (the denominator of the indicator), so (median − observed PLI) × base is not computed in code. The percentage adjustment to the median is the computed one; its peso amount requires the verified base.';

/** Motivo del ajuste en COP N/D en el idioma del informe. */
export function tpAjusteCopSinBaseMotivo(language: 'es' | 'en'): string {
  return language === 'en' ? TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN : TP_AJUSTE_COP_SIN_BASE_MOTIVO;
}

/** Ajuste en COP determinista: "0" dentro del rango; `null` en otro caso. */
export function tpAjusteCopDeterminista(check: TpRangeCheck): string | null {
  return check.isWithinRange === true ? '0' : null;
}

/**
 * Montos escritos por el modelo (es/en), con la moneda antes o después de la
 * cifra: `$…`, `COP …`, `USD …`, `EUR …`, `€…`, "… COP", "… pesos",
 * "… dólares", "… MM", "millones", "million". Sin la base del PLI ningún
 * monto de la nota lo calculó el código, esté en pesos o en otra moneda.
 */
const MONTO_EN_NOTA =
  /(?:\$|€|\bCOP|\bUSD|\bEUR)\s?\d|\d\s?(?:COP|USD|EUR|pesos|d[oó]lares|dollars|euros?|MM|millones|mil\s+millones|million|billion)\b/i;

/**
 * Nota del modelo con montos en pesos ⇒ se sustituye por el motivo (en el
 * idioma del informe) cuando el ajuste es N/D.
 */
export function notaSinMontosDelModelo(
  nota: string | null,
  ajusteCop: string | null,
  language: 'es' | 'en' = 'es',
): string | null {
  if (ajusteCop !== null) return nota;
  const motivo = tpAjusteCopSinBaseMotivo(language);
  if (nota === null) return motivo;
  return MONTO_EN_NOTA.test(nota) ? motivo : nota;
}

/**
 * La frase habla del ajuste de precios de transferencia o de su impacto
 * fiscal (es/en). Un monto en una frase así lo escribió el modelo: sin la base
 * del PLI en COP el código no calcula el ajuste.
 */
const MENCIONA_AJUSTE =
  /\bajust|\badjust|mayor\s+(?:renta|impuesto)|impuesto\s+adicional|additional\s+(?:tax|taxable|income)|impacto\s+fiscal|tax\s+impact|renta\s+gravable\s+adicional/i;

/** Abreviaturas que preceden a un número o a un nombre («Art. 260», «No. 5»). */
const ABREVIATURA_ANTES_DE = /\b(?:Arts?|par|num|núm|lit|inc|No|Nro|Dr|Sr|Sra|pp|p|vs)$/i;

/**
 * Un punto cierra la frase si le sigue espacio y luego fin de texto o una
 * mayúscula / signo de apertura, y no es una abreviatura que precede a un
 * número o nombre. «E.T. La…» cierra; «Art. 260-4», «E.T. y …» y «1.234» no.
 */
function puntoCierraFrase(texto: string, i: number): boolean {
  if (!/\s/.test(texto[i + 1] ?? ' ')) return false;
  const siguiente = texto.slice(i + 1).match(/\S/)?.[0];
  if (siguiente === undefined) return true;
  if (!/[A-ZÁÉÍÓÚÑ¿¡("«“]/.test(siguiente)) return false;
  return !ABREVIATURA_ANTES_DE.test(texto.slice(Math.max(0, i - 6), i));
}

/**
 * Parte el texto en frases conservando separadores y espacios, de modo que
 * unir los trozos reproduce el texto. Corta tras «! ? ;» seguidos de espacio,
 * tras el punto que cierra frase (`puntoCierraFrase`) y en cada salto de línea.
 */
function trocearFrases(texto: string): string[] {
  const trozos: string[] = [];
  let ini = 0;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    let corte = ch === '\n';
    if (!corte && /[!?;]/.test(ch)) corte = /\s/.test(texto[i + 1] ?? ' ');
    if (!corte && ch === '.') corte = puntoCierraFrase(texto, i);
    if (!corte) continue;
    let fin = i + 1;
    while (fin < texto.length && /[ \t]/.test(texto[fin])) fin++;
    trozos.push(texto.slice(ini, fin));
    ini = fin;
    i = fin - 1;
  }
  if (ini < texto.length) trozos.push(texto.slice(ini));
  return trozos;
}

/**
 * Texto libre del modelo con el ajuste en COP N/D (I4-escudo 7): retira cada
 * frase que menciona el ajuste o su impacto fiscal CON un monto y añade una
 * sola vez el motivo en el idioma del informe. El resto del texto —incluidos
 * los montos de las operaciones, que no son el ajuste— se conserva. Con el
 * ajuste determinista ("0") el texto no se toca. Idempotente.
 */
export function textoSinMontosDeAjuste(
  texto: string,
  ajusteCop: string | null,
  language: 'es' | 'en' = 'es',
): string {
  if (ajusteCop !== null || !texto) return texto;
  const trozos = trocearFrases(texto);
  const conservados = trozos.filter((t) => !(MONTO_EN_NOTA.test(t) && MENCIONA_AJUSTE.test(t)));
  if (conservados.length === trozos.length) return texto;
  const motivo = tpAjusteCopSinBaseMotivo(language);
  const base = conservados.join('').trim();
  if (!base) return motivo;
  return base.includes(motivo) ? base : `${base} ${motivo}`;
}

/** Lista de textos libres: filtra cada uno y deja el motivo una sola vez. */
export function textosSinMontosDeAjuste(
  textos: readonly string[],
  ajusteCop: string | null,
  language: 'es' | 'en' = 'es',
): string[] {
  if (ajusteCop !== null) return [...textos];
  const motivo = tpAjusteCopSinBaseMotivo(language);
  const out: string[] = [];
  for (const t of textos) {
    const limpio = textoSinMontosDeAjuste(t, ajusteCop, language);
    if (limpio === motivo && out.includes(motivo)) continue;
    out.push(limpio);
  }
  return out;
}

/**
 * Sobrescribe `interquartileRange` y `armLengthConclusion` con el cálculo
 * determinista. El ajuste en COP sólo es determinable dentro del rango ("0");
 * fuera de él no hay base del PLI en COP en el contrato ⇒ null con motivo, y
 * los textos libres del modelo sobre el ajuste (nota de impacto, `rationale`
 * y notas técnicas) no publican montos que el código no calculó.
 */
export function enforceComparableAnalysis(
  json: ComparableAnalysisReportJson,
  check: TpRangeCheck,
  language: 'es' | 'en' = 'es',
): ComparableAnalysisReportJson {
  const s = check.stats;
  const complies = check.conclusive && check.isWithinRange === true;
  const ajusteCop = tpAjusteCopDeterminista(check);
  return {
    ...json,
    interquartileRange: {
      ...json.interquartileRange,
      min: s?.min ?? 0,
      q1: s?.q1 ?? 0,
      median: s?.median ?? 0,
      q3: s?.q3 ?? 0,
      max: s?.max ?? 0,
      isWithinRange: check.isWithinRange === true,
    },
    armLengthConclusion: {
      ...json.armLengthConclusion,
      complies,
      requiredAdjustmentPercent: check.requiredAdjustmentPercent,
      requiredAdjustmentCop: ajusteCop,
      taxImpactNote: notaSinMontosDelModelo(json.armLengthConclusion.taxImpactNote, ajusteCop, language),
      rationale: textoSinMontosDeAjuste(json.armLengthConclusion.rationale, ajusteCop, language),
    },
    technicalNotes: textosSinMontosDeAjuste(json.technicalNotes, ajusteCop, language),
  };
}
