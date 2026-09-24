// ─── Regla Benford's Law ──────────────────────────────────────────────────────
//
// Algoritmo:
//   1. Extrae los montos ≥ $10 (débito y crédito) de las journal_lines. Los
//      montos menores distorsionan la prueba del primer dígito (Nigrini).
//   2. Para cada monto, obtiene el primer dígito significativo (1-9).
//   3. Construye la distribución observada de los 9 dígitos.
//   4. Dos estadísticos complementarios (auditoria-calidad-24):
//        - chi² (8 g.l., α = 0,05 → 15,507): ¿la desviación es significativa?
//          Con N grande tiene exceso de potencia: N = 100.000 con desviaciones
//          inmateriales supera el crítico.
//        - MAD de Nigrini (desviación absoluta media, independiente de N):
//          ¿la desviación es material? Umbrales del primer dígito: ≤ 0,006
//          conformidad cercana, ≤ 0,012 aceptable, ≤ 0,015 marginal,
//          > 0,015 no conformidad. Con N pequeño el MAD tiene mucho ruido
//          muestral; ahí el chi² es el que controla el falso positivo.
//      Se reporta anomalía sólo si AMBOS la sostienen: chi² > 15,507 y
//      MAD > 0,012 → 'low' (marginal); MAD > 0,015 → 'medium'.
//   5. Monto afectado: sólo los montos cuyo primer dígito está
//      significativamente SOBRE-representado (z de Nigrini > 1,96), por
//      asiento el mayor de sus lados (débito o crédito) para no contar dos
//      veces la misma transacción. Centavos BigInt.
//
// Skip: si N < 50 montos.

import type { ForensicRule, RuleInput, RuleResult, Anomaly } from '../types';
import { getJournalLinesForPeriod, type JournalLineAmount } from '../repository';
import { centsToNumeric, numericToCents } from '@/lib/accounting/double-entry/ledger';

// Distribución de Benford esperada para dígitos 1-9
// P(d) = log10(1 + 1/d)
const BENFORD_EXPECTED: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) =>
  Math.log10(1 + 1 / d),
);

const MIN_SAMPLE = 50;
/** Montos menores a $10 (1.000 centavos) no entran a la prueba. */
const MIN_AMOUNT_CENTS = BigInt(1_000);
// Chi-square crítico con 8 grados de libertad, alfa=0.05 → 15.507
const CHI_CRITICAL = 15.507;
/** MAD de Nigrini, primer dígito: por encima → conformidad marginal. */
export const MAD_MARGINAL = 0.012;
/** MAD de Nigrini, primer dígito: por encima → no conformidad. */
export const MAD_NONCONFORMITY = 0.015;
/** z crítico (α = 0,05, dos colas) para señalar un dígito desviado. */
const Z_CRITICAL = 1.96;

const ZERO = BigInt(0);

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

/** MAD de Nigrini: media de |proporción observada − esperada| sobre los 9 dígitos. */
export function meanAbsoluteDeviation(observed: number[], n: number): number {
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Math.abs(observed[i] / n - BENFORD_EXPECTED[i]);
  return sum / 9;
}

/**
 * z de Nigrini por dígito (con corrección de continuidad 1/2N). Positivo si
 * el dígito está sobre-representado, negativo si está sub-representado.
 */
export function digitZScores(observed: number[], n: number): number[] {
  return BENFORD_EXPECTED.map((p, i) => {
    if (n <= 0) return 0;
    const po = observed[i] / n;
    const diff = Math.abs(po - p) - 1 / (2 * n);
    const z = Math.max(diff, 0) / Math.sqrt((p * (1 - p)) / n);
    return po >= p ? z : -z;
  });
}

/** Parsea un NUMERIC a centavos; `null` si no es un número válido. */
function toCents(raw: string | null | undefined): bigint | null {
  try {
    return numericToCents(raw);
  } catch {
    return null;
  }
}

/** Puro: dado un array de montos (strings), retorna resultado Benford. */
export function runBenfordOnAmounts(amounts: string[]): {
  chiSquare: number;
  mad: number;
  n: number;
  digitCounts: number[];
  digitFrequencies: number[];
  benfordExpected: number[];
} {
  const counts = new Array<number>(9).fill(0);
  let n = 0;

  for (const amt of amounts) {
    const cents = toCents(amt);
    if (cents === null || cents <= ZERO) continue;
    const d = firstSignificantDigit(amt);
    if (d === null) continue;
    counts[d - 1]++;
    n++;
  }

  const chi = n > 0 ? chiSquare(counts, n) : 0;
  const frequencies = counts.map((c) => (n > 0 ? c / n : 0));

  return {
    chiSquare: chi,
    mad: meanAbsoluteDeviation(counts, n),
    n,
    digitCounts: counts,
    digitFrequencies: frequencies,
    benfordExpected: BENFORD_EXPECTED,
  };
}

interface BenfordAmount {
  entryId: string;
  side: 'debit' | 'credit';
  raw: string;
  cents: bigint;
  digit: number;
}

