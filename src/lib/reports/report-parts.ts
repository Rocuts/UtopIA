import type {
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';
import { HANDOFF_MAX_CHARS } from '@/lib/validation/schemas';

// ---------------------------------------------------------------------------
// Partes I–III que /consolidate recibe para persistir la versión del informe
// ---------------------------------------------------------------------------
// Forma cerrada y acotada: se conservan sólo las claves que el informe usa
// (secciones Markdown, JSON estructurado y veredictos) y se descarta el resto.
// No viaja al LLM (no aplica el contrato strict-mode). Los veredictos que llegan
// aquí no levantan nada por sí solos: /export vuelve a correr el gate
// aritmético sobre la versión persistida y contra su balance.
// ---------------------------------------------------------------------------

export interface ReportParts {
  niifAnalysis: NiifAnalysisResult;
  strategicAnalysis: StrategicAnalysisResult;
  governance: GovernanceResult;
}

/** Tope del JSON de las tres partes (≈ holgura sobre 3 × HANDOFF_MAX_CHARS). */
export const REPORT_PARTS_MAX_CHARS = 4_000_000;

const NIIF_TEXT = ['balanceSheet', 'incomeStatement', 'cashFlowStatement', 'equityChangesStatement', 'technicalNotes'] as const;
const STRATEGY_TEXT = ['kpiDashboard', 'breakEvenAnalysis', 'projectedCashFlow', 'strategicRecommendations'] as const;
const GOVERNANCE_TEXT = ['financialNotes', 'shareholderMinutes'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function pick(
  src: Record<string, unknown>,
  path: string,
  textKeys: readonly string[],
  extraKeys: readonly string[],
  errors: string[],
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const full = src.fullContent;
  if (typeof full !== 'string' || full.trim().length === 0 || full.length > HANDOFF_MAX_CHARS) {
    errors.push(`${path}.fullContent: requerido (texto no vacío de hasta ${HANDOFF_MAX_CHARS} caracteres)`);
    return null;
  }
  out.fullContent = full;
  for (const k of textKeys) {
    const v = src[k];
    if (v === undefined || v === null) {
      out[k] = '';
    } else if (typeof v === 'string' && v.length <= HANDOFF_MAX_CHARS) {
      out[k] = v;
    } else {
      errors.push(`${path}.${k}: debe ser texto`);
    }
  }
  for (const k of extraKeys) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (k === 'degraded') {
      if (typeof v === 'boolean') out[k] = v;
      else errors.push(`${path}.degraded: debe ser booleano`);
      continue;
    }
    if (!isPlainObject(v)) {
      errors.push(`${path}.${k}: debe ser un objeto`);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export type ReportPartsParse =
  | { kind: 'absent' }
  | { kind: 'invalid'; details: string[] }
  | { kind: 'ok'; parts: ReportParts };

/** Valida y recorta `reportParts` del cuerpo de /consolidate. */
export function parseReportParts(value: unknown): ReportPartsParse {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (!isPlainObject(value)) return { kind: 'invalid', details: ['reportParts: debe ser un objeto'] };
  let size = 0;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return { kind: 'invalid', details: ['reportParts: no es JSON serializable'] };
  }
  if (size > REPORT_PARTS_MAX_CHARS) {
    return { kind: 'invalid', details: [`reportParts: excede ${REPORT_PARTS_MAX_CHARS} caracteres`] };
  }
  const errors: string[] = [];
  const niif = isPlainObject(value.niifAnalysis)
    ? pick(value.niifAnalysis, 'reportParts.niifAnalysis', NIIF_TEXT, ['json', 'reconciliation'], errors)
    : (errors.push('reportParts.niifAnalysis: requerido'), null);
  const strategy = isPlainObject(value.strategicAnalysis)
    ? pick(
        value.strategicAnalysis,
        'reportParts.strategicAnalysis',
        STRATEGY_TEXT,
        ['json', 'strategyQualifications', 'degraded'],
        errors,
      )
    : (errors.push('reportParts.strategicAnalysis: requerido'), null);
  const governance = isPlainObject(value.governance)
    ? pick(value.governance, 'reportParts.governance', GOVERNANCE_TEXT, ['json', 'actaQualifications', 'degraded'], errors)
    : (errors.push('reportParts.governance: requerido'), null);
  if (errors.length > 0 || !niif || !strategy || !governance) return { kind: 'invalid', details: errors };
  return {
    kind: 'ok',
    parts: {
      niifAnalysis: niif as unknown as NiifAnalysisResult,
      strategicAnalysis: strategy as unknown as StrategicAnalysisResult,
      governance: governance as unknown as GovernanceResult,
    },
  };
}
