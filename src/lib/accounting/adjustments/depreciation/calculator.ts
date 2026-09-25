// ─── WS4 — Depreciación lineal (straight-line) MVP ───────────────────────────
//
// Algoritmo:
//   depreciable = acquisition_cost - salvage_value
//   monthly     = depreciable / useful_life_months          (BigInt-centavos)
//   remaining   = depreciable - accumulated_depreciation
//   this_month  = min(monthly, remaining)
//
// Precisión: todos los intermedios en BigInt centavos.
// Salida: NUMERIC string "XXXXXXX.XX" para Postgres.
//
// Métodos NO implementados (auditoría contab-nomina-14): units_of_production
// y accelerated se OMITEN con motivo `method_not_supported` — antes se
// calculaban en línea recta y se etiquetaban 'straight_line' sin aviso. La
// API ya no acepta esos métodos al crear/editar activos.
//
// Inicio de la depreciación (NIC 16 ¶55 / Sección 17.20: cuando el activo
// está disponible para su uso) — política explícita:
//   - acquisition_date posterior al cierre del período → `not_yet_in_use`.
//   - Mes de adquisición: se prorratea por días en uso dentro del período
//     (días desde acquisition_date hasta fin de mes / días del mes). La
//     fracción no depreciada se recupera al final de la vida útil porque el
//     cálculo continúa hasta agotar el valor depreciable.
//   - Meses no corridos entre `last_depreciated_period` y el período actual
//     se recuperan en este período (monthly × meses transcurridos), siempre
//     acotado al valor depreciable pendiente. Un activo que nunca se ha
//     depreciado en el sistema arranca en el período actual: los activos
//     preexistentes deben registrarse con su depreciación acumulada.
//   - El período 13 (ajustes de cierre anual) no genera depreciación.
//
// Referencia: Art. 137 E.T. (vidas útiles para efectos fiscales); NIC 16 para
// NIIF (vida útil estimada por la entidad — puede diferir del fiscal).

import type { AccountingPeriodRow } from '@/lib/db/schema';
import type { FixedAssetRow } from '@/lib/db/schema';
import type { CreateEntryInput } from '@/lib/accounting/types';
import type { DepreciationLine, DepreciationPreview } from '../types';

// ---------------------------------------------------------------------------
// BigInt helpers — mismo patrón que double-entry/validate.ts
// ---------------------------------------------------------------------------

const SCALE = BigInt(100); // centavos
const ZERO = BigInt(0);

/** Parsea string NUMERIC a BigInt centavos. Trunca al 2do decimal. */
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

