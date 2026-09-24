// ---------------------------------------------------------------------------
// Quality Meta-Auditor — Spec v2.1 (Parte V) 14 -> 12 dimension mapping
// ---------------------------------------------------------------------------
// Pure deterministic helper. Takes the internal QualityReportJson (14 D-dims
// plus dataQuality/aiGovernance/ifrs18Readiness blocks) and produces the v2.1
// 12-dimension view organized in 3 blocks (A/B/C), a sello de calidad and a
// list of corrective actions for dims that scored below 7/10.
//
// Auditoría 2026-09:
//   - auditoria-calidad-08: el umbral se aplica sobre score/10 con un decimal
//     (75/100 → 7,5 → en revisión); ya no se redondea al entero antes.
//   - auditoria-calidad-09: una dimensión sin fuente es N/D (null), se excluye
//     del promedio y se marca; un 0 real se respeta. Sin Exactitud, Completitud
//     o Consistencia, o con menos de 9 de 12 evaluadas, el sello es
//     "no evaluable". Ya no hay "valor por defecto 7/10".
//   - auditoria-calidad-03: Exactitud es dimensión bloqueante (< 6/10 → sello
//     máximo "requiere corrección") y la integridad aritmética determinista
//     rota fuerza Exactitud = 0.
//   - auditoria-calidad-11: sin periodo comparativo, Actualidad (proxy D14) y
//     Comparabilidad son N/D con motivo (antes D14 = 100 por defecto).
//
// No LLM. No side effects. Same input -> same output.
// ---------------------------------------------------------------------------

import type { QualityReportJson, QualityDimensionJson } from '../contracts/quality-report';
import type { AuditIntegrity } from '../audit/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityV21Status = 'aprobado' | 'en_revision' | 'requiere_correccion' | 'no_evaluable';
export type QualityV21Block = 'A' | 'B' | 'C';
export type QualityV21SelloType =
  | 'certificada'
  | 'con_observaciones'
  | 'requiere_correccion'
  | 'no_evaluable';

/** Contexto determinista que condiciona la vista v2.1 (opcional). */
export interface QualityV21Context {
  /** Integridad aritmética determinista del informe evaluado. */
  integrity?: AuditIntegrity;
  /**
   * `true` si hay periodo comparativo utilizable; `false` si consta que NO lo
   * hay; `null`/ausente si no se sabe (sin preprocesador).
   */
  comparativeAvailable?: boolean | null;
}

export interface QualityV21Dimension {
  /** v2.1 ordinal (1..12). */
  num: number;
  /** Block letter (A/B/C). */
  block: QualityV21Block;
  /** Full title of the block this dim belongs to. */
  blockTitle: string;
  /** Spanish display name (English label in parens, e.g. "Exactitud (Accuracy)"). */
  name: string;
  /** Framework/norm citation (e.g. "ISO 25012"). */
  framework: string;
  /** Score 0..10 con un decimal (score/100 ÷ 10, sin redondear al entero). null = N/D. */
  score10: number | null;
  /** Status tier from the threshold table ('no_evaluable' when score10 is null). */
  status: QualityV21Status;
  /** Findings + recommendations merged from the source D-dim(s). */
  points: string[];
}

export interface QualityV21CorrectiveAction {
  dimNum: number;
  dimName: string;
  action: string;
  /** Estimated points of overall improvement if this corrective action lands. */
  impactPoints: number;
}

export interface QualityV21Sello {
  type: QualityV21SelloType;
  title: string;
  /** Same as globalScore10 (one decimal, truncated). null when not evaluable. */
  score: number | null;
  /** Number of dimensions whose status === 'aprobado'. */
  approvedCount: number;
  /** Number of dimensions with a score (not N/D). */
  evaluatedCount: number;
  /** Bottom-line sentence shown inside the sello frame. */
  bottomLine: string;
}

