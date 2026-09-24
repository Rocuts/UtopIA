// ---------------------------------------------------------------------------
// Referencia a una versión persistida del informe financiero
// ---------------------------------------------------------------------------
// Módulo puro (sin `node:*`, sin DB): lo comparten la UI, que guarda la
// referencia que devuelve /consolidate y la reenvía a /export, /html y
// /api/escudo/fiscal-anchor, y las rutas, que la validan antes de consultar.
// ---------------------------------------------------------------------------

/** Lo que la UI conserva y reenvía: id de la fila `reports` y huella del informe. */
export interface ReportRef {
  reportId: string;
  reportHash: string;
}

/** Metadatos de procedencia que acompañan a la referencia. */
export interface ReportProvenance extends ReportRef {
  /** Huella SHA-256 canónica del balance preprocesado persistido (null sin balance). */
  sourceHash: string | null;
  /** Huella SHA-256 del texto del balance recibido (archivo de origen). */
  rawDataHash: string | null;
  /** Versión del contrato de reglas con el que se validó y persistió. */
  contractVersion: string;
  /** Versión del contrato del preprocesador (PUC, curador, anclas). */
  preprocessorVersion: string;
  /** ISO 8601 de la persistencia. */
  createdAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * Campo con el que la UI adjunta la procedencia al informe que guarda en su
 * estado (y en localStorage). No forma parte de la versión persistida ni de su
 * huella: el servidor lo ignora y sólo lee `reportRef` del cuerpo.
 */
export const SERVER_VERSION_FIELD = 'serverVersion';

type WithServerVersion = { [SERVER_VERSION_FIELD]?: ReportProvenance };

/** Informe con la procedencia de su versión persistida adjunta. */
export function attachServerVersion<T extends object>(report: T, provenance: ReportProvenance): T {
  return { ...report, [SERVER_VERSION_FIELD]: provenance };
}

/** Copia del informe SIN procedencia (p. ej. tras editarlo en el navegador). */
export function detachServerVersion<T extends object>(report: T): T {
  if (!(SERVER_VERSION_FIELD in report)) return report;
  const copy = { ...report } as T & WithServerVersion;
  delete copy[SERVER_VERSION_FIELD];
  return copy;
}

/** Procedencia adjunta al informe, si la tiene y es bien formada. */
export function readServerVersion(report: unknown): ReportProvenance | null {
  if (!report || typeof report !== 'object') return null;
  const v = (report as WithServerVersion)[SERVER_VERSION_FIELD];
  const parsed = parseReportRef(v);
  return parsed.kind === 'ok' && v ? { ...v, ...parsed.ref } : null;
}

/** Referencia `{reportId, reportHash}` del informe, si tiene versión persistida. */
export function readReportRef(report: unknown): ReportRef | null {
  const v = readServerVersion(report);
  return v ? { reportId: v.reportId, reportHash: v.reportHash } : null;
}

export type ParsedReportRef =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'ok'; ref: ReportRef };

/**
 * Lee `reportRef` del cuerpo de una petición. Ausente (undefined/null) no es
 * error: es el camino histórico sin procedencia verificada. Presente pero con
 * forma inválida sí lo es (el caller responde 400 sin consultar la DB).
 */
export function parseReportRef(value: unknown): ParsedReportRef {
  if (value === undefined || value === null) return { kind: 'absent' };
  if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const v = value as Record<string, unknown>;
  if (typeof v.reportId !== 'string' || !UUID_RE.test(v.reportId)) return { kind: 'invalid' };
  if (typeof v.reportHash !== 'string' || !SHA256_RE.test(v.reportHash)) return { kind: 'invalid' };
  return { kind: 'ok', ref: { reportId: v.reportId.toLowerCase(), reportHash: v.reportHash } };
}
