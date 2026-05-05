// ─── Regla Benford's Law ──────────────────────────────────────────────────────
//
// Algoritmo:
//   1. Extrae todos los montos > 0 (debit y credit) de las journal_lines.
//   2. Para cada monto, obtiene el primer dígito significativo (1-9).
//   3. Construye distribución observada de los 9 dígitos.
//   4. Calcula chi-cuadrado contra distribución esperada de Benford.
//   5. Umbral: chi > 15.51 (p<0.05, 8 grados de libertad) → medium/high.
//
// Skip: si N < 50 líneas con monto > 0.

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getJournalLinesForPeriod } from '../repository';

// Distribución de Benford esperada para dígitos 1-9
// P(d) = log10(1 + 1/d)
const BENFORD_EXPECTED: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) =>
  Math.log10(1 + 1 / d),
);

const MIN_SAMPLE = 50;
// Chi-square crítico con 8 grados de libertad, alfa=0.05 → 15.507
const CHI_CRITICAL_MEDIUM = 11.0;
const CHI_CRITICAL_HIGH = 15.507;

/** Extrae el primer dígito significativo (1-9) de un monto string. */
export function firstSignificantDigit(amount: string): number | null {
  for (const ch of amount) {
    if (ch >= '1' && ch <= '9') return parseInt(ch, 10);
  }
  return null;
}

/** Calcula chi-cuadrado dado observed counts (índices 0-8 = dígitos 1-9) y N total. */
export function chiSquare(observed: number[], n: number): number {
  let chi = 0;
  for (let i = 0; i < 9; i++) {
    const expected = BENFORD_EXPECTED[i] * n;
    if (expected < 1e-9) continue; // evitar división por cero
    const diff = observed[i] - expected;
    chi += (diff * diff) / expected;
  }
  return chi;
}

/** Puro: dado un array de montos (strings), retorna resultado Benford. */
export function runBenfordOnAmounts(amounts: string[]): {
  chiSquare: number;
  n: number;
  digitCounts: number[];
  digitFrequencies: number[];
  benfordExpected: number[];
} {
  const counts = new Array<number>(9).fill(0);
  let n = 0;

  for (const amt of amounts) {
    const val = parseFloat(amt);
    if (!isFinite(val) || val <= 0) continue;
    const d = firstSignificantDigit(amt);
    if (d === null) continue;
    counts[d - 1]++;
    n++;
  }

  const chi = n > 0 ? chiSquare(counts, n) : 0;
  const frequencies = counts.map((c) => (n > 0 ? c / n : 0));

  return {
    chiSquare: chi,
    n,
    digitCounts: counts,
    digitFrequencies: frequencies,
    benfordExpected: BENFORD_EXPECTED,
  };
}

const benfordRule: ForensicRule = {
  kind: 'benford_violation',

  async run(input: RuleInput): Promise<RuleResult> {
    const lines = await getJournalLinesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    // Recopilar montos positivos (debit o credit)
    const amounts: string[] = [];
    const entryIds = new Set<string>();
    let totalAmount = 0;

    for (const line of lines) {
      const d = parseFloat(line.debit ?? '0');
      const c = parseFloat(line.credit ?? '0');
      if (d > 0) {
        amounts.push(line.debit);
        entryIds.add(line.entryId);
        totalAmount += d;
      }
      if (c > 0) {
        amounts.push(line.credit);
        entryIds.add(line.entryId);
        totalAmount += c;
      }
    }

    if (amounts.length < MIN_SAMPLE) {
      return {
        anomalies: [],
        warnings: [
          `Benford: datos insuficientes (${amounts.length} montos > 0, mínimo ${MIN_SAMPLE}). Regla omitida.`,
        ],
      };
    }

    const result = runBenfordOnAmounts(amounts);

    if (result.chiSquare <= CHI_CRITICAL_MEDIUM) {
      return { anomalies: [] };
    }

    const severity =
      result.chiSquare > CHI_CRITICAL_HIGH ? 'medium' : 'low';

    const anomaly: Anomaly = {
      kind: 'benford_violation',
      severity,
      description:
        `Distribución del primer dígito significativo se desvía de la Ley de Benford ` +
        `(chi²=${result.chiSquare.toFixed(2)}, n=${result.n}). ` +
        `Puede indicar creación artificial de montos o manipulación de cifras.`,
      affectedEntryIds: [...entryIds],
      affectedAmountCop: totalAmount.toFixed(2),
      reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}`,
      evidence: {
        chiSquare: result.chiSquare,
        n: result.n,
        digitCounts: result.digitCounts,
        digitFrequencies: result.digitFrequencies.map((f) =>
          parseFloat(f.toFixed(4)),
        ),
        benfordExpected: result.benfordExpected.map((f) =>
          parseFloat(f.toFixed(4)),
        ),
        threshold: CHI_CRITICAL_HIGH,
        degreesOfFreedom: 8,
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default benfordRule;