/** BigInt centavos → NUMERIC string "1234.56". */
function fromCentavos(c: bigint): string {
  const abs = c < ZERO ? -c : c;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  return `${c < ZERO ? '-' : ''}${intPart}.${fracPart.toString().padStart(2, '0')}`;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

// ---------------------------------------------------------------------------
// comparePeriods — retorna negativo/0/positivo igual que compareTo
// ---------------------------------------------------------------------------

function comparePeriods(
  a: { year: number; month: number },
  b: { year: number; month: number },
): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

const MS_PER_DAY = 86_400_000;

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Días en uso del activo dentro del mes de adquisición y días del mes.
 * `null` si la adquisición no cae dentro del período.
 */
function firstMonthFraction(
  acquisitionDate: Date,
  period: { startsAt: Date; endsAt: Date },
): { daysInUse: number; daysInMonth: number } | null {
  const acq = utcDayStart(acquisitionDate);
  const start = utcDayStart(new Date(period.startsAt));
  const end = utcDayStart(new Date(period.endsAt));
  if (acq <= start || acq > end) return null;
  const daysInMonth = Math.round((end - start) / MS_PER_DAY) + 1;
  const daysInUse = Math.round((end - acq) / MS_PER_DAY) + 1;
  return { daysInUse, daysInMonth };
}

// ---------------------------------------------------------------------------
// previewDepreciation — puro, sin escrituras a DB
// ---------------------------------------------------------------------------

export interface DepreciationCalcInput {
  workspaceId: string;
  period: AccountingPeriodRow;
  entryDate: Date;
  assets: (FixedAssetRow & {
    lastDepreciatedPeriod?: { year: number; month: number } | null;
  })[];
}

export function calculateDepreciation(
  input: DepreciationCalcInput,
): DepreciationPreview {
  const { period, entryDate, assets } = input;
  const lines: DepreciationLine[] = [];
  const skipped: DepreciationPreview['skipped'] = [];

  // Aggregate lines into a single entry (2 lines per asset: expense + contra).
  // The individual asset amounts are captured in metadata.lineDetails.
  const entryLines: CreateEntryInput['lines'] = [];

  for (const asset of assets) {
    // ── Skip conditions ──────────────────────────────────────────────────────

    if (period.month === 13) {
      skipped.push({ fixedAssetId: asset.id, reason: 'closing_period' });
      continue;
    }

    if (asset.disposedAt !== null && asset.disposedAt !== undefined) {
      skipped.push({ fixedAssetId: asset.id, reason: 'disposed' });
      continue;
    }

    const method = asset.depreciationMethod ?? 'straight_line';
    if (method !== 'straight_line') {
      skipped.push({ fixedAssetId: asset.id, reason: 'method_not_supported' });
      continue;
    }

    const acquisitionDate = asset.acquisitionDate
      ? new Date(asset.acquisitionDate)
      : null;
    if (
      acquisitionDate &&
      acquisitionDate.getTime() > new Date(period.endsAt).getTime()
    ) {
      skipped.push({ fixedAssetId: asset.id, reason: 'not_yet_in_use' });
      continue;
    }

    const cost = toCentavos(asset.acquisitionCost);
    const salvage = toCentavos(asset.salvageValue ?? '0');
    const depreciable = cost - salvage;

    if (depreciable <= ZERO) {
      skipped.push({ fixedAssetId: asset.id, reason: 'non_depreciable' });
      continue;
    }

    const accumulated = toCentavos(asset.accumulatedDepreciation ?? '0');

    if (accumulated >= depreciable) {
      skipped.push({ fixedAssetId: asset.id, reason: 'fully_depreciated' });
      continue;
    }

    // Skip if this period has already been processed for this asset.
    // Meses a cargar: 1, o los transcurridos desde la última depreciación.
    let monthsToCharge = 1;
    if (asset.lastDepreciatedPeriod) {
      const cmp = comparePeriods(
        { year: period.year, month: period.month },
        asset.lastDepreciatedPeriod,
      );
      if (cmp <= 0) {
        skipped.push({
          fixedAssetId: asset.id,
          reason: 'already_depreciated_this_period',
        });
        continue;
      }
      monthsToCharge = cmp;
    }

    // ── Straight-line calculation ────────────────────────────────────────────
    // Units-of-production: diferido — requiere unidades producidas.
    // Accelerated:         diferido — requiere tabla de % anuales.

    const usefulLifeMonths = BigInt(asset.usefulLifeMonths);
    // Integer division. Example: 300_000_000 / 36 = 8_333_333 remainder 12.
    const monthlyBase = depreciable / usefulLifeMonths;
    // The BigInt remainder (depreciable % usefulLifeMonths) is added to the FIRST
    // depreciation month so the total over the full life is exact (= depreciable).
    // This is the standard "front-load remainder" policy used by most ERP systems.
    // Subsequent months use monthlyBase only.
    const remainder = accumulated === ZERO ? depreciable % usefulLifeMonths : ZERO;
    const remaining = depreciable - accumulated;
    let charge = monthlyBase * BigInt(monthsToCharge) + remainder;
    // Mes de adquisición: prorrateo por días en uso (sólo si el activo nunca
    // se ha depreciado; la fracción restante se recupera al final de la vida).
    const partial =
      accumulated === ZERO && !asset.lastDepreciatedPeriod && acquisitionDate
        ? firstMonthFraction(acquisitionDate, period)
        : null;
    if (partial) {
      charge =
        (charge * BigInt(partial.daysInUse)) / BigInt(partial.daysInMonth);
    }
    const thisMonth = minBigInt(charge, remaining);

    if (thisMonth <= ZERO) {
      skipped.push({ fixedAssetId: asset.id, reason: 'zero_amount' });
      continue;
    }

    const newAccumulated = accumulated + thisMonth;
    const bookValueAfter = cost - newAccumulated;

    lines.push({
      fixedAssetId: asset.id,
      fixedAssetCode: asset.code,
      monthlyAmountCop: fromCentavos(thisMonth),
      newAccumulatedCop: fromCentavos(newAccumulated),
      bookValueAfterCop: fromCentavos(bookValueAfter),
      method: 'straight_line',
    });

    const amtStr = fromCentavos(thisMonth);
    entryLines.push({
      accountId: asset.expenseAccountId,
      debit: amtStr,
      credit: '0.00',
      description: `Depreciación ${asset.name} (${asset.code})`,
    });
    entryLines.push({
      accountId: asset.depreciationAccountId,
      debit: '0.00',
      credit: amtStr,
      description: `Depreciación acumulada ${asset.name} (${asset.code})`,
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
          description: `Depreciación período ${period.year}-${String(period.month).padStart(2, '0')}`,
          sourceType: 'depreciation',
          sourceRef: `period:${period.id}`,
          status: 'draft',
          lines: entryLines,
          metadata: {
            generator: 'auto_depreciation',
            periodId: period.id,
            lineDetails: lines.map((l) => ({
              fixedAssetId: l.fixedAssetId,
              fixedAssetCode: l.fixedAssetCode,
              monthlyAmountCop: l.monthlyAmountCop,
              newAccumulatedCop: l.newAccumulatedCop,
              bookValueAfterCop: l.bookValueAfterCop,
              method: l.method,
            })),
          },
        };

  return {
    lines,
    totalAmountCop: fromCentavos(totalCentavos),
    proposedEntry,
    skipped,
  };
}
