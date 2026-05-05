// ─── Regla: Montos repetidos ──────────────────────────────────────────────────
//
// Detecta el mismo monto exacto repetido muchas veces en el período.
// Un monto que aparece ≥5 veces en 7 días o ≥8 veces en el período total
// es sospechoso (puede indicar pagos fraccionados / smurf / errores de batch).
//
// Excepciones: montos redondos comunes (salarios, arriendos) se omiten.
// Umbral mínimo: monto > 100.000 COP.

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getJournalLinesForPeriod } from '../repository';

const MIN_AMOUNT_COP = 100_000;
const MIN_WEEKLY_REPEATS = 5;
const MIN_PERIOD_REPEATS = 8;

// Montos redondos típicos (COP) que se excluyen del análisis.
// Arriendos, salarios, cuotas fijas.
const COMMON_ROUND_AMOUNTS = new Set([
  50_000, 100_000, 200_000, 300_000, 400_000, 500_000,
  750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000,
  4_000_000, 5_000_000, 8_000_000, 10_000_000, 15_000_000,
  20_000_000, 25_000_000, 30_000_000, 50_000_000,
]);

interface AmountOccurrence {
  entryId: string;
  amount: number;
  date: Date;
  thirdPartyId: string | null;
}

/** Puro: dado un array de ocurrencias, retorna las anomalías de montos repetidos. */
export function detectRepeatedAmounts(
  occurrences: AmountOccurrence[],
  options: {
    minAmountCop?: number;
    minWeeklyRepeats?: number;
    minPeriodRepeats?: number;
    commonRoundAmounts?: Set<number>;
    periodId?: string;
  } = {},
): Anomaly[] {
  const {
    minAmountCop = MIN_AMOUNT_COP,
    minWeeklyRepeats = MIN_WEEKLY_REPEATS,
    minPeriodRepeats = MIN_PERIOD_REPEATS,
    commonRoundAmounts = COMMON_ROUND_AMOUNTS,
    periodId = '',
  } = options;

  // Agrupar por monto exacto (como integer centavos para evitar float issues).
  const byAmount = new Map<number, AmountOccurrence[]>();
  for (const occ of occurrences) {
    if (occ.amount < minAmountCop) continue;
    if (commonRoundAmounts.has(occ.amount)) continue;
    const existing = byAmount.get(occ.amount) ?? [];
    existing.push(occ);
    byAmount.set(occ.amount, existing);
  }

  const anomalies: Anomaly[] = [];

  for (const [amount, occs] of byAmount) {
    const totalCount = occs.length;
    if (totalCount < minPeriodRepeats) {
      // Verificar si se repite minWeeklyRepeats en alguna ventana de 7 días.
      const sorted = [...occs].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );
      let triggered = false;
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = sorted[i].date.getTime() + 7 * 24 * 60 * 60 * 1000;
        const inWindow = sorted.filter(
          (o) => o.date.getTime() >= sorted[i].date.getTime() && o.date.getTime() <= windowEnd,
        );
        if (inWindow.length >= minWeeklyRepeats) {
          triggered = true;
          break;
        }
      }
      if (!triggered) continue;
    }

    const dates = occs.map((o) => o.date);
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    const distinctThirdParties = [
      ...new Set(occs.map((o) => o.thirdPartyId).filter((id) => id !== null)),
    ];
    const entryIds = [...new Set(occs.map((o) => o.entryId))];

    anomalies.push({
      kind: 'repeated_amount',
      severity: 'medium',
      description:
        `Monto $${amount.toLocaleString('es-CO')} COP repetido ${totalCount} veces ` +
        `(ventana: ${minDate.toISOString().slice(0, 10)} a ${maxDate.toISOString().slice(0, 10)}). ` +
        `Puede indicar fraccionamiento de pagos o errores de proceso batch.`,
      affectedEntryIds: entryIds,
      affectedAmountCop: (amount * totalCount).toFixed(2),
      reviewUrl: `/workspace/contabilidad/asientos?period=${periodId}&ids=${entryIds.join(',')}`,
      evidence: {
        amount,
        count: totalCount,
        dateRangeStart: minDate.toISOString(),
        dateRangeEnd: maxDate.toISOString(),
        distinctThirdPartyIds: distinctThirdParties,
      },
    });
  }

  return anomalies;
}

const repeatedAmountsRule: ForensicRule = {
  kind: 'repeated_amount',

  async run(input: RuleInput): Promise<RuleResult> {
    const lines = await getJournalLinesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    // Necesitamos la fecha de cada entry. Las lines no la llevan, pero
    // el repository getPostedEntriesForPeriod la tiene. Hacemos join local.
    const { getPostedEntriesForPeriod } = await import('../repository');
    const entries = await getPostedEntriesForPeriod(
      input.workspaceId,
      input.periodId,
    );
    const entryDateMap = new Map<string, Date>(
      entries.map((e) => [e.id, new Date(e.entryDate)]),
    );

    const occurrences: AmountOccurrence[] = [];

    for (const line of lines) {
      const d = parseFloat(line.debit ?? '0');
      const c = parseFloat(line.credit ?? '0');
      const date = entryDateMap.get(line.entryId);
      if (!date) continue;

      if (d > 0) {
        occurrences.push({
          entryId: line.entryId,
          amount: Math.round(d * 100) / 100,
          date,
          thirdPartyId: line.thirdPartyId,
        });
      }
      if (c > 0) {
        occurrences.push({
          entryId: line.entryId,
          amount: Math.round(c * 100) / 100,
          date,
          thirdPartyId: line.thirdPartyId,
        });
      }
    }

    const anomalies = detectRepeatedAmounts(occurrences, {
      periodId: input.periodId,
    });

    return { anomalies };
  },
};

export default repeatedAmountsRule;
