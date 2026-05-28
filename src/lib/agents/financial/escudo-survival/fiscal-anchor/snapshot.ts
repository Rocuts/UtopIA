// ---------------------------------------------------------------------------
// FiscalSnapshot builder — auto-cableado NIIF → El Escudo (Capa 5)
// ---------------------------------------------------------------------------
// Ensambla el `FiscalSnapshot` determinístico (anchor F01-F10 + Score de
// Riesgo DIAN) reutilizando `buildFiscalAnchor` + `computeRiskScore`. Cero LLM,
// cero red. Si algo falla devuelve `undefined` para que la fase NIIF continúe.
// Ver docs/wave-notes/escudo-autowire-contract.md §4.1.
// ---------------------------------------------------------------------------

import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { CompanyContext } from '../types';
import type { FiscalSnapshot } from '../../types';
import { buildFiscalAnchor } from './index';
import { computeRiskScore } from '../fiscal-agent/tools/risk-score-calculator';

export interface BuildFiscalSnapshotInput {
  preprocessed: PreprocessedBalance;
  company: CompanyContext;
  /** Fecha de cálculo. El orchestrator pasa `new Date()`. */
  hoy: Date;
  /** NIT extraído del archivo (`ExtractedCompanyMetadata.nitFromFile`). */
  nitFromFile?: string | null;
}

/**
 * Compone el `FiscalSnapshot`. Determinístico — nunca lanza: ante cualquier
 * fallo del cálculo devuelve `undefined` (el caller marca el snapshot ausente y
 * el pipeline NIIF no aborta).
 */
export function buildFiscalSnapshot(
  input: BuildFiscalSnapshotInput,
): FiscalSnapshot | undefined {
  try {
    const anchor = buildFiscalAnchor({
      preprocessed: input.preprocessed,
      company: input.company,
      hoy: input.hoy,
      nitFromFile: input.nitFromFile,
    });

    // `RiskScorePrecomputedData` es estructuralmente asignable a
    // `FiscalRiskScore` (contrato §2). Asignación directa.
    const riskScore = computeRiskScore({
      anchor,
      preprocessed: input.preprocessed,
    });

    return {
      anchor,
      riskScore,
      period: anchor.fuente.periodo,
      computedAt: input.hoy.toISOString(),
    };
  } catch (err) {
    console.warn(
      '[fiscal-snapshot] cálculo determinístico falló, snapshot omitido:',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}
