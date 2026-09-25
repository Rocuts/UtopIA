// ─── WS4 — Amortización lineal de diferidos con prorateo por días ─────────────
//
// Algoritmo por ACUMULADO ESPERADO (auditoría contab-nomina-15):
//   total_days     = días entre amortization_start y amortization_end (inclusive)
//   elapsed_days   = días desde amortization_start hasta min(fin del período, end)
//   expected       = total_amount × elapsed_days / total_days   (BigInt-centavos)
//                    = total_amount si el período llega a amortization_end
//   this_period    = expected − amortized_amount   (≥ 0)
//
// Antes cada período amortizaba sólo su propia fracción y, pasada la fecha
// final, el diferido quedaba `period_out_of_range`: el residuo de redondeo y
// cualquier mes no corrido quedaban para siempre en el activo. Con el
// acumulado esperado, un mes omitido se recupera en el siguiente y el período
// que contiene (o sigue a) amortization_end lleva el saldo a cero exacto.
//
// Casos de meses parciales (inicio o fin del diferido):
//   - Inicio: si amortization_start cae dentro del período, se cuenta desde ese día.
//   - Fin:    si amortization_end cae dentro del período, se cuenta hasta ese día.
//
// El prorateo por días es más exacto que el prorateo por meses para diferidos
// que no empiezan el 1ro del mes (ej. seguro pagado el 15 de marzo).
//
// Referencia normativa: NIC 1 §58 (activos corrientes — gastos anticipados);
// NIC 38 §97 (método de amortización — refleja el patrón de consumo).

import type { AccountingPeriodRow, DeferredAssetRow } from '@/lib/db/schema';
import type { CreateEntryInput } from '@/lib/accounting/types';
import type { AmortizationLine, AmortizationPreview } from '../types';

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------

const SCALE = BigInt(100);
const ZERO = BigInt(0);

function toCentavos(raw: string): bigint {
  const trimmed = (raw ?? '0').trim() || '0';
  const dot = trimmed.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dot < 0) {
    intPart = trimmed;
    fracPart = '';
  } else {
    intPart = trimmed.slice(0, dot) || '0';
    fracPart = trimmed.slice(dot + 1);
  }
  fracPart = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart) * SCALE + BigInt(fracPart);
}

function fromCentavos(c: bigint): string {
  const abs = c < ZERO ? -c : c;
  return `${c < ZERO ? '-' : ''}${abs / SCALE}.${(abs % SCALE).toString().padStart(2, '0')}`;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// Date helpers — truncate to UTC midnight for day counting
// ---------------------------------------------------------------------------

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Dias entre dos fechas (inclusive en ambos extremos). */
function daysBetweenInclusive(a: Date, b: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / msPerDay) + 1;
}

