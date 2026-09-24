/**
 * Puente servicio macro → bloque <macro_vigente> de Valoración y Factibilidad.
 *
 * valoracion-04/18 (IW4): el servicio ya expone procedencia POR CAMPO
 * ({ value | null, source, asOf = vigencia, fetchedAt, stale }) sin rellenar
 * con constantes. Aquí se traduce a `MacroSnapshot` (valuation/macro-context):
 *   - IPC anual (DANE)                 → inflationCopYoYPercent (decimal × 100)
 *   - Tasa de política (BanRep)        → policyRatePercent      (decimal × 100)
 *   - TRM (Superfinanciera)            → trmCopPerUsd
 * Un campo sin valor, vigencia o fuente queda `null` (el bloque lo publica
 * N/D). Un último valor bueno (`stale`) conserva su vigencia original y lo
 * declara en la fuente. TES 10Y, EMBI, ERP, UST, IBR… no los provee el
 * servicio: quedan N/D y el agente debe declarar cualquier supuesto.
 *
 * `getMacroSnapshotForPrompts` nunca lanza ni bloquea el pipeline: ante error
 * o demora devuelve `null` (todo N/D).
 */

import type { MacroDatum, MacroSnapshot } from '@/lib/agents/financial/valuation/macro-context';
import type { MacroFactors, MacroIndicator, MacroSource } from '@/lib/pillars/types';

import { getMacroFactors } from './service';

const SOURCE_LABEL: Record<MacroSource, string> = {
  dane: 'DANE — IPC, variación anual',
  banrep: 'Banco de la República — tasa de política monetaria',
  superfinanciera: 'Superintendencia Financiera de Colombia — TRM',
};

/** Espera máxima por el servicio antes de seguir con el bloque en N/D. */
const DEFAULT_TIMEOUT_MS = 12_000;

function toDatum(ind: MacroIndicator | null | undefined, scale: number): MacroDatum | null {
  if (!ind || ind.value === null || !Number.isFinite(ind.value)) return null;
  if (!ind.source || !ind.asOf || ind.asOf.trim().length === 0) return null;
  const staleNote = ind.stale
    ? ` (último dato verificado${ind.fetchedAt ? `, consultado ${ind.fetchedAt.slice(0, 10)}` : ''}; la consulta más reciente falló)`
    : '';
  return {
    value: Math.round(ind.value * scale * 10_000) / 10_000,
    asOf: ind.asOf,
    source: `${SOURCE_LABEL[ind.source]}${staleNote}`,
  };
}

/** Traduce los factores con procedencia por campo al snapshot de los prompts. */
export function macroFactorsToSnapshot(factors: MacroFactors | null | undefined): MacroSnapshot | null {
  if (!factors) return null;
  return {
    inflationCopYoYPercent: toDatum(factors.ipc, 100),
    policyRatePercent: toDatum(factors.tasaBanRep, 100),
    trmCopPerUsd: toDatum(factors.trm, 1),
  };
}

/**
 * Snapshot macro para Valoración / Factibilidad. `null` (todo N/D) si el
 * servicio falla o tarda más de `timeoutMs`.
 */
export async function getMacroSnapshotForPrompts(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<MacroSnapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const factors = await Promise.race([getMacroFactors(), timeout]);
    return macroFactorsToSnapshot(factors);
  } catch (err) {
    console.warn('[macro/prompt-snapshot] Servicio macro no disponible:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
