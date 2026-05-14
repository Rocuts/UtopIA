// ---------------------------------------------------------------------------
// Quality Meta-Auditor — Spec v2.1 (Parte V) 14 -> 12 dimension mapping
// ---------------------------------------------------------------------------
// Pure deterministic helper. Takes the internal QualityReportJson (14 D-dims
// plus dataQuality/aiGovernance/ifrs18Readiness blocks) and produces the v2.1
// 12-dimension view organized in 3 blocks (A/B/C), a sello de calidad and a
// list of corrective actions for dims that scored below 7/10.
//
// No LLM. No side effects. Same input -> same output.
// ---------------------------------------------------------------------------

import type { QualityReportJson, QualityDimensionJson } from '../contracts/quality-report';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityV21Status = 'aprobado' | 'en_revision' | 'requiere_correccion';
export type QualityV21Block = 'A' | 'B' | 'C';
export type QualityV21SelloType = 'certificada' | 'con_observaciones' | 'requiere_correccion';

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
  /** Score rounded to 0..10 (from internal 0..100). */
  scoreInt0to10: number;
  /** Status tier from the threshold table. */
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
  /** Same as globalScoreInt0to10 (rounded to 1 decimal). */
  score: number;
  /** Number of dimensions whose status === 'aprobado'. */
  approvedCount: number;
  /** Bottom-line sentence shown inside the sello frame. */
  bottomLine: string;
}

export interface QualityV21View {
  /** Always 12 entries, in canonical order (block A first, then B, then C). */
  dimensions: QualityV21Dimension[];
  /** Arithmetic average of the 12 dim scores (one decimal). */
  globalScoreInt0to10: number;
  /** Status tier of the global score. */
  globalStatus: QualityV21Status;
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

function statusFromScore10(score10: number): QualityV21Status {
  if (score10 >= 8) return 'aprobado';
  if (score10 >= 6) return 'en_revision';
  return 'requiere_correccion';
}

function selloTypeFromScore10(score10: number): QualityV21SelloType {
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
  }
}

