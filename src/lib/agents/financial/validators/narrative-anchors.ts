// ---------------------------------------------------------------------------
// Cifras citadas en prosa contra las anclas deterministas
// ---------------------------------------------------------------------------
// Pendiente #2 de la auditoría integral 2026-09-24. Las notas y la prosa de
// Gobierno y Estrategia se rotulaban "Narrativa generada por IA — no auditada"
// y el HTML bloqueaba contradicciones con anclas conocidas (R6), pero:
//   - los montos citados en el acta (desarrollo de los puntos, quorum, texto
//     neutral de destinación) y en las notas a los estados financieros de
//     Gobierno no se cruzaban con nada: "la utilidad neta del ejercicio fue de
//     $4.000.000,00" (real $40M) o "se decreta un dividendo de $900.000.000,00"
//     (sin base en la aritmética del acta) salían en un documento para firma;
//   - la prosa de la Parte II (comentario ejecutivo, diagnósticos,
//     recomendaciones, solvencia) tampoco.
//
// Este módulo es el reconocedor común. Cada MENCIÓN de un concepto con ancla
// conocida se cruza con la PRIMERA cifra que la sigue en la misma frase o fila
// (completa o abreviada, a la precisión impresa): vale la del periodo actual o
// la del comparativo; una variación ("disminuyó $10M"), una referencia
// sectorial o una proyección no se juzgan. Sin ancla para el concepto no se
// acusa nada; con el concepto publicado N/D, cualquier cifra impresa carece de
// base. El reconocimiento de montos COP (signo, paréntesis, abreviaturas
// "$X M" / "mil millones") es `extractCopTokens`, el mismo del validador de
// reportes; el gate R6 del HTML (`html-editor-validator.ts`) usa este mismo
// núcleo sobre las unidades de texto del DOM.
//
// Principio rector: las cifras las produce y valida el código; el modelo sólo
// redacta. Una cifra en prosa distinta del ancla sella la sección
// (`actaQualifications` / `strategyQualifications`), no se corrige en silencio.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildPeriodAnchors } from '../contracts/anchors';
import type { ActaArithmetic } from '../contracts/base';
import { formatCopFromCents } from '../contracts/money';
import type { GovernanceReportJson } from '../contracts/governance-report';
import type { NiifReportJson } from '../contracts/niif-report';
import type { StrategyReportJson } from '../contracts/strategy-report';
import type { GovernanceResult } from '../types';
import { extractCopTokens } from './report-validator';

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export type NarrativeConceptKey =
  | 'utilidadNeta'
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'efectivo'
  | 'ebitda'
  | 'ingresos'
  | 'dividendos'
  | 'reservaLegal'
  | 'capitalizacion';

export interface NarrativeConcept {
  key: NarrativeConceptKey;
  label: string;
  /** Mención del concepto (bandera `g`). */
  re: RegExp;
  /** Pesos válidos (periodo actual, comparativo y equivalentes del acta). */
  values: number[];
  /** Publicado N/D: cualquier cifra impresa carece de base. */
  nd: boolean;
  /** Por qué es N/D (texto del motivo, sin punto final). */
  ndMotivo?: { es: string; en: string };
  /** Tipo de rótulo para el signo: 'pos' (utilidad), 'neg' (pérdida) o neutro. */
  polarity?: (match: string) => 'pos' | 'neg' | null;
  /** Rótulo genérico que sólo cuenta como primera celda de una fila de tabla. */
  rowLabelOnly?: RegExp;
}

/** Una frase, párrafo o fila que el lector ve como unidad. */
export interface NarrativeUnit {
  text: string;
  /** Dónde está (p. ej. "Nota 11 — Patrimonio", "Acta — punto 3"). */
  where?: string;
  /** Primera celda cuando la unidad es una fila de tabla. */
  firstCell?: string | null;
  /**
   * La unidad es una propuesta o un impacto esperado (acción e impacto de una
   * recomendación): con `skipForwardLooking` no se juzga, igual que una
   * proyección ("Llevar el ROE a 25 %", "elevar el EBITDA en $12 M").
   */
  forwardLooking?: boolean;
}

export interface NarrativeFinding {
  where?: string;
  detail: string;
}

export interface NarrativeAnchorSources {
  /** JSON NIIF ya validado (totales, EFE, ECP). */
  niif?: NiifReportJson | null;
  /** Snapshot del periodo que se firma (preprocesado). */
  primary?: PeriodSnapshot | null;
  /** Snapshot comparativo; `null` si no hay o es impracticable. */
  comparative?: PeriodSnapshot | null;
  /** Aritmética determinista del acta (`buildActaExpectedArithmetic`). */
  acta?: ActaArithmetic | null;
  /**
   * Activa los conceptos del acta (dividendos, reserva legal, capitalización).
   * Sin `acta` las cifras de esos conceptos se declaran sin base (N/D).
   */
  actaConcepts?: boolean;
}