/** Días de intersección entre [aStart, aEnd] y [bStart, bEnd]. 0 si no se solapan. */
function daysOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  const start = new Date(Math.max(utcDay(aStart).getTime(), utcDay(bStart).getTime()));
  const end = new Date(Math.min(utcDay(aEnd).getTime(), utcDay(bEnd).getTime()));
  if (start > end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// comparePeriods helper
// ---------------------------------------------------------------------------

function comparePeriods(
  a: { year: number; month: number },
  b: { year: number; month: number },
): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

// ---------------------------------------------------------------------------
// calculateAmortization — puro, sin escrituras a DB
// ---------------------------------------------------------------------------

export interface AmortizationCalcInput {
  workspaceId: string;
  period: AccountingPeriodRow;
  entryDate: Date;
  deferredAssets: (DeferredAssetRow & {
    lastAmortizedPeriod?: { year: number; month: number } | null;
  })[];
}

export function calculateAmortization(
  input: AmortizationCalcInput,
): AmortizationPreview {
  const { period, entryDate, deferredAssets } = input;
  const lines: AmortizationLine[] = [];
  const skipped: AmortizationPreview['skipped'] = [];
  const entryLines: CreateEntryInput['lines'] = [];

  for (const asset of deferredAssets) {
    // ── Skip conditions ──────────────────────────────────────────────────────

    if (period.month === 13) {
      skipped.push({ deferredAssetId: asset.id, reason: 'closing_period' });
      continue;
    }

    if (!asset.active) {
      skipped.push({ deferredAssetId: asset.id, reason: 'inactive' });
      continue;
    }

    const totalAmount = toCentavos(asset.totalAmount);
    const amortized = toCentavos(asset.amortizedAmount ?? '0');

    if (amortized >= totalAmount) {
      skipped.push({ deferredAssetId: asset.id, reason: 'fully_amortized' });
      continue;
    }

    // Skip if already processed this period.
    if (asset.lastAmortizedPeriod) {
      const cmp = comparePeriods(
        { year: period.year, month: period.month },
        asset.lastAmortizedPeriod,
      );
      if (cmp <= 0) {
        skipped.push({
          deferredAssetId: asset.id,
          reason: 'already_amortized_this_period',
        });
        continue;
      }
    }

    const amortStart = new Date(asset.amortizationStart);
    const amortEnd = new Date(asset.amortizationEnd);
    const periodStart = new Date(period.startsAt);
    const periodEnd = new Date(period.endsAt);

    // Aún no empieza: nada que amortizar en este período.
    if (utcDay(periodEnd).getTime() < utcDay(amortStart).getTime()) {
      skipped.push({
        deferredAssetId: asset.id,
        reason: 'period_out_of_range',
      });
      continue;
    }

    // ── Prorated calculation (acumulado esperado) ────────────────────────────

    const totalDays = daysBetweenInclusive(amortStart, amortEnd);
    if (totalDays <= 0) {
      skipped.push({ deferredAssetId: asset.id, reason: 'invalid_date_range' });
      continue;
    }

    const daysInPeriod = daysOverlap(amortStart, amortEnd, periodStart, periodEnd);
    const reachedEnd = utcDay(periodEnd).getTime() >= utcDay(amortEnd).getTime();
    const elapsedDays = daysOverlap(amortStart, amortEnd, amortStart, periodEnd);
    const expected = reachedEnd
      ? totalAmount
      : (totalAmount * BigInt(elapsedDays)) / BigInt(totalDays);
    const remaining = totalAmount - amortized;
    const thisPeriod = minBigInt(expected - amortized, remaining);

    if (thisPeriod <= ZERO) {
      skipped.push({ deferredAssetId: asset.id, reason: 'zero_amount' });
      continue;
    }

    const newAmortized = amortized + thisPeriod;
    const remainingAfter = totalAmount - newAmortized;
    const fraction = daysInPeriod / totalDays; // float — solo para el campo informativo

    lines.push({
      deferredAssetId: asset.id,
      description: asset.description,
      monthlyAmountCop: fromCentavos(thisPeriod),
      newAmortizedCop: fromCentavos(newAmortized),
      remainingCop: fromCentavos(remainingAfter),
      proratedFraction: Math.round(fraction * 10000) / 10000, // 4 decimales
    });

    const amtStr = fromCentavos(thisPeriod);
    entryLines.push({
      accountId: asset.expenseAccountId,
      debit: amtStr,
      credit: '0.00',
      description: `Amortización: ${asset.description}`,
    });
    entryLines.push({
      accountId: asset.assetAccountId,
      debit: '0.00',
      credit: amtStr,
      description: `Amortización diferido: ${asset.description}`,
    });
  }

  const totalCentavos = lines.reduce(
    (s, l) => s + toCentavos(l.monthlyAmountCop),
    ZERO,
  );

  const proposedEntry: CreateEntryInput | null =
    lines.length === 0
      ? null
      : {
          workspaceId: input.workspaceId,
          periodId: period.id,
          entryDate,
          description: `Amortización diferidos período ${period.year}-${String(period.month).padStart(2, '0')}`,
          sourceType: 'adjustment',
          // Llave de idempotencia por período (createEntry idempotentBySource).
          sourceRef: `period:${period.id}:amortization`,
          status: 'draft',
          lines: entryLines,
          metadata: {
            generator: 'auto_amortization',
            periodId: period.id,
            lineDetails: lines,
          },
        };

  return {
    lines,
    totalAmountCop: fromCentavos(totalCentavos),
    proposedEntry,
    skipped,
  };
}
