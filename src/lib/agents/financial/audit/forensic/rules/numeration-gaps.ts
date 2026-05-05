// ─── Regla: Gaps en numeración de asientos ───────────────────────────────────
//
// Detecta saltos en la secuencia correlativa de entry_number para los asientos
// posteados del período. Un gap puede indicar eliminación de asientos o
// numeración no correlativa (irregularidad según CTCP).
//
// Severidad:
//   - gap de 1 número → low
//   - gap de 3+ números → medium

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getPostedEntriesForPeriod } from '../repository';

export interface GapInfo {
  from: number;
  to: number;
  size: number;
}

/** Puro: dado array de números ordenados, retorna los gaps. */
export function detectGaps(numbers: number[]): GapInfo[] {
  if (numbers.length < 2) return [];
  const gaps: GapInfo[] = [];
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1];
    const curr = numbers[i];
    if (curr - prev > 1) {
      gaps.push({ from: prev + 1, to: curr - 1, size: curr - prev - 1 });
    }
  }
  return gaps;
}

const numerationGapsRule: ForensicRule = {
  kind: 'numeration_gap',

  async run(input: RuleInput): Promise<RuleResult> {
    const entries = await getPostedEntriesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    if (entries.length < 2) {
      return { anomalies: [], warnings: [] };
    }

    const numbers = entries.map((e) => e.entryNumber).sort((a, b) => a - b);
    const gaps = detectGaps(numbers);

    if (gaps.length === 0) return { anomalies: [] };

    const anomalies: Anomaly[] = gaps.map((gap) => {
      const severity = gap.size >= 3 ? 'medium' : 'low';
      return {
        kind: 'numeration_gap' as const,
        severity,
        description:
          `Gap en numeración correlativa: falta${gap.size > 1 ? 'n' : ''} ` +
          `${gap.size} asiento${gap.size > 1 ? 's' : ''} ` +
          `(#${gap.from}${gap.size > 1 ? `-${gap.to}` : ''}). ` +
          `Puede indicar eliminación de asientos posteados.`,
        affectedEntryIds: [],
        affectedAmountCop: '0',
        reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}`,
        evidence: {
          gapFrom: gap.from,
          gapTo: gap.to,
          gapSize: gap.size,
          totalEntriesFound: entries.length,
          firstEntryNumber: numbers[0],
          lastEntryNumber: numbers[numbers.length - 1],
        },
      };
    });

    return { anomalies };
  },
};

export default numerationGapsRule;
