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
//
// Re-auditoría 2 de la fase 2 (2026-09-24). Ninguna cifra sin respaldo puede
// salir "procedencia verificada" y ningún informe honesto puede quedar
// sellado; cuando una heurística choca con los dos objetivos, la frase ambigua
// no se juzga y una regla más estrecha cubre el caso:
//   - Vocabulario habitual (narrativa-09/10, procedencia-R2-01): "la utilidad /
//     el resultado / la pérdida del ejercicio", "obtuvo utilidades por", "los
//     activos ascienden", "los ingresos del ejercicio", "el disponible", "caja
//     y bancos", "distribuir … la suma de", "se capitalizan", "utilidades
//     líquidas", reserva ocasional y enjugamiento. Las redacciones nuevas sólo
//     cuentan en prosa (`proseRe`): en una fila de tabla la primera cifra
//     puede ser otra columna.
//   - El NIVEL tras un verbo de variación sí se juzga ("aumentó a", "creció
//     hasta", "pasó de A a B" → B; narrativa-12); la variación misma no.
//   - Un negativo impreso sin signo bajo un rótulo neutro (patrimonio,
//     resultado, EBITDA) se lee positivo (narrativa-13).
//   - No se juzgan: la aritmética del acta regida por un porcentaje ("el 10 %
//     de la utilidad neta, es decir $Y" vale si Y es esa fracción o una cifra
//     del acta), los subtotales ("total de activos fijos"), los componentes
//     ("se compone de"), lo que queda tras restar un concepto ("apropiada la
//     reserva legal, queda…"), los partitivos ("del total de activos, $X…"),
//     otra magnitud en medio ("el impuesto de renta de $X") y las cifras en
//     otra unidad ("unidades", "USD") o que son identificadores (NIT, C.C.).
//   - Revisión adversarial: los activos / pasivos sólo cuentan como sujeto
//     ("la depreciación de los activos fue de", "los otros activos suman" no
//     son el total), los flujos de efectivo no son el saldo, el fin de palabra
//     reconoce tildes ("ascendió", "distribuyó", "se ubicó"), una relativa
//     ("…, que ascendió a $X") es del sustantivo que la precede y una cifra
//     del acta regida por un porcentaje no puede exceder esa fracción de la base.
// Límites conocidos: la prosa en inglés y las cifras en palabras no se cruzan;
// una redacción fuera de estas listas queda sin juzgar (no sella ni verifica).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildPeriodAnchors } from '../contracts/anchors';
import type { ActaArithmetic } from '../contracts/base';
import { formatCopFromCents } from '../contracts/money';
import type { GovernanceReportJson } from '../contracts/governance-report';
import type { EquityChangeRowJson, NiifReportJson } from '../contracts/niif-report';
import type { StrategyReportJson } from '../contracts/strategy-report';
import type { GovernanceResult } from '../types';
import { extractCopTokens, type CopToken } from './report-validator';

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
  | 'capitalizacion'
  | 'reservaOcasional'
  | 'enjugue'
  | 'utilidadLiquida';

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
  /**
   * Redacciones de prosa (bandera `g`) que no cuentan en filas de tabla:
   * "la utilidad del ejercicio", "los activos ascienden a", "el disponible".
   * En una tabla la primera cifra de una fila puede ser otra columna (la fila
   * "Utilidad del ejercicio 2024" del ECP abre con la columna Capital).
   */
  proseRe?: RegExp;
  /** Cortes de ventana propios del concepto ("queda un saldo" tras la reserva legal). */
  windowStops?: RegExp[];
  /** Texto tras la cifra que la atribuye a otra partida ("… en la venta de activos"). */
  skipIfAfter?: RegExp;
  /**
   * Bases adicionales para una mención regida por un porcentaje ("el 50 % de
   * la utilidad neta, una vez apropiada la reserva legal, es decir $Y").
   */
  percentBases?: number[];
  /** Cifras de la aritmética del acta que valen como resultado de ese porcentaje. */
  percentResults?: number[];
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

/**
 * Fin de palabra que reconoce las tildes. Sin la bandera `u`, `\b` de JS sólo
 * conoce [A-Za-z0-9_]: "ascendió", "distribuyó", "se ubicó" o "capitalizó"
 * seguidos de un espacio no cumplían `[oó]\b` y la mención no se reconocía
 * (revisión adversarial de la re-auditoría 2).
 */
const WORD_END = String.raw`(?![A-Za-zÀ-ÖØ-öø-ÿ0-9_])`;

/**
 * Verbos que introducen el monto de un saldo en prosa ("asciende a", "es de",
 * "los activos suman"). El futuro ("ascenderá") se reconoce aquí pero la
 * mención queda como proyección (`FUTURE_OR_CONDITIONAL` sobre el rótulo).
 */
const AMOUNT_VERBS = String.raw`(?:asciende|ascienden|ascendi[oó]|ascendieron|ascender[aá]n?|es\s+de|son\s+de|fue\s+de|fueron\s+de|era\s+de|eran\s+de|cerr[oó]\s+en|cerraron\s+en|totaliza|totalizan|totaliz[oó]|totalizaron|suma|suman|sum[oó]|sumaron|alcanz[oó]|alcanzaron|se\s+ubic(?:[oó]|aron)\s+en)`;

/**
 * Partida del resultado, no el resultado: "la pérdida del ejercicio por
 * deterioro", "la ganancia neta por diferencia en cambio", "la utilidad neta en
 * venta de activos".
 */
const LINE_ITEM = String.raw`(?:por|en)\s+(?:la\s+|el\s+)?(?:diferencia|venta|valoraci|m[eé]todo|deterioro|baja|medici|conversi|enajenaci|retiro|siniestro|cobertura|inversiones)`;

/**
 * "Los activos" como SUJETO de la frase: no "la depreciación de los activos fue
 * de", "la venta de activos fue de" ni "los otros / demás activos suman", que
 * son partidas o subtotales (revisión adversarial de la re-auditoría 2).
 */
const SUBJECT_ONLY = String.raw`(?<!\b(?:de|del|en|por|sobre|con|para|a|al|entre|hacia|desde|sin|tras|otros|otras|dem[aá]s|dichos|estos|esos|algunos|ciertos|principales|nuevos|mayores|menores)\s+)(?<!\b(?:de|en|por|sobre|con|para|a|entre|hacia|desde|sin|tras)\s+(?:los|sus|estos|esos|dichos)\s+)`;

/**
 * "Flujos de efectivo al 31 de diciembre", "estado de flujos de efectivo al
 * cierre": el flujo del periodo, no el saldo de efectivo.
 */
const NOT_CASH_FLOW = String.raw`(?<!\bflujos?\s+(?:netos?\s+)?(?:de|del)\s+)`;

/** "de la sociedad", "de la compañía": el sujeto sigue siendo el total de la entidad. */
const OF_ENTITY = String.raw`(?:\s+de\s+(?:la|esta|dicha)\s+(?:sociedad|compa[nñ][ií]a|empresa|entidad))?`;
/** "al cierre (del ejercicio) (de 2025)", "al 31 de diciembre de 2025". */
const AT_CUTOFF = String.raw`(?:\s+al\s+(?:cierre|final)(?:\s+del?\s+(?:per[ií]odo|ejercicio|a[nñ]o))?|\s+al\s+31\s+de\s+diciembre)?(?:\s+(?:de|del)\s+(?:19|20)\d{2})?`;
/** "del ejercicio (2025)", "del año". */
const OF_PERIOD = String.raw`(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o))?(?:\s+(?:de\s+)?(?:19|20)\d{2})?`;