export interface NarrativeCheckOptions {
  language?: 'es' | 'en';
  /** Sujeto de los mensajes ("el HTML", "la narrativa"). */
  subject?: { es: string; en: string };
  /**
   * Sólo cuentan montos con moneda ("$", "COP" delante o "pesos" detrás) o con
   * escala ("1.500 millones"): evita NIT y códigos.
   */
  requireCurrency?: boolean;
  /** No juzga proyecciones, metas, promedios sectoriales ni años futuros. */
  skipForwardLooking?: boolean;
  /** Año del periodo que se firma (para descartar años futuros). */
  primaryYear?: string | null;
  /**
   * Prosa redactada por el modelo (Partes II y III), no una fila de tabla: un
   * monto entre paréntesis justo después del rótulo ("la utilidad neta
   * ($20.000.000,00)") es un inciso y no se lee como signo negativo (la
   * magnitud se sigue cruzando), y una cifra presentada como componente
   * ("incluye", "compuesto por", "se concentra en", "cubre") no es el saldo
   * del concepto.
   */
  lenientProse?: boolean;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const MONEY_RE = /^-?\d+$/;

function centsToPesos(v: string | null | undefined): number | null {
  if (typeof v !== 'string' || !MONEY_RE.test(v)) return null;
  return Number(BigInt(v)) / 100;
}

function snapshotPesos(snapshot: PeriodSnapshot | null | undefined, key: string): number | null {
  const a = buildPeriodAnchors(snapshot ?? undefined);
  const c = (a?.cents as Record<string, bigint | undefined> | undefined)?.[key];
  return typeof c === 'bigint' ? Number(c) / 100 : null;
}

/** Valor de `controlTotals`: `undefined` = sin campo; `null` = N/D publicado. */
export function ctNumber(snapshot: PeriodSnapshot | null | undefined, key: string): number | null | undefined {
  const ct = snapshot?.controlTotals as unknown as Record<string, unknown> | undefined;
  if (!ct || !(key in ct)) return undefined;
  const v = ct[key];
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function vals(...xs: Array<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === 'number' && Number.isFinite(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

export function fmtPesos(n: number): string {
  return formatCopFromCents(BigInt(Math.round(n * 100)), false);
}

function yearOf(period: string | null | undefined): string | null {
  const m = typeof period === 'string' ? period.match(/(\d{4})/) : null;
  return m ? m[1] : null;
}

/** Fuentes desde el preprocesado del mismo balance (comparativo impracticable = ausente). */
export function narrativeSourcesFromPreprocessed(
  preprocessed: PreprocessedBalance | null | undefined,
  niif: NiifReportJson | null | undefined,
  extra: Pick<NarrativeAnchorSources, 'acta' | 'actaConcepts'> = {},
): NarrativeAnchorSources {
  return {
    niif: niif ?? null,
    primary: preprocessed?.primary ?? null,
    comparative:
      !preprocessed || preprocessed.comparativos_impracticables === true
        ? null
        : (preprocessed.comparative ?? null),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Conceptos anclados
// ---------------------------------------------------------------------------

/** Verbos que introducen el monto de un saldo en prosa ("asciende a", "es de"). */
const AMOUNT_VERBS = String.raw`(?:asciende|ascendi[oó]|ascender[aá]|es\s+de|fue\s+de|cerr[oó]\s+en|totaliza|totaliz[oó]|suma|sum[oó])`;

/** Mención de ingresos con monto (prosa) y rótulo de fila de tabla. */
const INGRESOS_RE = /\bingresos\s+(?:operacionales\s+netos|operacionales|netos|totales|de\s+actividades\s+ordinarias)\b/gi;
const INGRESOS_ROW_RE = /^ingresos(?:\s+(?:operacionales(?:\s+netos)?|netos|totales|de actividades ordinarias))?$/i;

const ND_PREPROCESSOR = {
  es: 'el preprocesador lo publica N/D (sin base verificable)',
  en: 'the preprocessor publishes it as N/A (no verifiable base)',
};
const ND_ACTA = {
  es: 'el acta no tiene aritmética determinista contra la cual verificarlo (sin base verificable)',
  en: 'the minutes have no deterministic arithmetic to verify it against (no verifiable base)',
};

/**
 * Conceptos con ancla conocida para las fuentes dadas. El orden importa sólo
 * para los mensajes; cada concepto corta la ventana de los demás.
 */
export function buildNarrativeConcepts(sources: NarrativeAnchorSources): NarrativeConcept[] {
  const niif = sources.niif ?? null;
  const primary = sources.primary ?? null;
  const comparative = sources.comparative ?? null;
  const bs = niif?.balanceSheet;
  const is = niif?.incomeStatement;
  const concepts: NarrativeConcept[] = [
    {
      key: 'utilidadNeta',
      label: 'Utilidad neta',
      // "utilidad neta a disposición / distribuible / tras la reserva" es un
      // saldo del acta, no el resultado del ejercicio; "por acción" (NIC 33)
      // y "antes de impuestos" tampoco son el resultado neto.
      re: /\b(?:utilidad|ganancia|p[eé]rdida|resultado)\s+net[ao]\b(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o))?(?!\s+(?:distribuible|disponible|a\s+disposici[oó]n|despu[eé]s|tras|restante|por\s+distribuir|a\s+distribuir|l[ií]quida|por\s+(?:acci[oó]n|cuota)|antes\s+de))/gi,
      values: vals(
        centsToPesos(is?.netIncomePrimary),
        centsToPesos(is?.netIncomeComparative),
        snapshotPesos(primary, 'utilidadNeta'),
        snapshotPesos(comparative, 'utilidadNeta'),
      ),
      nd: false,
      polarity: (m) => (/p[eé]rdida/i.test(m) ? 'neg' : /utilidad|ganancia/i.test(m) ? 'pos' : null),
    },
    {
      key: 'activo',
      label: 'Total Activo',
      re: /\b(?:total\s+(?:de\s+)?activos?|activos?\s+totales?)\b(?!\s+(?:no\s+)?corrientes?)/gi,
      values: vals(
        centsToPesos(bs?.totalAssetsPrimary),
        centsToPesos(bs?.totalAssetsComparative),
        snapshotPesos(primary, 'activo'),
        snapshotPesos(comparative, 'activo'),
      ),
      nd: false,
    },
    {
      key: 'pasivo',
      label: 'Total Pasivo',
      re: /\b(?:total\s+(?:de\s+)?pasivos?|pasivos?\s+totales?)\b(?!\s+(?:no\s+)?corrientes?)(?!\s*(?:y|\+|m[aá]s)\s*(?:el\s+)?patrimonio)/gi,
      values: vals(
        centsToPesos(bs?.totalLiabilitiesPrimary),
        centsToPesos(bs?.totalLiabilitiesComparative),
        snapshotPesos(primary, 'pasivo'),
        snapshotPesos(comparative, 'pasivo'),
      ),
      nd: false,
    },
    {
      key: 'patrimonio',
      label: 'Total Patrimonio',
      // "Total patrimonio", "el patrimonio al cierre", "el patrimonio al 31 de
      // diciembre de 2025" (e2e-niif-10) y "el patrimonio asciende a" (notas
      // de Gobierno). "El patrimonio está compuesto por capital de $X" NO es
      // el total: sin verbo de saldo no se juzga.
      re: new RegExp(
        String.raw`\b(?:total\s+(?:del?\s+)?patrimonio|patrimonio\s+(?:total|al\s+cierre|al\s+31\s+de\s+diciembre(?:\s+(?:de|del)\s+\d{4})?)|patrimonio(?:\s+(?:neto|total))?(?:\s+de\s+la\s+(?:sociedad|compa[nñ][ií]a|empresa|entidad))?\s+${AMOUNT_VERBS})\b`,
        'gi',
      ),
      values: vals(
        centsToPesos(bs?.totalEquityPrimary),
        centsToPesos(bs?.totalEquityComparative),
        snapshotPesos(primary, 'patrimonio'),
        snapshotPesos(comparative, 'patrimonio'),
      ),
      nd: false,
    },
    {
      key: 'efectivo',
      label: 'Efectivo al cierre',
      // El cierre del comparativo es la apertura del periodo actual.
      re: new RegExp(
        String.raw`\befectivo(?:\s+y\s+equivalentes(?:\s+(?:de|al)\s+efectivo)?)?\s+al\s+(?:cierre|final)(?:\s+del\s+(?:per[ií]odo|ejercicio|a[nñ]o))?(?:\s+(?:de|del)\s+\d{4})?|\befectivo\s+y\s+equivalentes(?:\s+(?:de|al)\s+efectivo)?\s+${AMOUNT_VERBS}\b`,
        'gi',
      ),
      values: vals(
        centsToPesos(niif?.cashFlow?.cashClosing),
        centsToPesos(niif?.cashFlow?.cashOpening),
        snapshotPesos(primary, 'efectivoCuenta11'),
        snapshotPesos(comparative, 'efectivoCuenta11'),
      ),
      nd: false,
    },
  ];
  if (primary) {
    const ebitdaP = ctNumber(primary, 'ebitda');
    if (ebitdaP !== undefined) {
      concepts.push({
        key: 'ebitda',
        label: 'EBITDA',
        // No "margen EBITDA" ni "EBITDA YoY": esos no son el monto.
        re: /(?<!margen\s(?:de\s)?)\bEBITDA\b(?!\s*(?:YoY|\/|%))/gi,
        values: vals(ebitdaP, ctNumber(comparative, 'ebitda')),
        nd: ebitdaP === null,
        ndMotivo: ND_PREPROCESSOR,
      });
    }
    const revenue = vals(
      ...['ingresosOperacionales', 'ingresosNetos', 'ingresos'].flatMap((k) => [
        snapshotPesos(primary, k),
        snapshotPesos(comparative, k),
      ]),
    );
    if (revenue.length > 0) {
      concepts.push({
        key: 'ingresos',
        label: 'Ingresos',
        re: INGRESOS_RE,
        rowLabelOnly: INGRESOS_ROW_RE,
        values: revenue,
        nd: false,
      });
    }
  }
  if (sources.actaConcepts || sources.acta) concepts.push(...actaConcepts(sources));
  return concepts.filter((c) => c.values.length > 0 || c.nd);
}

/**
 * Conceptos del acta: cada uno admite las cifras que la aritmética determinista
 * publica para él (y los saldos del ECP que las notas citan). Sin aritmética
 * ni saldos del ECP, cualquier cifra impresa es N/D.
 */
function actaConcepts(sources: NarrativeAnchorSources): NarrativeConcept[] {
  const a = sources.acta ?? null;
  const niif = sources.niif ?? null;
  const rows = niif?.equityChanges?.rows ?? [];
  const pesos = (v: string | null | undefined) => centsToPesos(v ?? null);
  const reservaAcumulada = sources.primary?.equityBreakdown?.reservaLegal;
  // Sin aritmética, sólo los saldos del ECP (reserva acumulada, dividendos
  // decretados en el periodo) sirven de ancla; sin ellos la cifra carece de base.
  const concept = (
    key: NarrativeConceptKey,
    label: string,
    re: RegExp,
    values: number[],
  ): NarrativeConcept => ({ key, label, re, values, nd: a === null && values.length === 0, ndMotivo: ND_ACTA });
  // Dividendos pagados que presenta el EFE (financiación): una nota que los cita
  // con su monto es honesta aunque se hayan decretado en otro ejercicio.
  const efeDividends = (niif?.cashFlow?.sections ?? []).flatMap((s) =>
    (s.lines ?? []).filter((l) => /dividend/i.test(l.label)).map((l) => pesos(l.amountPrimary)),
  );
  return [
    concept(
      'dividendos',
      'Dividendos',
      // "Dividendos por pagar / por cobrar / recibidos" e "ingresos por
      // dividendos" son saldos del balance o ingresos, no la distribución del acta.
      /(?<!ingresos\s+por\s+)\bdividendos?\b(?!\s+(?:por\s+(?:pagar|cobrar)|recibidos?))|\butilidades?\s+(?:a\s+distribuir|distribuibles?|por\s+distribuir)\b|\bsaldo\s+distribuible\b|\bm[ií]nimo\s+(?:legal\s+)?a\s+repartir\b/gi,
      vals(
        pesos(a?.distribuibleCop),
        pesos(a?.saldoDistribuibleCop),
        pesos(a?.minimoArt155Cop),
        pesos(a?.deficitArt155Cop),
        // La capitalización es un dividendo pagado en acciones.
        pesos(a?.capitalizationAmountCop),
        ...rows.filter((r) => r.kind === 'dividend_distribution').map((r) => pesos(r.total)),
        ...efeDividends,
      ),
    ),
    concept(
      'reservaLegal',
      'Reserva legal',
      /\breserva\s+legal\b/gi,
      vals(
        pesos(a?.reservaLegalDelEjercicioCop),
        pesos(a?.apropiacionTeorica10Cop),
        pesos(a?.reservaLegalPendienteCop),
        pesos(a?.techoArt452Cop),
        typeof reservaAcumulada === 'number' ? reservaAcumulada : null,
        ...rows
          .filter((r) => ['opening_balance', 'closing_balance', 'reserve_appropriation'].includes(r.kind))
          .map((r) => pesos(r.reservaLegal)),
      ),
    ),
    concept(
      'capitalizacion',
      'Monto a capitalizar',
      /\bcapitaliza(?:ci[oó]n|r)\b/gi,
      vals(pesos(a?.capitalizationAmountCop), pesos(a?.capitalizationBaseCop)),
    ),
  ];
}

/**
 * Menciones que NO se juzgan pero cortan la ventana de los conceptos: en
 * "reserva legal y reserva ocasional por $X" el monto es de la ocasional.
 */
const WINDOW_STOPS: RegExp[] = [
  /\breserva\s+(?:ocasional|estatutaria)/i,
  /\benjug(?:ar|amiento)/i,
  /\bcapital\s+(?:suscrito|social|pagado)/i,
  /\bp[eé]rdidas?\s+(?:acumuladas|de\s+ejercicios\s+anteriores)/i,
  /\butilidades\s+acumuladas/i,
  /\btecho\b/i,
];

// ---------------------------------------------------------------------------
// Núcleo: menciones → primera cifra
// ---------------------------------------------------------------------------

const VARIATION_WORDS =
  /variaci|aument|disminu|increment|reducci|redujo|cay[oó]|ca[ií]da|crec|diferencia|cambio|pas[oó]\s+de|mejor[oó]|empeor|frente\s+a|respecto|\bvs\.?/i;
/** Proyecciones, metas, referencias sectoriales y cifras que no son el saldo del periodo. */
const FORWARD_WORDS =
  /proyect|estim|esperad|previst|presupuest|escenario|objetivo|\bmetas?\b|potencial|\balcanzar(?:[aá]n?|[ií]a)?\b|\blograr(?:[aá]n?|[ií]a)?\b|llegar[ií]a|podr[ií]a|ser[ií]a|anualizad|mensual|trimestral|sector|benchmark|promedio|pro\s*forma|a\s+partir\s+de/i;
/**
 * Futuro y condicional de los verbos con que se redacta un impacto
 * ("elevaría", "subirá", "quedaría", "tendrá"): la cifra es hipotética. Sólo
 * formas inequívocas (infinitivo + "ía"/"á"); el presente ("queda", "genera")
 * sí se juzga.
 */
const FUTURE_OR_CONDITIONAL =
  /(?<![\p{L}])(?:aumentar|elevar|subir|incrementar|mejorar|reducir|disminuir|bajar|pasar|quedar|ubicar|situar|generar|liberar|cerrar|ascender|llevar|crecer|representar|ser|estar|tendr|habr|podr|deber|saldr|valdr)(?:[ií]an?|[áÁ]n?)(?![\p{L}])/iu;
/** "4.000.000 de pesos", "4.000.000,00 pesos m/cte.": la palabra marca el monto. */
const CURRENCY_WORD_AFTER = /^[(\s−-]*[\d.,]+\s*\)?\s*(?:de\s+)?pesos\b/i;
/** Cifra presentada como parte del concepto, no como su saldo. */
const COMPONENT_WORDS = /incluy|compuest|conformad|concentr|\bcubr|de\s+los\s+cuales|de\s+las\s+cuales/i;
/** Monto por unidad ("$200,00 por acción", "$15 / cuota"): no es el total del concepto. */
const PER_UNIT_AFTER =
  /^[(\s−-]*\$?\s*\(?\s*[-−]?\s*[\d.,]+\s*\)?\s*(?:MM|M|millones|mil\s+millones)?\s*(?:por|\/|cada)\s*(?:acci[oó]n|cuota|parte\s+de\s+inter[eé]s|participaci[oó]n)/i;
const POSITIVE_WORDS = /positiv|super[aá]vit|excedente|ganancia/i;
const NEGATIVE_WORDS = /negativ|p[eé]rdida|d[eé]ficit/i;
export const ROE_LABEL = /\bROE\b|rentabilidad\s+(?:del|sobre\s+el)\s+patrimonio/i;

/** Tramo tras el rótulo hasta el fin de la frase o la mención de otro concepto. */
export function windowAfter(text: string, from: number, stops: RegExp[]): string {
  const rest = text.slice(from, from + 160);
  // Fin de frase: signo seguido de espacio o fin (el punto de miles va seguido de dígito).
  const sentenceEnd = /[.;!?](?=\s|$)/.exec(rest);
  let cut = sentenceEnd ? sentenceEnd.index + 1 : rest.length;
  for (const re of stops) {
    const hit = new RegExp(re.source, re.flags.replace('g', '')).exec(rest);
    if (hit && hit.index > 0 && hit.index < cut) cut = hit.index;
  }
  return rest.slice(0, cut);
}

/** Tramo de la frase ANTES de la mención ("Para 2026 se proyecta una utilidad neta…"). */
function sentencePrefix(text: string, index: number): string {
  const prefix = text.slice(0, index);
  const cut = Math.max(
    prefix.lastIndexOf('. '),
    prefix.lastIndexOf('; '),
    prefix.lastIndexOf('? '),
    prefix.lastIndexOf('! '),
    prefix.lastIndexOf('\n'),
  );
  return prefix.slice(cut + 1);
}

function mentionsFutureYear(text: string, primaryYear: string | null | undefined): boolean {
  if (!primaryYear) return false;
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    if (Number(m[1]) > Number(primaryYear)) return true;
  }
  return false;
}

/**
 * ¿La cifra es una proyección? `before` es el tramo entre la mención y la
 * cifra; `prefix`, la frase antes de la mención. El futuro/condicional sólo
 * cuenta en `before` o en la última cláusula del prefijo: en "El acta, que
 * será firmada, indica que la utilidad neta fue de $X" el "será" no rige la cifra.
 */
function isForwardLooking(before: string, prefix: string, primaryYear: string | null | undefined): boolean {
  const lastClause = prefix.slice(Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(':')) + 1);
  return (
    [before, prefix].some((p) => FORWARD_WORDS.test(p) || mentionsFutureYear(p, primaryYear)) ||
    FUTURE_OR_CONDITIONAL.test(before) ||
    FUTURE_OR_CONDITIONAL.test(lastClause)
  );
}

function subjectOf(options: NarrativeCheckOptions): string {
  const s = options.subject ?? { es: 'la narrativa', en: 'the narrative' };
  return options.language === 'en' ? s.en : s.es;
}

/**
 * Cruza las menciones de conceptos anclados de cada unidad de texto. Devuelve
 * los hallazgos y cuántas menciones con cifra se contrastaron.
 */
export function checkNarrativeUnits(
  units: NarrativeUnit[],
  concepts: NarrativeConcept[],
  options: NarrativeCheckOptions = {},
): { findings: NarrativeFinding[]; checked: number } {
  const en = options.language === 'en';
  const subject = subjectOf(options);
  const findings: NarrativeFinding[] = [];
  const seen = new Set<string>();
  let checked = 0;
  const push = (where: string | undefined, detail: string) => {
    const key = `${where ?? ''}::${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ where, detail });
  };

  for (const unit of units) {
    if (options.skipForwardLooking && unit.forwardLooking) continue;
    const prose = options.lenientProse === true && !unit.firstCell;
    for (const concept of concepts) {
      const stops = [...concepts.filter((c) => c !== concept).map((c) => c.re), ROE_LABEL, ...WINDOW_STOPS];
      const matches: Array<{ index: number; text: string }> = [];
      const re = new RegExp(concept.re.source, concept.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(unit.text)) !== null) matches.push({ index: m.index, text: m[0] });
      if (concept.rowLabelOnly && unit.firstCell && concept.rowLabelOnly.test(unit.firstCell)) {
        matches.push({ index: 0, text: unit.firstCell });
      }
      for (const hit of matches) {
        const win = windowAfter(unit.text, hit.index + hit.text.length, stops);
        const token = extractCopTokens(win).find((t) => {
          if (t.percent) return false;
          if (PER_UNIT_AFTER.test(win.slice(t.index))) return false;
          if (!options.requireCurrency) return true;
          return (
            t.abbreviated ||
            /^[(\s−-]*\$/.test(win.slice(t.index)) ||
            /\bCOP\s*$/i.test(win.slice(0, t.index)) ||
            CURRENCY_WORD_AFTER.test(win.slice(t.index))
          );
        });
        if (!token) continue;
        const before = win.slice(0, token.index);
        if (VARIATION_WORDS.test(before)) continue;
        if (prose && COMPONENT_WORDS.test(before)) continue;
        if (
          options.skipForwardLooking &&
          isForwardLooking(before, sentencePrefix(unit.text, hit.index), options.primaryYear)
        ) {
          continue;
        }
        checked += 1;
        const shown = token.abbreviated
          ? `${fmtPesos(token.value)} (${en ? 'abbreviated' : 'abreviado'})`
          : fmtPesos(token.value);
        const context = `"${unit.text.slice(hit.index, hit.index + 90)}"`;
        if (concept.nd) {
          const motivo = concept.ndMotivo ?? ND_PREPROCESSOR;
          push(
            unit.where,
            en
              ? `${concept.label}: ${subject} prints ${shown} in ${context} and ${motivo.en}.`
              : `${concept.label}: ${subject} imprime ${shown} en ${context} y ${motivo.es}.`,
          );
          continue;
        }
        const tol = Math.max(1, token.roundingTolerance);
        const match = concept.values.find((v) => Math.abs(Math.abs(token.value) - Math.abs(v)) <= tol);
        if (match === undefined) {
          push(
            unit.where,
            en
              ? `${concept.label}: ${subject} prints ${shown} in ${context} and the report gives ` +
                  `${concept.values.map(fmtPesos).join(' / ')}.`
              : `${concept.label}: ${subject} imprime ${shown} en ${context} y el reporte da ` +
                  `${concept.values.map(fmtPesos).join(' / ')}.`,
          );
          continue;
        }
        if (match === 0) continue;
        // Signo: el rótulo ("pérdida" / "utilidad") o el calificativo
        // ("positivo" / "negativo") contra el signo del ancla. En prosa, un
        // "($X)" sin signo menos es un inciso: no dice nada del signo.
        const rest = win.slice(token.index);
        const asideParen = prose && token.value < 0 && /^\(/.test(rest) && !/^\(\s*\$?\s*[-−]/.test(rest);
        const shownValue = asideParen ? Math.abs(token.value) : token.value;
        const labelPolarity = concept.polarity?.(hit.text) ?? null;
        const negWord = NEGATIVE_WORDS.test(before);
        const posWord = POSITIVE_WORDS.test(before);
        const presentedNegative = (!asideParen && shownValue < 0) || labelPolarity === 'neg' || negWord;
        const presentedPositive =
          !asideParen && shownValue >= 0 && !negWord && (labelPolarity === 'pos' || posWord);
        if (match < 0 && presentedPositive) {
          push(
            unit.where,
            en
              ? `${concept.label}: is negative (${fmtPesos(match)}) and ${subject} presents it as positive in ${context}.`
              : `${concept.label}: es negativa (${fmtPesos(match)}) y ${subject} la presenta como positiva en ${context}.`,
          );
        } else if (match > 0 && presentedNegative) {
          push(
            unit.where,
            en
              ? `${concept.label}: is positive (${fmtPesos(match)}) and ${subject} presents it as negative in ${context}.`
              : `${concept.label}: es positiva (${fmtPesos(match)}) y ${subject} la presenta como negativa en ${context}.`,
          );
        }
      }
    }
  }
  return { findings, checked };
}

/**
 * ROE citado en prosa o tablas contra el del preprocesador, a la precisión
 * impresa. Sin snapshot con el campo `roe` no se juzga.
 */
export function checkRoeUnits(
  units: NarrativeUnit[],
  primary: PeriodSnapshot | null | undefined,
  comparative: PeriodSnapshot | null | undefined,
  options: NarrativeCheckOptions = {},
): { findings: NarrativeFinding[]; checked: number } {
  const p = ctNumber(primary, 'roe');
  if (p === undefined) return { findings: [], checked: 0 };
  const en = options.language === 'en';
  const subject = subjectOf(options);
  const c = ctNumber(comparative, 'roe');
  const valid = [p, c].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const findings: NarrativeFinding[] = [];
  const seen = new Set<string>();
  let checked = 0;
  for (const unit of units) {
    if (options.skipForwardLooking && unit.forwardLooking) continue;
    const re = new RegExp(ROE_LABEL.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(unit.text)) !== null) {
      const win = windowAfter(unit.text, m.index + m[0].length, []);
      const pct = /([<>≥≤]\s*)?([-−+]?\s*\d{1,3}(?:[.,]\d+)?)\s*%/.exec(win);
      if (!pct || pct[1]) continue; // "> 15 %" es una banda, no el ROE
      const before = win.slice(0, pct.index);
      if (VARIATION_WORDS.test(before) || /sector|benchmark|meta|objetivo|banda|referencia|m[ií]nimo/i.test(before)) {
        continue;
      }
      if (
        options.skipForwardLooking &&
        isForwardLooking(before, sentencePrefix(unit.text, m.index), options.primaryYear)
      ) {
        continue;
      }
      const raw = pct[2].replace(/\s/g, '').replace('−', '-').replace('+', '');
      const decimals = /[.,]/.test(raw) ? raw.split(/[.,]/)[1].length : 0;
      const value = Number(raw.replace(',', '.'));
      if (!Number.isFinite(value)) continue;
      checked += 1;
      const tol = 0.5 * 10 ** -decimals + 1e-9;
      let detail: string | null = null;
      if (valid.length === 0) {
        detail = en
          ? `ROE: ${subject} prints ${pct[2].trim()} % and ${ND_PREPROCESSOR.en}.`
          : `ROE: ${subject} imprime ${pct[2].trim()} % y ${ND_PREPROCESSOR.es}.`;
      } else if (!valid.some((v) => Math.abs(v - value) <= tol)) {
        const expected = valid.map((v) => `${v.toFixed(1).replace('.', ',')} %`).join(' / ');
        detail = en
          ? `ROE: ${subject} prints ${pct[2].trim()} % and the preprocessor computes ${expected}.`
          : `ROE: ${subject} imprime ${pct[2].trim()} % y el preprocesador calcula ${expected}.`;
      }
      if (detail) {
        const key = `${unit.where ?? ''}::${detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push({ where: unit.where, detail });
        }
      }
    }
  }
  return { findings, checked };
}

/**
 * Años de corte ajenos al periodo: una frase que declara el corte de los
 * estados ("estados financieros al 31 de diciembre de 2024") con un año
 * distinto del periodo del reporte. Un año comparativo citado como tal
 * ("… de 2024 (comparativo)") o los dos cortes ("… de 2025 y 2024") no cuentan.
 */
export function findForeignCutoffYears(units: NarrativeUnit[], primaryYear: string | null | undefined): string[] {
  if (!primaryYear) return [];
  const found = new Set<string>();
  for (const unit of units) {
    const re =
      /\b(?:estados?(?:\s+financieros?|\s+de\s+situaci[oó]n\s+financiera)?|cifras|informe|corte|cierre)\s+(?:con\s+corte\s+)?(?:al|a)\s+31\s+de\s+diciembre\s+(?:de|del)\s+(\d{4})(?!\s*(?:y|e)\s+\d{4})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(unit.text)) !== null) {
      const tail = unit.text.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (/comparativ|anterior/i.test(tail)) continue;
      if (m[1] !== primaryYear) found.add(m[1]);
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Unidades de texto de Gobierno y Estrategia
// ---------------------------------------------------------------------------

function unit(text: string | null | undefined, where: string, forwardLooking = false): NarrativeUnit[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const clean = text.replace(/\u00a0/g, ' ').replace(/\$\s+/g, '$').replace(/\s+/g, ' ').trim();
  return [forwardLooking ? { text: clean, where, forwardLooking } : { text: clean, where }];
}

/** Prosa de la Parte III que llega al entregable (notas, acta, checklist, avisos). */
export function governanceNarrativeUnits(json: GovernanceReportJson, language: 'es' | 'en' = 'es'): NarrativeUnit[] {
  const en = language === 'en';
  const out: NarrativeUnit[] = [];
  for (const n of json.financialNotes ?? []) {
    if (n.materiality === 'omitted') continue;
    out.push(...unit(n.body, `${en ? 'Note' : 'Nota'} ${n.number} — ${n.title}`));
  }
  const m = json.shareholderMinutes;
  if (m) {
    const acta = en ? 'Minutes' : 'Acta';
    out.push(...unit(m.convocationStatement, `${acta} — ${en ? 'call notice' : 'convocatoria'}`));
    out.push(...unit(m.quorumStatement, `${acta} — quorum`));
    for (const item of m.agenda ?? []) {
      out.push(...unit(item.topic, `${acta} — ${en ? 'agenda' : 'orden del día'} ${item.number}`));
    }
    for (const d of m.developments ?? []) {
      out.push(...unit(d.body, `${acta} — ${en ? 'item' : 'punto'} ${d.itemNumber}`));
    }
    out.push(
      ...unit(m.resultDistribution?.neutralProposalText, `${acta} — ${en ? 'allocation proposal' : 'propuesta de destinación'}`),
    );
    if (m.capitalizationProposal?.applies) {
      out.push(...unit(m.capitalizationProposal.body, `${acta} — ${en ? 'capitalization' : 'capitalización'}`));
    }
    out.push(...unit(m.closingStatement, `${acta} — ${en ? 'closing' : 'cierre'}`));
  }
  (json.complianceChecklist ?? []).forEach((c, i) => {
    const where = `${en ? 'Compliance checklist' : 'Checklist normativo'} ${i + 1}`;
    out.push(...unit(c.evidencia, where), ...unit(c.accionRequerida, where));
  });
  for (const d of json.disclaimers ?? []) {
    out.push(...unit(d.trigger, `${en ? 'Disclaimer' : 'Aviso'} ${d.code}`));
  }
  (json.preparerNotes ?? []).forEach((p, i) => {
    out.push(...unit(p.body, `${en ? 'Preparer note' : 'Nota del preparador'} ${i + 1}`));
  });
  return out;
}

/** Prosa de la Parte II que llega al entregable. */
export function strategyNarrativeUnits(json: StrategyReportJson, language: 'es' | 'en' = 'es'): NarrativeUnit[] {
  const en = language === 'en';
  const out: NarrativeUnit[] = [];
  const dash = json.executiveDashboard;
  out.push(...unit(dash?.executiveCommentary, en ? 'Executive commentary' : 'Comentario ejecutivo'));
  for (const r of dash?.rows ?? []) out.push(...unit(r.commentary, `Dashboard — ${r.label}`));
  for (const a of json.technicalAlerts ?? []) {
    out.push(...unit(a.description, `${en ? 'Technical alert' : 'Alerta técnica'} — ${a.title}`));
  }
  for (const k of json.kpis ?? []) out.push(...unit(k.diagnosis, `KPI ${k.name}`));
  out.push(...unit(json.dupontAnalysis?.drivingFactor, 'DuPont'));
  out.push(...unit(json.trends?.qualitativeCommentary, en ? 'Trends' : 'Tendencias'));
  out.push(...unit(json.breakEven?.classificationNote, en ? 'Break-even' : 'Punto de equilibrio'));
  out.push(...unit(json.projectedCashFlow?.solvencyNarrative, en ? 'Solvency' : 'Solvencia'));
  (json.recommendations ?? []).forEach((r, i) => {
    const where = `${en ? 'Recommendation' : 'Recomendación'} ${i + 1}`;
    // La acción y el impacto esperado describen el futuro por construcción.
    out.push(...unit(r.diagnosis, where), ...unit(r.action, where, true), ...unit(r.expectedImpact, where, true));
  });
  (json.preparerNotes ?? []).forEach((p, i) => {
    out.push(...unit(p.body, `${en ? 'Preparer note' : 'Nota del preparador'} ${i + 1}`));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Prosa del JSON NIIF (Parte I, I5-3)
// ---------------------------------------------------------------------------
// Las notas de los estados (ESF, ERI, ECP), la nota de método del EFE y las
// notas técnicas son texto del modelo que el Markdown, el PDF y el Excel
// imprimen tal cual: una "utilidad neta de $X" falsa en una nota técnica salía
// "procedencia verificada" aunque las cifras de las tablas cuadraran al
// centavo. Se cruzan los conceptos con ancla de la Parte I —utilidad/pérdida
// neta, efectivo, patrimonio, activos, pasivos e ingresos— con las mismas
// reglas que la prosa de las Partes II y III. No se juzgan aquí EBITDA, ROE ni
// años de corte: no son conceptos de los estados y las notas técnicas citan
// cortes de apertura y comparativos por diseño.
// ---------------------------------------------------------------------------

const NIIF_NARRATIVE_KEYS: ReadonlySet<NarrativeConceptKey> = new Set([
  'utilidadNeta',
  'efectivo',
  'patrimonio',
  'activo',
  'pasivo',
  'ingresos',
]);

/** Prosa del JSON NIIF que llega al entregable (notas de los estados y notas técnicas). */
export function niifNarrativeUnits(json: NiifReportJson, language: 'es' | 'en' = 'es'): NarrativeUnit[] {
  const en = language === 'en';
  const noteWord = en ? 'Note' : 'Nota';
  const out: NarrativeUnit[] = [];
  const notes = (list: NiifReportJson['balanceSheet']['notes'] | undefined, section: string) => {
    (list ?? []).forEach((n, i) => {
      const ref = typeof n.ref === 'string' && n.ref.trim() && n.ref.trim() !== '*' ? n.ref.trim() : `${noteWord} ${i + 1}`;
      out.push(...unit(n.body, `${section} — ${ref}`));
    });
  };
  notes(json.balanceSheet?.notes, en ? 'Statement of financial position' : 'Estado de situación financiera');
  notes(json.incomeStatement?.notes, en ? 'Statement of comprehensive income' : 'Estado de resultados integral');
  out.push(...unit(json.cashFlow?.methodNote, en ? 'Statement of cash flows — method' : 'Estado de flujos de efectivo — método'));
  notes(json.equityChanges?.notes, en ? 'Statement of changes in equity' : 'Estado de cambios en el patrimonio');
  notes(json.technicalNotes, en ? 'Technical notes' : 'Notas técnicas');
  return out;
}

/**
 * Conceptos de la Parte I. Los ingresos admiten además los renglones de
 * ingresos del propio ERI (ya cruzados contra el balance por el validador del
 * JSON NIIF): una nota que cita los ingresos brutos o la línea de otros
 * ingresos con su cifra es honesta.
 *
 * El efectivo y el patrimonio admiten también los saldos que imprimen el EFE y
 * el ECP del propio informe, incluidos los del periodo comparativo (revisión
 * I5-3): con tres cortes, el EFE y el ECP comparativos abren con el corte
 * anterior al comparativo (p. ej. 2023 en un informe 2025/2024), que no es
 * ninguno de los dos snapshots, y la nota que cita ese saldo de apertura es
 * honesta. Esos saldos los calcula el código y el validador del JSON NIIF los
 * cruza contra el balance (E2/E3/E18/E23 del EFE comparativo; E4/E7 del ECP).
 */
function niifNarrativeConcepts(json: NiifReportJson, sources: NarrativeAnchorSources): NarrativeConcept[] {
  const concepts = buildNarrativeConcepts({ ...sources, niif: json, acta: null, actaConcepts: false }).filter((c) =>
    NIIF_NARRATIVE_KEYS.has(c.key),
  );
  const cf = json.cashFlow;
  const statementValues: Partial<Record<NarrativeConceptKey, number[]>> = {
    efectivo: vals(
      centsToPesos(cf?.cashOpeningComparative),
      centsToPesos(cf?.cashClosingComparative),
    ),
    patrimonio: vals(
      ...[...(json.equityChanges?.rows ?? []), ...(json.equityChanges?.comparativeRows ?? [])]
        .filter((r) => r.kind === 'opening_balance' || r.kind === 'closing_balance')
        .map((r) => centsToPesos(r.total)),
    ),
  };
  for (const concept of concepts) {
    const extra = statementValues[concept.key];
    if (extra && extra.length > 0) concept.values = vals(...concept.values, ...extra);
  }
  const revenueLines = vals(
    ...(json.incomeStatement?.lines ?? [])
      .filter((l) => /ingres|venta/i.test(l.label) && !/costo|gasto/i.test(l.label))
      .flatMap((l) => [centsToPesos(l.amountPrimary), centsToPesos(l.amountComparative)]),
  );
  if (revenueLines.length === 0) return concepts;
  const ingresos = concepts.find((c) => c.key === 'ingresos');
  if (ingresos) {
    ingresos.values = vals(...ingresos.values, ...revenueLines);
    return concepts;
  }
  return [
    ...concepts,
    { key: 'ingresos', label: 'Ingresos', re: INGRESOS_RE, rowLabelOnly: INGRESOS_ROW_RE, values: revenueLines, nd: false },
  ];
}

/**
 * Parte I: montos de conceptos anclados en las notas de los estados y en las
 * notas técnicas contra el propio JSON NIIF (totales, EFE) y el balance
 * preprocesado. La usan `runNiifPhase` (orchestrator.ts) y el servidor
 * (`serverNiifIntegrity`, src/lib/reports/part-verdicts.ts) con las mismas
 * fuentes: paridad fase ↔ servidor.
 */
export function checkNiifNarrative(
  json: NiifReportJson,
  sources: NarrativeAnchorSources,
  language: 'es' | 'en' = 'es',
): NarrativeCheckResult {
  const primaryYear = yearOf(json.company?.fiscalPeriod) ?? yearOf(sources.primary?.period);
  const options: NarrativeCheckOptions = {
    language,
    subject: { es: 'la nota', en: 'the note' },
    requireCurrency: true,
    skipForwardLooking: true,
    lenientProse: true,
    primaryYear,
  };
  const money = checkNarrativeUnits(niifNarrativeUnits(json, language), niifNarrativeConcepts(json, sources), options);
  return {
    findings: money.findings,
    checked: money.checked,
    motivos: money.findings.map((f) => (f.where ? `${f.where} · ${f.detail}` : f.detail)),
  };
}

/** Sello de la Parte I por cifras en las notas sin respaldo (texto; el veredicto lo fija el llamador). */
export function buildNiifNarrativeSeal(motivos: readonly string[], language: 'es' | 'en' = 'es'): string {
  const en = language === 'en';
  return [
    en
      ? '> ## REPORT WITH QUALIFICATIONS — FIGURES IN NOTES WITHOUT SUPPORT'
      : '> ## REPORTE CON SALVEDADES — CIFRAS EN NOTAS SIN RESPALDO',
    '>',
    en
      ? '> Figures quoted in the notes to the statements or in the technical notes contradict the statements ' +
        'or the trial balance. This report is NOT signable as issued:'
      : '> Cifras citadas en las notas de los estados o en las notas técnicas contradicen los estados o el ' +
        'balance. Este informe NO es firmable tal como está:',
    '>',
    ...motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// API de alto nivel
// ---------------------------------------------------------------------------

export interface NarrativeCheckResult {
  /** Motivos listos para `actaQualifications` / `strategyQualifications`. */
  motivos: string[];
  findings: NarrativeFinding[];
  /** Menciones con cifra efectivamente contrastadas. */
  checked: number;
}

function runNarrativeCheck(
  units: NarrativeUnit[],
  sources: NarrativeAnchorSources,
  primaryYear: string | null,
  language: 'es' | 'en',
): NarrativeCheckResult {
  const en = language === 'en';
  const options: NarrativeCheckOptions = {
    language,
    subject: { es: 'la narrativa', en: 'the narrative' },
    requireCurrency: true,
    skipForwardLooking: true,
    lenientProse: true,
    primaryYear,
  };
  const concepts = buildNarrativeConcepts(sources);
  const money = checkNarrativeUnits(units, concepts, options);
  const roe = checkRoeUnits(units, sources.primary, sources.comparative, options);
  const findings = [...money.findings, ...roe.findings];
  const cutoff = findForeignCutoffYears(units, primaryYear);
  if (cutoff.length > 0) {
    findings.push({
      detail: en
        ? `The narrative declares statements cut off at December 31, ${cutoff.join(', ')} and the report covers ${primaryYear}.`
        : `La narrativa declara estados con corte al 31 de diciembre de ${cutoff.join(', ')} y el reporte corresponde al periodo ${primaryYear}.`,
    });
  }
  return {
    findings,
    checked: money.checked + roe.checked,
    motivos: findings.map((f) => (f.where ? `${f.where} · ${f.detail}` : f.detail)),
  };
}

/**
 * Parte III (notas + acta): montos de conceptos anclados en la prosa contra el
 * balance, el JSON NIIF y la aritmética determinista del acta. Sin aritmética
 * del acta, un dividendo, una reserva legal o una capitalización con monto
 * carecen de base.
 */
export function checkGovernanceNarrative(
  json: GovernanceReportJson,
  sources: NarrativeAnchorSources,
  language: 'es' | 'en' = 'es',
): NarrativeCheckResult & { notesFindings: number; actaFindings: number } {
  const primaryYear =
    yearOf(sources.niif?.company?.fiscalPeriod) ?? yearOf(json.company?.fiscalPeriod) ?? yearOf(sources.primary?.period);
  const units = governanceNarrativeUnits(json, language);
  const result = runNarrativeCheck(units, { ...sources, actaConcepts: true }, primaryYear, language);
  const notePrefix = language === 'en' ? 'Note ' : 'Nota ';
  const notesFindings = result.findings.filter((f) => f.where?.startsWith(notePrefix)).length;
  return { ...result, notesFindings, actaFindings: result.findings.length - notesFindings };
}

/** Parte II: prosa (comentarios, diagnósticos, recomendaciones) contra el balance. */
export function checkStrategyNarrative(
  json: StrategyReportJson,
  sources: NarrativeAnchorSources,
  language: 'es' | 'en' = 'es',
): NarrativeCheckResult {
  const primaryYear =
    yearOf(sources.niif?.company?.fiscalPeriod) ?? yearOf(json.company?.fiscalPeriod) ?? yearOf(sources.primary?.period);
  return runNarrativeCheck(strategyNarrativeUnits(json, language), sources, primaryYear, language);
}

/**
 * Sella la Parte III cuando la prosa cita cifras que contradicen sus anclas:
 * los motivos se suman a `actaQualifications` (el veredicto que los gates de
 * exportación y del HTML ya leen) y el sello viaja en el cuerpo de la sección
 * afectada, porque un evento SSE `warning` no llega al entregable.
 */
export function sealGovernanceNarrative(
  governance: GovernanceResult,
  check: NarrativeCheckResult & { notesFindings: number; actaFindings: number },
  language: 'es' | 'en' = 'es',
): void {
  if (check.motivos.length === 0) return;
  const en = language === 'en';
  const previous = governance.actaQualifications?.motivos ?? [];
  governance.actaQualifications = {
    clean: false,
    motivos: Array.from(new Set([...previous, ...check.motivos])),
  };
  const seal = [
    en
      ? '> ## PART III WITH QUALIFICATIONS — NARRATIVE FIGURES WITHOUT SUPPORT'
      : '> ## PARTE III CON SALVEDADES — CIFRAS EN PROSA SIN RESPALDO',
    '>',
    en
      ? '> Figures quoted in the notes or the minutes contradict the trial balance or the deterministic ' +
        'arithmetic of the minutes. This section is NOT signable as issued:'
      : '> Cifras citadas en las notas o en el acta contradicen el balance o la aritmética determinista ' +
        'del acta. Esta sección NO es firmable tal como está:',
    '>',
    ...check.motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
  if (check.notesFindings > 0) governance.financialNotes = `${seal}\n${governance.financialNotes}`;
  if (check.actaFindings > 0) governance.shareholderMinutes = `${seal}\n${governance.shareholderMinutes}`;
  governance.fullContent = `${seal}\n${governance.fullContent}`;
}
