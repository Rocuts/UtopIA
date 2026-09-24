/**
 * Gate de descarga del informe financiero (Excel / PDF / HTML) — lógica pura.
 * ---------------------------------------------------------------------------
 * Un entregable sólo se ofrece para descargar cuando:
 *   - tiene las tres partes (pipeline-flujo-14: un checkpoint con Estrategia o
 *     Gobierno fallidos se rehidrataba como "completo" y se exportaba sin
 *     marca, omitiendo en silencio el acta y las recomendaciones);
 *   - la Parte II (`strategyQualifications`) y el acta (`actaQualifications`)
 *     no traen salvedades (pipeline-flujo-05 / -15), con motivo propio;
 *   - la reconciliación contra el balance preprocesado cerró;
 *   - los gates post-render del servidor (`/api/financial-report/consolidate`,
 *     pipeline-flujo-16) no lo marcaron como no emitible ni con validación
 *     fallida.
 *
 * Vive fuera de PipelineWorkspace para poder probarse sin DOM.
 */

import { detectMissingPhases, type PipelinePhaseId } from './pipeline-resilience';

/** Parte del informe con salvedades propias: Estrategia (Parte II) o el acta. */
export type QualifiedPart = 'strategy' | 'acta';

export type ReportExportBlock =
  | { reason: 'incomplete'; missing: PipelinePhaseId[] }
  | { reason: 'part-qualifications'; parts: QualifiedPart[]; details: string[] }
  | { reason: 'qualifications' }
  | { reason: 'not-emittable'; details: string[] }
  | { reason: 'validation-failed'; details: string[] };

interface PartQualificationsShape {
  clean?: unknown;
  motivos?: unknown;
}

interface ExportGateShape {
  strategicAnalysis?: {
    fullContent?: unknown;
    strategyQualifications?: PartQualificationsShape | null;
    degraded?: unknown;
  } | null;
  governance?: {
    fullContent?: unknown;
    actaQualifications?: PartQualificationsShape | null;
    degraded?: unknown;
  } | null;
  niifAnalysis?: { reconciliation?: { clean?: boolean } | null } | null;
  validation?: { ok?: boolean; errors?: string[] } | null;
  emittability?: { kind?: string; blockers?: Array<{ message?: string }> } | null;
}

function qualificationMotivos(q: PartQualificationsShape | null | undefined): string[] | null {
  if (!q || q.clean !== false) return null;
  return Array.isArray(q.motivos)
    ? q.motivos.filter((m): m is string => typeof m === 'string' && m.length > 0)
    : [];
}

/** Motivo por el que el informe NO puede descargarse, o `null` si puede. */
export function resolveReportExportBlock(report: unknown): ReportExportBlock | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as ExportGateShape;

  const missing = detectMissingPhases(report);
  if (missing.length > 0) return { reason: 'incomplete', missing };

  // Salvedades de la Parte II y del acta con su propio motivo. Se leen
  // directamente (y no sólo vía el pliegue de la UI sobre la reconciliación)
  // para que un informe persistido antes de ese pliegue también se bloquee, y
  // antes que `reconciliation.clean`, que la UI pone en false al plegarlas.
  const parts: QualifiedPart[] = [];
  const details: string[] = [];
  const strategyMotivos = qualificationMotivos(r.strategicAnalysis?.strategyQualifications);
  if (strategyMotivos) {
    parts.push('strategy');
    details.push(...strategyMotivos);
  }
  const actaMotivos = qualificationMotivos(r.governance?.actaQualifications);
  if (actaMotivos) {
    parts.push('acta');
    details.push(...actaMotivos);
  }
  if (parts.length > 0) return { reason: 'part-qualifications', parts, details };

  if (r.niifAnalysis?.reconciliation?.clean === false) return { reason: 'qualifications' };

  if (r.emittability?.kind === 'no-emitible') {
    return {
      reason: 'not-emittable',
      details: (r.emittability.blockers ?? [])
        .map((b) => b?.message)
        .filter((m): m is string => typeof m === 'string' && m.length > 0),
    };
  }

  if (r.validation && r.validation.ok === false) {
    return {
      reason: 'validation-failed',
      details: (r.validation.errors ?? []).filter((e) => typeof e === 'string'),
    };
  }

  return null;
}

