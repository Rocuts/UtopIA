// ─── WS4 — Posteo de ajustes automáticos (servicio único) ────────────────────
//
// Auditoría contab-nomina-05: el cierre mensual posteaba depreciación y
// amortización sin actualizar el activo (accumulated / last_period quedaban
// en 0/null y se depreciaba para siempre) y ni ellas ni las provisiones eran
// idempotentes (un reintento o un POST previo al API duplicaba asientos). Las
// rutas /api/accounting/adjustments/* y el paso run-adjustments del cierre
// usan ahora ESTE servicio:
//
//   - El asiento y la actualización del estado del activo/diferido ocurren en
//     la MISMA transacción serializable (createEntry inTransaction).
//   - La actualización es optimista: sólo aplica si el acumulado sigue siendo
//     el que usó el cálculo; si otra corrida se adelantó, se revierte todo.
//   - Idempotencia por origen (sourceType + sourceRef del período): si ya hay
//     un asiento vivo para ese ajuste/período, no se crea otro.

import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { createEntry } from '@/lib/accounting/double-entry/service';
import { DoubleEntryError, ERR } from '@/lib/accounting/types';
import { deferredAssets, fixedAssets } from '@/lib/db/schema';

import {
  ADJ_ERR,
  AdjustmentsError,
  type AmortizationPreview,
  type DepreciationPreview,
  type ProvisionsPreview,
} from './types';

export interface PostedAdjustment {
  /** Asiento creado, o el existente si ya estaba posteado. */
  entryId: string | null;
  entryNumber: number | null;
  /** true si el ajuste del período ya existía (no se creó otro). */
  alreadyPosted: boolean;
}

const NOTHING: PostedAdjustment = { entryId: null, entryNumber: null, alreadyPosted: false };

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toCents(raw: string): bigint {
  const t = (raw ?? '0').trim() || '0';
  const neg = t.startsWith('-');
  const abs = neg ? t.slice(1) : t;
  const [i, f = ''] = abs.split('.');
  const c = BigInt(i || '0') * SCALE + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
}

function fromCents(c: bigint): string {
  const neg = c < ZERO;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / SCALE}.${(a % SCALE).toString().padStart(2, '0')}`;
}

function existingFromDuplicate(err: unknown): PostedAdjustment | null {
  if (err instanceof DoubleEntryError && err.code === ERR.DUPLICATE_SOURCE) {
    const id = (err.details as { existingEntryId?: string } | undefined)?.existingEntryId ?? null;
    return { entryId: id, entryNumber: null, alreadyPosted: true };
  }
  return null;
}

/** Postea la depreciación del período y actualiza cada activo en la misma TX. */
export async function postDepreciation(
  preview: DepreciationPreview,
  periodId: string,
  postedBy?: string | null,
): Promise<PostedAdjustment> {
  if (!preview.proposedEntry || preview.lines.length === 0) return NOTHING;
  try {
    const { entry } = await createEntry(
      { ...preview.proposedEntry, status: 'posted', createdBy: postedBy ?? null },
      {
        idempotentBySource: true,
        inTransaction: async (tx) => {
          for (const l of preview.lines) {
            const before = fromCents(toCents(l.newAccumulatedCop) - toCents(l.monthlyAmountCop));
            const updated = await tx
              .update(fixedAssets)
              .set({
                accumulatedDepreciation: l.newAccumulatedCop,
                lastDepreciatedPeriodId: periodId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(fixedAssets.id, l.fixedAssetId),
                  sql`${fixedAssets.accumulatedDepreciation} = ${before}::numeric`,
                ),
              )
              .returning({ id: fixedAssets.id });
            if (updated.length !== 1) {
              throw new AdjustmentsError(
                ADJ_ERR.ALREADY_APPLIED,
                `El activo ${l.fixedAssetCode} cambió durante el cálculo (otra corrida lo depreció); se revierte el asiento.`,
              );
            }
          }
        },
      },
    );
    return { entryId: entry.id, entryNumber: entry.entryNumber, alreadyPosted: false };
  } catch (err) {
    const dup = existingFromDuplicate(err);
    if (dup) return dup;
    throw err;
  }
}

/** Postea la amortización del período y actualiza cada diferido en la misma TX. */
export async function postAmortization(
  preview: AmortizationPreview,
  periodId: string,
  postedBy?: string | null,
): Promise<PostedAdjustment> {
  if (!preview.proposedEntry || preview.lines.length === 0) return NOTHING;
  try {
    const { entry } = await createEntry(
      { ...preview.proposedEntry, status: 'posted', createdBy: postedBy ?? null },
      {
        idempotentBySource: true,
        inTransaction: async (tx) => {
          for (const l of preview.lines) {
            const before = fromCents(toCents(l.newAmortizedCop) - toCents(l.monthlyAmountCop));
            const updated = await tx
              .update(deferredAssets)
              .set({
                amortizedAmount: l.newAmortizedCop,
                lastAmortizedPeriodId: periodId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(deferredAssets.id, l.deferredAssetId),
                  sql`${deferredAssets.amortizedAmount} = ${before}::numeric`,
                ),
              )
              .returning({ id: deferredAssets.id });
            if (updated.length !== 1) {
              throw new AdjustmentsError(
                ADJ_ERR.ALREADY_APPLIED,
                `El diferido "${l.description}" cambió durante el cálculo (otra corrida lo amortizó); se revierte el asiento.`,
              );
            }
          }
        },
      },
    );
    return { entryId: entry.id, entryNumber: entry.entryNumber, alreadyPosted: false };
  } catch (err) {
    const dup = existingFromDuplicate(err);
    if (dup) return dup;
    throw err;
  }
}

export interface PostedProvisions {
  postedEntryIds: string[];
  /** Tipos cuya provisión del período ya estaba posteada. */
  alreadyPosted: string[];
  /** Provisiones que no pudieron postearse (p. ej. cuenta mal configurada). */
  errors: Array<{ provisionType: string; message: string }>;
}

/** Postea cada provisión (un asiento por tipo), idempotente por período y tipo. */
export async function postProvisions(
  preview: ProvisionsPreview,
  postedBy?: string | null,
): Promise<PostedProvisions> {
  const out: PostedProvisions = { postedEntryIds: [], alreadyPosted: [], errors: [] };
  for (const proposed of preview.proposedEntries) {
    const type = String(
      (proposed.metadata as { provisionType?: unknown } | null)?.provisionType ?? proposed.sourceRef,
    );
    try {
      const { entry } = await createEntry(
        { ...proposed, status: 'posted', createdBy: postedBy ?? null },
        { idempotentBySource: true },
      );
      out.postedEntryIds.push(entry.id);
    } catch (err) {
      if (existingFromDuplicate(err)) {
        out.alreadyPosted.push(type);
        continue;
      }
      out.errors.push({ provisionType: type, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