/** Montos ≥ $10 de las líneas, un registro por lado con saldo. */
function collectAmounts(lines: JournalLineAmount[]): BenfordAmount[] {
  const out: BenfordAmount[] = [];
  for (const line of lines) {
    for (const side of ['debit', 'credit'] as const) {
      const raw = line[side];
      const cents = toCents(raw);
      if (cents === null || cents < MIN_AMOUNT_CENTS) continue;
      const digit = firstSignificantDigit(raw);
      if (digit === null) continue;
      out.push({ entryId: line.entryId, side, raw, cents, digit });
    }
  }
  return out;
}

export type BenfordEvaluation =
  | { kind: 'insufficient'; n: number }
  | { kind: 'conforming'; n: number; chiSquare: number; mad: number }
  | {
      kind: 'anomaly';
      severity: 'low' | 'medium';
      n: number;
      chiSquare: number;
      mad: number;
      digitCounts: number[];
      digitFrequencies: number[];
      zScores: number[];
      /** Dígitos (1-9) significativamente sobre-representados. */
      deviatedDigits: number[];
      affectedEntryIds: string[];
      /** Centavos de los montos con dígito desviado (sin doble lado). */
      affectedCents: bigint;
    };

/** Puro: evalúa Benford sobre las líneas del periodo (auditoria-calidad-24). */
export function evaluateBenford(lines: JournalLineAmount[]): BenfordEvaluation {
  const amounts = collectAmounts(lines);
  const n = amounts.length;
  if (n < MIN_SAMPLE) return { kind: 'insufficient', n };

  const counts = new Array<number>(9).fill(0);
  for (const a of amounts) counts[a.digit - 1]++;
  const chi = chiSquare(counts, n);
  const mad = meanAbsoluteDeviation(counts, n);

  if (chi <= CHI_CRITICAL || mad <= MAD_MARGINAL) {
    return { kind: 'conforming', n, chiSquare: chi, mad };
  }

  const zScores = digitZScores(counts, n);
  const deviatedDigits = zScores
    .map((z, i) => ({ z, digit: i + 1 }))
    .filter(({ z }) => z > Z_CRITICAL)
    .map(({ digit }) => digit);
  const deviated = new Set(deviatedDigits);

  // Por asiento: el mayor de los lados con dígito desviado (una compra de
  // $5.000.000 aparece en débito y en crédito; es una sola transacción).
  const perEntry = new Map<string, { debit: bigint; credit: bigint }>();
  for (const a of amounts) {
    if (!deviated.has(a.digit)) continue;
    const acc = perEntry.get(a.entryId) ?? { debit: ZERO, credit: ZERO };
    acc[a.side] += a.cents;
    perEntry.set(a.entryId, acc);
  }
  let affectedCents = ZERO;
  for (const { debit, credit } of perEntry.values()) {
    affectedCents += debit > credit ? debit : credit;
  }

  return {
    kind: 'anomaly',
    severity: mad > MAD_NONCONFORMITY ? 'medium' : 'low',
    n,
    chiSquare: chi,
    mad,
    digitCounts: counts,
    digitFrequencies: counts.map((c) => c / n),
    zScores,
    deviatedDigits,
    affectedEntryIds: [...perEntry.keys()],
    affectedCents,
  };
}

const benfordRule: ForensicRule = {
  kind: 'benford_violation',

  async run(input: RuleInput): Promise<RuleResult> {
    const lines = await getJournalLinesForPeriod(
      input.workspaceId,
      input.periodId,
    );

    const result = evaluateBenford(lines);

    if (result.kind === 'insufficient') {
      return {
        anomalies: [],
        warnings: [
          `Benford: datos insuficientes (${result.n} montos ≥ $10, mínimo ${MIN_SAMPLE}). Regla omitida.`,
        ],
      };
    }

    if (result.kind === 'conforming') return { anomalies: [] };

    const digitos =
      result.deviatedDigits.length > 0
        ? `Dígitos iniciales sobre-representados: ${result.deviatedDigits.join(', ')}.`
        : 'Ningún dígito individual está sobre-representado de forma significativa.';

    const anomaly: Anomaly = {
      kind: 'benford_violation',
      severity: result.severity,
      description:
        `Distribución del primer dígito significativo se desvía de la Ley de Benford ` +
        `(MAD=${result.mad.toFixed(4).replace('.', ',')}, ` +
        `chi²=${result.chiSquare.toFixed(2).replace('.', ',')}, n=${result.n}). ${digitos} ` +
        `Puede indicar creación artificial de montos o manipulación de cifras.`,
      affectedEntryIds: result.affectedEntryIds,
      affectedAmountCop: centsToNumeric(result.affectedCents),
      reviewUrl: `/workspace/contabilidad/asientos?period=${input.periodId}`,
      evidence: {
        chiSquare: result.chiSquare,
        mad: parseFloat(result.mad.toFixed(5)),
        n: result.n,
        digitCounts: result.digitCounts,
        digitFrequencies: result.digitFrequencies.map((f) =>
          parseFloat(f.toFixed(4)),
        ),
        benfordExpected: BENFORD_EXPECTED.map((f) => parseFloat(f.toFixed(4))),
        zScores: result.zScores.map((z) => parseFloat(z.toFixed(2))),
        deviatedDigits: result.deviatedDigits,
        threshold: CHI_CRITICAL,
        degreesOfFreedom: 8,
        madThresholds: { marginal: MAD_MARGINAL, nonconformity: MAD_NONCONFORMITY },
      },
    };

    return { anomalies: [anomaly] };
  },
};

export default benfordRule;