/** Textos accesibles del botón bloqueado (aria-label y title). */
export function reportExportBlockCopy(
  block: ReportExportBlock,
  language: 'es' | 'en',
  action: 'download' | 'generate',
): { ariaLabel: string; title: string } {
  const es = language === 'es';
  const verb = action === 'download'
    ? es ? 'Descarga bloqueada' : 'Download blocked'
    : es ? 'Generación bloqueada' : 'Generation blocked';
  const firstDetails = (details: string[]) =>
    details.length > 0 ? ` ${details.slice(0, 3).join(' · ')}` : '';

  switch (block.reason) {
    case 'incomplete': {
      const names = block.missing
        .map((p) =>
          p === 'strategy'
            ? es ? 'Estrategia (Parte II)' : 'Strategy (Part II)'
            : es ? 'Gobierno Corporativo (Parte III)' : 'Corporate Governance (Part III)',
        )
        .join(', ');
      return {
        ariaLabel: es
          ? `${verb}: el informe está INCOMPLETO`
          : `${verb}: the report is INCOMPLETE`,
        title: es
          ? `Faltan por generar: ${names}. Un informe incompleto no es firmable; reintente la fase faltante antes de descargarlo.`
          : `Still missing: ${names}. An incomplete report is not signable; retry the missing phase before downloading.`,
      };
    }
    case 'part-qualifications': {
      const names = block.parts
        .map((p) =>
          p === 'strategy'
            ? es ? 'Estrategia (Parte II)' : 'Strategy (Part II)'
            : es ? 'el acta de asamblea (Parte III)' : 'the shareholders\' minutes (Part III)',
        )
        .join(es ? ' y ' : ' and ');
      return {
        ariaLabel: es
          ? `${verb}: ${names} con salvedades`
          : `${verb}: ${names} with qualifications`,
        title:
          (es
            ? `Las cifras de ${names} no coinciden con el balance preprocesado; el informe no es firmable tal como está.`
            : `The figures in ${names} do not match the preprocessed trial balance; this report is not signable as issued.`) +
          firstDetails(block.details),
      };
    }
    case 'qualifications':
      return {
        ariaLabel: es
          ? `${verb}: el informe tiene salvedades de reconciliación`
          : `${verb}: the report has reconciliation qualifications`,
        title: es
          ? 'La reconciliación contra el balance preprocesado no cerró. El informe no es firmable tal como está; revise las salvedades de la portada.'
          : 'Reconciliation against the preprocessed trial balance did not close. This report is not signable as issued; see the qualifications on the cover.',
      };
    case 'not-emittable':
      return {
        ariaLabel: es
          ? `${verb}: el informe no es emitible`
          : `${verb}: the report is not issuable`,
        title:
          (es
            ? 'El gate de emitibilidad del servidor bloqueó el informe.'
            : 'The server issuability gate blocked the report.') + firstDetails(block.details),
      };
    case 'validation-failed':
      return {
        ariaLabel: es
          ? `${verb}: la validación del informe consolidado falló`
          : `${verb}: consolidated report validation failed`,
        title:
          (es
            ? 'La validación post-render del informe consolidado no pasó.'
            : 'Post-render validation of the consolidated report failed.') +
          firstDetails(block.details),
      };
  }
}

/**
 * Aviso (no bloqueo) cuando Estrategia o Gobierno se completaron con esfuerzo
 * de razonamiento degradado tras un primer intento sin salida
 * (`degraded === true`, pipeline-flujo-15). `null` si no aplica.
 */
export function reportExportDegradedNotice(
  report: unknown,
  language: 'es' | 'en',
): string | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as ExportGateShape;
  const es = language === 'es';
  const names: string[] = [];
  if (r.strategicAnalysis?.degraded === true) {
    names.push(es ? 'Estrategia (Parte II)' : 'Strategy (Part II)');
  }
  if (r.governance?.degraded === true) {
    names.push(es ? 'Gobierno Corporativo (Parte III)' : 'Corporate Governance (Part III)');
  }
  if (names.length === 0) return null;
  const list = names.join(es ? ' y ' : ' and ');
  return es
    ? `Aviso: ${list} se completó con esfuerzo de razonamiento reducido tras un primer intento sin salida. Revise esas partes antes de emitir el informe.`
    : `Notice: ${list} completed with reduced reasoning effort after a first attempt produced no output. Review those parts before issuing the report.`;
}
