// ---------------------------------------------------------------------------
// Consolidación y gates post-render del camino partido (pipeline-flujo-16).
// ---------------------------------------------------------------------------
// La UI corre el pipeline por endpoints separados (/niif, /strategy,
// /governance) y ensamblaba el consolidado en el navegador SIN los gates que
// el orchestrator legacy aplica al final (`validateConsolidatedReport` y
// `auditReportEmittable` completo, con los checks de texto V8/V9/V10/V15).
// Ese legacy no tiene llamador en la UI, así que esos gates no corrían para
// ningún usuario. Este módulo los aplica en servidor sobre el consolidado que
// arma `/api/financial-report/consolidate` y devuelve `validation` y
// `emittability` para que el cliente los pliegue en el gate de descarga
// (y `financialExportBlockers` los vea en /export).
// ---------------------------------------------------------------------------

import {
  validateConsolidatedReport,
  type ControlTotalsInput,
} from './validators/report-validator';
import {
  auditReportEmittable,
  type AuditCompanyContext,
} from '@/lib/pillars/audit-report-emittable';
import {
  extractCompanyMetadata,
  type ExtractedCompanyMetadata,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { buildConsolidatedReportMarkdown } from './consolidated-markdown';
import { normalizeTipoSocietario as normalizeTipoSocietarioActa } from './prompts/governance-specialist.prompt';
import type {
  CompanyInfo,
  FinancialReport,
  ReportEmittabilityState,
  ReportValidationResult,
} from './types';
import type { ProvisionalFlag } from '@/lib/agents/repair/types';

/** Código del bloqueante cuando no hubo balance preprocesado que verificar. */
export const NO_VERIFIED_BALANCE_BLOCKER = 'SIN_BALANCE_VERIFICADO';

export interface SplitConsolidationInput {
  company: CompanyInfo;
  /** Preprocesado re-derivado en servidor (ya con ajustes aplicados). */
  preprocessed: PreprocessedBalance | undefined;
  /** rawData efectivo (sin informe antepuesto), para metadata del archivo. */
  rawData: string;
  niifContent: string;
  strategyContent: string;
  governanceContent: string;
  language: 'es' | 'en';
  now?: Date;
  /**
   * Override del Doctor de Datos ("Continuar de todas formas" →
   * `mark_provisional`). Con `active`, el consolidado se entrega como
   * BORRADOR con la razón declarada y los errores de la validación
   * post-render (pipeline-flujo-21): el PDF lo estampa y nadie lo lee como
   * definitivo. No levanta ningún gate: `validation` y `emittability` son
   * los mismos que sin override.
   */
  provisional?: ProvisionalFlag | null;
}

export interface SplitConsolidationResult {
  consolidatedReport: string;
  validation: ReportValidationResult;
  emittability: ReportEmittabilityState;
}

/**
 * Tipo societario para el gate `auditReportEmittable`. SAS / S.A. / Ltda. se
 * normalizan con la MISMA función que usa el acta (`normalizeTipoSocietario`
 * del prompt de Gobierno: tolera "S. A. S.", "Sociedad por Acciones
 * Simplificada", "Limitada"), para que gate y acta no lean tipos distintos
 * (prompts-normativa-08). Se conservan aquí la E.U. y el vacío → `undefined`
 * (tri-estado del gate: no se asume SAS). Fuente única para el consolidado
 * partido y el orquestador legacy.
 */
export function normalizeTipoSocietarioParaGate(
  raw: string | null | undefined,
): AuditCompanyContext['tipoSocietario'] {
  if (!raw || !raw.trim()) return undefined;
  const compact = raw.toUpperCase().replace(/[.\s]/g, '');
  if (compact === 'EU' || compact === 'EMPRESAUNIPERSONAL') return 'EU';
  return normalizeTipoSocietarioActa(raw);
}

function estatutosFlag(company: CompanyInfo): boolean | undefined {
  const c = company as unknown as { estatutosRequierenReservaLegal?: unknown };
  return typeof c.estatutosRequierenReservaLegal === 'boolean'
    ? c.estatutosRequierenReservaLegal
    : undefined;
}

/**
 * Encabezado BORRADOR del override del Doctor de Datos (pipeline-flujo-21).
 * Mismo texto que el orquestador legacy (`buildProvisionalWatermark`): el
 * composer del PDF lo reconoce ("BORRADOR — VALIDACION PENDIENTE") y estampa
 * la marca de agua.
 */
export function buildProvisionalDraftBanner(
  reason: string,
  errors: string[],
  language: 'es' | 'en',
): string {
  const safeReason =
    (reason || '').trim() || (language === 'en' ? '(no reason provided)' : '(razon no declarada)');
  const errLines =
    errors.length > 0
      ? errors.map((e) => `> - ${e}`).join('\n')
      : language === 'en'
        ? '> - (post-render validation reported no errors)'
        : '> - (la validacion post-render no reporto errores)';
  if (language === 'en') {
    return [
      '> ⚠️ **DRAFT — VALIDATION PENDING**',
      '> This report was generated with a user override. Automatic validation detected:',
      errLines,
      `> User-stated reason: "${safeReason}"`,
      '> Must NOT be signed by the statutory auditor in this state.',
    ].join('\n');
  }
  return [
    '> ⚠️ **BORRADOR — VALIDACION PENDIENTE**',
    '> Este reporte fue generado con override del usuario. La validacion automatica detecto:',
    errLines,
    `> Razon declarada: "${safeReason}"`,
    '> NO debe firmarse por revisor fiscal en este estado.',
  ].join('\n');
}

/** Antepone el encabezado BORRADOR cuando el override está activo. */
function withProvisionalBanner(
  result: SplitConsolidationResult,
  provisional: ProvisionalFlag | null | undefined,
  language: 'es' | 'en',
): SplitConsolidationResult {
  if (!provisional?.active) return result;
  return {
    ...result,
    consolidatedReport:
      buildProvisionalDraftBanner(provisional.reason, result.validation.errors, language) +
      '\n\n' +
      result.consolidatedReport,
  };
}

export function consolidateSplitReport(input: SplitConsolidationInput): SplitConsolidationResult {
  return withProvisionalBanner(consolidateUnmarked(input), input.provisional, input.language);
}

function consolidateUnmarked(input: SplitConsolidationInput): SplitConsolidationResult {
  const { company, preprocessed, language } = input;

  const consolidatedReport = buildConsolidatedReportMarkdown(
    company,
    input.niifContent,
    input.strategyContent,
    input.governanceContent,
    language,
    input.now,
  );

  const primary = preprocessed?.primary ?? null;
  const comparative = preprocessed?.comparative ?? null;
  const controlTotals: ControlTotalsInput | undefined = primary?.controlTotals;
  const validation = validateConsolidatedReport(consolidatedReport, controlTotals, {
    comparativeTotals: comparative?.controlTotals,
    primaryPeriod: primary?.period,
    comparativePeriod: comparative?.period,
  });

  if (!primary || !preprocessed) {
    // Sin balance preprocesado no hay totales vinculantes contra los cuales
    // verificar las cifras: el informe no se ofrece como emitible.
    return {
      consolidatedReport,
      validation,
      emittability: {
        kind: 'no-emitible',
        blockers: [
          {
            code: NO_VERIFIED_BALANCE_BLOCKER,
            message:
              language === 'en'
                ? 'No preprocessed trial balance: the figures could not be verified against binding totals.'
                : 'Sin balance de prueba preprocesado: las cifras no se pudieron verificar contra totales vinculantes.',
          },
        ],
        suggestedAdjustments: [],
      },
    };
  }

  // El upload puede inyectar la metadata del archivo en el preprocesado; si
  // no, se extrae del rawData (determinista), igual que el orchestrator legacy.
  const injectedMeta = (preprocessed as unknown as {
    extractedCompanyMetadata?: ExtractedCompanyMetadata;
  }).extractedCompanyMetadata;
  const extractedMeta: ExtractedCompanyMetadata | null =
    injectedMeta ?? extractCompanyMetadata(input.rawData ?? '');
  const result = auditReportEmittable(
    { consolidatedReport } as unknown as FinancialReport,
    primary,
    {
      razonSocialFromFile: extractedMeta?.razonSocialFromFile ?? null,
      nitFromFile: extractedMeta?.nitFromFile ?? null,
      nit: company.nit ?? null,
      niifGroup: company.niifGroup ?? 2,
      tipoSocietario: normalizeTipoSocietarioParaGate(company.entityType),
      estatutosRequierenReservaLegal: estatutosFlag(company),
    },
    {
      comparativos_impracticables: preprocessed.comparativos_impracticables,
      actividadInferida: preprocessed.actividadInferida,
      reclasificacionesNoCompensacion: preprocessed.reclasificacionesNoCompensacion,
    },
    // V3 sobre el EFE DETERMINISTA de los dos cortes, igual que el orquestador
    // legacy (recalculo-11). Sin comparativo V3 no aplica (NIC 7 ¶1).
    { comparativeSnapshot: comparative },
  );

  return {
    consolidatedReport,
    validation,
    emittability: {
      kind: result.emittable ? 'emittable' : 'no-emitible',
      blockers: result.blockers.map((b) => ({ code: b.code, message: b.message, detail: b.detail })),
      suggestedAdjustments: result.suggestedAdjustments,
    },
  };
}
