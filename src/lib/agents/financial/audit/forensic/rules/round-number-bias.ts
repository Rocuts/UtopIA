// ─── Regla: Sesgo de números redondos ────────────────────────────────────────
//
// Mide la proporción de montos que son múltiplos exactos de $1.000.
//
// Base estadística (auditoria-calidad-25): si los tres últimos dígitos
// enteros fueran uniformes, sólo ~0,1 % de los montos terminaría en 000 (el
// ~10 % corresponde a terminar en un solo 0). En la contabilidad real la
// proporción es mucho mayor —precios de lista, nómina, arriendos y cuotas
// fijas son redondos—, por eso los umbrales NO derivan de esa hipótesis: son
// empíricos y holgados, para señalar sólo un libro dominado por cifras
// redondas (estimaciones o ajustes sin soporte documental).
//
// Severidad (umbrales empíricos):
//   > 30% de montos múltiplos de $1.000 → medium
//   > 50% → high
//
// Monto afectado: sólo los montos redondos, por asiento el mayor de sus
// lados (débito o crédito), en centavos BigInt.

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getJournalLinesForPeriod, type JournalLineAmount } from '../repository';
import { centsToNumeric, numericToCents } from '@/lib/accounting/double-entry/ledger';

const THRESHOLD_MEDIUM = 0.30;
const THRESHOLD_HIGH = 0.50;
/** $1.000 en centavos. */
const THOUSAND_CENTS = BigInt(100_000);
const ZERO = BigInt(0);

function toCents(raw: string | null | undefined): bigint | null {
  try {
    return numericToCents(raw);
  } catch {
    return null;
  }
}

/** Puro: determina si un monto string es múltiplo exacto de $1.000 COP. */
export function isRoundThousand(amount: string): boolean {
  const cents = toCents(amount);
  if (cents === null || cents <= ZERO) return false;
  return cents % THOUSAND_CENTS === ZERO;
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
    const cents = toCents(amt);
    if (cents === null || cents <= ZERO) continue;
    total++;
    if (cents % THOUSAND_CENTS === ZERO) roundCount++;
  }
  return {
    total,
    roundCount,
    percentage: total > 0 ? roundCount / total : 0,
  };
}

/** Puro: asientos con montos redondos y su monto sin doble lado. */
export function roundAmountsByEntry(lines: JournalLineAmount[]): {
  amounts: string[];
  affectedEntryIds: string[];
  affectedCents: bigint;
} {
  const amounts: string[] = [];
  const perEntry = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    for (const side of ['debit', 'credit'] as const) {
      const cents = toCents(line[side]);
      if (cents === null || cents <= ZERO) continue;
      amounts.push(line[side]);
      if (cents % THOUSAND_CENTS !== ZERO) continue;
      const acc = perEntry.get(line.entryId) ?? { debit: ZERO, credit: ZERO };
      acc[side] += cents;
      perEntry.set(line.entryId, acc);
    }
  }
  let affectedCents = ZERO;
  for (const { debit, credit } of perEntry.values()) {
    affectedCents += debit > credit ? debit : credit;
  }
  return { amounts, affectedEntryIds: [...perEntry.keys()], affectedCents };
}

function pctEs(fraction: number): string {
  return `${(fraction * 100).toFixed(1).replace('.', ',')} %`;
}

const roundNumberBiasRule: ForensicRule = {
  kind: 'round_number_bias',

  async run(input: RuleInput): Promise<RuleResult> {
    const lines = await getJournalLinesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    const { amounts, affectedEntryIds, affectedCents } = roundAmountsByEntry(lines);

    if (amounts.length === 0) return { anomalies: [] };

    const { total, roundCount, percentage } = analyzeRoundBias(amounts);

    if (percentage <= THRESHOLD_MEDIUM) return { anomalies: [] };

    const severity = percentage > THRESHOLD_HIGH ? 'high' : 'medium';

    const anomaly: Anomaly = {
      kind: 'round_number_bias',
      severity,
      description:
        `${pctEs(percentage)} de los montos son múltiplos exactos de $1.000 ` +
        `(${roundCount} de ${total}), por encima del umbral empírico de ` +
        `${pctEs(severity === 'high' ? THRESHOLD_HIGH : THRESHOLD_MEDIUM)}. ` +
        `Con últimos dígitos uniformes sólo ~0,1 % lo sería; precios, nómina y ` +
        `arriendos elevan esa cifra en la práctica. ` +
        (severity === 'high'
          ? 'Nivel muy alto — revisar si corresponden a estimaciones o ajustes sin soporte.'
          : 'Revisar si hay asientos basados en estimaciones no respaldadas por documentos.'),
      affectedEntryIds,
      affectedAmountCop: centsToNumeric(affectedCents),
      reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}`,
      evidence: {
        totalAmounts: total,
        roundCount,
        percentage: parseFloat((percentage * 100).toFixed(2)),
        thresholdMedium: THRESHOLD_MEDIUM * 100,
        thresholdHigh: THRESHOLD_HIGH * 100,
        thresholdsBasis: 'empirico',
        uniformExpectationPct: 0.1,
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default roundNumberBiasRule;