/**
 * Calificativos de un SUBTOTAL tras "total de activos / pasivos": "total de
 * activos fijos", "total de pasivos laborales" (re-auditoría 2, narrativa-02).
 * "Activos netos" es el patrimonio, no el activo; "activo total promedio" es
 * la base del ROA, no el saldo. "Total de activos de la sociedad" sí es el
 * total.
 */
const SUBTOTAL_QUALIFIER = String.raw`\s+(?:(?:no\s+)?corrientes?|circulantes?|fijos?|financieros?|intangibles?|laborales?|diferidos?|biol[oó]gicos?|contingentes?|tributarios?|fiscales?|(?:no\s+)?monetarios?|netos?|brutos?|operacionales?|productivos?|improductivos?|estimados?|restringidos?|mantenidos?|exigibles?|promedios?|por\s+(?![$\d(−-]|COP\b|(?:un\s+)?(?:valor|monto|importe|total)\b|la\s+suma\b)|de\s+(?:corto|mediano|largo)\s+plazo|a\s+(?:corto|largo)\s+plazo|de\s+inversi[oó]n|en\s+(?:moneda|arrendamiento))`;

/** Mención de ingresos con monto (prosa) y rótulo de fila de tabla. "Otros ingresos" no es el total. */
const INGRESOS_RE =
  /(?<!\b(?:otros|dem[aá]s)\s)\bingresos\s+(?:operacionales\s+netos|operacionales|netos|totales|de\s+actividades\s+ordinarias)\b/gi;
const INGRESOS_ROW_RE = /^ingresos(?:\s+(?:operacionales(?:\s+netos)?|netos|totales|de actividades ordinarias))?$/i;
/** "Los ingresos del ejercicio ascendieron a", "las ventas del año fueron de" (narrativa-09). */
const INGRESOS_PROSE_RE = new RegExp(
  String.raw`(?<!\b(?:otros|dem[aá]s)\s)\b(?:los\s+)?ingresos(?:\s+(?:ordinarios|totales|netos|operacionales(?:\s+netos)?))?${OF_PERIOD}\s+${AMOUNT_VERBS}|\b(?:las\s+)?ventas(?:\s+(?:netas|totales))?${OF_PERIOD}\s+${AMOUNT_VERBS}`,
  'gi',
);

const ND_PREPROCESSOR = {
  es: 'el preprocesador lo publica N/D (sin base verificable)',
  en: 'the preprocessor publishes it as N/A (no verifiable base)',
};
const ND_ACTA = {
  es: 'el acta no tiene aritmética determinista contra la cual verificarlo (sin base verificable)',
  en: 'the minutes have no deterministic arithmetic to verify it against (no verifiable base)',
};

/**
 * Saldos que imprimen el EFE y el ECP del propio informe, incluidos los del
 * periodo comparativo (revisión I5-3 y re-auditoría 2, narrativa-04): con
 * tres cortes, el EFE y el ECP comparativos abren con el corte anterior al
 * comparativo (p. ej. 2023 en un informe 2025/2024), que no es ninguno de los
 * dos snapshots, y la nota que cita ese saldo de apertura es honesta en
 * cualquier Parte. Esos saldos los calcula el código y el validador del JSON
 * NIIF los cruza contra el balance (E2/E3/E18/E23 del EFE; E4/E7 del ECP).
 */
