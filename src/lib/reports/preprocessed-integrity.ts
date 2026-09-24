import type { Adjustment } from '@/lib/agents/repair/types';
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
import { preprocessTrialBalance, type PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { preprocessedAnchorMismatches } from '@/lib/preprocessing/json-safe';
import { adjustmentPeriodSchema } from './adjustment-ledger';

// ---------------------------------------------------------------------------
// Re-derivación del preprocesado que envía el cliente (niif-preproceso-33)
// ---------------------------------------------------------------------------
// `revivePreprocessedBalance` sólo valida la forma y revive los BigInt: unos
// totales de control alterados (centavos coherentes entre sí) pasaban como
// anclas vinculantes. Cuando la petición no trae `rawData` legible, la única
// fuente contra la que recalcularlos son las filas crudas que el propio
// preprocesado transporta (`rawRows`, las mismas que produjo el parser). Aquí
// se re-ejecuta `preprocessTrialBalance` sobre ellas —con los periodos de
// saldos de apertura declarados y los ajustes confirmados del Doctor de Datos,
// igual que Stage 0/0.4 de /niif— y:
//   - si los totales de control difieren al centavo, se rechaza (el caller
//     responde 422);
//   - si coinciden, el caller usa el RE-DERIVADO (no el objeto del cliente),
//     de modo que clases, cuentas y resúmenes también salen de las filas.
//
// Límite: las filas también las envía el cliente. Esto detecta un preprocesado
// incoherente con sus propias filas, no demuestra que las filas sean las de la
// empresa; eso lo da la versión persistida (`reportRef`, src/lib/reports).
// ---------------------------------------------------------------------------

export type RederivedPreprocessed =
  | { ok: true; preprocessed: PreprocessedBalance }
  | { ok: false; details: string[] };

export const REDERIVE_MISMATCH_HEADLINE =
  'Fuentes incoherentes — el balance preprocesado enviado no corresponde a sus propias filas ' +
  're-derivadas por el servidor (con los ajustes confirmados).';

/** Re-deriva el preprocesado desde sus `rawRows` (+ ajustes confirmados) y lo cruza. */
export function rederivePreprocessedFromRows(
  claimed: PreprocessedBalance,
  adjustments: readonly Adjustment[] = [],
): RederivedPreprocessed {
  let derived: PreprocessedBalance;
  try {
    const openingPeriods = claimed.periods
      .filter((p) => p.saldosDeApertura === true)
      .map((p) => p.period);
    derived = preprocessTrialBalance(claimed.rawRows, {
      openingPeriods,
      defaultPeriod: claimed.primary?.period,
    });
    const applied = adjustments.filter((a) => a.status === 'applied');
    if (applied.length > 0) derived = applyAdjustments(derived, applied).balance;
  } catch (err) {
    console.warn(
      '[reports/preprocessed-integrity] no se pudo re-derivar el preprocesado:',
      err instanceof Error ? err.message : 'unknown',
    );
    return {
      ok: false,
      details: [
        REDERIVE_MISMATCH_HEADLINE,
        'Las filas crudas (rawRows) del balance preprocesado no se pudieron volver a procesar.',
      ],
    };
  }
  const mismatches = preprocessedAnchorMismatches(claimed, derived);
  if (mismatches.length > 0) return { ok: false, details: [REDERIVE_MISMATCH_HEADLINE, ...mismatches] };
  return { ok: true, preprocessed: derived };
}

/**
 * Ajustes confirmados de un `adjustmentLedger` recibido en el cuerpo. `null`
 * si el ledger viene con forma inválida (el caller responde 400); `[]` si no
 * llegó. Sólo interesan los `applied`: son los que /niif aplicó al balance.
 *
 * Mismo contrato que el esquema de /niif, /consolidate y /export
 * (`src/lib/reports/adjustment-ledger.ts`): `period` se conserva, de modo que
 * la re-derivación aplica cada ajuste al MISMO snapshot que /niif (un ajuste
 * del comparativo no se aplica al primario).
 */
export function readAppliedAdjustments(ledger: unknown): Adjustment[] | null {
  if (ledger === undefined || ledger === null) return [];
  if (typeof ledger !== 'object' || Array.isArray(ledger)) return null;
  const list = (ledger as { adjustments?: unknown }).adjustments;
  if (!Array.isArray(list) || list.length > 50) return null;
  const out: Adjustment[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const a = item as Record<string, unknown>;
    if (
      typeof a.id !== 'string' ||
      typeof a.accountCode !== 'string' ||
      typeof a.accountName !== 'string' ||
      typeof a.amount !== 'number' ||
      !Number.isFinite(a.amount) ||
      (a.status !== 'proposed' && a.status !== 'applied' && a.status !== 'rejected')
    ) {
      return null;
    }
    const period = a.period === undefined || a.period === null ? undefined : adjustmentPeriodSchema.safeParse(a.period);
    if (period && !period.success) return null;
    if (a.status !== 'applied') continue;
    out.push({
      id: a.id,
      accountCode: a.accountCode,
      accountName: a.accountName,
      amount: a.amount,
      rationale: typeof a.rationale === 'string' ? a.rationale : '',
      status: 'applied',
      proposedAt: typeof a.proposedAt === 'string' ? a.proposedAt : '',
      ...(period?.success ? { period: period.data } : {}),
    });
  }
  return out;
}