export interface QualityV21View {
  /** Always 12 entries, in canonical order (block A first, then B, then C). */
  dimensions: QualityV21Dimension[];
  /**
   * Promedio aritmético de las dimensiones EVALUADAS (una decimal, truncado).
   * null cuando ninguna dimensión tiene fuente.
   */
  globalScore10: number | null;
  /** Status tier of the global score. */
  globalStatus: QualityV21Status;
  /** Motivos que bloquean o limitan el sello (vacío si ninguno). */
  selloBlockers: string[];
  /** The sello block (one of three variants based on globalScore). */
  sello: QualityV21Sello;
  /** Only filled for dimensions with score < 7. Empty array when none. */
  correctiveActions: QualityV21CorrectiveAction[];
}

// ---------------------------------------------------------------------------
// Static definitions per v2.1 dimension
// ---------------------------------------------------------------------------
//
// Hard-coded prose grounded in the source frameworks (ISO 25012, ISO/IEC
// 42001, IASB Conceptual Framework). These strings are contractual: the
// renderer cites them verbatim, so changing them is a spec-level decision.

interface QualityV21DimMeta {
  num: number;
  block: QualityV21Block;
  blockTitle: string;
  name: string;
  framework: string;
  definition: string;
  verification: string;
}

const BLOCK_A_TITLE = 'ISO 25012 — Calidad de Datos Financieros';
const BLOCK_B_TITLE = 'ISO/IEC 42001 — Gobernanza de IA';
const BLOCK_C_TITLE = 'IASB Conceptual Framework — Características Cualitativas';