function statementValues(niif: NiifReportJson | null): { efectivo: number[]; patrimonio: number[]; resultado: number[] } {
  if (!niif) return { efectivo: [], patrimonio: [], resultado: [] };
  const cf = niif.cashFlow;
  const ec = niif.equityChanges;
  const balances = [...(ec?.rows ?? []), ...(ec?.comparativeRows ?? [])].filter(
    (r) => r.kind === 'opening_balance' || r.kind === 'closing_balance',
  );
  return {
    efectivo: vals(centsToPesos(cf?.cashOpeningComparative), centsToPesos(cf?.cashClosingComparative)),
    patrimonio: vals(...balances.map((r) => centsToPesos(r.total))),
    // La columna "Result. Ejercicio" de los saldos del ECP: con tres cortes,
    // la apertura del comparativo imprime el resultado del corte anterior
    // (p. ej. 2023), que una nota puede citar.
    resultado: vals(...balances.map((r) => centsToPesos(r.resultadoEjercicio))).filter((v) => v !== 0),
  };
}

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
  const statements = statementValues(niif);
  const acta = sources.acta ?? null;
  const actaPesos = (v: string | null | undefined) => centsToPesos(v ?? null);
  const netValues = vals(
    centsToPesos(is?.netIncomePrimary),
    centsToPesos(is?.netIncomeComparative),
    snapshotPesos(primary, 'utilidadNeta'),
    snapshotPesos(comparative, 'utilidadNeta'),
    ...statements.resultado,
  );
  const concepts: NarrativeConcept[] = [
    {
      key: 'utilidadNeta',
      label: 'Utilidad neta',
      // "utilidad neta a disposición / distribuible / tras la reserva" es un
      // saldo del acta, no el resultado del ejercicio; "por acción" (NIC 33),
      // "antes de impuestos" y una partida ("por diferencia en cambio")
      // tampoco son el resultado neto. La exclusión mira también detrás de
      // "del ejercicio": sin eso el motor retrocede y la mención corta casa.
      re: new RegExp(
        String.raw`\b(?:utilidad|ganancia|p[eé]rdida|resultado)\s+net[ao]\b(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o))?(?!(?:\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o))?\s+(?:distribuible|disponible|a\s+disposici[oó]n|despu[eé]s|tras|restante|por\s+distribuir|a\s+distribuir|l[ií]quida|por\s+(?:acci[oó]n|cuota)|antes\s+de|${LINE_ITEM}))`,
        'gi',
      ),
      // Terminología contable habitual (PUC 3605, re-auditoría 2, narrativa-09 y
      // procedencia-R2-01): "la utilidad / el resultado / la pérdida del
      // ejercicio", "la ganancia del periodo", "el excedente del año" (ESAL) y
      // "la sociedad obtuvo utilidades por $X". "Del ejercicio anterior" es el
      // comparativo con otra redacción: no se juzga.
      proseRe: new RegExp(
        String.raw`(?<!\bestados?\s+(?:integral\s+)?de\s+)\b(?:utilidad(?:es)?|ganancias?|p[eé]rdida|resultado|excedentes?)\s+del\s+(?:ejercicio|per[ií]odo|a[nñ]o)(?:\s+(?:de\s+)?(?:19|20)\d{2})?(?!(?:\s+(?:de\s+)?(?:19|20)\d{2})?\s+(?:anterior|precedente|pasado|distribuible|disponible|a\s+disposici[oó]n|despu[eé]s|tras|restante|por\s+distribuir|a\s+distribuir|l[ií]quid|por\s+(?:acci[oó]n|cuota)|antes\s+de|${LINE_ITEM}))` +
          String.raw`|\b(?:obtuv(?:o|ieron)|obtiene|gener(?:[oó]|a|aron)|arroj(?:[oó]|a)|alcanz[oó]|report(?:[oó]|a)|registr(?:[oó]|a))\s+(?:una\s+|unas\s+)?(?:utilidad(?:es)?|ganancias?|excedentes?)(?:\s+net[ao]s?)?\s+(?:por|de)(?=\s*\(?\s*[-−]?\s*(?:\$|COP\b|\d))`,
        'gi',
      ),
      // "… de $5.000.000,00 en la venta de maquinaria": la cifra es de otra partida.
      skipIfAfter:
        /^[^.;]{0,24}?\b(?:en|por|de)\s+(?:la\s+|el\s+|las\s+|los\s+)?(?:venta|baja|enajenaci|diferencia\s+en\s+cambio|valoraci|m[eé]todo\s+de\s+participaci|negociaci)/i,
      values: netValues,
      nd: false,
      polarity: (m) =>
        /p[eé]rdida/i.test(m) ? 'neg' : /utilidad|ganancia|excedente/i.test(m) ? 'pos' : null,
      ...(acta
        ? {
            percentBases: vals(
              actaPesos(acta.saldoDistribuibleCop),
              subtractPesos(acta.saldoDistribuibleCop, acta.reservaLegalDelEjercicioCop),
            ),
            percentResults: actaAmounts(acta),
          }
        : {}),
    },
    {
      key: 'activo',
      label: 'Total Activo',
      re: new RegExp(
        String.raw`\b(?:total\s+(?:de\s+)?(?:los\s+)?activos?|activos?\s+total(?:es)?)\b(?!${SUBTOTAL_QUALIFIER})`,
        'gi',
      ),
      // "Los activos (de la sociedad) ascienden / suman / totalizan" (narrativa-09).
      proseRe: new RegExp(
        String.raw`${SUBJECT_ONLY}\b(?:los\s+)?activos(?:\s+totales)?${OF_ENTITY}${AT_CUTOFF}\s+${AMOUNT_VERBS}`,
        'gi',
      ),
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
      re: new RegExp(
        String.raw`\b(?:total\s+(?:de\s+)?(?:los\s+)?pasivos?|pasivos?\s+total(?:es)?)\b(?!${SUBTOTAL_QUALIFIER})(?!\s*(?:y|\+|m[aá]s)\s*(?:el\s+)?patrimonio)`,
        'gi',
      ),
      proseRe: new RegExp(
        String.raw`${SUBJECT_ONLY}\b(?:los\s+)?pasivos(?:\s+totales)?${OF_ENTITY}${AT_CUTOFF}\s+${AMOUNT_VERBS}`,
        'gi',
      ),
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
      // el total: sin verbo de saldo no se juzga. "El total de pasivos y
      // patrimonio asciende a $X" tampoco: X es pasivo + patrimonio (= el
      // activo), no el patrimonio (revisión I5-3; frase habitual de las notas
      // de la Parte I).
      re: new RegExp(
        String.raw`(?<!\bpasivos?(?:\s+total(?:es)?)?\s*(?:y|\+|m[aá]s)\s*(?:el\s+)?)\b(?:total\s+(?:del?\s+)?patrimonio|patrimonio\s+(?:total|al\s+cierre|al\s+31\s+de\s+diciembre(?:\s+(?:de|del)\s+\d{4})?)|patrimonio(?:\s+(?:neto|total))?(?:\s+de\s+la\s+(?:sociedad|compa[nñ][ií]a|empresa|entidad))?\s+${AMOUNT_VERBS})${WORD_END}`,
        'gi',
      ),
      values: vals(
        centsToPesos(bs?.totalEquityPrimary),
        centsToPesos(bs?.totalEquityComparative),
        snapshotPesos(primary, 'patrimonio'),
        snapshotPesos(comparative, 'patrimonio'),
        ...statements.patrimonio,
      ),
      nd: false,
    },
    {
      key: 'efectivo',
      label: 'Efectivo al cierre',
      // El cierre del comparativo es la apertura del periodo actual.
      re: new RegExp(
        String.raw`${NOT_CASH_FLOW}\befectivo(?:\s+y\s+equivalentes(?:\s+(?:de|al)\s+efectivo)?)?\s+al\s+(?:cierre|final)(?:\s+del\s+(?:per[ií]odo|ejercicio|a[nñ]o))?(?:\s+(?:de|del)\s+\d{4})?|\befectivo\s+y\s+equivalentes(?:\s+(?:de|al)\s+efectivo)?\s+${AMOUNT_VERBS}${WORD_END}`,
        'gi',
      ),
      // "El efectivo asciende a", "el efectivo de la compañía al 31 de
      // diciembre de 2025 era de", "el disponible cerró en", "caja y bancos
      // suman" (narrativa-09, procedencia-R2-01). "El efectivo generado /
      // neto / restringido" no es el saldo: el calificativo corta la mención.
      proseRe: new RegExp(
        String.raw`(?:\bel\s+efectivo|\bel\s+disponible|\b(?:la\s+)?caja\s+y\s+bancos)${OF_ENTITY}${AT_CUTOFF}\s+${AMOUNT_VERBS}` +
          String.raw`|(?:${NOT_CASH_FLOW}\befectivo(?:\s+y\s+equivalentes(?:\s+(?:de|al)\s+efectivo)?)?|\bel\s+disponible|\bcaja\s+y\s+bancos)${OF_ENTITY}\s+al\s+(?:31\s+de\s+diciembre(?:\s+(?:de|del)\s+(?:19|20)\d{2})?|(?:cierre|final)(?:\s+del?\s+(?:per[ií]odo|ejercicio|a[nñ]o))?(?:\s+(?:de|del)\s+(?:19|20)\d{2})?)`,
        'gi',
      ),
      values: vals(
        centsToPesos(niif?.cashFlow?.cashClosing),
        centsToPesos(niif?.cashFlow?.cashOpening),
        snapshotPesos(primary, 'efectivoCuenta11'),
        snapshotPesos(comparative, 'efectivoCuenta11'),
        ...statements.efectivo,
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
        proseRe: INGRESOS_PROSE_RE,
        rowLabelOnly: INGRESOS_ROW_RE,
        values: revenue,
        nd: false,
      });
    }
  }
  if (sources.actaConcepts || sources.acta) concepts.push(...actaConcepts(sources, netValues));
  return concepts.filter((c) => c.values.length > 0 || c.nd);
}

/** a − b en pesos (centavos MoneyCop); `null` si falta alguno. */
function subtractPesos(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = centsToPesos(a ?? null);
  const y = centsToPesos(b ?? null);
  return x === null || y === null ? null : x - y;
}

/** Todas las cifras que publica la aritmética determinista del acta. */
function actaAmounts(a: ActaArithmetic): number[] {
  return vals(
    ...[
      a.netIncomeCop,
      a.enjugarPerdidasCop,
      a.saldoDistribuibleCop,
      a.apropiacionTeorica10Cop,
      a.techoArt452Cop,
      a.reservaLegalPendienteCop,
      a.reservaLegalDelEjercicioCop,
      a.reservaOcasionalCop,
      a.distribuibleCop,
      a.minimoArt155Cop,
      a.deficitArt155Cop,
      a.capitalizationBaseCop,
      a.capitalizationAmountCop,
      ...a.lines.map((l) => l.amountCop),
    ].map((v) => centsToPesos(v ?? null)),
    subtractPesos(a.saldoDistribuibleCop, a.reservaLegalDelEjercicioCop),
  );
}

