import { z } from 'zod';

// ---------------------------------------------------------------------------
// Contrato único del ledger del Doctor de Datos en las rutas financieras
// ---------------------------------------------------------------------------
// /niif, /consolidate, /export y la ruta legacy declaraban cada una su copia
// del esquema, y ninguna incluía `period`: Zod quita las claves no declaradas,
// así que un ajuste anclado al comparativo (`propose_adjustment({ period })`,
// `Adjustment.period`) llegaba a `applyAdjustments` sin periodo y se aplicaba
// al primario. Un solo esquema evita que las rutas vuelvan a divergir;
// `readAppliedAdjustments` (/html) aplica el mismo contrato a mano.
//
// No viaja al LLM (entrada del usuario confirmada en el repair chat): el
// contrato strict-mode no aplica.
// ---------------------------------------------------------------------------

/** Periodo del snapshot al que apunta el ajuste (`PeriodSnapshot.period`). */
export const adjustmentPeriodSchema = z.string().trim().min(1).max(20);

export const adjustmentSchema = z.object({
  id: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(10),
  accountName: z.string().min(1).max(200),
  amount: z.number().refine((n) => Number.isFinite(n), 'amount debe ser finito'),
  rationale: z.string().min(1).max(2_000),
  status: z.enum(['proposed', 'applied', 'rejected']),
  proposedAt: z.string().min(1).max(40),
  appliedAt: z.string().min(1).max(40).optional(),
  rejectedAt: z.string().min(1).max(40).optional(),
  /**
   * Multiperiodo: sin periodo el ajuste va al primario (contrato de
   * `applyAdjustments`). Uno que no existe en el balance se rechaza en las
   * rutas (`unknownAdjustmentPeriodReasons`): el aplicador lo ignoraría con
   * sólo un aviso en el log.
   */
  period: adjustmentPeriodSchema.optional(),
});

export const adjustmentLedgerSchema = z
  .object({ adjustments: z.array(adjustmentSchema).max(50) })
  .optional();

/**
 * Motivos de rechazo de los ajustes CONFIRMADOS cuyo `period` no existe en el
 * balance. `applyAdjustments` los descarta con un `console.warn`, así que el
 * informe saldría sin el ajuste que el usuario confirmó y con cifras distintas
 * de las que aprobó. Stage 0.4 (`prepareFinancialContext`), la re-derivación
 * del preprocesado del cliente y /export los convierten en 422. Vacío si todos
 * los periodos existen (o el ajuste no trae periodo: va al primario).
 */
export function unknownAdjustmentPeriodReasons(
  balance: { periods: ReadonlyArray<{ period: string }> },
  adjustments: ReadonlyArray<{ id: string; accountCode: string; status: string; period?: string | null }>,
): string[] {
  const known = balance.periods.map((p) => p.period);
  const out: string[] = [];
  for (const a of adjustments) {
    if (a.status !== 'applied' || a.period === undefined || a.period === null) continue;
    if (known.includes(a.period)) continue;
    out.push(
      `Ajuste confirmado ${a.id} (cuenta ${a.accountCode}): apunta al periodo "${a.period}", que no existe ` +
        `en el balance (periodos: ${known.join(', ') || 'ninguno'}). No se aplica ni se descarta en silencio: ` +
        'corrija el periodo del ajuste y vuelva a generar el informe.',
    );
  }
  return out;
}
