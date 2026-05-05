// ─── Regla: Sesgo de números redondos ────────────────────────────────────────
//
// En contabilidad natural, los montos terminan en .000 (3 ceros) con una
// frecuencia esperada de ~10% (distribución uniforme de los últimos dígitos).
// Un % elevado de montos redondos puede indicar creación artificial (fraude,
// estimaciones no respaldadas, ajustes de conveniencia).
//
// Severidad:
//   > 30% de montos terminados en .000 → medium
//   > 50% → high

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getJournalLinesForPeriod } from '../repository';

const THRESHOLD_MEDIUM = 0.30;
const THRESHOLD_HIGH = 0.50;

/** Puro: determina si un monto string termina en ,000 (tres ceros en COP). */
export function isRoundThousand(amount: string): boolean {
  const val = parseFloat(amount);
  if (!isFinite(val) || val <= 0) return false;
  // Un monto COP redondo en miles: val % 1000 === 0
  return Math.abs(val % 1_000) < 0.01;
}

/** Puro: analiza un array de amounts strings y retorna estadísticas. */
export function analyzeRoundBias(amounts: string[]): {
  total: number;
  roundCount: number;
  percentage: number;
} {
  let total = 0;
  let roundCount = 0;
  for (const amt of amounts) {
    const val = parseFloat(amt);
    if (!isFinite(val) || val <= 0) continue;
    total++;
    if (isRoundThousand(amt)) roundCount++;
  }
  return {
    total,
    roundCount,
    percentage: total > 0 ? roundCount / total : 0,
  };
}

const roundNumberBiasRule: ForensicRule = {
  kind: 'round_number_bias',

  async run(input: RuleInput): Promise<RuleResult> {
    const lines = await getJournalLinesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    const amounts: string[] = [];
    const entryIds = new Set<string>();
    let totalAmountCop = 0;

    for (const line of lines) {
      const d = parseFloat(line.debit ?? '0');
      const c = parseFloat(line.credit ?? '0');
      if (d > 0) {
        amounts.push(line.debit);
        entryIds.add(line.entryId);
        totalAmountCop += d;
      }
      if (c > 0) {
        amounts.push(line.credit);
        entryIds.add(line.entryId);
        totalAmountCop += c;
      }
    }

    if (amounts.length === 0) return { anomalies: [] };

    const { total, roundCount, percentage } = analyzeRoundBias(amounts);

    if (percentage <= THRESHOLD_MEDIUM) return { anomalies: [] };

    const severity = percentage > THRESHOLD_HIGH ? 'high' : 'medium';

    const anomaly: Anomaly = {
      kind: 'round_number_bias',
      severity,
      description:
        `${(percentage * 100).toFixed(1)}% de los montos terminan en múltiplos de $1.000 ` +
        `(${roundCount} de ${total}). ` +
        `Lo esperado en contabilidad natural es ~10%. ` +
        (severity === 'high'
          ? 'Nivel muy alto — revisar si corresponden a estimaciones o ajustes sin soporte.'
          : 'Revisar si hay asientos basados en estimaciones no respaldadas por documentos.'),
      affectedEntryIds: [...entryIds],
      affectedAmountCop: totalAmountCop.toFixed(2),
      reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}`,
      evidence: {
        totalAmounts: total,
        roundCount,
        percentage: parseFloat((percentage * 100).toFixed(2)),
        thresholdMedium: THRESHOLD_MEDIUM * 100,
        thresholdHigh: THRESHOLD_HIGH * 100,
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default roundNumberBiasRule;