type EquityRow = EquityChangeRowJson;

/**
 * Distribuciones a los socios que imprime el ECP: la fila `dividend_distribution`
 * y, en la fila de movimientos con los socios (aportes netos de retiros), la
 * disminución de reservas + resultados acumulados. Con tres cortes el ECP
 * comparativo de la tres-cortes neta "capital +20M, utilidades giradas −6M" en
 * una fila de aportes de $14M: la nota que cita los $6M girados es honesta
 * (re-auditoría 2, narrativa-04) y la cifra sale de las columnas impresas.
 */
function equityDistributions(rows: EquityRow[]): number[] {
  const out: Array<number | null> = [];
  for (const r of rows) {
    if (r.kind === 'dividend_distribution') out.push(centsToPesos(r.total));
    if (r.kind === 'dividend_distribution' || r.kind === 'capital_contribution') {
      const parts = [r.resultadosAcumulados, r.reservaLegal, r.otrasReservas];
      if (parts.every((v) => typeof v === 'string' && MONEY_RE.test(v))) {
        const retained = parts.reduce((acc, v) => acc + BigInt(v as string), BigInt(0));
        if (retained < BigInt(0)) out.push(Number(-retained) / 100);
      }
    }
  }
  return vals(...out);
}

/**
 * Los verbos "distribuir", "repartir" y "capitalizar" sólo son la decisión del
 * acta con los socios, la utilidad, las reservas o la asamblea en la misma
 * cláusula: "la compañía distribuye productos farmacéuticos, con ventas netas
 * de $X" o "los inventarios se distribuyen entre bodegas" son la operación
 * (revisión adversarial de la re-auditoría 2). El punto de miles ("$876.543")
 * no cierra la cláusula.
 */
const ACTA_CONTEXT_AHEAD = String.raw`(?=(?:[^.;]|\.(?=\d)){0,80}?(?:\baccionistas|\bsocios|\basociados|\bdividendos?\b|\butilidad|\bexcedentes?\b|\bparticipaciones\b|\breservas?\b|\bcapital\s+(?:social|suscrito)|\bacciones\b|\bcuotas\b|\basamblea|\bsuma\s+de\b|\bArt\.?\s*30\b))`;
/** Lo que capitaliza una nota NIIF (Secciones 17, 18 y 25): costos y mejoras de un activo. */
const NIIF_CAPITALIZED = String.raw`(?:los\s+|las\s+)?(?:costos?|gastos?|desembolsos?|mejoras?|intereses|erogaciones|adiciones|licencias?|software|desarrollos?|proyectos?)\b`;

/**
 * Conceptos del acta: cada uno admite las cifras que la aritmética determinista
 * publica para él (y los saldos del ECP que las notas citan). Sin aritmética
 * ni saldos del ECP, cualquier cifra impresa es N/D.
 */
