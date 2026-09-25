import type {
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';

/**
 * Pliega las salvedades de la Parte II (`strategyQualifications`,
 * pipeline-flujo-05) y del acta (`actaQualifications`) sobre la reconciliación
 * del NIIF: es el canal que apaga los botones de descarga (`downloadsBlocked`
 * lee `niifAnalysis.reconciliation.clean`) y el que ve el gate de /export.
 *
 * Vive fuera del componente para que el servidor (`/consolidate`, al persistir
 * la versión del informe) aplique exactamente la misma regla que la UI.
 */
export function foldReportQualifications(
  niifResult: NiifAnalysisResult,
  strategyResult: StrategicAnalysisResult,
  governanceResult: GovernanceResult,
): NiifAnalysisResult {
  const strategyQualified =
    (strategyResult as { strategyQualifications?: { clean?: unknown } | null })
      .strategyQualifications?.clean === false;
  const actaQualified = governanceResult.actaQualifications?.clean === false;
  if (!strategyQualified && !actaQualified) return niifResult;
  return {
    ...niifResult,
    reconciliation: {
      deviations: niifResult.reconciliation?.deviations ?? [],
      lineGaps: niifResult.reconciliation?.lineGaps ?? [],
      repairAttempted: niifResult.reconciliation?.repairAttempted ?? false,
      clean: false,
    },
  };
}
