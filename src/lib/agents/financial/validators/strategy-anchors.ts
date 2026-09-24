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
import type { StrategyReportJson } from '../contracts/strategy-report';
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
    .replace(/[:.;,]/g, ' ')
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
  // "Ingresos operacionales" queda sin ancla a propósito: su perímetro (grupo
  // 41 vs Clase 4) es una definición del preprocesador que puede cambiar.
  { keys: ['ingresosNetos', 'ingresos'], re: /^(total )?ingresos( netos| totales)?$/ },
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

    if (!field || !hasPreprocessed) {
      unverifiable.push(where);
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
