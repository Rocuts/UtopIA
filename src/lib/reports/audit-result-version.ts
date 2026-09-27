import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import { canonicalHash, toCanonicalJsonValue } from './canonical';
import { FINANCIAL_REPORT_CONTRACT_VERSION } from './financial-report-version';
import type { ReportRef } from './report-ref';

// ---------------------------------------------------------------------------
// Resultado persistido de la Parte IV (dictámenes) o la Parte V (meta-auditoría)
// ---------------------------------------------------------------------------
// Hasta aquí la versión persistida cubría las Partes I–III: /export por
// referencia sellaba "procedencia verificada" pero imprimía los dictámenes y la
// meta-auditoría que enviaba el navegador, sin nada que los atara a la versión.
// Un resultado es la fila `reports` (kind = 'financial_audit_result') que
// escriben /financial-audit y /financial-quality cuando reciben `reportRef`: el
// servidor carga ESA versión, corre los agentes sobre ella y guarda la salida
// antes de responder. Queda atado a la versión por su `{reportId, reportHash}`
// exacto, y la meta-auditoría además a la Parte IV que leyó.
//
// Módulo puro salvo por `node:crypto` (vía ./canonical): sin DB ni cookies.
// ---------------------------------------------------------------------------

export const FINANCIAL_AUDIT_RESULT_KIND = 'financial_audit_result';

export const AUDIT_RESULT_FORMAT = 'utopia.financial-audit-result.v1';

/** Parte IV: los cuatro dictámenes; Parte V: la meta-auditoría de calidad. */
export type AuditResultPart = 'iv' | 'v';

/** Lo que la UI conserva y reenvía de un resultado: id de la fila y su huella. */
export interface AuditResultRef {
  resultId: string;
  resultHash: string;
}

export interface AuditResultData {
  format: typeof AUDIT_RESULT_FORMAT;
  part: AuditResultPart;
  /** Versión del informe que los agentes examinaron. */
  reportRef: ReportRef;
  /** Parte V: la Parte IV persistida que leyó; null si corrió sin ella. */
  auditRef: AuditResultRef | null;
  /**
   * `false` si un auditor falló o el agente no devolvió contenido. El
   * resultado se conserva (la UI lo muestra) pero no entra en una descarga.
   * En la Parte V también es `false` si la Parte IV que leyó era parcial.
   */
  complete: boolean;
  language: 'es' | 'en';
  /** Contrato del informe vigente cuando se produjo el resultado. */
  contractVersion: string;
  createdAt: string;
  /** Salida del agente en su forma JSON canónica. */
  result: AuditReport | QualityAssessment;
  /** SHA-256 del sobre completo salvo esta huella. */
  resultHash: string;
}

/** Procedencia de un resultado incluido en un artefacto. */
export interface AuditResultProvenance extends AuditResultRef {
  part: AuditResultPart;
  createdAt: string;
  /** Parte V: la Parte IV que leyó. */
  auditRef: AuditResultRef | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type ParsedAuditResultRef =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'ok'; ref: AuditResultRef };

/** Lee una referencia de resultado del cuerpo. Ausente no es error; mal formada sí. */
export function parseAuditResultRef(value: unknown): ParsedAuditResultRef {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const v = value as Record<string, unknown>;
  if (typeof v.resultId !== 'string' || !UUID_RE.test(v.resultId)) return { kind: 'invalid' };
  if (typeof v.resultHash !== 'string' || !SHA256_RE.test(v.resultHash)) return { kind: 'invalid' };
  return { kind: 'ok', ref: { resultId: v.resultId.toLowerCase(), resultHash: v.resultHash } };
}

/**
 * ¿El resultado es exportable como el de registro? Un auditor caído o un
 * agente sin contenido deja el resultado en pantalla, fuera de la descarga.
 */
export function auditResultIsComplete(
  part: AuditResultPart,
  result: AuditReport | QualityAssessment | null | undefined,
): boolean {
  if (!result) return false;
  if (part === 'iv') {
    const audit = result as AuditReport;
    const results = audit.auditorResults;
    return Array.isArray(results) && results.length > 0 && results.every((r) => !r.failed)
      && typeof audit.consolidatedReport === 'string' && audit.consolidatedReport.trim().length > 0;
  }
  const quality = result as QualityAssessment;
  return Array.isArray(quality.dimensions) && quality.dimensions.length > 0
    && typeof quality.fullReport === 'string' && quality.fullReport.trim().length > 0;
}

function hashEnvelope(data: Omit<AuditResultData, 'resultHash'>): string {
  return canonicalHash(data);
}

/** Arma el resultado a persistir. `complete` sale de la salida y, en la Parte V, de la Parte IV leída. */
export function buildAuditResultVersion(args: {
  part: AuditResultPart;
  reportRef: ReportRef;
  auditRef: AuditResultRef | null;
  /** Parte V: ¿la Parte IV que leyó era completa? Ignorado en la Parte IV. */
  auditComplete?: boolean;
  language: 'es' | 'en';
  result: AuditReport | QualityAssessment;
  createdAt?: string;
}): AuditResultData {
  const own = auditResultIsComplete(args.part, args.result);
  const complete = args.part === 'v' && args.auditRef ? own && args.auditComplete === true : own;
  const envelope: Omit<AuditResultData, 'resultHash'> = {
    format: AUDIT_RESULT_FORMAT,
    part: args.part,
    reportRef: { reportId: args.reportRef.reportId, reportHash: args.reportRef.reportHash },
    auditRef: args.part === 'v' ? args.auditRef : null,
    complete,
    language: args.language,
    contractVersion: FINANCIAL_REPORT_CONTRACT_VERSION,
    createdAt: args.createdAt ?? new Date().toISOString(),
    result: toCanonicalJsonValue(args.result),
  };
  return { ...envelope, resultHash: hashEnvelope(envelope) };
}

export type VerifiedAuditResult =
  | { ok: true; data: AuditResultData }
  | { ok: false; reason: string };

/** Recalcula la huella del sobre guardado: cualquier cambio en la fila la rompe. */
export function verifyAuditResultVersion(value: unknown): VerifiedAuditResult {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not an object' };
  const data = value as AuditResultData;
  if (data.format !== AUDIT_RESULT_FORMAT) return { ok: false, reason: 'unknown format' };
  if (data.part !== 'iv' && data.part !== 'v') return { ok: false, reason: 'unknown part' };
  if (!data.result || typeof data.result !== 'object') return { ok: false, reason: 'missing result' };
  const { resultHash, ...envelope } = data;
  if (typeof resultHash !== 'string' || hashEnvelope(envelope) !== resultHash) {
    return { ok: false, reason: 'hash mismatch' };
  }
  return { ok: true, data };
}

/** Procedencia del resultado para el sello y las cabeceras del artefacto. */
export function auditResultProvenanceOf(resultId: string, data: AuditResultData): AuditResultProvenance {
  return {
    resultId,
    resultHash: data.resultHash,
    part: data.part,
    createdAt: data.createdAt,
    auditRef: data.auditRef,
  };
}

/** ¿Dos referencias de versión nombran exactamente la misma versión? */
export function sameReportRef(a: ReportRef, b: ReportRef): boolean {
  return a.reportId.toLowerCase() === b.reportId.toLowerCase() && a.reportHash === b.reportHash;
}

/** ¿Dos referencias de resultado (o su ausencia) coinciden? */
export function sameAuditResultRef(a: AuditResultRef | null, b: AuditResultRef | null): boolean {
  if (!a || !b) return a === b;
  return a.resultId.toLowerCase() === b.resultId.toLowerCase() && a.resultHash === b.resultHash;
}
