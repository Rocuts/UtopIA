// ---------------------------------------------------------------------------
// Integridad aritmética determinista del informe auditado
// ---------------------------------------------------------------------------
// La opinión del Revisor Fiscal, el Dictamen 1 NIIF y el sello de calidad
// v2.1 dependían sólo del LLM: con la ecuación patrimonial rota, si el modelo
// no emitía hallazgos, el cliente recibía "FAVORABLE (Sin Salvedades)" y
// "CALIDAD CERTIFICADA" (auditoria-calidad-03).
//
// Este módulo deriva el estado de integridad de las señales DETERMINISTAS que
// el pipeline ya produce:
//   - preprocesador: `periods[].summary.equationBalanced`;
//   - reconciliación de anclas / pre-vuelo: `niifAnalysis.reconciliation.clean`,
//     `emittability.kind`, `governance.actaQualifications.clean`,
//     `validation.ok`;
//   - el sello literal "REPORTE CON SALVEDADES" / "ACTA CON SALVEDADES" que
//     el orquestador antepone al contenido cuando alguna de las anteriores falla
//     (es la única señal que sobrevive al esquema de /api/financial-audit).
//
// Semántica "sólo degrada": una señal ausente nunca produce `integra` por sí
// sola; una señal de fallo siempre produce `con_bloqueantes`. Por eso es
// seguro leer banderas enviadas por el cliente: no pueden mejorar la opinión.
// ---------------------------------------------------------------------------

import type { AuditIntegrity } from './types';

const QUALIFICATION_SEAL_RX =
  /^>\s*##\s*(?:REPORTE CON SALVEDADES|REPORT WITH QUALIFICATIONS|ACTA CON SALVEDADES|MINUTES WITH QUALIFICATIONS)/m;

interface LooseReport {
  consolidatedReport?: unknown;
  niifAnalysis?: { fullContent?: unknown; reconciliation?: { clean?: unknown } | null } | null;
  governance?: { fullContent?: unknown; actaQualifications?: { clean?: unknown } | null } | null;
  emittability?: { kind?: unknown } | null;
  validation?: { ok?: unknown } | null;
}

interface LoosePreprocessed {
  periods?: Array<{ period?: unknown; summary?: { equationBalanced?: unknown } | null }> | null;
}

function asObject<T>(v: unknown): T | null {
  return v && typeof v === 'object' ? (v as T) : null;
}

/**
 * Estado de integridad del informe. `extra` permite sumar motivos que el
 * llamador ya conoce (por ejemplo, banderas leídas del cuerpo crudo de la
 * petición antes de que el esquema de validación las descarte).
 */
export function deriveReportIntegrity(
  report: unknown,
  preprocessed?: unknown,
  extra?: AuditIntegrity | null,
): AuditIntegrity {
  const motivos: string[] = [];
  let positiveEvidence = false;

  const r = asObject<LooseReport>(report);
  const pp = asObject<LoosePreprocessed>(preprocessed);

  if (pp && Array.isArray(pp.periods) && pp.periods.length > 0) {
    let allBalanced = true;
    for (const p of pp.periods) {
      const balanced = p?.summary?.equationBalanced;
      if (balanced === false) {
        allBalanced = false;
        motivos.push(
          `Ecuación patrimonial NO CUADRA en el periodo ${typeof p?.period === 'string' ? p.period : '?'} (preprocesador).`,
        );
      } else if (balanced !== true) {
        allBalanced = false;
      }
    }
    if (allBalanced) positiveEvidence = true;
  }

  if (r) {
    const clean = r.niifAnalysis?.reconciliation?.clean;
    if (clean === false) {
      motivos.push('La reconciliación de los estados financieros contra las anclas deterministas no cerró (reporte con salvedades).');
    } else if (clean === true) {
      positiveEvidence = true;
    }
    if (r.emittability?.kind === 'no-emitible') {
      motivos.push('El gate de emisión declaró el informe NO EMITIBLE.');
    }
    if (r.governance?.actaQualifications?.clean === false) {
      motivos.push('Las cifras del acta no coinciden con la aritmética determinista.');
    }
    if (r.validation?.ok === false) {
      motivos.push('La validación aritmética del informe falló.');
    }
    const texts = [r.consolidatedReport, r.niifAnalysis?.fullContent, r.governance?.fullContent];
    if (texts.some((t) => typeof t === 'string' && QUALIFICATION_SEAL_RX.test(t))) {
      motivos.push('El informe lleva el sello determinista "CON SALVEDADES" del pipeline.');
    }
  }

  if (extra) {
    if (extra.status === 'con_bloqueantes') motivos.push(...extra.motivos);
    if (extra.status === 'integra') positiveEvidence = true;
  }

  const unique = Array.from(new Set(motivos));
  if (unique.length > 0) return { status: 'con_bloqueantes', motivos: unique };
  if (positiveEvidence) return { status: 'integra', motivos: [] };
  return { status: 'no_verificada', motivos: [] };
}

/** Línea legible del estado de integridad para los informes Markdown. */
export function describeIntegrity(integrity: AuditIntegrity): string {
  switch (integrity.status) {
    case 'integra':
      return 'Integridad aritmética determinista: VERIFICADA (sin bloqueantes).';
    case 'con_bloqueantes':
      return `Integridad aritmética determinista: CON BLOQUEANTES — ${integrity.motivos.join(' ')}`;
    case 'no_verificada':
      return 'Integridad aritmética determinista: NO VERIFICADA (no se suministraron el preprocesador ni el estado de reconciliación).';
  }
}
