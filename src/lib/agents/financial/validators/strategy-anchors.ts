// ---------------------------------------------------------------------------
// Validación determinista del Director de Estrategia (Parte II)
// ---------------------------------------------------------------------------
// pipeline-flujo-05: runStrategyPhase devolvía el JSON del Director de
// Estrategia tal cual. 'Total Activo', 'Utilidad Neta', ROE, AC/PC del gate de
// liquidez… no se cruzaban contra nada aunque el preprocesador SÍ tiene ancla
// para ellos, y la coherencia ROE KPI = DuPont (spec v2.1, Corrección 3) se
// dejaba al propio modelo. Esas cifras llegan al visor, al Excel, al PDF y al
// HTML.
//
// Este módulo cruza, con tolerancia exacta, SÓLO lo que se puede recomputar
// desde fuentes deterministas:
//   - Filas del dashboard con rubro anclado → centavos exactos contra las
//     anclas del preprocesado (o, sin él, contra los totales del JSON NIIF ya
//     validado).
//   - KPIs con valor precalculado por el preprocesador (los mismos que el
//     bloque TOTALES VINCULANTES le ordena citar literalmente) → iguales al
//     valor anclado redondeado a la precisión que el propio modelo imprimió.
//   - DuPont → ROE, margen neto, rotación y apalancamiento anclados, y ROE de
//     DuPont == ROE del KPI.
//   - Gate de liquidez → AC y PC en centavos exactos, brecha = AC − PC y
//     `triggered` == (AC < PC).
//   - Cifras comparativas o tendencias sin periodo comparativo → error.
// Todo lo demás (punto de equilibrio, proyecciones, KPIs sin ancla) se declara
// NO VERIFICABLE — nunca se inventa un valor de referencia.
//
// No duplica fórmulas: los KPIs se contrastan con los valores que publica el
// preprocesador (`controlTotals`), y los rubros con `buildPeriodAnchors`.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { pesosToCents } from '@/lib/preprocessing/curator-rules/sync-control-totals';
import { computeEbitdaMargin, type EbitdaResult } from '@/lib/pillars/ebitda';
import { buildPeriodAnchors } from '../contracts/anchors';
import { formatCopFromCents } from '../contracts/money';
import type { NiifReportJson } from '../contracts/niif-report';
import type { KpiJson, StrategyReportJson } from '../contracts/strategy-report';
import type { StrategicAnalysisResult, StrategyQualifications } from '../types';
import { checkStrategyNarrative } from './narrative-anchors';

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export interface StrategyAnchorSources {
  /** Snapshot del periodo que se firma (preprocesado). */
  primary?: PeriodSnapshot | null;
  /** Snapshot comparativo (preprocesado). `null` = no hay comparativo. */
  comparative?: PeriodSnapshot | null;
  /** JSON NIIF — anclas de respaldo cuando no hay preprocesado. */
  niif?: NiifReportJson | null;
}

export interface StrategyAnchorCheck {
  /** Cifras ancladas que no coinciden: sellan la Parte II. */
  deviations: string[];
  /** Cifras sin ancla determinista: se declaran, no se validan. */
  unverifiable: string[];
  /** Número de cifras efectivamente cruzadas contra un ancla. */
  verifiedCount: number;
}

/**
 * Veredicto que viaja con el resultado de Estrategia. El tipo vive en
 * `types.ts` (campo `StrategicAnalysisResult.strategyQualifications`) para que
 * la UI y los exportadores lo consuman tipado; se re-exporta aquí por
 * compatibilidad.
 */
export type { StrategyQualifications };

/** Alias histórico: `StrategicAnalysisResult` ya declara `strategyQualifications`. */
export type QualifiedStrategicAnalysisResult = StrategicAnalysisResult;

/**
 * Fuentes de anclas desde el preprocesado (y el JSON NIIF de respaldo). Un
 * comparativo impracticable (§3.14/§10.21) cuenta como AUSENTE: el reporte es
 * LINEA_BASE (`deriveReportMode`) y no presenta cifras comparativas.
 */
export function strategyAnchorSources(
  preprocessed: PreprocessedBalance | undefined,
  niif: NiifReportJson | null | undefined,
): StrategyAnchorSources {
  if (!preprocessed) return { niif: niif ?? null };
  return {
    primary: preprocessed.primary,
    comparative:
      preprocessed.comparativos_impracticables === true ? null : (preprocessed.comparative ?? null),
    niif: niif ?? null,
  };
}

/** Lectura defensiva del veredicto desde un payload que viajó por JSON. */
export function readStrategyQualifications(strategic: unknown): StrategyQualifications | undefined {
  if (!strategic || typeof strategic !== 'object') return undefined;
  const q = (strategic as { strategyQualifications?: unknown }).strategyQualifications;
  if (!q || typeof q !== 'object') return undefined;
  const { clean, motivos, noVerificables } = q as Partial<StrategyQualifications>;
  if (typeof clean !== 'boolean') return undefined;
  return {
    clean,
    motivos: Array.isArray(motivos) ? motivos.filter((m): m is string => typeof m === 'string') : [],
    noVerificables: Array.isArray(noVerificables)
      ? noVerificables.filter((m): m is string => typeof m === 'string')
      : [],
  };
}

// ---------------------------------------------------------------------------
// Sello y nota de verificación de la Parte II (texto del entregable)
// ---------------------------------------------------------------------------
// Mismo texto que `qualifyStrategyResult` (orchestrator.ts) escribe en el
// cuerpo de la Parte II: el servidor lo reconstruye desde su propio cruce al
// re-renderizar el Markdown desde el JSON (src/lib/reports/part-markdown.ts).
// Una prueba de paridad fija que la fase y el re-render coinciden
// (src/lib/reports/__tests__/part-markdown.test.ts).
// ---------------------------------------------------------------------------