function selloBottomLine(type: QualityV21SelloType, approvedCount: number, score10: number): string {
  switch (type) {
    case 'certificada':
      return `${approvedCount}/12 dimensiones aprobadas — Score ${score10.toFixed(1)}/10. Listo para revisión del contador y firma del representante legal.`;
    case 'con_observaciones':
      return `${approvedCount}/12 dimensiones aprobadas — Score ${score10.toFixed(1)}/10. Atender las acciones correctivas antes de la presentación oficial.`;
    case 'requiere_correccion':
      return `${approvedCount}/12 dimensiones aprobadas — Score ${score10.toFixed(1)}/10. Bloqueado para firma: corregir hallazgos críticos antes de continuar.`;
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
  /** 0..100 score. */
  score: number;
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

function round10FromScore100(score100: number): number {
  return Math.round(clamp0to100(score100) / 10);
}

// ---------------------------------------------------------------------------
// Per-dim resolver — implements the mapping table from spec Parte V
// ---------------------------------------------------------------------------

function resolveV21Dim(
  num: number,
  index: Map<number, QualityDimensionJson>,
  json: QualityReportJson,
): FoundDim {
  switch (num) {
    case 1: // Accuracy <- D2
      return resolveSimple(index, 2, () => json.dataQuality.accuracy, 'Exactitud');
    case 2: // Completeness <- D1
      return resolveSimple(index, 1, () => json.dataQuality.completeness, 'Completitud');
    case 3: // Consistency <- D3
      return resolveSimple(index, 3, () => json.dataQuality.consistency, 'Consistencia');
    case 4: // Currentness <- D14 (multi-period coverage is the proxy for "currentness")
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
    case 10: // Faithful Representation <- D4
      return resolveSimple(index, 4, () => 70, 'Representación fiel');
    case 11: // Understandability <- D11
      return resolveSimple(index, 11, () => 70, 'Comprensibilidad');
    case 12: // Comparability <- (D14 + D12) / 2
      return resolveComparabilityComposite(index, json);
    default:
      // Defensive: not reachable for 1..12.
      return { score: 70, points: [`Dimensión v2.1 #${num} sin mapeo definido — datos incompletos.`], found: false };
  }
}

function resolveSimple(
  index: Map<number, QualityDimensionJson>,
  dNum: number,
  rawFallback: () => number,
  v21Name: string,
): FoundDim {
  const dd = readDDim(index, dNum);
  if (dd) return { score: dd.score, points: dd.points, found: true };

  const raw = clamp0to100(rawFallback());
  if (raw > 0) {
    return {
      score: raw,
      points: [
        `Mapeo fallback: D${dNum} ausente en el JSON del meta-auditor — score derivado de la métrica raw (ISO 25012 / 42001).`,
      ],
      found: false,
    };
  }
  return {
    score: 70,
    points: [
      `Dato incompleto: la dimensión "${v21Name}" no recibió score de D${dNum} ni métrica raw asociada. Valor por defecto 7/10.`,
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

  const rawFallback = Math.round(
    clamp0to100(json.aiGovernance.antiHallucination) * 0.9 +
      clamp0to100(json.aiGovernance.explainability) * 0.1,
  );
  return {
    score: clamp0to100(rawFallback) || 70,
    points: [
      'Dato incompleto: el meta-auditor no emitió D9 ni D6. Score derivado de aiGovernance.antiHallucination + explainability.',
    ],
    found: false,
  };
}

function resolveComparabilityComposite(
  index: Map<number, QualityDimensionJson>,
  json: QualityReportJson,
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
  if (d12) {
    return {
      score: d12.score,
      points: [
        ...d12.points,
        'Mapeo fallback: D14 (multiperiodo) ausente — Comparabilidad refleja únicamente la preparación IFRS 18 D12.',
      ],
      found: false,
    };
  }

  const ifrsScore = clamp0to100(json.ifrs18Readiness.score);
  return {
    score: ifrsScore || 70,
    points: [
      'Dato incompleto: el meta-auditor no emitió D14 ni D12. Score derivado de ifrs18Readiness.score como aproximación.',
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
    if (d.scoreInt0to10 >= 7) continue;
    const gap = 8 - d.scoreInt0to10;
    const impact = Math.round((gap / 12) * 10) / 10; // one decimal
    const firstPoint = d.points.find((p) => p && p.trim().length > 0);
    const action = firstPoint
      ? `Atender: ${firstPoint}`
      : `Revisar la dimensión "${d.name}" — score actual ${d.scoreInt0to10}/10 por debajo del umbral 7.`;
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

export function buildQualityV21View(json: QualityReportJson): QualityV21View {
  const index = indexDimensionsByD(json.dimensions);

  const dimensions: QualityV21Dimension[] = QUALITY_V21_DIM_META.map((meta) => {
    const resolved = resolveV21Dim(meta.num, index, json);
    const score10 = round10FromScore100(resolved.score);
    return {
      num: meta.num,
      block: meta.block,
      blockTitle: meta.blockTitle,
      name: meta.name,
      framework: meta.framework,
      scoreInt0to10: score10,
      status: statusFromScore10(score10),
      points: resolved.points,
    };
  });

  const sumScores10 = dimensions.reduce((acc, d) => acc + d.scoreInt0to10, 0);
  const globalScoreInt0to10 = Math.round((sumScores10 / dimensions.length) * 10) / 10;
  const globalStatus = statusFromScore10(globalScoreInt0to10);
  const approvedCount = dimensions.filter((d) => d.status === 'aprobado').length;
  const selloType = selloTypeFromScore10(globalScoreInt0to10);

  const sello: QualityV21Sello = {
    type: selloType,
    title: selloTitle(selloType),
    score: globalScoreInt0to10,
    approvedCount,
    bottomLine: selloBottomLine(selloType, approvedCount, globalScoreInt0to10),
  };

  const correctiveActions = buildCorrectiveActions(dimensions);

  return {
    dimensions,
    globalScoreInt0to10,
    globalStatus,
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
  }
}