export const QUALITY_V21_DIM_META: QualityV21DimMeta[] = [
  // --- Block A (ISO 25012) ---
  {
    num: 1,
    block: 'A',
    blockTitle: BLOCK_A_TITLE,
    name: 'Exactitud (Accuracy)',
    framework: 'ISO 25012',
    definition:
      'Las cifras presentadas reflejan el valor real de las transacciones registradas, sin errores aritméticos ni de clasificación.',
    verification:
      'Ecuación patrimonial (Activo = Pasivo + Patrimonio), conciliación utilidad ↔ patrimonio, EFE ↔ saldo de caja PUC 11, KPIs derivables de los EEFF.',
  },
  {
    num: 2,
    block: 'A',
    blockTitle: BLOCK_A_TITLE,
    name: 'Completitud (Completeness)',
    framework: 'ISO 25012',
    definition:
      'El set entregado contiene los cuatro estados financieros, notas, acta, KPIs, punto de equilibrio y proyecciones cuando aplica.',
    verification:
      'Inventario formal de entregables vs. el contrato Spec v2.1: Balance, P&L, EFE, ECP, notas 1..N, acta, KPIs base.',
  },
  {
    num: 3,
    block: 'A',
    blockTitle: BLOCK_A_TITLE,
    name: 'Consistencia (Consistency)',
    framework: 'ISO 25012',
    definition:
      'Las cifras no se contradicen entre los EEFF, las notas, el acta y los KPIs; los criterios contables son uniformes en todo el informe.',
    verification:
      'Cross-check inter-secciones (utilidad neta del P&L = resultado del ejercicio en ECP; total activo en balance = total activo citado en notas).',
  },
  {
    num: 4,
    block: 'A',
    blockTitle: BLOCK_A_TITLE,
    name: 'Actualidad (Currentness)',
    framework: 'ISO 25012 + NIC 1 §38',
    definition:
      'El informe cubre los períodos pactados con datos del corte vigente; tarifas, UVT y benchmarks corresponden a 2026.',
    verification:
      'Período primario coincide con el corte declarado; comparativo presente si hay dos años; tarifas DIAN y UVT 2026 actuales.',
  },
  // --- Block B (ISO/IEC 42001) ---
  {
    num: 5,
    block: 'B',
    blockTitle: BLOCK_B_TITLE,
    name: 'Trazabilidad IA (Traceability)',
    framework: 'ISO/IEC 42001',
    definition:
      'Cada cifra y juicio del informe es rastreable a un dato de entrada del balance de prueba o a una norma citada con código.',
    verification:
      'Cadena de custodia: balance crudo → preprocesador → bindingTotals → agentes; auditoría aritmética determinista publicada como anexo.',
  },
  {
    num: 6,
    block: 'B',
    blockTitle: BLOCK_B_TITLE,
    name: 'Transparencia (Transparency)',
    framework: 'ISO/IEC 42001',
    definition:
      'Las decisiones del modelo se explican con criterio técnico citado; limitaciones y supuestos quedan visibles para el lector.',
    verification:
      'Notas y disclaimers explican cómo se obtuvo cada cifra material; ningún cálculo crítico queda como "caja negra".',
  },
  {
    num: 7,
    block: 'B',
    blockTitle: BLOCK_B_TITLE,
    name: 'Sesgo y neutralidad (Bias & Fairness)',
    framework: 'ISO/IEC 42001',
    definition:
      'El informe no fabrica deficiencias ni minimiza hallazgos; cita normas verificables y evita lenguaje promocional.',
    verification:
      'Vocabulario neutro (sin "Élite", "Excepcional", "Sólido"); cifras y normas todas verificables; sin penalizaciones inventadas.',
  },
  {
    num: 8,
    block: 'B',
    blockTitle: BLOCK_B_TITLE,
    name: 'Responsabilidad humana (Human Oversight)',
    framework: 'ISO/IEC 42001 + Ley 43/1990',
    definition:
      'El informe deja explícito que requiere validación por Contador Público y/o Revisor Fiscal antes de su uso oficial.',
    verification:
      'Disclaimer de IA presente; recomendación de validación CP citada; espacios de firma humana incluidos en el acta.',
  },
  // --- Block C (IASB QC) ---
  {
    num: 9,
    block: 'C',
    blockTitle: BLOCK_C_TITLE,
    name: 'Relevancia (Relevance)',
    framework: 'IASB Conceptual Framework QC6-QC10',
    definition:
      'La información presentada es capaz de influir decisiones económicas — KPIs accionables, recomendaciones priorizadas, análisis de riesgo material.',
    verification:
      'Cada KPI viene con fórmula sustituida; las recomendaciones tienen impacto cuantificado o priorizado.',
  },
  {
    num: 10,
    block: 'C',
    blockTitle: BLOCK_C_TITLE,
    name: 'Representación fiel (Faithful Representation)',
    framework: 'IASB Conceptual Framework QC12-QC16 + NIC 1',
    definition:
      'Los estados financieros muestran sustancia económica completa, neutral y libre de errores materiales; clasificación y subtotales NIIF correctos.',
    verification:
      'Clasificación corriente/no corriente justificada, partidas mínimas NIC 1 §54 presentes, subtotales conformes a NIIF 18 cuando aplica.',
  },
  {
    num: 11,
    block: 'C',
    blockTitle: BLOCK_C_TITLE,
    name: 'Comprensibilidad (Understandability)',
    framework: 'IASB Conceptual Framework QC30-QC32',
    definition:
      'El informe se presenta con formato exportable, tablas legibles, moneda COP consistente y lenguaje accesible a un usuario informado.',
    verification:
      'Markdown limpio con tablas alineadas (no inline pipe-separated); cifras en formato $X.XXX.XXX,XX; sin metadatos internos del preparador.',
  },
  {
    num: 12,
    block: 'C',
    blockTitle: BLOCK_C_TITLE,
    name: 'Comparabilidad (Comparability)',
    framework: 'IASB Conceptual Framework QC20-QC25 + NIC 1 §38',
    definition:
      'Cuando hay dos períodos, los EEFF y KPIs se presentan en paralelo; variaciones materiales se explican.',
    verification:
      'Comparativo presente cuando preprocessed.periods.length≥2; variaciones >10% comentadas; uniformidad de políticas declarada.',
  },
];

// ---------------------------------------------------------------------------
// Threshold helpers (spec Parte V)
// ---------------------------------------------------------------------------

// Parte V: ✅ APROBADO (≥80%) · ⚠ (60-79%) · ❌ (<60%) — sobre el score SIN
// redondear al entero (75% → 7,5 → en revisión).
function statusFromScore10(score10: number | null): QualityV21Status {
  if (score10 === null) return 'no_evaluable';
  if (score10 >= 8) return 'aprobado';
  if (score10 >= 6) return 'en_revision';
  return 'requiere_correccion';
}