/** Sello "CON SALVEDADES" que encabeza la Parte II cuando su veredicto no es limpio. */
export function buildStrategyQualificationSeal(motivos: readonly string[], language: 'es' | 'en' = 'es'): string {
  const es = language === 'es';
  return [
    es
      ? '> ## ANÁLISIS ESTRATÉGICO CON SALVEDADES — CIFRAS SIN RESPALDO'
      : '> ## STRATEGIC ANALYSIS WITH QUALIFICATIONS — UNSUPPORTED FIGURES',
    '>',
    es
      ? '> Cifras de la Parte II no coinciden con el balance preprocesado. Esta sección NO es emitible tal como está:'
      : '> Part II figures do not match the preprocessed trial balance. This section is NOT issuable as is:',
    '>',
    ...motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
}

/** Nota final "Verificación determinista de la Parte II" (cifras cruzadas y no verificables). */
export function buildStrategyVerificationNote(
  verifiedCount: number,
  noVerificables: readonly string[],
  language: 'es' | 'en' = 'es',
): string {
  const es = language === 'es';
  const MAX = 12;
  const shown = noVerificables.slice(0, MAX);
  const rest = noVerificables.length - shown.length;
  return [
    '',
    es ? '### Verificación determinista de la Parte II' : '### Deterministic verification of Part II',
    es
      ? `- Cifras cruzadas contra el balance preprocesado: ${verifiedCount}.`
      : `- Figures cross-checked against the preprocessed trial balance: ${verifiedCount}.`,
    (es
      ? '- No verificables contra anclas deterministas (estimaciones del modelo, no cifras del balance): '
      : '- Not verifiable against deterministic anchors (model estimates, not trial-balance figures): ') +
      shown.join('; ') +
      (rest > 0 ? (es ? `; y ${rest} más.` : `; and ${rest} more.`) : '.'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Anclas monetarias por periodo
// ---------------------------------------------------------------------------

type MoneyKey =
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'activoCorriente'
  | 'pasivoCorriente'
  | 'ingresos'
  | 'ingresosNetos'
  | 'ingresosOperacionales'
  | 'utilidadBruta'
  | 'ebit'
  | 'utilidadAntesImpuestos'
  | 'utilidadNeta'
  | 'efectivoCuenta11'
  | 'ebitda';

type MoneyAnchors = Partial<Record<MoneyKey, bigint>>;

const MONEY_RE = /^-?\d+$/;

function moneyOrUndefined(v: string | null | undefined): bigint | undefined {
  return typeof v === 'string' && MONEY_RE.test(v) ? BigInt(v) : undefined;
}

function anchorsFromSnapshot(snapshot: PeriodSnapshot | null | undefined): MoneyAnchors {
  const out: MoneyAnchors = {};
  const period = buildPeriodAnchors(snapshot ?? undefined);
  if (period) {
    for (const key of [
      'activo',
      'pasivo',
      'patrimonio',
      'ingresos',
      'ingresosNetos',
      'ingresosOperacionales',
      'utilidadBruta',
      'ebit',
      'utilidadAntesImpuestos',
      'utilidadNeta',
      'efectivoCuenta11',
    ] as const) {
      const v = period.cents[key];
      if (typeof v === 'bigint') out[key] = v;
    }
  }
  const ct = snapshot?.controlTotals;
  // Mismo redondeo al centavo que el token `[MoneyCop: N]` del bloque vinculante.
  if (typeof ct?.activoCorriente === 'number') out.activoCorriente = pesosToCents(ct.activoCorriente);
  if (typeof ct?.pasivoCorriente === 'number') out.pasivoCorriente = pesosToCents(ct.pasivoCorriente);
  // EBITDA con la definición única (computeEbitda) que publica TOTALES
  // VINCULANTES (W3-A, ratios-kpis-05): desde entonces es cifra anclada.
  if (typeof ct?.ebitda === 'number' && Number.isFinite(ct.ebitda)) out.ebitda = pesosToCents(ct.ebitda);
  return out;
}

/** Claves que el preprocesador publica N/D (valor `null` con motivo). */
function ndMoneyKeys(snapshot: PeriodSnapshot | null | undefined): Set<MoneyKey> {
  const out = new Set<MoneyKey>();
  if (snapshot?.controlTotals && snapshot.controlTotals.ebitda === null) out.add('ebitda');
  return out;
}

function anchorsFromNiif(niif: NiifReportJson | null | undefined, period: 'primary' | 'comparative'): MoneyAnchors {
  if (!niif) return {};
  const b = niif.balanceSheet;
  const p = niif.incomeStatement;
  if (period === 'primary') {
    return {
      activo: moneyOrUndefined(b?.totalAssetsPrimary),
      pasivo: moneyOrUndefined(b?.totalLiabilitiesPrimary),
      patrimonio: moneyOrUndefined(b?.totalEquityPrimary),
      utilidadBruta: moneyOrUndefined(p?.grossProfitPrimary),
      ebit: moneyOrUndefined(p?.operatingProfitPrimary),
      utilidadNeta: moneyOrUndefined(p?.netIncomePrimary),
      efectivoCuenta11: moneyOrUndefined(niif.cashFlow?.cashClosing),
    };
  }
  return {
    activo: moneyOrUndefined(b?.totalAssetsComparative),
    pasivo: moneyOrUndefined(b?.totalLiabilitiesComparative),
    patrimonio: moneyOrUndefined(b?.totalEquityComparative),
    utilidadBruta: moneyOrUndefined(p?.grossProfitComparative),
    ebit: moneyOrUndefined(p?.operatingProfitComparative),
    utilidadNeta: moneyOrUndefined(p?.netIncomeComparative),
  };
}

/** El preprocesado manda; el JSON NIIF sólo cubre las claves que falten. */
function mergeAnchors(preferred: MoneyAnchors, fallback: MoneyAnchors): MoneyAnchors {
  const out: MoneyAnchors = { ...fallback };
  for (const [k, v] of Object.entries(preferred) as Array<[MoneyKey, bigint | undefined]>) {
    if (typeof v === 'bigint') out[k] = v;
  }
  for (const k of Object.keys(out) as MoneyKey[]) {
    if (typeof out[k] !== 'bigint') delete out[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rótulos → anclas
// ---------------------------------------------------------------------------

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    // "MARGEN_OPERATIVO" / "MARGEN_NETO" son los nombres que el propio prompt
    // del Director pide para los KPIs anclados: el guion bajo es un espacio.
    .replace(/[:.;,_]/g, ' ')
    // e2e-niif-14: "Utilidad neta 2025" es el mismo rubro que "Utilidad neta";
    // el año del rótulo no lo saca del ancla.
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DASHBOARD_ANCHORS: ReadonlyArray<{ keys: MoneyKey[]; re: RegExp }> = [
  { keys: ['activoCorriente'], re: /^(total )?activos? corrientes?$/ },
  { keys: ['pasivoCorriente'], re: /^(total )?pasivos? corrientes?$/ },
  { keys: ['activo'], re: /^(total )?activos?( totale?s?)?$/ },
  { keys: ['pasivo'], re: /^(total )?pasivos?( totale?s?)?$/ },
  { keys: ['patrimonio'], re: /^(total )?patrimonio( total)?$/ },
  // Ingresos (re-auditoría fase 2, narrativa-14): "Ingresos operacionales" o
  // "Ventas netas" quedaban sin ancla y una cifra inventada salía "no
  // verificable" (la misma cifra en prosa sí sellaba). Se aceptan los tres
  // perímetros que publica el preprocesador —operacionales netos (41 − 4175),
  // netos y brutos de Clase 4—, igual que la prosa: vale cualquiera, así que el
  // perímetro que el modelo eligió no produce un falso sello. "Ventas brutas"
  // (41 antes de devoluciones) no es ninguno de ellos y sigue sin ancla.
  {
    keys: ['ingresosOperacionales', 'ingresosNetos', 'ingresos'],
    re: /^(total )?(ingresos|ventas)( (operacionales|ordinarios|de actividades ordinarias))?( netos| netas| totales)?$/,
  },
  { keys: ['utilidadBruta'], re: /^(utilidad|ganancia) bruta$/ },
  { keys: ['ebit'], re: /^((utilidad|ganancia|resultado) (operacional|operativa|operativo)|ebit)$/ },
  { keys: ['utilidadAntesImpuestos'], re: /^(utilidad|ganancia|resultado) antes de impuestos?$/ },
  {
    keys: ['utilidadNeta'],
    // "Utilidad neta", "Pérdida neta del periodo", "Utilidad del ejercicio",
    // "Resultado del ejercicio" (e2e-niif-14).
    re: /^(utilidad|ganancia|resultado|perdida) (net[ao]( del (ejercicio|periodo))?|del (ejercicio|periodo))$/,
  },
  { keys: ['efectivoCuenta11'], re: /^(efectivo|caja)( y equivalentes( (al|de) efectivo)?)?( al cierre)?$/ },
  { keys: ['ebitda'], re: /^ebitda( del (ejercicio|periodo))?$/ },
];

type KpiField =
  | 'roe'
  | 'roa'
  | 'razonCorriente'
  | 'pruebaAcida'
  | 'endeudamientoTotal'
  | 'apalancamientoFinanciero'
  | 'coberturaIntereses'
  | 'margenNeto'
  | 'margenOperativo'
  | 'rotacionActivos'
  | 'diasCartera'
  | 'diasInventario'
  | 'diasProveedores'
  | 'margenEbitda';

const KPI_ANCHORS: ReadonlyArray<{ field: KpiField; re: RegExp }> = [
  {
    field: 'roe',
    re: /^roe( dinamico| anualizado)?$|^(rentabilidad|retorno) (del |sobre (el )?)?patrimonio( neto)?$/,
  },
  { field: 'roa', re: /^roa$|^rentabilidad (sobre (el |los )?)?activos?$/ },
  { field: 'razonCorriente', re: /^razon corriente$|^liquidez corriente$/ },
  { field: 'pruebaAcida', re: /^prueba acida$/ },
  { field: 'endeudamientoTotal', re: /^(nivel de )?endeudamiento( total)?$/ },
  { field: 'apalancamientoFinanciero', re: /^apalancamiento financiero$/ },
  { field: 'coberturaIntereses', re: /^cobertura de intereses$/ },
  { field: 'margenNeto', re: /^margen neto$/ },
  { field: 'margenOperativo', re: /^margen (operacional|operativo)$/ },
  { field: 'rotacionActivos', re: /^rotacion (de )?(los )?activos?( totales)?$/ },
  { field: 'diasCartera', re: /^dias (de )?cartera$/ },
  { field: 'diasInventario', re: /^dias (de )?inventarios?$/ },
  { field: 'diasProveedores', re: /^dias (de )?proveedores$/ },
  { field: 'margenEbitda', re: /^margen( de)? ebitda$/ },
];

function kpiFieldOf(name: string): KpiField | null {
  const n = normalizeLabel(name);
  return KPI_ANCHORS.find((k) => k.re.test(n))?.field ?? null;
}

/**
 * KPIs que el preprocesador publica en TOTALES VINCULANTES pero que no
 * estaban en `KPI_ANCHORS`: se recomputan desde `controlTotals` y se
 * sobrescriben (pendiente #2 de la auditoría integral 2026-09-24). El
 * validador los cruza igual que a los demás.
 */
type RecomputedField = 'margenBruto' | 'cicloConversionEfectivo' | 'capitalTrabajo';

const RECOMPUTED_KPIS: ReadonlyArray<{
  field: RecomputedField;
  re: RegExp;
  unit: KpiJson['unit'];
  formula: { es: string; en: string };
}> = [
  {
    field: 'margenBruto',
    re: /^margen (bruto|de utilidad bruta)$/,
    unit: 'percent',
    formula: {
      es: 'Utilidad bruta / Ingresos operacionales netos (41 − 4175) × 100 — calculado por el sistema',
      en: 'Gross profit / Net operating revenue (41 − 4175) × 100 — computed by the system',
    },
  },
  {
    field: 'cicloConversionEfectivo',
    re: /^ciclo (de )?(conversion (del? )?efectivo|caja|efectivo)$/,
    unit: 'days',
    formula: {
      es: 'Días de cartera + días de inventario − días de proveedores — calculado por el sistema',
      en: 'Receivable days + inventory days − payable days — computed by the system',
    },
  },
  {
    field: 'capitalTrabajo',
    re: /^capital (de )?trabajo( neto)?$/,
    unit: 'cop',
    formula: {
      es: 'Activo corriente − Pasivo corriente — calculado por el sistema',
      en: 'Current assets − Current liabilities — computed by the system',
    },
  },
];

function recomputedOf(name: string): (typeof RECOMPUTED_KPIS)[number] | null {
  const n = normalizeLabel(name);
  return RECOMPUTED_KPIS.find((k) => k.re.test(n)) ?? null;
}

/** Valor recomputable: `undefined` = sin campo; `null` = N/D publicado. */
function recomputedValue(snapshot: PeriodSnapshot | null | undefined, field: RecomputedField): number | null | undefined {
  const ct = snapshot?.controlTotals as unknown as Record<string, unknown> | undefined;
  if (!ct || !(field in ct)) return undefined;
  const v = ct[field];
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function kpiValue(snapshot: PeriodSnapshot | null | undefined, field: KpiField): number | null | undefined {
  const ct = snapshot?.controlTotals as unknown as Record<string, unknown> | undefined;
  if (!ct) return undefined;
  if (field === 'margenEbitda') {
    // Definición única (pillars/ebitda.ts): EBITDA / ingresos operacionales netos.
    if (!('ebitda' in ct)) return undefined;
    const ebitda = typeof ct.ebitda === 'number' ? ct.ebitda : null;
    const ion = typeof ct.ingresosOperacionalesNetos === 'number' ? ct.ingresosOperacionalesNetos : null;
    const m = computeEbitdaMargin({ ebitda, ingresosOperacionalesNetos: ion } as EbitdaResult);
    return m === null ? null : m * 100;
  }
  const v = ct[field];
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// Números impresos por el modelo
// ---------------------------------------------------------------------------

interface PrintedNumber {
  value: number;
  decimals: number;
}

/**
 * Interpretaciones posibles de un número impreso ("1,33", "45,0%", "1.234,5",
 * "1.33"). Un "1.234" es ambiguo (miles o decimal): se devuelven ambas
 * lecturas y basta con que una coincida — el validador nunca acusa por una
 * ambigüedad de formato.
 */
function parsePrinted(raw: string): PrintedNumber[] {
  const cleaned = raw
    .replace(/[%\s$]/g, '')
    .replace(/(veces|dias|días|x)$/i, '')
    .replace(/^\+/, '')
    .replace(/−/g, '-');
  if (!/^-?[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return [];
  const out: PrintedNumber[] = [];
  const push = (normalized: string) => {
    const value = Number(normalized);
    if (!Number.isFinite(value)) return;
    const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
    if (!out.some((o) => o.value === value && o.decimals === decimals)) out.push({ value, decimals });
  };
  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  if (hasDot && hasComma) {
    // El último separador es el decimal.
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) push(cleaned.replace(/\./g, '').replace(',', '.'));
    else push(cleaned.replace(/,/g, ''));
  } else if (hasComma) {
    if ((cleaned.match(/,/g) ?? []).length === 1) push(cleaned.replace(',', '.'));
    if (/^-?\d{1,3}(,\d{3})+$/.test(cleaned)) push(cleaned.replace(/,/g, ''));
  } else if (hasDot) {
    if ((cleaned.match(/\./g) ?? []).length === 1) push(cleaned);
    if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) push(cleaned.replace(/\./g, ''));
  } else {
    push(cleaned);
  }
  return out;
}

/** El número impreso es el valor anclado redondeado a la precisión impresa. */
function matchesAtPrintedPrecision(printed: PrintedNumber[], expected: number): boolean {
  return printed.some((p) => {
    const tolerance = 0.5 * 10 ** -p.decimals;
    return Math.abs(p.value - expected) <= tolerance + 1e-9 * Math.max(1, Math.abs(expected));
  });
}

function isNd(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^n\/?d$/i.test(v.trim());
}

function fmtNumber(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 4 });
}

function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')} %`;
}

/**
 * Una variación impresa ("12,5", "+13,3 pp", "-20,0 %", "66,7%") contra los
 * valores admitidos, a la precisión impresa. Sin signo explícito se compara la
 * magnitud: "20,0" en la columna de variación de una disminución no afirma un
 * aumento. `null` = cuadra; 'base' = no hay valor admitido (base cero o N/D);
 * 'mismatch' = no cuadra con ninguno; 'unparsable' = no es un número.
 */
function variationIssue(printedRaw: string, expected: number[]): null | 'base' | 'mismatch' | 'unparsable' {
  const raw = printedRaw
    .trim()
    .replace(/\s*(?:p\.\s?p\.?|pp|puntos(?:\s+porcentuales)?|pts?\.?)\s*$/i, '')
    .trim();
  const printed = parsePrinted(raw);
  if (printed.length === 0) return 'unparsable';
  if (expected.length === 0) return 'base';
  const signed = /^[+\-−]/.test(raw);
  const ok = expected.some((e) =>
    printed.some((p) => {
      const tolerance = 0.5 * 10 ** -p.decimals + 1e-9 * Math.max(1, Math.abs(e));
      return signed ? Math.abs(p.value - e) <= tolerance : Math.abs(Math.abs(p.value) - Math.abs(e)) <= tolerance;
    }),
  );
  return ok ? null : 'mismatch';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function reconcileStrategyAnchors(
  json: StrategyReportJson,
  sources: StrategyAnchorSources,
  language: 'es' | 'en' = 'es',
): StrategyAnchorCheck {
  const es = language === 'es';
  const t = (spanish: string, english: string) => (es ? spanish : english);
  const deviations: string[] = [];
  const unverifiable: string[] = [];
  let verifiedCount = 0;

  const hasPreprocessed = !!sources.primary;
  const primaryAnchors = mergeAnchors(anchorsFromSnapshot(sources.primary), anchorsFromNiif(sources.niif, 'primary'));
  const comparativeAnchors = mergeAnchors(
    anchorsFromSnapshot(sources.comparative),
    hasPreprocessed ? {} : anchorsFromNiif(sources.niif, 'comparative'),
  );
  // ¿Hay periodo comparativo? El preprocesado lo decide; sin él, el JSON NIIF
  // (cuyo `comparativePeriod` fija el orquestador). Sin ninguna fuente: se
  // desconoce y no se acusa.
  const hasComparative: boolean | undefined = hasPreprocessed
    ? !!sources.comparative
    : sources.niif
      ? sources.niif.company?.comparativePeriod !== null
      : undefined;

  const ndPrimary = ndMoneyKeys(sources.primary);
  const ndComparative = ndMoneyKeys(sources.comparative);
  const money = (cents: bigint) => formatCopFromCents(cents);
  const checkMoney = (
    where: string,
    emitted: string | null | undefined,
    anchors: MoneyAnchors,
    keys: MoneyKey[],
    nd: Set<MoneyKey> = ndPrimary,
  ): void => {
    const e = moneyOrUndefined(emitted ?? undefined);
    if (e === undefined) return;
    const available = keys.map((k) => anchors[k]).filter((v): v is bigint => typeof v === 'bigint');
    if (available.length === 0) {
      if (keys.some((k) => nd.has(k))) {
        // El preprocesador publica N/D (p. ej. EBITDA sin base): una cifra ahí
        // no tiene respaldo.
        verifiedCount += 1;
        deviations.push(
          t(
            `${where}: el Director de Estrategia emitió ${money(e)} pero el preprocesador lo marca N/D (sin base verificable).`,
            `${where}: the Strategy Director emitted ${money(e)} but the preprocessor marks it N/A (no verifiable base).`,
          ),
        );
        return;
      }
      unverifiable.push(where);
      return;
    }
    verifiedCount += 1;
    if (!available.some((a) => a === e)) {
      deviations.push(
        t(
          `${where}: el Director de Estrategia emitió ${money(e)} frente a ${money(available[0])} del balance (diferencia ${money(e - available[0])}).`,
          `${where}: the Strategy Director emitted ${money(e)} versus ${money(available[0])} from the trial balance (difference ${money(e - available[0])}).`,
        ),
      );
    }
  };

  // -- Dashboard ejecutivo -------------------------------------------------
  for (const row of json.executiveDashboard?.rows ?? []) {
    const label = normalizeLabel(row.label);
    const mapping = DASHBOARD_ANCHORS.find((m) => m.re.test(label));
    const where = t(`Dashboard — ${row.label}`, `Dashboard — ${row.label}`);

    const hasComparativeFigures =
      row.comparative !== null ||
      row.variation !== null ||
      (row.variationPct !== null && !isNd(row.variationPct));
    if (hasComparative === false && hasComparativeFigures) {
      deviations.push(
        t(
          `${where}: presenta cifra comparativa o variación sin periodo comparativo en el balance.`,
          `${where}: shows a comparative figure or variation without a comparative period in the trial balance.`,
        ),
      );
    }

    if (mapping) {
      checkMoney(where, row.primary, primaryAnchors, mapping.keys);
      if (hasComparative !== false && row.comparative !== null) {
        checkMoney(
          `${where} (${t('comparativo', 'comparative')})`,
          row.comparative,
          comparativeAnchors,
          mapping.keys,
          ndComparative,
        );
      }
    } else {
      unverifiable.push(where);
    }

    // Aritmética interna: variación = actual − comparativo, al centavo.
    const p = moneyOrUndefined(row.primary);
    const c = moneyOrUndefined(row.comparative);
    const v = moneyOrUndefined(row.variation);
    if (p !== undefined && c !== undefined && v !== undefined && v !== p - c) {
      deviations.push(
        t(
          `${where}: la variación ${money(v)} no es actual − comparativo (${money(p - c)}).`,
          `${where}: variation ${money(v)} is not current − comparative (${money(p - c)}).`,
        ),
      );
    }
    // Variación % = (actual − comparativo) / |comparativo| × 100, a la precisión
    // impresa (narrativa-14: "87,5" por 12,5 salía verificado).
    if (p !== undefined && c !== undefined && row.variationPct !== null && !isNd(row.variationPct)) {
      const issue = variationIssue(row.variationPct, c === BigInt(0) ? [] : [(Number(p - c) / Number(c < BigInt(0) ? -c : c)) * 100]);
      if (issue === 'base') {
        verifiedCount += 1;
        deviations.push(
          t(
            `${where}: la variación % ${row.variationPct} no tiene base (comparativo cero).`,
            `${where}: the % change ${row.variationPct} has no base (zero comparative).`,
          ),
        );
      } else if (issue === 'mismatch') {
        verifiedCount += 1;
        const expected = (Number(p - c) / Number(c < BigInt(0) ? -c : c)) * 100;
        deviations.push(
          t(
            `${where}: la variación % ${row.variationPct} no es (actual − comparativo) / |comparativo| (${fmtPct(expected)}).`,
            `${where}: the % change ${row.variationPct} is not (current − comparative) / |comparative| (${fmtPct(expected)}).`,
          ),
        );
      } else if (issue === null) {
        verifiedCount += 1;
      }
    }
  }

  /**
   * Un indicador impreso contra el valor que publica el preprocesador, a la
   * precisión que el propio modelo imprimió. `expected === null` significa que
   * el preprocesador lo marca N/D: un número impreso ahí es una cifra sin base.
   */
  const checkRatio = (where: string, printedRaw: string, expected: number | null | undefined, suffix = ''): void => {
    if (expected === undefined) {
      unverifiable.push(where);
      return;
    }
    if (isNd(printedRaw)) {
      // Más conservador que el ancla: no se acusa, pero tampoco se verifica.
      if (expected !== null) unverifiable.push(where);
      return;
    }
    const printed = parsePrinted(printedRaw);
    if (printed.length === 0) {
      unverifiable.push(where);
      return;
    }
    verifiedCount += 1;
    if (expected === null) {
      deviations.push(
        t(
          `${where}: el Director de Estrategia emitió ${printedRaw}${suffix} pero el preprocesador marca este indicador N/D (sin base verificable).`,
          `${where}: the Strategy Director emitted ${printedRaw}${suffix} but the preprocessor marks this ratio N/A (no verifiable base).`,
        ),
      );
      return;
    }
    if (!matchesAtPrintedPrecision(printed, expected)) {
      deviations.push(
        t(
          `${where}: el Director de Estrategia emitió ${printedRaw}${suffix} frente a ${fmtNumber(expected)}${suffix} calculado por el preprocesador.`,
          `${where}: the Strategy Director emitted ${printedRaw}${suffix} versus ${fmtNumber(expected)}${suffix} computed by the preprocessor.`,
        ),
      );
    }
  };

  // -- KPIs ----------------------------------------------------------------
  let kpiRoePrinted: PrintedNumber[] = [];
  for (const kpi of json.kpis ?? []) {
    const field = kpiFieldOf(kpi.name);
    const where = `KPI ${kpi.name}`;
    const suffix = kpi.unit === 'percent' ? '%' : '';
    if (field === 'roe' && !isNd(kpi.resultPrimary)) kpiRoePrinted = parsePrinted(kpi.resultPrimary);

    const hasComparativeResult =
      (kpi.resultComparative !== null && !isNd(kpi.resultComparative)) ||
      (kpi.yoyVariation !== null && !isNd(kpi.yoyVariation));
    if (hasComparative === false && hasComparativeResult) {
      deviations.push(
        t(
          `${where}: presenta resultado comparativo o variación sin periodo comparativo en el balance.`,
          `${where}: shows a comparative result or variation without a comparative period in the trial balance.`,
        ),
      );
    }

    const recomputed = field ? null : recomputedOf(kpi.name);
    if (recomputed && hasPreprocessed) {
      const checkRecomputed = (label: string, printed: string, snapshot: PeriodSnapshot | null | undefined) => {
        const expected = recomputedValue(snapshot, recomputed.field);
        if (recomputed.unit !== 'cop') {
          checkRatio(label, printed, expected, suffix);
          return;
        }
        if (expected === undefined || isNd(printed)) return;
        const emitted = moneyOrUndefined(printed);
        if (emitted === undefined) return;
        verifiedCount += 1;
        const expectedCents = expected === null ? null : pesosToCents(expected);
        if (expectedCents === null || emitted !== expectedCents) {
          deviations.push(
            t(
              `${label}: el Director de Estrategia emitió ${money(emitted)} frente a ${expectedCents === null ? 'N/D' : money(expectedCents)} del balance.`,
              `${label}: the Strategy Director emitted ${money(emitted)} versus ${expectedCents === null ? 'N/A' : money(expectedCents)} from the trial balance.`,
            ),
          );
        }
      };
      checkRecomputed(where, kpi.resultPrimary, sources.primary);
      if (hasComparative && kpi.resultComparative !== null && sources.comparative) {
        checkRecomputed(`${where} (${t('comparativo', 'comparative')})`, kpi.resultComparative, sources.comparative);
      }
      continue;
    }
    if (!field || !hasPreprocessed) {
      // Publicado N/D (applyKpiAnchors): no hay cifra impresa que declarar.
      const printedNothing =
        isNd(kpi.resultPrimary) && (kpi.resultComparative === null || isNd(kpi.resultComparative));
      if (!printedNothing) unverifiable.push(where);
      continue;
    }
    checkRatio(where, kpi.resultPrimary, kpiValue(sources.primary, field), suffix);
    if (hasComparative && kpi.resultComparative !== null && sources.comparative) {
      checkRatio(
        `${where} (${t('comparativo', 'comparative')})`,
        kpi.resultComparative,
        kpiValue(sources.comparative, field),
        suffix,
      );
    }
    // Variación interanual del KPI anclado (narrativa-14: "+999,0 pp" en el ROE
    // salía verificado). Se admite en puntos (actual − comparativo) o relativa
    // (% sobre |comparativo|): el modelo usa una u otra según el indicador.
    if (hasComparative && sources.comparative && kpi.yoyVariation !== null && !isNd(kpi.yoyVariation)) {
      const cur = kpiValue(sources.primary, field);
      const prev = kpiValue(sources.comparative, field);
      if (cur === undefined || prev === undefined) {
        unverifiable.push(`${where} — ${t('variación interanual', 'year-over-year change')}`);
      } else {
        const candidates =
          cur === null || prev === null ? [] : [cur - prev, ...(prev === 0 ? [] : [((cur - prev) / Math.abs(prev)) * 100])];
        const issue = variationIssue(kpi.yoyVariation, candidates);
        if (issue !== 'unparsable') verifiedCount += 1;
        if (issue === 'base') {
          deviations.push(
            t(
              `${where}: la variación interanual ${kpi.yoyVariation} no tiene base (el preprocesador publica el indicador N/D en un periodo).`,
              `${where}: the year-over-year change ${kpi.yoyVariation} has no base (the preprocessor publishes the ratio as N/A in one period).`,
            ),
          );
        } else if (issue === 'mismatch') {
          deviations.push(
            t(
              `${where}: la variación interanual ${kpi.yoyVariation} no es la del preprocesador (${fmtNumber(candidates[0])} puntos${candidates[1] !== undefined ? ` o ${fmtPct(candidates[1])}` : ''}).`,
              `${where}: the year-over-year change ${kpi.yoyVariation} is not the preprocessor's (${fmtNumber(candidates[0])} points${candidates[1] !== undefined ? ` or ${fmtPct(candidates[1])}` : ''}).`,
            ),
          );
        } else if (issue === 'unparsable') {
          unverifiable.push(`${where} — ${t('variación interanual', 'year-over-year change')}`);
        }
      }
    }
  }

  // -- DuPont --------------------------------------------------------------
  const dupont = json.dupontAnalysis;
  if (dupont) {
    if (hasPreprocessed) {
      const ct = sources.primary?.controlTotals;
      const leverage =
        typeof ct?.activoPromedio === 'number' &&
        typeof ct?.patrimonioPromedio === 'number' &&
        ct.patrimonioPromedio !== 0
          ? ct.activoPromedio / ct.patrimonioPromedio
          : undefined;
      checkRatio('DuPont — ROE', dupont.roe, kpiValue(sources.primary, 'roe'), '%');
      checkRatio(t('DuPont — Margen neto', 'DuPont — Net margin'), dupont.netMargin, kpiValue(sources.primary, 'margenNeto'), '%');
      checkRatio(
        t('DuPont — Rotación de activos', 'DuPont — Asset turnover'),
        dupont.assetTurnover,
        kpiValue(sources.primary, 'rotacionActivos'),
      );
      checkRatio(t('DuPont — Apalancamiento', 'DuPont — Leverage'), dupont.financialLeverage, leverage);
    } else {
      unverifiable.push('DuPont');
    }

    // Corrección 3 spec v2.1: el ROE es UNO en todo el informe.
    const dupontRoe = parsePrinted(dupont.roe);
    if (kpiRoePrinted.length > 0 && dupontRoe.length > 0) {
      verifiedCount += 1;
      const consistent = dupontRoe.some((a) =>
        kpiRoePrinted.some((b) => {
          const tolerance = Math.max(0.5 * 10 ** -a.decimals, 0.5 * 10 ** -b.decimals);
          return Math.abs(a.value - b.value) <= tolerance + 1e-9;
        }),
      );
      if (!consistent) {
        deviations.push(
          t(
            `DuPont — ROE (${dupont.roe}) distinto del ROE del KPI: el informe usa dos fórmulas de ROE (spec v2.1, Corrección 3).`,
            `DuPont — ROE (${dupont.roe}) differs from the ROE KPI: the report uses two ROE formulas (spec v2.1, Correction 3).`,
          ),
        );
      }
    }
  }

  // -- Gate de liquidez ----------------------------------------------------
  const gate = json.projectedCashFlow?.liquidityGate;
  if (gate) {
    checkMoney(t('Gate de liquidez — Activo corriente', 'Liquidity gate — Current assets'), gate.currentAssetsCop, primaryAnchors, ['activoCorriente']);
    checkMoney(t('Gate de liquidez — Pasivo corriente', 'Liquidity gate — Current liabilities'), gate.currentLiabilitiesCop, primaryAnchors, ['pasivoCorriente']);
    const ac = moneyOrUndefined(gate.currentAssetsCop);
    const pc = moneyOrUndefined(gate.currentLiabilitiesCop);
    const gap = moneyOrUndefined(gate.gapCop);
    if (ac !== undefined && pc !== undefined && gap !== undefined && gap !== ac - pc) {
      deviations.push(
        t(
          `Gate de liquidez: la brecha ${money(gap)} no es AC − PC (${money(ac - pc)}).`,
          `Liquidity gate: gap ${money(gap)} is not CA − CL (${money(ac - pc)}).`,
        ),
      );
    }
    const acRef = primaryAnchors.activoCorriente ?? ac;
    const pcRef = primaryAnchors.pasivoCorriente ?? pc;
    if (acRef !== undefined && pcRef !== undefined && gate.triggered !== acRef < pcRef) {
      deviations.push(
        t(
          `Gate de liquidez: triggered=${gate.triggered} contradice AC ${money(acRef)} vs PC ${money(pcRef)}.`,
          `Liquidity gate: triggered=${gate.triggered} contradicts CA ${money(acRef)} vs CL ${money(pcRef)}.`,
        ),
      );
    }
  }

  // -- Tendencias ----------------------------------------------------------
  const trends = json.trends;
  if (
    hasComparative === false &&
    trends &&
    [trends.yoyRevenue, trends.yoyEbitda, trends.yoyNetIncome, trends.yoyEquity, trends.marginDeltaPp].some(
      (v) => v !== null && !isNd(v),
    )
  ) {
    deviations.push(
      t(
        'Tendencias: presenta variaciones interanuales sin periodo comparativo en el balance.',
        'Trends: shows year-over-year changes without a comparative period in the trial balance.',
      ),
    );
  }
  // e2e-niif-14: con comparativo, las variaciones se recalculan desde las
  // anclas de ambos cortes: "+33,3 %" para una pérdida que pasó de −$30M a
  // −$40M (−33,3 %) salía como tendencia verificada.
  if (hasComparative === true && trends && hasPreprocessed) {
    const expected = deterministicTrends(sources);
    const checkTrend = (where: string, printedRaw: string | null, candidates: Array<number | null> | undefined) => {
      if (printedRaw === null) return;
      if (candidates === undefined || candidates.length === 0) {
        unverifiable.push(where);
        return;
      }
      if (isNd(printedRaw)) return;
      const printed = parsePrinted(printedRaw);
      if (printed.length === 0) {
        unverifiable.push(where);
        return;
      }
      verifiedCount += 1;
      const numeric = candidates.filter((c): c is number => c !== null);
      if (numeric.length === 0) {
        deviations.push(
          t(
            `${where}: el Director de Estrategia emitió ${printedRaw} pero la variación no tiene base comparable (${expected.motivo ?? 'N/D'}).`,
            `${where}: the Strategy Director emitted ${printedRaw} but the change has no comparable base (${expected.motivo ?? 'N/A'}).`,
          ),
        );
        return;
      }
      if (!numeric.some((c) => matchesAtPrintedPrecision(printed, c))) {
        deviations.push(
          t(
            `${where}: el Director de Estrategia emitió ${printedRaw} frente a ${fmtTrendPct(numeric[0])} calculado desde el balance de ambos periodos.`,
            `${where}: the Strategy Director emitted ${printedRaw} versus ${fmtTrendPct(numeric[0])} computed from both periods' trial balance.`,
          ),
        );
      }
    };
    checkTrend(t('Tendencias — Ingresos', 'Trends — Revenue'), trends.yoyRevenue, expected.revenueCandidates);
    checkTrend(t('Tendencias — EBITDA', 'Trends — EBITDA'), trends.yoyEbitda, expected.ebitda === undefined ? undefined : [expected.ebitda]);
    checkTrend(
      t('Tendencias — Utilidad neta', 'Trends — Net income'),
      trends.yoyNetIncome,
      expected.netIncome === undefined ? undefined : [expected.netIncome],
    );
    checkTrend(t('Tendencias — Patrimonio', 'Trends — Equity'), trends.yoyEquity, expected.equity === undefined ? undefined : [expected.equity]);
    if (trends.marginDeltaPp !== null && !isNd(trends.marginDeltaPp)) {
      // El margen de la variación en puntos no está definido (bruto, operativo o neto).
      unverifiable.push(t('Tendencias — Δ margen (pp)', 'Trends — margin Δ (pp)'));
    }
  }

  // -- Cifras en prosa (pendiente #2 de la auditoría integral 2026-09-24) --
  // Comentario ejecutivo, diagnósticos, recomendaciones y solvencia: una
  // mención de un concepto anclado (utilidad neta, activos, patrimonio,
  // efectivo, ingresos, EBITDA, ROE, fecha de corte) con otra cifra sella la
  // Parte II igual que un rubro del dashboard. Proyecciones y referencias
  // sectoriales no se juzgan.
  const narrative = checkStrategyNarrative(json, sources, language);
  verifiedCount += narrative.checked;
  deviations.push(
    ...narrative.motivos.map((m) => t(`Prosa — ${m}`, `Narrative — ${m}`)),
  );

  // -- Sin ancla por construcción -----------------------------------------
  unverifiable.push(
    t(
      'Punto de equilibrio (clasificación de costos fijos/variables del modelo)',
      'Break-even (model classification of fixed/variable costs)',
    ),
    t('Proyecciones de flujo de caja (supuestos del modelo)', 'Cash-flow projections (model assumptions)'),
  );

  return { deviations, unverifiable: Array.from(new Set(unverifiable)), verifiedCount };
}

// ---------------------------------------------------------------------------
// KPIs sin ancla → N/D; recomputables → sobrescritos (pendiente #2)
// ---------------------------------------------------------------------------
// Antes, un KPI sin ancla determinista ("Margen EBITDA ajustado", "Índice de
// solvencia", o cualquier KPI cuando no llegó el preprocesado) se imprimía con
// la cifra del modelo en el visor, el Excel y el HTML, rotulado "no
// verificable". Ahora:
//   - KPI con ancla (`KPI_ANCHORS`) y preprocesado → se conserva: el
//     validador lo cruza y sella la Parte II si difiere.
//   - KPI recomputable (margen bruto, ciclo de conversión del efectivo,
//     capital de trabajo) → se sobrescribe con el valor del preprocesador (o
//     N/D con su motivo).
//   - Cualquier otro KPI (o todos, sin preprocesado) → N/D con motivo: no se
//     publica la cifra del modelo, ni su fórmula con números ni su diagnóstico.
// Idempotente: los exportadores lo re-aplican sobre JSON persistidos.
// ---------------------------------------------------------------------------

export interface KpiAnchorOutcome {
  json: StrategyReportJson;
  /** KPIs publicados N/D por falta de ancla (nombre). */
  neutralized: string[];
  /** KPIs recalculados por el sistema (nombre). */
  recomputed: string[];
}

export interface KpiAnchorOptions {
  language?: 'es' | 'en';
  /**
   * Sin preprocesado, conservar los KPIs con ancla por nombre y los
   * recomputables tal como llegan (exportadores: la fase ya los validó o
   * neutralizó y el gate servidor los re-cruza cuando hay balance). En la
   * fase (`false`) sin preprocesado todo KPI es N/D.
   */
  keepWhenNoSource?: boolean;
}

function kpiNdMotivo(snapshot: PeriodSnapshot | null | undefined, field: string): string | null {
  const motivos = snapshot?.controlTotals?.kpiNdMotivos as Record<string, string | undefined> | undefined;
  return motivos?.[field] ?? null;
}

function formatRecomputed(value: number, unit: KpiJson['unit']): string {
  if (unit === 'cop') return pesosToCents(value).toString(10);
  if (unit === 'days') return String(Math.round(value));
  return value.toFixed(1).replace('.', ',');
}

export function applyKpiAnchors(
  input: StrategyReportJson,
  sources: StrategyAnchorSources,
  options: KpiAnchorOptions = {},
): KpiAnchorOutcome {
  const es = options.language !== 'en';
  const t = (spanish: string, english: string) => (es ? spanish : english);
  const json: StrategyReportJson = structuredClone(input);
  const neutralized: string[] = [];
  const recomputed: string[] = [];
  const hasSource = !!sources.primary;
  const keep = !hasSource && options.keepWhenNoSource === true;
  const noSourceMotivo = t(
    'N/D — sin balance preprocesado no hay base determinista para este indicador; el sistema no publica la cifra estimada por el modelo.',
    'N/A — without the preprocessed trial balance there is no deterministic base for this ratio; the system does not publish the model estimate.',
  );
  const noAnchorMotivo = t(
    'N/D — indicador sin ancla determinista en el balance preprocesado; el sistema no publica la cifra estimada por el modelo.',
    'N/A — ratio without a deterministic anchor in the preprocessed trial balance; the system does not publish the model estimate.',
  );

  const asNd = (kpi: KpiJson, motivo: string): KpiJson => ({
    ...kpi,
    formula: t(`${kpi.name}: sin fórmula determinista`, `${kpi.name}: no deterministic formula`),
    resultPrimary: 'ND',
    resultComparative: kpi.resultComparative === null ? null : 'ND',
    yoyVariation: null,
    diagnosis: motivo,
    confidence: 'low',
    anomalyFlag: null,
    sparklinePoints: null,
  });

  json.kpis = (json.kpis ?? []).map((kpi) => {
    if (kpiFieldOf(kpi.name)) {
      if (hasSource || keep) return kpi;
      neutralized.push(kpi.name);
      return asNd(kpi, noSourceMotivo);
    }
    const rec = recomputedOf(kpi.name);
    if (rec) {
      if (keep) return kpi;
      if (!hasSource) {
        neutralized.push(kpi.name);
        return asNd(kpi, noSourceMotivo);
      }
      const primary = recomputedValue(sources.primary, rec.field);
      if (primary === undefined) {
        neutralized.push(kpi.name);
        return asNd(kpi, noAnchorMotivo);
      }
      recomputed.push(kpi.name);
      const comparativeValue = sources.comparative ? recomputedValue(sources.comparative, rec.field) : undefined;
      const resultPrimary = primary === null ? 'ND' : formatRecomputed(primary, rec.unit);
      const resultComparative =
        kpi.resultComparative === null || comparativeValue === undefined
          ? null
          : comparativeValue === null
            ? 'ND'
            : formatRecomputed(comparativeValue, rec.unit);
      // El diagnóstico del modelo se conserva sólo si citaba el mismo valor.
      const printed = parsePrinted(kpi.resultPrimary);
      const sameValue =
        primary !== null &&
        (rec.unit === 'cop'
          ? moneyOrUndefined(kpi.resultPrimary) === pesosToCents(primary)
          : printed.length > 0 && matchesAtPrintedPrecision(printed, primary));
      const motivo = primary === null ? (kpiNdMotivo(sources.primary, rec.field) ?? noAnchorMotivo) : null;
      return {
        ...kpi,
        unit: rec.unit,
        formula: es ? rec.formula.es : rec.formula.en,
        resultPrimary,
        resultComparative,
        yoyVariation: null,
        diagnosis:
          motivo ??
          (sameValue
            ? kpi.diagnosis
            : t(
                'Valor recalculado por el sistema desde el balance preprocesado; el diagnóstico del modelo citaba otra cifra y se omite.',
                'Value recomputed by the system from the preprocessed trial balance; the model diagnosis cited another figure and is omitted.',
              )),
        confidence: primary === null ? 'low' : kpi.confidence,
        anomalyFlag: sameValue ? kpi.anomalyFlag : null,
        sparklinePoints: null,
      };
    }
    neutralized.push(kpi.name);
    return asNd(kpi, noAnchorMotivo);
  });

  // DuPont sin preprocesado no tiene contra qué cruzarse (en la fase).
  if (json.dupontAnalysis && !hasSource && !keep) {
    json.dupontAnalysis = {
      roe: 'ND',
      netMargin: 'ND',
      assetTurnover: 'ND',
      financialLeverage: 'ND',
      drivingFactor: noSourceMotivo,
    };
    neutralized.push('DuPont');
  }

  // La cifra que el modelo estimó para un KPI publicado N/D (o recalculado) no
  // puede sobrevivir en la prosa de la misma Parte II (narrativa-15): se
  // sustituye junto al nombre del KPI por N/D o por el valor del sistema.
  const discarded = discardedKpiFigures(input, json);
  if (discarded.length > 0) scrubStrategyProse(json, discarded, es ? 'es' : 'en');

  return { json, neutralized, recomputed };
}

// ---------------------------------------------------------------------------
// Cifra descartada de un KPI en prosa (narrativa-15; R7 del HTML)
// ---------------------------------------------------------------------------
// Un KPI sin ancla se publica N/D y uno recomputable con el valor del sistema,
// pero el modelo suele repetir su propia cifra en el comentario ejecutivo, los
// títulos y diagnósticos de las recomendaciones o la solvencia ("El margen
// EBITDA ajustado de 23,7 %…"). Se reconoce el nombre del KPI plegado
// (mayúsculas, tildes y conectores "de/del/la…" indiferentes) y, en lo que le
// sigue dentro de la misma frase, la cifra descartada a la precisión impresa
// ("24 %" es 23,7 redondeado). No cuentan la banda sectorial, las cotas con
// comparador ("> 10 %"), la cifra que el sistema sí publica ni un entero de un
// dígito (demasiado ambiguo). El mismo reconocedor lo usa R7 del HTML
// (`html-editor-validator.ts`).
// ---------------------------------------------------------------------------

const NAME_CONNECTORS = ['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'sobre', 'a', 'al', 'of', 'the', 'on', 'to'];

const ACCENT_CLASS: Record<string, string> = {
  a: '[aáàâä]',
  e: '[eéèêë]',
  i: '[iíìîï]',
  o: '[oóòôö]',
  u: '[uúùûü]',
  n: '[nñ]',
};

function foldName(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Mención del nombre de un KPI en texto (bandera `g`): sin distinguir
 * mayúsculas ni tildes y con conectores opcionales entre sus palabras
 * ("Margen EBITDA ajustado" ≈ "margen de EBITDA ajustado"). `null` si el
 * nombre es demasiado corto para reconocerlo sin ambigüedad.
 */
export function kpiNamePattern(name: string): RegExp | null {
  const tokens = foldName(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 0 && !NAME_CONNECTORS.includes(w));
  if (tokens.length === 0 || tokens.join('').length < 3) return null;
  const word = (w: string) => w.split('').map((ch) => ACCENT_CLASS[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  const sep = `(?:[\\s\\-_/()]+(?:(?:${NAME_CONNECTORS.join('|')})[\\s\\-_/()]+)*)`;
  return new RegExp(`(?<![\\p{L}\\d])${tokens.map(word).join(sep)}(?![\\p{L}\\d])`, 'giu');
}

/** Tramo tras el nombre hasta el fin de la frase (a lo sumo 160 caracteres). */
export function kpiMentionWindow(text: string, from: number): string {
  const rest = text.slice(from, from + 160);
  const end = /[.;!?](?=\s|$)/.exec(rest);
  return end ? rest.slice(0, end.index + 1) : rest;
}

/** Cifra impresa en prosa: signo, "$", número es-CO y unidad (sin paréntesis). */
const FIGURE_TOKEN =
  /(?<![\p{L}\d.,])([-−+]\s*)?(\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?![\d]|[.,]\d)(\s*(?:%|pp\b|p\.\s?p\.|puntos(?:\s+porcentuales)?\b|veces\b|x\b|d[ií]as\b|mil\s+millones\b|millones\b|MM\b|M\b))?/gu;

/** Pesos de un número es-CO ("1.234.567,89", "23,7", "2.000"). */
function esCoPesos(digits: string): { value: number; decimals: number } {
  const [int, dec = ''] = digits.includes(',') ? digits.split(',') : [digits, ''];
  const grouped = /^\d{1,3}(?:\.\d{3})+$/.test(int);
  const whole = grouped ? int.replace(/\./g, '') : int;
  const value = Number(`${whole}${dec ? `.${dec}` : ''}`);
  return { value, decimals: dec.length };
}

/** ¿La unidad impresa tras el número es compatible con la del KPI? (sin unidad: sí). */
function unitCompatible(unit: KpiJson['unit'], suffix: string): boolean {
  if (!suffix) return true;
  const percent = /^(?:%|pp|p\.\s?p\.|puntos(?:\s+porcentuales)?)$/.test(suffix);
  const days = /^d[ií]as$/.test(suffix);
  const times = /^(?:veces|x)$/.test(suffix);
  const money = /^(?:m|mm|millones|mil\s+millones)$/.test(suffix);
  switch (unit) {
    case 'percent':
      return percent;
    case 'days':
      return days;
    case 'times':
    case 'ratio':
      return times;
    case 'cop':
      return money;
    default:
      return true;
  }
}

/** Posiciones (en `tail`) de la cifra descartada impresa a su precisión. */
export function discardedFigureHits(tail: string, d: DiscardedKpiFigure): Array<{ index: number; length: number }> {
  let masked = tail;
  const band = d.band.trim();
  if (band) {
    const lower = masked.toLowerCase();
    const needle = band.toLowerCase();
    let at = lower.indexOf(needle);
    while (at >= 0) {
      masked = masked.slice(0, at) + ' '.repeat(band.length) + masked.slice(at + band.length);
      at = lower.indexOf(needle, at + band.length);
    }
  }
  const hits: Array<{ index: number; length: number }> = [];
  const cop = d.unit === 'cop';
  const discardedPesos = cop ? Number(moneyOrUndefined(d.value) ?? NaN) / 100 : parsePrinted(d.value)[0]?.value;
  if (discardedPesos === undefined || !Number.isFinite(discardedPesos)) return hits;
  const publishedPesos =
    d.published === null || isNd(d.published)
      ? undefined
      : cop
        ? Number(moneyOrUndefined(d.published) ?? NaN) / 100
        : parsePrinted(d.published)[0]?.value;
  const re = new RegExp(FIGURE_TOKEN.source, FIGURE_TOKEN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const [token, , dollar, digits, suffixRaw] = m;
    if (/[<>≥≤]\s*$/.test(masked.slice(Math.max(0, m.index - 3), m.index))) continue; // cota de una banda
    const suffix = (suffixRaw ?? '').trim().toLowerCase();
    if (!unitCompatible(d.unit, suffix)) continue; // "23,7 días" no es un margen de 23,7 %
    const scale = /^mil\s+millones$/.test(suffix) ? 1e9 : /^(?:m|mm|millones)$/.test(suffix) ? 1e6 : 1;
    let candidates: Array<{ value: number; tolerance: number }>;
    if (cop) {
      if (!dollar && scale === 1) continue;
      const { value, decimals } = esCoPesos(digits);
      candidates = [{ value: value * scale, tolerance: Math.max(0.005, 0.5 * 10 ** -decimals * scale) }];
    } else {
      if (dollar || scale !== 1) continue;
      candidates = parsePrinted(digits).map((p) => ({ value: p.value, tolerance: 0.5 * 10 ** -p.decimals }));
      // Un entero de un dígito ("3 acciones", "5 veces") es demasiado ambiguo.
      candidates = candidates.filter((c) => !(Number.isInteger(c.value) && c.tolerance === 0.5 && Math.abs(c.value) < 10));
    }
    const near = (target: number | undefined) =>
      target !== undefined &&
      Number.isFinite(target) &&
      candidates.some((c) => Math.abs(Math.abs(c.value) - Math.abs(target)) <= c.tolerance + 1e-9 * Math.max(1, Math.abs(target)));
    if (!near(discardedPesos) || near(publishedPesos)) continue;
    hits.push({ index: m.index, length: token.length });
  }
  return hits;
}

/** Texto que el sistema publica en lugar de la cifra descartada. */
function publishedText(d: DiscardedKpiFigure, language: 'es' | 'en'): string {
  const nd = language === 'es' ? 'N/D' : 'N/A';
  if (d.published === null || isNd(d.published)) return nd;
  if (d.unit === 'cop') {
    const c = moneyOrUndefined(d.published);
    return c === undefined ? nd : formatCopFromCents(c);
  }
  if (d.unit === 'percent') return `${d.published} %`;
  if (d.unit === 'days') return `${d.published} ${language === 'es' ? 'días' : 'days'}`;
  if (d.unit === 'times') return `${d.published} ${language === 'es' ? 'veces' : 'times'}`;
  return d.published;
}

/** Sustituye en `text` las cifras descartadas que siguen al nombre de su KPI. */
export function scrubDiscardedKpiFigures(
  text: string,
  discarded: readonly DiscardedKpiFigure[],
  language: 'es' | 'en' = 'es',
): string {
  let out = text;
  for (const d of discarded) {
    const re = kpiNamePattern(d.name);
    if (!re) continue;
    const edits: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      const from = m.index + m[0].length;
      for (const h of discardedFigureHits(kpiMentionWindow(out, from), d)) {
        edits.push({ start: from + h.index, end: from + h.index + h.length });
      }
    }
    const replacement = publishedText(d, language);
    let lastStart = Number.POSITIVE_INFINITY;
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      if (e.end > lastStart) continue; // solapada con una ya sustituida
      out = out.slice(0, e.start) + replacement + out.slice(e.end);
      lastStart = e.start;
    }
  }
  return out;
}

/** Prosa de la Parte II que llega al entregable (la misma que cruza `checkStrategyNarrative`, más títulos). */
function scrubStrategyProse(json: StrategyReportJson, discarded: DiscardedKpiFigure[], language: 'es' | 'en'): void {
  const fix = (v: string) => scrubDiscardedKpiFigures(v, discarded, language);
  const dash = json.executiveDashboard;
  if (dash) {
    dash.executiveCommentary = fix(dash.executiveCommentary);
    for (const r of dash.rows ?? []) r.commentary = fix(r.commentary);
  }
  for (const a of json.technicalAlerts ?? []) {
    a.title = fix(a.title);
    a.description = fix(a.description);
  }
  for (const k of json.kpis ?? []) k.diagnosis = fix(k.diagnosis);
  if (json.dupontAnalysis) json.dupontAnalysis.drivingFactor = fix(json.dupontAnalysis.drivingFactor);
  if (json.trends) json.trends.qualitativeCommentary = fix(json.trends.qualitativeCommentary);
  if (json.breakEven) json.breakEven.classificationNote = fix(json.breakEven.classificationNote);
  const pcf = json.projectedCashFlow;
  if (pcf) {
    pcf.solvencyNarrative = fix(pcf.solvencyNarrative);
    pcf.assumptionsNote = fix(pcf.assumptionsNote);
    for (const sc of pcf.scenarios ?? []) sc.assumptions = fix(sc.assumptions);
  }
  for (const r of json.recommendations ?? []) {
    r.title = fix(r.title);
    r.diagnosis = fix(r.diagnosis);
    r.action = fix(r.action);
    r.expectedImpact = fix(r.expectedImpact);
  }
  if (json.presumedCostWarning) {
    json.presumedCostWarning.recommendedActions = json.presumedCostWarning.recommendedActions.map(fix);
  }
  for (const n of json.preparerNotes ?? []) n.body = fix(n.body);
}

/** Cifra del modelo que `applyKpiAnchors` no publica (KPI N/D o recalculado). */
export interface DiscardedKpiFigure {
  name: string;
  unit: KpiJson['unit'];
  /** Valor tal como lo emitió el modelo (MoneyCop en 'cop'; decimal en el resto). */
  value: string;
  /** Banda sectorial del KPI: sus cotas no son la cifra descartada. */
  band: string;
  /** Lo que el sistema publica en su lugar ("ND", el valor recalculado o `null`). */
  published: string | null;
}

/**
 * Cifras que el modelo emitió para un KPI y que el sistema no publica: el KPI
 * quedó N/D o se recalculó con otro valor. El validador del HTML (R7) exige
 * que no reaparezcan junto al nombre del KPI.
 */
export function discardedKpiFigures(
  original: StrategyReportJson,
  anchored: StrategyReportJson,
): DiscardedKpiFigure[] {
  const out: DiscardedKpiFigure[] = [];
  (original.kpis ?? []).forEach((kpi, i) => {
    const published = anchored.kpis?.[i];
    if (!published || published.name !== kpi.name) return;
    const pairs: Array<[string | null, string | null]> = [
      [kpi.resultPrimary, published.resultPrimary],
      [kpi.resultComparative, published.resultComparative],
    ];
    for (const [emitted, shown] of pairs) {
      if (emitted === null || isNd(emitted) || emitted === shown) continue;
      const money = kpi.unit === 'cop' ? moneyOrUndefined(emitted) : undefined;
      const printed = kpi.unit === 'cop' ? [] : parsePrinted(emitted);
      if (money === undefined && printed.length === 0) continue;
      // Mismo valor con otra escritura ("62.5" frente a "62,5"): no se descartó nada.
      if (shown !== null && !isNd(shown)) {
        if (money !== undefined && moneyOrUndefined(shown) === money) continue;
        const shownValue = parsePrinted(shown)[0]?.value;
        if (shownValue !== undefined && matchesAtPrintedPrecision(printed, shownValue)) continue;
      }
      out.push({
        name: kpi.name,
        unit: kpi.unit,
        value: emitted,
        band: kpi.benchmarkBand?.description ?? '',
        published: shown,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tendencias deterministas (e2e-niif-14 / e2e-niif-17)
// ---------------------------------------------------------------------------

/**
 * Variaciones interanuales desde las anclas de ambos cortes, en porcentaje:
 * (actual − comparativo) / |comparativo| × 100. `undefined` = sin fuente
 * (no hay comparativo o no hay ancla); `null` = N/D con `motivo` (base cero, o
 * P&G de un comparativo de saldos de apertura, que no es un ejercicio).
 */
export interface DeterministicTrends {
  /** Ingresos: operacionales netos, netos y brutos (el que el modelo haya usado). */
  revenueCandidates?: Array<number | null>;
  /** Primer candidato de ingresos disponible (el que imprime el sistema). */
  revenue?: number | null;
  ebitda?: number | null;
  netIncome?: number | null;
  equity?: number | null;
  motivo: string | null;
}

function yoyPct(primary: bigint | undefined, comparative: bigint | undefined): number | null | undefined {
  if (primary === undefined || comparative === undefined) return undefined;
  if (comparative === BigInt(0)) return null;
  const abs = comparative < BigInt(0) ? -comparative : comparative;
  return (Number(primary - comparative) / Number(abs)) * 100;
}

export function deterministicTrends(sources: StrategyAnchorSources): DeterministicTrends {
  if (!sources.primary || !sources.comparative) return { motivo: null };
  const p = anchorsFromSnapshot(sources.primary);
  const c = anchorsFromSnapshot(sources.comparative);
  const opening = sources.comparative.saldosDeApertura === true;
  const OPENING_MOTIVO =
    'el comparativo es de saldos de apertura: no hay estado de resultados de ese periodo';
  const motivos: string[] = [];
  const pyg = (key: MoneyKey): number | null | undefined => {
    if (opening) return null;
    const v = yoyPct(p[key], c[key]);
    if (v === null) motivos.push(`base comparativa cero en ${key}`);
    return v;
  };
  const revenueKeys: MoneyKey[] = ['ingresosOperacionales', 'ingresosNetos', 'ingresos'];
  const revenueCandidates = opening
    ? [null]
    : revenueKeys.map((k) => yoyPct(p[k], c[k])).filter((v): v is number | null => v !== undefined);
  if (opening) motivos.push(OPENING_MOTIVO);
  const equity = yoyPct(p.patrimonio, c.patrimonio);
  if (equity === null) motivos.push('patrimonio comparativo cero');
  return {
    revenueCandidates: revenueCandidates.length > 0 ? revenueCandidates : undefined,
    revenue: revenueCandidates.length > 0 ? revenueCandidates[0] : undefined,
    ebitda: pyg('ebitda'),
    netIncome: pyg('utilidadNeta'),
    equity,
    motivo: motivos.length > 0 ? Array.from(new Set(motivos)).join('; ') : null,
  };
}

/** "+20,0%" / "-33,3%" / "0,0%" — la forma en que el adaptador imprime tendencias. */
export function fmtTrendPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (rounded === 0) return '0,0%';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1).replace('.', ',')}%`;
}
