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
import type {
  CompanyInfo,
  FinancialReport,
  ReportEmittabilityState,
  ReportValidationResult,
} from './types';

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
}

export interface SplitConsolidationResult {
  consolidatedReport: string;
  validation: ReportValidationResult;
  emittability: ReportEmittabilityState;
}

function normalizeTipoSocietario(raw: string | undefined): AuditCompanyContext['tipoSocietario'] {
  if (!raw) return undefined;
  const upper = raw.toUpperCase().trim().replace(/\.$/, '');
  if (upper === 'SAS' || upper === 'S.A.S') return 'SAS';
  if (upper === 'SA' || upper === 'S.A') return 'SA';
  if (upper === 'LTDA') return 'LTDA';
  if (upper === 'EU' || upper === 'E.U') return 'EU';
  return 'OTRO';
}

function estatutosFlag(company: CompanyInfo): boolean | undefined {
  const c = company as unknown as { estatutosRequierenReservaLegal?: unknown };
  return typeof c.estatutosRequierenReservaLegal === 'boolean'
    ? c.estatutosRequierenReservaLegal
    : undefined;
}

export function consolidateSplitReport(input: SplitConsolidationInput): SplitConsolidationResult {
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
      tipoSocietario: normalizeTipoSocietario(company.entityType),
      estatutosRequierenReservaLegal: estatutosFlag(company),
    },
    {
      comparativos_impracticables: preprocessed.comparativos_impracticables,
      actividadInferida: preprocessed.actividadInferida,
      reclasificacionesNoCompensacion: preprocessed.reclasificacionesNoCompensacion,
    },
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