function actaConcepts(sources: NarrativeAnchorSources, netValues: number[]): NarrativeConcept[] {
  const a = sources.acta ?? null;
  const niif = sources.niif ?? null;
  const rows = [...(niif?.equityChanges?.rows ?? []), ...(niif?.equityChanges?.comparativeRows ?? [])];
  const pesos = (v: string | null | undefined) => centsToPesos(v ?? null);
  const breakdowns = [sources.primary?.equityBreakdown, sources.comparative?.equityBreakdown];
  const reservaAcumulada = sources.primary?.equityBreakdown?.reservaLegal;
  const amounts = a ? actaAmounts(a) : [];
  // Sin aritmética, sólo los saldos del ECP (reserva acumulada, dividendos
  // decretados en el periodo) sirven de ancla; sin ellos la cifra carece de base.
  const concept = (
    key: NarrativeConceptKey,
    label: string,
    re: RegExp,
    values: number[],
    extra: Partial<NarrativeConcept> = {},
  ): NarrativeConcept => ({
    key,
    label,
    re,
    values,
    nd: a === null && values.length === 0,
    ndMotivo: ND_ACTA,
    ...(a ? { percentResults: amounts } : {}),
    ...extra,
  });
  // Dividendos y distribuciones que presenta el EFE (financiación), de los dos
  // periodos: una nota que los cita con su monto es honesta aunque se hayan
  // decretado en otro ejercicio.
  const efeDividends = (niif?.cashFlow?.sections ?? []).flatMap((s) =>
    (s.lines ?? [])
      .filter((l) => /dividend|distribu/i.test(l.label))
      .flatMap((l) => [pesos(l.amountPrimary), pesos(l.amountComparative)]),
  );
  return [
    concept(
      'dividendos',
      'Dividendos',
      // "Dividendos por pagar / por cobrar / recibidos" e "ingresos por
      // dividendos" son saldos del balance o ingresos, no la distribución del
      // acta. "Distribuir entre los accionistas la suma de", "se reparten" y
      // "distribución a los socios" son la misma decisión (narrativa-10).
      new RegExp(
        String.raw`(?<!ingresos\s+por\s+)\bdividendos?\b(?!\s+(?:por\s+(?:pagar|cobrar)|recibidos?))|\butilidades?\s+(?:a\s+distribuir|por\s+distribuir)\b|\bsaldo\s+distribuible\b|\bm[ií]nimo\s+(?:legal\s+)?a\s+repartir\b|\bdistribu(?:ir|ye|yen|y[oó]|yeron|ir[aá]n?)${WORD_END}${ACTA_CONTEXT_AHEAD}|\bdistribuci[oó]n(?:es)?\s+(?:a|entre)\s+(?:los\s+)?(?:accionistas|socios|asociados)\b|\b(?:reparto|distribuci[oó]n)\s+de\s+(?:las\s+|los\s+)?(?:utilidades|dividendos|excedentes)\b|\brepart(?:ir|e|en|i[oó]|ieron)${WORD_END}${ACTA_CONTEXT_AHEAD}`,
        'gi',
      ),
      vals(
        pesos(a?.distribuibleCop),
        pesos(a?.saldoDistribuibleCop),
        pesos(a?.minimoArt155Cop),
        pesos(a?.deficitArt155Cop),
        // La capitalización es un dividendo pagado en acciones.
        pesos(a?.capitalizationAmountCop),
        ...equityDistributions(rows),
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
      // "Apropiada la reserva legal, queda un saldo de $18M": el saldo que
      // queda es de la utilidad, no de la reserva (narrativa-01).
      { windowStops: [/\b(?:queda|quedan|resta|restan|sobra|sobran)\b/i, /\bsaldo\s+(?:restante|remanente|resultante)\b/i] },
    ),
    concept(
      'reservaOcasional',
      'Reserva ocasional',
      /\breservas?\s+ocasional(?:es)?\b/gi,
      vals(
        pesos(a?.reservaOcasionalCop),
        ...(a?.lines ?? []).filter((l) => l.key === 'reserva_ocasional').map((l) => pesos(l.amountCop)),
        ...breakdowns.map((b) => (typeof b?.otrasReservas === 'number' ? b.otrasReservas : null)),
        ...rows
          .filter((r) => ['opening_balance', 'closing_balance', 'reserve_appropriation'].includes(r.kind))
          .map((r) => pesos(r.otrasReservas)),
      ),
    ),
    concept(
      'enjugue',
      'Enjugamiento de pérdidas',
      new RegExp(
        String.raw`\benjug(?:amiento|ar[aá]n?|aron|ar|an|ue|uen|a|[oó])${WORD_END}(?:\s+(?:de\s+)?(?:las\s+)?p[eé]rdidas?(?:\s+(?:acumuladas|de\s+(?:ejercicios|per[ií]odos|a[nñ]os)\s+anteriores))?)?`,
        'gi',
      ),
      vals(
        pesos(a?.enjugarPerdidasCop),
        ...breakdowns.map((b) =>
          typeof b?.utilidadesAcumuladas === 'number' && b.utilidadesAcumuladas < 0 ? -b.utilidadesAcumuladas : null,
        ),
      ),
    ),
    concept(
      'utilidadLiquida',
      'Utilidad líquida / distribuible',
      // "Utilidades líquidas" (Art. 155 C.Co.), "utilidad neta distribuible",
      // "utilidad a disposición de la asamblea": la utilidad del ejercicio, el
      // saldo tras enjugar pérdidas o el que queda tras la reserva legal.
      /\butilidad(?:es)?(?:\s+net[ao]s?)?\s+(?:l[ií]quidas?|distribuibles?|a\s+disposici[oó]n(?:\s+de\s+(?:la\s+)?asamblea)?)\b/gi,
      // Sin aritmética del acta sólo la utilidad del ejercicio sirve de ancla.
      a
        ? vals(
            ...netValues,
            pesos(a.netIncomeCop),
            pesos(a.saldoDistribuibleCop),
            subtractPesos(a.saldoDistribuibleCop, a.reservaLegalDelEjercicioCop),
            pesos(a.distribuibleCop),
          )
        : netValues,
    ),
    concept(
      'capitalizacion',
      'Monto a capitalizar',
      // "Capitalización" y "capitalizar" como antes; las demás formas del verbo
      // sólo con la utilidad, las reservas o la asamblea en la cláusula: en las
      // notas NIIF "se capitalizan los costos por préstamos" o "la compañía
      // capitalizó mejoras por $X" son activos, no la capitalización del acta.
      new RegExp(
        String.raw`\bcapitaliz(?:aci[oó]n|ar)${WORD_END}(?!\s+(?:de\s+)?${NIIF_CAPITALIZED})` +
          String.raw`|\bcapitaliz(?:ar[aá]n?|aron|ad[oa]s?|an|a|[oó])${WORD_END}(?!\s+${NIIF_CAPITALIZED})${ACTA_CONTEXT_AHEAD}`,
        'gi',
      ),
      vals(pesos(a?.capitalizationAmountCop), pesos(a?.capitalizationBaseCop)),
    ),
  ];
}

/**
 * Menciones que NO se juzgan pero cortan la ventana de los conceptos: en
 * "reserva legal y reserva estatutaria por $X" el monto es de la estatutaria.
 */
const WINDOW_STOPS: RegExp[] = [
  /\breserva\s+estatutaria/i,
  // Las Partes I y II no tienen los conceptos del acta: "con la utilidad neta
  // se enjugan pérdidas por $X" o "se destina a reserva ocasional $X" siguen
  // cortando la ventana, como antes de la re-auditoría 2.
  /\breservas?\s+ocasional/i,
  /\benjug/i,
  /\bcapital\s+(?:suscrito|social|pagado)/i,
  /\bp[eé]rdidas?\s+(?:acumuladas|de\s+ejercicios\s+anteriores)/i,
  /\b(?:utilidades|resultados|ganancias)\s+(?:acumulad[oa]s|de\s+ejercicios\s+anteriores)/i,
  /\btecho\b/i,
];

// ---------------------------------------------------------------------------
// Núcleo: menciones → primera cifra
// ---------------------------------------------------------------------------

/**
 * Variación o comparación entre la mención y la cifra: "aumentó $5M",
 * "frente a 2024", "respecto al presupuesto", "pasó de $1M a $4M". La cifra
 * que sigue es una variación o una referencia, salvo que el giro termine en un
 * nivel ("aumentó a", "creció hasta", "…, fue de"; ver `levelAfterVariation`).
 */
const VARIATION_WORDS =
  /variaci|aument|disminu|increment|reducci|redujo|reducid|cay[oó]|ca[ií]da|crec|diferencia|cambio|pas(?:[oó]|ar|ando)\s+de|mejor[oó]|empeor|\bsub(?:i[oó]|ieron)(?![\p{L}])|\bbaj(?:ó|aron)(?![\p{L}])|repunt|retroced|descend|\bse\s+contrajo|frente\s+al?\b|respecto\s+(?:a|al|de|del)\b|respecto|comparad[oa]s?\s+con|en\s+comparaci[oó]n\s+con|\bvs\.?|\bversus\b/iu;
/** Sustantivos de variación: "el aumento fue de $5M" es la variación, no el nivel. */
const VARIATION_NOUN = /^(?:variaci[oó]n|aumentos?|incrementos?|disminuci[oó]n|reducci[oó]n|crecimiento|ca[ií]da|diferencias?|cambios?|mejora|deterioro)(?:es)?$/i;
/**
 * Verbo de saldo tras una variación: "que mejoró frente a 2024, fue de $X"
 * afirma el nivel. En una relativa ("…por el impuesto de renta, que ascendió a
 * $6M") el verbo es del sustantivo que la precede, no del concepto.
 */
const LEVEL_VERB = new RegExp(
  String.raw`(?<!\bque\s+(?:se\s+)?)(?:\b(?:fue|es|era|son|fueron|eran)\s+de\b|\b(?:asciende|ascienden|ascendi[oó]|ascendieron|cerr[oó]|cerraron|qued[oó]|quedaron|lleg[oó]|totaliz[oó]|sum[oó]|alcanz[oó])${WORD_END}|\bse\s+(?:ubic|situ)[oó]${WORD_END})`,
  'i',
);
/**
 * Lo que sigue a la palabra de variación cuando la cifra es el nivel: el resto
 * del verbo, un porcentaje o un año opcionales y "a" / "hasta" ("aumentó a",
 * "creció un 20 %, hasta", "frente a 2024, hasta"). "…frente a 2024 debido a
 * $X de inversiones" no es el nivel.
 */
const LEVEL_TAIL =
  /^[A-Za-zÀ-ÖØ-öø-ÿ]*\s*,?\s*(?:(?:en\s+|de\s+)?(?:un\s+|el\s+)?[\d.,]+\s*%\s*,?\s*)?(?:(?:en|de|del)\s+)?(?:(?:19|20)\d{2}\s*,?\s*)?(?:a|hasta)\s*$/i;
/**
 * Enlace entre la cifra de una variación (o de otra magnitud) y la del nivel:
 * "pasó de $1M (en 2024) a $4M", "aumentó $3M, hasta $4M", "…, y cerró en
 * $4M", "…, que incluye obligaciones de $25M, asciende a $47M".
 */
const LEVEL_CONNECTOR =
  /^\s*(?:\(\s*(?:19|20)\d{2}\s*\)\s*)?(?:,\s*)?(?:(?:en|de|del)\s+(?:(?:19|20)\d{2}|el\s+(?:a[nñ]o|ejercicio|per[ií]odo)\s+(?:anterior|pasado))\s*)?(?:,\s*)?(?:a|hasta|(?:y\s+)?(?:cerr[oó]|qued[oó]|termin[oó])\s+en|(?:y\s+)?se\s+(?:ubic|situ)[oó]\s+en|(?:para|al)\s+(?:cerrar|ubicarse|situarse|quedar|llegar)\s+(?:en|a)|(?:y\s+|que\s+)?(?:(?:fue|es|era|son|fueron)\s+de|(?:asciende|ascienden|ascendi[oó]|ascendieron)\s+a|suma|suman|sum[oó]|totaliza|totaliz[oó]|alcanz[oó]))\s*$/i;
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
/** "4.000.000 de pesos", "4.000.000,00 pesos m/cte.", "4.000.000 COP": la palabra marca el monto. */
const CURRENCY_WORD_AFTER = /^[(\s−-]*[\d.,]+\s*\)?\s*(?:(?:de\s+)?pesos|COP)\b/i;
/**
 * Cifra agrupada sin moneda con dos o más grupos de miles ("4.000.000,00"):
 * tras la mención de un concepto es un monto (re-auditoría 2, narrativa-11),
 * salvo que sea un identificador (NIT, cédula, matrícula, tarjeta profesional).
 */
const MILLIONS_GROUPED = /^\d{1,3}(?:\.\d{3}){2,}(?:,\d{1,2})?$/;
const IDENTIFIER_BEFORE =
  /(?:\bNIT|\bN\.\s*I\.\s*T\.?|\bC\.\s*C\.?|\bc[eé]dula(?:\s+de\s+ciudadan[ií]a)?|\bidentificad[oa]s?(?:\s+con)?|\bmatr[ií]cula(?:\s+mercantil)?|\bn[uú]mero|\bNo\.?|\bNro\.?|\bT\.\s*P\.?|\btarjeta\s+profesional|\bregistro|\bRUT|\bradicado|\bresoluci[oó]n|\bdecreto|\bescritura)\s*(?:No\.?|n[uú]mero|Nro\.?)?\s*[:#]?\s*$/i;
/**
 * Otra magnitud entre la mención y la cifra: "sobre la utilidad del ejercicio
 * se calcula el impuesto de renta de $6M". La cifra es de esa magnitud, salvo
 * que un verbo de saldo vuelva al concepto ("…, neta del impuesto, fue de $X").
 */
const OTHER_QUANTITY =
  /(?<![\p{L}])(?:impuestos?|provisi[oó]n|provisiones|retenci[oó]n|retenciones|costos?|gastos?|obligaci[oó]n|obligaciones|pagos?|pag[oó]|pagaron|compras?|inversi[oó]n|inversiones|pr[eé]stamos?|cr[eé]ditos?|deudas?|anticipos?|sanci[oó]n|sanciones|multas?|intereses|reservas?|restricci[oó]n|restricciones|embargos?|rendimientos?|sobregiros?|comisi[oó]n|comisiones|depreciaci[oó]n|amortizaci[oó]n)(?![\p{L}])/iu;
/**
 * La mención es complemento de otra magnitud sin ancla: "el gasto por
 * impuesto de renta sobre la utilidad del ejercicio fue de $6M". La cifra
 * enlazada por un verbo es de esa magnitud; la pegada a la mención ("…sobre la
 * utilidad neta de $20M") sí es del concepto (revisión adversarial de la
 * re-auditoría 2). Dividendos y reservas no están aquí: son conceptos del acta
 * y su cifra se sigue cruzando.
 */
const OTHER_HEAD_PREFIX =
  /(?<![\p{L}])(?:impuestos?|provisi[oó]n|retenci[oó]n|gastos?|costos?|tasa|margen|porcentaje)(?:\s+[\p{L}]+){0,4}\s+(?:sobre|de|del|a|al|en)\s+(?:(?:la|el|los|las)\s+)?$/iu;
/** Cifra pegada a la mención: "… utilidad neta de $X", "… utilidad neta ($X)", "…, por $X". */
const ATTACHED_TOKEN = /^\s*(?:\(\s*|,?\s*(?:de|por)\s+)$/i;
/** "Del total de activos, $X son corrientes": partitivo, la cifra que sigue a la coma es una parte. */
const PARTITIVE_PREFIX = /^\s*(?:del|de\s+(?:la|las|los|el))\s*$/i;
/** "1.200.000 unidades", "USD 4.000.000": la cifra no está en pesos. */
const NOT_PESOS_UNIT_AFTER =
  /^\s*(?:de\s+)?(?:unidades|kilos|kg|toneladas|litros|galones|clientes|empleados|trabajadores|horas|metros|m2|acciones|cuotas|participaciones|habitantes|personas|usuarios|d[oó]lares|USD|euros|EUR)\b/i;
const NOT_PESOS_BEFORE = /(?:\bUSD|\bUS\$|\bEUR|\bd[oó]lares(?:\s+de)?|€)\s*$/i;
/** Cifra presentada como parte del concepto, no como su saldo ("se compone de", "se discrimina así:"). */
const COMPONENT_WORDS =
  /incluy|compuest|compon|conformad|concentr|\bcubr|representad|discrimin|desglos|detall|distribuid|de\s+los\s+cuales|de\s+las\s+cuales|\bas[ií]\s*:/i;
/** Monto por unidad ("$200,00 por acción", "$15 / cuota"): no es el total del concepto. */
const PER_UNIT_AFTER =
  /^[(\s−-]*\$?\s*\(?\s*[-−]?\s*[\d.,]+\s*\)?\s*(?:MM|M|millones|mil\s+millones)?\s*(?:por|\/|cada)\s*(?:acci[oó]n|cuota|parte\s+de\s+inter[eé]s|participaci[oó]n)/i;
/**
 * Mención regida por un porcentaje: "el 10 % de la utilidad neta, es decir
 * $2M" describe la aritmética del acta; la cifra es la fracción, no el saldo
 * (re-auditoría 2, narrativa-01).
 */
const PERCENT_OF_PREFIX =
  /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|por\s+ciento)\s*\)?\s*(?:de|del|sobre)\s+(?:(?:la|el|los|las)\s+)?$/i;
/** "La variación de la utilidad neta fue de $10M": la cifra es la variación. */
const VARIATION_NOUN_PREFIX =
  /\b(?:variaci[oó]n|aumento|disminuci[oó]n|incremento|reducci[oó]n|ca[ií]da|crecimiento|cambio|diferencia|mejora|deterioro)(?:\s+(?:neta?|absoluta|relativa|anual))?\s+(?:de|en|del)\s+(?:(?:la|el|los|las)\s+)?$/i;
/**
 * "Apropiada la reserva legal, queda…", "una vez descontada la reserva legal,
 * el saldo…": el concepto es lo que se resta y la cifra de la cláusula
 * siguiente es de otro sujeto.
 */
const SUBTRACTED_PREFIX =
  /\b(?:apropiad[ao]s?|descontad[ao]s?|deducid[ao]s?|restad[ao]s?|detra[ií]d[ao]s?|constituid[ao]s?|enjugad[ao]s?|despu[eé]s\s+de(?:\s+(?:apropiar|descontar|deducir|constituir|enjugar))?|tras(?:\s+(?:apropiar|descontar|deducir|constituir|enjugar))?|una\s+vez\s+(?:apropiad[ao]|descontad[ao]|deducid[ao]|constituid[ao]))\s+(?:(?:la|el|los|las)\s+)?$/i;
const POSITIVE_WORDS = /positiv|super[aá]vit|excedente|ganancia/i;
const NEGATIVE_WORDS = /negativ|p[eé]rdida|d[eé]ficit/i;
/** Saldos cuyo signo es parte de la cifra (un negativo impreso sin signo es otra cifra). */
const SIGNED_BALANCES: ReadonlySet<NarrativeConceptKey> = new Set(['utilidadNeta', 'patrimonio', 'ebitda']);
/**
 * El signo va después de la cifra: "$40.000.000,00 negativos", "… en rojo",
 * "… (pérdida)", "…, una pérdida explicada por…", "… de pérdida". Una pérdida
 * con su propia cifra ("… (pérdida de $30M en 2024)") es otra cifra, no el
 * signo de ésta.
 */
const NEGATIVE_AFTER =
  /^\s*(?:negativ|en\s+rojo|deficitari|\(\s*(?:una?\s+)?(?:p[eé]rdida|d[eé]ficit)(?:\s+(?:neta|del\s+(?:ejercicio|per[ií]odo|a[nñ]o)))?\s*\)|(?:,\s*|de\s+|[-—–]\s*)(?:(?:es\s+decir|esto\s+es|que\s+(?:corresponde|equivale)\s+a)\s*,?\s*)?(?:una?\s+)?(?:negativ|p[eé]rdida|d[eé]ficit)(?![\p{L}]*\s+(?:de|por)\s+[$\d(−-]))/iu;
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
 * cifra; `prefix`, la frase antes de la mención; `label`, la mención misma
 * ("el patrimonio ascenderá"). El futuro/condicional sólo cuenta en `before`,
 * en la mención o en la última cláusula del prefijo: en "El acta, que será
 * firmada, indica que la utilidad neta fue de $X" el "será" no rige la cifra.
 */
function isForwardLooking(
  before: string,
  prefix: string,
  primaryYear: string | null | undefined,
  label = '',
): boolean {
  const lastClause = prefix.slice(Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(':')) + 1);
  return (
    [before, prefix].some((p) => FORWARD_WORDS.test(p) || mentionsFutureYear(p, primaryYear)) ||
    mentionsFutureYear(label, primaryYear) ||
    FUTURE_OR_CONDITIONAL.test(before) ||
    FUTURE_OR_CONDITIONAL.test(label) ||
    FUTURE_OR_CONDITIONAL.test(lastClause)
  );
}

function subjectOf(options: NarrativeCheckOptions): string {
  const s = options.subject ?? { es: 'la narrativa', en: 'the narrative' };
  return options.language === 'en' ? s.en : s.es;
}

/** Última coincidencia de `re` en `text`. */
function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    last = m;
    if (m[0].length === 0) g.lastIndex += 1;
  }
  return last;
}

