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
   * `applyAdjustments`); con uno que no existe en el balance, el aplicador lo
   * ignora con un aviso en el log.
   */
  period: adjustmentPeriodSchema.optional(),
});

export const adjustmentLedgerSchema = z
  .object({ adjustments: z.array(adjustmentSchema).max(50) })
  .optional();