function selloTypeFromScore10(score10: number | null): QualityV21SelloType {
  if (score10 === null) return 'no_evaluable';
  if (score10 >= 8) return 'certificada';
  if (score10 >= 6) return 'con_observaciones';
  return 'requiere_correccion';
}

function selloTitle(type: QualityV21SelloType): string {
  switch (type) {
    case 'certificada':
      return 'CALIDAD CERTIFICADA 1+1';
    case 'con_observaciones':
      return 'CALIDAD CON OBSERVACIONES 1+1';
    case 'requiere_correccion':
      return 'CALIDAD REQUIERE CORRECCIÓN 1+1';
    case 'no_evaluable':
      return 'CALIDAD NO EVALUABLE 1+1';
  }
}

/** Un decimal con coma es-CO (`7,5`), igual que la página PDF de la Parte V. */
function dec1(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

function fmtScore10(score10: number | null): string {
  return score10 === null ? 'N/D' : dec1(score10);
}

function selloBottomLine(
  type: QualityV21SelloType,
  approvedCount: number,
  evaluatedCount: number,
  score10: number | null,
  blockers: string[],
): string {
  const nd = 12 - evaluatedCount;
  const head = `${approvedCount}/12 dimensiones aprobadas${nd > 0 ? ` (${nd} N/D)` : ''} — Score ${fmtScore10(score10)}/10.`;
  const why = blockers.length > 0 ? ` Motivo: ${blockers.join(' ')}` : '';
  switch (type) {
    case 'certificada':
      // Texto de la spec v2.1 Parte V: el sello no anticipa firmas (auditoria-calidad-30).
      return `${head} Listo para revisión del contador.`;
    case 'con_observaciones':
      return `${head} Atender las acciones correctivas antes de la presentación oficial.${why}`;
    case 'requiere_correccion':
      return `${head} Bloqueado para firma: corregir hallazgos críticos antes de continuar.${why}`;
    case 'no_evaluable':
      return `${head} Sello no emitido: cobertura insuficiente para evaluar la calidad.${why}`;
  }
}

// ---------------------------------------------------------------------------
// Internal D-dim lookup (defensive — names may vary slightly)
// ---------------------------------------------------------------------------
//
// `json.dimensions[].name` typically starts with the D-number ("D1 Completitud",
// "D14 Multiperiodo"). The matcher pulls the leading D<n> token. If the model
// emits a free-form name we fall back to substring scan against the D-tag.

interface FoundDim {
  /** 0..100 score; null = sin fuente (N/D). */
  score: number | null;
  /** points = findings + recommendations. */
  points: string[];
  /** True if we located a real entry; false if synthesized fallback. */
  found: boolean;
}

function indexDimensionsByD(dimensions: QualityDimensionJson[]): Map<number, QualityDimensionJson> {
  const map = new Map<number, QualityDimensionJson>();
  for (const d of dimensions) {
    // Match leading "D<n>" with optional dot/whitespace separator.
    const m = /^\s*D(\d{1,2})\b/i.exec(d.name);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= 14 && !map.has(n)) {
        map.set(n, d);
      }
    }
  }
  return map;
}

function readDDim(
  index: Map<number, QualityDimensionJson>,
  n: number,
): { score: number; points: string[] } | null {
  const d = index.get(n);
  if (!d) return null;
  const points = [...d.findings, ...d.recommendations].filter((s) => typeof s === 'string' && s.length > 0);
  return { score: clamp0to100(d.score), points };
}