/**
 * Tras una palabra de variación, ¿la cifra es el NIVEL del periodo? "aumentó a
 * $4M" y "creció hasta $4M" afirman el saldo; "que mejoró frente a 2024, fue
 * de $4M" también (verbo de saldo tras la comparación). "aumentó $5M",
 * "aumentó en $5M" y "el aumento fue de $5M" son la variación (re-auditoría
 * 2, narrativa-12).
 */
function levelAfterVariation(before: string): boolean {
  const last = lastMatch(VARIATION_WORDS, before);
  if (!last) return true;
  const word = /^[\p{L}]+/u.exec(before.slice(last.index))?.[0] ?? '';
  if (VARIATION_NOUN.test(word)) return false;
  const tail = before.slice(last.index + last[0].length);
  return LEVEL_TAIL.test(tail) || LEVEL_VERB.test(tail);
}

/** Texto que sigue a la cifra (sin la cifra). */
function afterToken(win: string, t: CopToken): string {
  return win.slice(t.index + t.length);
}

/** ¿El token es un identificador (NIT, cédula) o una cantidad en otra unidad, y no un monto en pesos? */
function isNotPesos(win: string, t: CopToken): boolean {
  const lead = win.slice(Math.max(0, t.index - 40), t.index);
  if (NOT_PESOS_BEFORE.test(lead)) return true;
  if (t.dollar) return false;
  return IDENTIFIER_BEFORE.test(lead) || /^\s*-\s*\d/.test(afterToken(win, t)) || NOT_PESOS_UNIT_AFTER.test(afterToken(win, t));
}

