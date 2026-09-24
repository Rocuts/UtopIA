import { NextResponse } from 'next/server';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import type { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';
import { readAppliedAdjustments, rederivePreprocessedFromRows } from './preprocessed-integrity';

// ---------------------------------------------------------------------------
// `preprocessed` recibido en el cuerpo de una ruta de análisis (cross-dep P1)
// ---------------------------------------------------------------------------
// /export y /html re-derivan el preprocesado del cliente (niif-preproceso-33),
// pero /strategy, /governance, /api/financial-quality, /api/financial-audit,
// /api/fiscal-audit-opinion, el respaldo de /niif y la ruta legacy lo usaban
// tal cual tras `revivePreprocessedBalance`, que sólo valida la forma: unos
// totales de control alterados con centavos coherentes pasaban como anclas
// vinculantes de la Parte II, del acta, de la auditoría o del dictamen, y esas
// cifras llegaban al cliente. Aquí se aplica el mismo cruce: el balance se
// RE-DERIVA desde sus propias filas (`rawRows`) con los ajustes confirmados
// del Doctor de Datos que acompañan la petición, se rechaza con 422 si los
// totales difieren y, si coinciden, la ruta usa el re-derivado.
//
// Los ajustes: el preprocesado de /niif (el que reenvía la UI a las fases
// siguientes) ya los trae aplicados, así que la petición debe traer el MISMO
// `adjustmentLedger`; el del upload (respaldo de /niif, ruta legacy) llega sin
// ajustes y la ruta los aplica después, por eso esas rutas no pasan ledger.
// ---------------------------------------------------------------------------

export type ClientPreprocessedResult =
  | {
      ok: true;
      preprocessed: PreprocessedBalance | undefined;
      /**
       * Ajustes confirmados aplicados en la re-derivación y su detalle: la
       * traza de ajustes del consolidado que el servidor reconstruye para las
       * Partes IV/V (I5-1). Ausente sin ajustes.
       */
      adjustments?: { applied: Adjustment[]; affected: ReturnType<typeof applyAdjustments>['affected'] };
    }
  | { ok: false; response: Response };

/** Código máquina-legible del 422 (la UI lo muestra con los detalles). */
export const PREPROCESSED_MISMATCH_CODE = 'PREPROCESSED_MISMATCH';

/**
 * Revive y re-deriva el `preprocessed` de una petición. Ausente → `undefined`
 * (la ruta decide qué hacer sin balance). `ledger` es el `adjustmentLedger`
 * crudo del cuerpo, o `null` cuando el preprocesado esperado no lleva ajustes.
 */
export function resolveClientPreprocessed(raw: unknown, ledger: unknown): ClientPreprocessedResult {
  if (raw === undefined || raw === null) return { ok: true, preprocessed: undefined };
  const revived = revivePreprocessedBalance(raw);
  if (!revived) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid preprocessed format.' }, { status: 400 }),
    };
  }
  const adjustments = readAppliedAdjustments(ledger);
  if (!adjustments) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid adjustmentLedger format.' }, { status: 400 }),
    };
  }
  const rederived = rederivePreprocessedFromRows(revived, adjustments);
  if (!rederived.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'El balance preprocesado enviado no corresponde a sus propias filas.',
          code: PREPROCESSED_MISMATCH_CODE,
          details: rederived.details,
        },
        { status: 422 },
      ),
    };
  }
  return {
    ok: true,
    preprocessed: rederived.preprocessed,
    ...(adjustments.length > 0 ? { adjustments: { applied: adjustments, affected: rederived.affected } } : {}),
  };
}
