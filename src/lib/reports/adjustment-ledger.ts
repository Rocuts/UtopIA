import { z } from 'zod';
import type { Adjustment } from '@/lib/agents/repair/types';
import type { AdjustmentApplicationAffected } from '@/lib/agents/repair/adjustments';
import { formatCopFromPesos } from '@/lib/agents/financial/contracts/money';

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

// ---------------------------------------------------------------------------
// Traza de ajustes aplicados (procedencia-R2-02)
// ---------------------------------------------------------------------------

/**
 * Ajustes confirmados que el servidor aplicó al balance y su detalle por
 * cuenta (saldo previo y nuevo, periodo). La versión persistida la guarda y
 * los artefactos la divulgan: consolidado (traza), anexo del PDF y del HTML, y
 * el sello de procedencia.
 */
export interface AdjustmentsTrail {
  applied: Adjustment[];
  affected: AdjustmentApplicationAffected[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Traza leída de una versión persistida: `null` si no hay ajustes, `undefined`
 * si la forma es inválida (la versión no se usa: su integridad ya la ata la
 * huella del sobre, así que una forma inválida es un defecto del almacenamiento).
 */
export function readAdjustmentsTrail(value: unknown): AdjustmentsTrail | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as { applied?: unknown; affected?: unknown };
  if (!Array.isArray(v.applied) || !Array.isArray(v.affected)) return undefined;
  for (const a of v.applied) {
    const r = a as Record<string, unknown> | null;
    if (!r || typeof r.id !== 'string' || typeof r.accountCode !== 'string' || !isFiniteNumber(r.amount)) return undefined;
  }
  for (const a of v.affected) {
    const r = a as Record<string, unknown> | null;
    if (
      !r ||
      typeof r.adjustmentId !== 'string' ||
      typeof r.accountCode !== 'string' ||
      !isFiniteNumber(r.oldBalance) ||
      !isFiniteNumber(r.newBalance)
    ) {
      return undefined;
    }
  }
  return v.applied.length === 0 ? null : (v as AdjustmentsTrail);
}

/** Renglón legible de un ajuste aplicado (anexo del PDF y del HTML). */
export interface AdjustmentTrailRow {
  id: string;
  accountCode: string;
  accountName: string;
  period: string | null;
  /** Saldo previo, monto y saldo nuevo ya formateados en COP; N/D sin detalle. */
  previous: string;
  amount: string;
  amountPesos: number;
  next: string;
  isNewAccount: boolean;
  rationale: string;
}

/**
 * Renglones del anexo de ajustes con la MISMA información que la traza del
 * consolidado (`buildAdjustmentsAuditSection`): id, cuenta, saldo previo, monto,
 * saldo nuevo, cuenta nueva y razón.
 */
export function adjustmentTrailRows(trail: AdjustmentsTrail | null | undefined): AdjustmentTrailRow[] {
  if (!trail) return [];
  const byId = new Map(trail.affected.map((a) => [a.adjustmentId, a]));
  return trail.applied
    .filter((a) => a.status === 'applied')
    .map((a) => {
      const affected = byId.get(a.id);
      return {
        id: a.id,
        accountCode: a.accountCode,
        accountName: a.accountName || affected?.accountName || '',
        period: affected?.period ?? a.period ?? null,
        previous: affected ? formatCopFromPesos(affected.oldBalance) : 'N/D',
        amount: formatCopFromPesos(a.amount),
        amountPesos: a.amount,
        next: affected ? formatCopFromPesos(affected.newBalance) : 'N/D',
        isNewAccount: affected?.isNewAccount === true,
        rationale: (a.rationale || '').replace(/\s+/g, ' ').slice(0, 200),
      };
    });
}

/** Número de ajustes confirmados aplicados de la traza. */
export function appliedAdjustmentsCount(trail: AdjustmentsTrail | null | undefined): number {
  return trail ? trail.applied.filter((a) => a.status === 'applied').length : 0;
}