/** Con `requireCurrency`, ¿el token es un monto en pesos? */
function hasCurrency(win: string, t: CopToken): boolean {
  const from = win.slice(t.index);
  return (
    t.abbreviated ||
    t.dollar ||
    /^[(\s−-]*\$/.test(from) ||
    /\bCOP\s*$/i.test(win.slice(0, t.index)) ||
    CURRENCY_WORD_AFTER.test(from) ||
    // Sin paréntesis: "(7.117.500.000)" en prosa es un inciso (un tope, una
    // equivalencia), no el saldo.
    (MILLIONS_GROUPED.test(t.digits) && !/^\(/.test(from))
  );
}

/**
 * La cifra que la mención afirma como saldo: la primera, salvo que sea una
 * variación, una referencia ("frente a $10M de 2024") u otra magnitud ("el
 * impuesto de renta de $6M"); entonces la que el giro enlaza como nivel
 * ("pasó de $1M a $4M", "aumentó $3M, hasta $4M", "…, fue de $18M").
 * `null` si la frase sólo cita variaciones o referencias.
 */
function pickLevelToken(win: string, tokens: CopToken[]): CopToken | null {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  const before = win.slice(0, first.index);
  const variation = VARIATION_WORDS.test(before);
  const other = lastMatch(OTHER_QUANTITY, before);
  const otherQuantity = other !== null && !LEVEL_VERB.test(before.slice(other.index + other[0].length));
  if (!otherQuantity && (!variation || levelAfterVariation(before))) return first;
  let prevEnd = first.index + first.length;
  for (const t of tokens.slice(1)) {
    const lead = win.slice(prevEnd, t.index);
    if (LEVEL_CONNECTOR.test(lead)) return t;
    if (!VARIATION_WORDS.test(lead) && !OTHER_QUANTITY.test(lead)) return null;
    prevEnd = t.index + t.length;
  }
  return null;
}

/** Tramo del texto desde la última palabra de componente ("se compone de…") hasta la cifra. */
function isComponent(before: string): boolean {
  const last = lastMatch(COMPONENT_WORDS, before);
  if (!last) return false;
  // "El efectivo, detallado en la Nota 5, asciende a $X": tras el componente
  // hay un verbo de saldo; la cifra es el saldo.
  return !LEVEL_VERB.test(before.slice(last.index + last[0].length));
}

/** Menciones del concepto en la unidad, sin solaparse (la primera y más larga manda). */
function conceptHits(unit: NarrativeUnit, concept: NarrativeConcept): Array<{ index: number; text: string }> {
  const hits: Array<{ index: number; text: string }> = [];
  const collect = (source: RegExp) => {
    const re = new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(unit.text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      hits.push({ index: m.index, text: m[0] });
    }
  };
  collect(concept.re);
  if (concept.proseRe && !unit.firstCell) collect(concept.proseRe);
  if (concept.rowLabelOnly && unit.firstCell && concept.rowLabelOnly.test(unit.firstCell)) {
    hits.push({ index: 0, text: unit.firstCell });
  }
  hits.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const out: typeof hits = [];
  let end = -1;
  for (const h of hits) {
    if (h.index < end) continue;
    out.push(h);
    end = h.index + h.text.length;
  }
  return out;
}

/** "el 10 %" → 0,1 y la tolerancia de redondeo del porcentaje impreso. */
function parsePercent(raw: string): { ratio: number; tolerance: number } {
  const decimals = /[.,](\d+)$/.exec(raw)?.[1].length ?? 0;
  return { ratio: Number(raw.replace(',', '.')) / 100, tolerance: (0.5 * 10 ** -decimals) / 100 };
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
      const stops = [
        ...concepts.filter((c) => c !== concept).flatMap((c) => (c.proseRe && !unit.firstCell ? [c.re, c.proseRe] : [c.re])),
        ROE_LABEL,
        ...WINDOW_STOPS,
        ...(concept.windowStops ?? []),
      ];
      for (const hit of conceptHits(unit, concept)) {
        const prefix = sentencePrefix(unit.text, hit.index);
        // "La variación de la utilidad neta fue de $X": la cifra es la variación.
        if (VARIATION_NOUN_PREFIX.test(prefix)) continue;
        const win = windowAfter(unit.text, hit.index + hit.text.length, stops);
        const candidates = extractCopTokens(win).filter(
          (t) =>
            !t.percent &&
            !PER_UNIT_AFTER.test(win.slice(t.index)) &&
            !isNotPesos(win, t) &&
            (!options.requireCurrency || hasCurrency(win, t)),
        );
        const token = pickLevelToken(win, candidates);
        if (!token) continue;
        const before = win.slice(0, token.index);
        // "Apropiada la reserva legal, queda un saldo de $X": el concepto es lo
        // que se resta; la cifra es de la cláusula siguiente.
        if (SUBTRACTED_PREFIX.test(prefix) && /^\s*[,)]/.test(before)) continue;
        // "Del total de activos, $X corresponden a inventarios": la cifra es
        // una parte. "De la utilidad neta, por $X, se apropia…" sí es el saldo.
        if (PARTITIVE_PREFIX.test(prefix) && /^\s*,?\s*$/.test(before)) continue;
        // "El impuesto de renta sobre la utilidad del ejercicio fue de $6M".
        if (OTHER_HEAD_PREFIX.test(prefix) && !ATTACHED_TOKEN.test(before)) continue;
        if (prose && isComponent(before)) continue;
        if (concept.skipIfAfter?.test(afterToken(win, token))) continue;
        if (
          options.skipForwardLooking &&
          isForwardLooking(before, prefix, options.primaryYear, hit.text)
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
        const matches = (v: number) => Math.abs(Math.abs(token.value) - Math.abs(v)) <= tol;
        const match = concept.values.find(matches);
        // Mención regida por un porcentaje ("el 10 % de la utilidad neta, es
        // decir $2M"): vale la base misma, su fracción o una cifra de la
        // aritmética del acta; el signo no se juzga (narrativa-01).
        const percentOf = PERCENT_OF_PREFIX.exec(prefix);
        if (percentOf) {
          const { ratio, tolerance } = parsePercent(percentOf[1]);
          const bases = vals(...concept.values, ...(concept.percentBases ?? []));
          // Una cifra del acta vale como resultado del porcentaje sólo si no
          // excede esa fracción de la base (la reserva legal limitada por el
          // tope del Art. 452 es menor que el 10 %): "el 10 % de la utilidad
          // neta, es decir $10M" con utilidad de $20M no se ampara en que $10M
          // sea el mínimo del Art. 155.
          const cap = Math.max(0, ...bases.map((b) => Math.abs(b))) * (ratio + tolerance) + tol;
          const actaResult = (concept.percentResults ?? []).some((v) => matches(v) && Math.abs(v) <= cap);
          if (match !== undefined || actaResult) continue;
          const fits = bases.some(
            (b) => Math.abs(Math.abs(token.value) - ratio * Math.abs(b)) <= tol + tolerance * Math.abs(b),
          );
          if (fits) continue;
          const pct = percentOf[1];
          const expected = concept.values.map((v) => fmtPesos(Math.abs(v) * ratio)).join(' / ');
          push(
            unit.where,
            en
              ? `${concept.label}: ${subject} prints ${shown} as ${pct} % of it in ${context} and ${pct} % of ` +
                  `${concept.values.map(fmtPesos).join(' / ')} is ${expected}.`
              : `${concept.label}: ${subject} imprime ${shown} como el ${pct} % en ${context} y el ${pct} % de ` +
                  `${concept.values.map(fmtPesos).join(' / ')} es ${expected}.`,
          );
          continue;
        }
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
        const negAfter = NEGATIVE_AFTER.test(afterToken(win, token));
        const negWord = NEGATIVE_WORDS.test(before) || negAfter;
        const posWord = POSITIVE_WORDS.test(before);
        const presentedNegative = (!asideParen && shownValue < 0) || labelPolarity === 'neg' || negWord;
        const presentedPositive =
          !asideParen && shownValue >= 0 && !negWord && (labelPolarity === 'pos' || posWord);
        // Rótulo neutro ("el resultado neto", "el patrimonio", "el EBITDA") con
        // la cifra sin signo ni paréntesis: el lector la lee positiva. Sólo si
        // nada en la frase la declara negativa (re-auditoría 2, narrativa-13;
        // la misma regla que R3 del HTML) y sólo en saldos con signo: los
        // dividendos o la reserva se citan en magnitud aunque el EFE los
        // presente como salida.
        const neutralUnsigned =
          SIGNED_BALANCES.has(concept.key) &&
          labelPolarity === null &&
          token.value >= 0 &&
          !negWord &&
          !NEGATIVE_WORDS.test(prefix);
        if (match < 0 && (presentedPositive || neutralUnsigned)) {
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
      // "El ROE negativo de 80,0 %": la palabra da el signo de una cifra sin
      // él (re-auditoría 2, narrativa-06). Sólo "negativo": una "pérdida" en la
      // frase no invierte un ROE impreso.
      const unsigned = !/^[-−+]/.test(pct[2].trim());
      const value = Number(raw.replace(',', '.')) * (unsigned && /negativ/i.test(before) ? -1 : 1);
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
 * ("… de 2024 (comparativo)", "… en forma comparativa con los estados
 * financieros al 31 de diciembre de 2024") o los dos cortes ("… de 2025 y
 * 2024") no cuentan (re-auditoría 2, narrativa-05).
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
      const lead = sentencePrefix(unit.text, m.index).slice(-100);
      if (/comparativ|comparad[oa]s?\s+con|anterior|con\s+(?:los|las)\s+(?:de|del)\b/i.test(lead)) continue;
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
 * Los saldos que imprimen el EFE y el ECP del propio informe (aperturas del
 * comparativo con tres cortes, revisión I5-3) los admite ya
 * `buildNarrativeConcepts` para todas las Partes (re-auditoría 2,
 * narrativa-04).
 */
function niifNarrativeConcepts(json: NiifReportJson, sources: NarrativeAnchorSources): NarrativeConcept[] {
  const concepts = buildNarrativeConcepts({ ...sources, niif: json, acta: null, actaConcepts: false }).filter((c) =>
    NIIF_NARRATIVE_KEYS.has(c.key),
  );
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
    {
      key: 'ingresos',
      label: 'Ingresos',
      re: INGRESOS_RE,
      proseRe: INGRESOS_PROSE_RE,
      rowLabelOnly: INGRESOS_ROW_RE,
      values: revenueLines,
      nd: false,
    },
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