function clamp0to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/** 0..100 → 0..10 con UN decimal. No se redondea al entero (auditoria-calidad-08). */
function score10FromScore100(score100: number | null): number | null {
  if (score100 === null) return null;
  return clamp0to100(score100) / 10;
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Per-dim resolver — implements the mapping table from spec Parte V
// ---------------------------------------------------------------------------

const SIN_COMPARATIVO =
  'N/D — sin periodo comparativo: la cobertura multiperiodo (D14) no tiene base y la dimensión no es evaluable (NIC 1 §38).';

function resolveV21Dim(
  num: number,
  index: Map<number, QualityDimensionJson>,
  json: QualityReportJson,
  ctx: QualityV21Context,
): FoundDim {
  switch (num) {
    case 1: // Accuracy <- D2
      return resolveSimple(index, 2, () => json.dataQuality.accuracy, 'Exactitud');
    case 2: // Completeness <- D1
      return resolveSimple(index, 1, () => json.dataQuality.completeness, 'Completitud');
    case 3: // Consistency <- D3
      return resolveSimple(index, 3, () => json.dataQuality.consistency, 'Consistencia');
    case 4: // Currentness <- D14 (multi-period coverage is the proxy for "currentness")
      if (ctx.comparativeAvailable === false) {
        return { score: null, points: [SIN_COMPARATIVO], found: false };
      }
      return resolveSimple(index, 14, () => json.dataQuality.timeliness, 'Actualidad');
    case 5: // Traceability IA <- D8
      return resolveSimple(index, 8, () => json.aiGovernance.traceability, 'Trazabilidad IA');
    case 6: // Transparency <- D9*0.9 + D6*0.1 (weighted composite)
      return resolveTransparencyComposite(index, json);
    case 7: // Bias <- D9
      return resolveSimple(index, 9, () => json.aiGovernance.antiHallucination, 'Sesgo y neutralidad');
    case 8: // Human Oversight <- D10
      return resolveSimple(index, 10, () => json.aiGovernance.humanOversight, 'Responsabilidad humana');
    case 9: // Relevance <- D6
      return resolveSimple(index, 6, () => json.aiGovernance.explainability, 'Relevancia');
    case 10: // Faithful Representation <- D4 (sin métrica raw asociada)
      return resolveSimple(index, 4, () => null, 'Representación fiel');
    case 11: // Understandability <- D11 (sin métrica raw asociada)
      return resolveSimple(index, 11, () => null, 'Comprensibilidad');
    case 12: // Comparability <- (D14 + D12) / 2
      if (ctx.comparativeAvailable === false) {
        return { score: null, points: [SIN_COMPARATIVO], found: false };
      }
      return resolveComparabilityComposite(index);
    default:
      // Defensive: not reachable for 1..12.
      return { score: null, points: [`Dimensión v2.1 #${num} sin mapeo definido — N/D.`], found: false };
  }
}

function resolveSimple(
  index: Map<number, QualityDimensionJson>,
  dNum: number,
  rawFallback: () => number | null,
  v21Name: string,
): FoundDim {
  const dd = readDDim(index, dNum);
  if (dd) return { score: dd.score, points: dd.points, found: true };

  // Un 0 real es un valor, no "sin dato": se respeta (auditoria-calidad-09).
  const raw = finiteOrNull(rawFallback());
  if (raw !== null) {
    return {
      score: clamp0to100(raw),
      points: [
        `Mapeo fallback: D${dNum} ausente en el JSON del meta-auditor — score derivado de la métrica raw (ISO 25012 / 42001).`,
      ],
      found: false,
    };
  }
  return {
    score: null,
    points: [
      `N/D — la dimensión "${v21Name}" no recibió score de D${dNum} ni métrica raw asociada; se excluye del promedio.`,
    ],
    found: false,
  };
}

function resolveTransparencyComposite(
  index: Map<number, QualityDimensionJson>,
  json: QualityReportJson,
): FoundDim {
  const d9 = readDDim(index, 9);
  const d6 = readDDim(index, 6);

  if (d9 && d6) {
    const composite = Math.round(d9.score * 0.9 + d6.score * 0.1);
    const points = [...d9.points, ...d6.points];
    return { score: clamp0to100(composite), points, found: true };
  }

  // Defensive fallbacks
  if (d9) {
    return {
      score: d9.score,
      points: [
        ...d9.points,
        'Mapeo fallback: D6 ausente — el score de Transparencia usa únicamente D9 anti-alucinación.',
      ],
      found: false,
    };
  }
  if (d6) {
    return {
      score: d6.score,
      points: [
        ...d6.points,
        'Mapeo fallback: D9 ausente — el score de Transparencia usa únicamente D6 análisis estratégico.',
      ],
      found: false,
    };
  }

  const anti = finiteOrNull(json.aiGovernance.antiHallucination);
  const expl = finiteOrNull(json.aiGovernance.explainability);
  if (anti === null || expl === null) {
    return {
      score: null,
      points: ['N/D — el meta-auditor no emitió D9 ni D6 ni métricas raw de gobernanza IA.'],
      found: false,
    };
  }
  return {
    score: clamp0to100(Math.round(clamp0to100(anti) * 0.9 + clamp0to100(expl) * 0.1)),
    points: [
      'Dato incompleto: el meta-auditor no emitió D9 ni D6. Score derivado de aiGovernance.antiHallucination + explainability.',
    ],
    found: false,
  };
}

function resolveComparabilityComposite(
  index: Map<number, QualityDimensionJson>,
): FoundDim {
  const d14 = readDDim(index, 14);
  const d12 = readDDim(index, 12);

  if (d14 && d12) {
    const composite = Math.round((d14.score + d12.score) / 2);
    const points = [...d14.points, ...d12.points];
    return { score: clamp0to100(composite), points, found: true };
  }

  if (d14) {
    return {
      score: d14.score,
      points: [
        ...d14.points,
        'Mapeo fallback: D12 (preparación IFRS 18) ausente — Comparabilidad refleja únicamente la cobertura multiperiodo D14.',
      ],
      found: false,
    };
  }
  // Sin D14 la comparabilidad no tiene base: la preparación IFRS 18 (D12) o
  // su score raw no miden comparabilidad entre periodos (auditoria-calidad-09/-11).
  return {
    score: null,
    points: [
      ...(d12 ? d12.points : []),
      'N/D — el meta-auditor no evaluó la cobertura multiperiodo (D14); la comparabilidad no se estima desde la preparación IFRS 18.',
    ],
    found: false,
  };
}

// ---------------------------------------------------------------------------
// Corrective action synthesis (only for dims with score10 < 7)
// ---------------------------------------------------------------------------
//
// `impactPoints` estimates the average overall score gain (in 0..10 units) if
// the action lands. Heuristic: bringing a dim from N to the 8/10 threshold
// improves the average by `(8 - N) / 12` rounded up to 1 decimal.

function buildCorrectiveActions(dims: QualityV21Dimension[]): QualityV21CorrectiveAction[] {
  const actions: QualityV21CorrectiveAction[] = [];
  for (const d of dims) {
    if (d.score10 === null || d.score10 >= 7) continue;
    const gap = 8 - d.score10;
    const impact = Math.round((gap / 12) * 10) / 10; // one decimal
    const firstPoint = d.points.find((p) => p && p.trim().length > 0);
    const action = firstPoint
      ? `Atender: ${firstPoint}`
      : `Revisar la dimensión "${d.name}" — score actual ${dec1(d.score10)}/10 por debajo del umbral 7.`;
    actions.push({
      dimNum: d.num,
      dimName: d.name,
      action,
      impactPoints: impact,
    });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Dimensiones sin las cuales el sello no se emite (Bloque A — datos). */
const CRITICAL_DIMS = [1, 2, 3] as const;
/** Cobertura mínima de dimensiones evaluadas para emitir el sello. */
const MIN_EVALUATED_DIMS = 9;
/** Exactitud por debajo de este score (0..10) bloquea el sello. */
const EXACTITUD_BLOQUEANTE = 6;

export function buildQualityV21View(
  json: QualityReportJson,
  ctx: QualityV21Context = {},
): QualityV21View {
  const index = indexDimensionsByD(json.dimensions);
  const integrityBroken = ctx.integrity?.status === 'con_bloqueantes';

  const dimensions: QualityV21Dimension[] = QUALITY_V21_DIM_META.map((meta) => {
    const resolved = resolveV21Dim(meta.num, index, json, ctx);
    let score10 = score10FromScore100(resolved.score);
    let points = resolved.points;
    if (meta.num === 1 && integrityBroken) {
      // Integridad aritmética determinista rota → Exactitud = 0, sin importar
      // lo que haya puntuado el LLM (auditoria-calidad-03).
      score10 = 0;
      points = [
        `Integridad aritmética determinista con bloqueantes: ${ctx.integrity!.motivos.join(' ')}`,
        ...points,
      ];
    }
    return {
      num: meta.num,
      block: meta.block,
      blockTitle: meta.blockTitle,
      name: meta.name,
      framework: meta.framework,
      score10,
      status: statusFromScore10(score10),
      points,
    };
  });

  const evaluated = dimensions.filter((d) => d.score10 !== null);
  const evaluatedCount = evaluated.length;
  const globalScore10 =
    evaluatedCount > 0
      ? Math.floor((evaluated.reduce((acc, d) => acc + (d.score10 as number), 0) / evaluatedCount) * 10 + 1e-9) / 10
      : null;
  const approvedCount = dimensions.filter((d) => d.status === 'aprobado').length;

  // --- Gating del sello ---------------------------------------------------
  const selloBlockers: string[] = [];
  let selloType = selloTypeFromScore10(globalScore10);
  const missingCritical = CRITICAL_DIMS.filter(
    (n) => dimensions.find((d) => d.num === n)?.score10 === null,
  );
  if (missingCritical.length > 0 || evaluatedCount < MIN_EVALUATED_DIMS) {
    selloType = 'no_evaluable';
    if (missingCritical.length > 0) {
      selloBlockers.push(
        `Dimensiones críticas sin evaluar: ${missingCritical
          .map((n) => dimensions.find((d) => d.num === n)!.name)
          .join(', ')}.`,
      );
    }
    if (evaluatedCount < MIN_EVALUATED_DIMS) {
      selloBlockers.push(`Sólo ${evaluatedCount} de 12 dimensiones tienen fuente (mínimo ${MIN_EVALUATED_DIMS}).`);
    }
  } else {
    const exactitud = dimensions.find((d) => d.num === 1)!.score10 as number;
    if (integrityBroken) {
      selloBlockers.push('La integridad aritmética determinista del informe tiene bloqueantes.');
    }
    if (exactitud < EXACTITUD_BLOQUEANTE) {
      selloBlockers.push(`Exactitud ${dec1(exactitud)}/10 por debajo de ${EXACTITUD_BLOQUEANTE}/10 (dimensión bloqueante).`);
    }
    if (selloBlockers.length > 0) selloType = 'requiere_correccion';
  }
  const globalStatus: QualityV21Status =
    selloType === 'no_evaluable'
      ? 'no_evaluable'
      : selloType === 'requiere_correccion'
        ? 'requiere_correccion'
        : statusFromScore10(globalScore10);

  const sello: QualityV21Sello = {
    type: selloType,
    title: selloTitle(selloType),
    score: globalScore10,
    approvedCount,
    evaluatedCount,
    bottomLine: selloBottomLine(selloType, approvedCount, evaluatedCount, globalScore10, selloBlockers),
  };

  const correctiveActions = buildCorrectiveActions(dimensions);

  return {
    dimensions,
    globalScore10,
    globalStatus,
    selloBlockers,
    sello,
    correctiveActions,
  };
}

/** Returns the static metadata for a v2.1 dimension number (1..12). */
export function getV21DimMeta(num: number): QualityV21DimMeta | undefined {
  return QUALITY_V21_DIM_META.find((m) => m.num === num);
}

/** Status -> visual marker (✅ / ⚠ / ❌) used by the renderer. */
export function statusMarker(status: QualityV21Status): string {
  switch (status) {
    case 'aprobado':
      return '✅';
    case 'en_revision':
      return '⚠';
    case 'requiere_correccion':
      return '❌';
    case 'no_evaluable':
      return '— N/D';
  }
}
