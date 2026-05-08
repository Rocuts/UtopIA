// ---------------------------------------------------------------------------
// Monte Carlo — motor de simulación determinístico para proyección de flujo
// de caja a 12 meses (estándar Bank of England 2024+, 9.600 iteraciones).
// ---------------------------------------------------------------------------
// Exports públicos:
//   mulberry32(seed)          → PRNG de 32 bits, determinístico
//   normalRandom(rng, m, s)   → variate normal via Box-Muller
//   computeDistribution(arr)  → p10/p50/p90/mean/stdev
//   runMonteCarlo(snapshot)   → MonteCarloResult completo
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';
import type {
  MonteCarloOptions,
  MonteCarloResult,
  MonteCarloDistribution,
} from './types';

// ─── PRNG seedable (Mulberry32) ─────────────────────────────────────────────

/**
 * Implementación estándar de Mulberry32.
 * Devuelve una función que genera números en [0, 1) de forma determinística.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0; // garantiza uint32
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Box-Muller transform ───────────────────────────────────────────────────

/**
 * Genera un variate normal N(mean, sigma) usando Box-Muller sobre el PRNG dado.
 * Consume 2 variates uniformes por llamada.
 */
export function normalRandom(rng: () => number, mean: number, sigma: number): number {
  const u1 = rng();
  const u2 = rng();
  // Evita log(0)
  const safe = u1 === 0 ? Number.EPSILON : u1;
  const z = Math.sqrt(-2 * Math.log(safe)) * Math.cos(2 * Math.PI * u2);
  return mean + sigma * z;
}

// ─── Distribución estadística ────────────────────────────────────────────────

/**
 * Computa p10/p50/p90/mean/stdev de un array de valores.
 * Opera sobre una copia ordenada; el array original no se muta.
 */
export function computeDistribution(values: number[]): MonteCarloDistribution {
  const n = values.length;
  if (n === 0) {
    return { p10: 0, p50: 0, p90: 0, mean: 0, stdev: 0 };
  }

  // Ordenar copia
  const sorted = values.slice().sort((a, b) => a - b);

  // Percentiles por índice (interpolación baja, estilo NumPy 'lower')
  const idx = (p: number): number => Math.floor(p * (n - 1));
  const p10 = sorted[idx(0.1)];
  const p50 = sorted[idx(0.5)];
  const p90 = sorted[idx(0.9)];

  // Media
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;

  // Desviación estándar (población)
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    sumSq += d * d;
  }
  const stdev = Math.sqrt(sumSq / n);

  return { p10, p50, p90, mean, stdev };
}

// ─── Motor principal ─────────────────────────────────────────────────────────

const DEFAULT_ITERATIONS = 9600;
const DEFAULT_HORIZON = 12;
const DEFAULT_SIGMA = 0.15;
const DEFAULT_SEED = 42;

interface SimSample {
  caja: number;
  utilidadAcumulada: number;
  mesQuiebre: number | null;
}

/**
 * Corre N simulaciones de flujo de caja a H meses con varianza normal
 * en los ingresos mensuales.  Reproducible vía seed.
 */
export function runMonteCarlo(
  snapshot: PeriodSnapshot,
  opts?: MonteCarloOptions,
): MonteCarloResult {
  const N = opts?.iterations ?? DEFAULT_ITERATIONS;
  const H = opts?.horizonMonths ?? DEFAULT_HORIZON;
  const sigma = opts?.ingresoSigma ?? DEFAULT_SIGMA;
  const seed = opts?.seed ?? DEFAULT_SEED;

  const { controlTotals, classes } = snapshot;

  // Parámetros base
  const ingresoMesBase = controlTotals.ingresos / 12;
  const egresoMesBase = controlTotals.gastos / 12;
  const cajaInicial = controlTotals.efectivoCuenta11;

  // Inversión PPE (Clase 15) — suma de saldos de las cuentas
  const clase15 = classes.find((c) => c.code === 15);
  let inversionPPE = 0;
  if (clase15 && clase15.accounts.length > 0) {
    for (const acc of clase15.accounts) {
      inversionPPE += acc.balance;
    }
  } else {
    // Fallback: activo no corriente
    inversionPPE = controlTotals.activoNoCorriente;
  }

  // PRNG único para toda la simulación (determinístico)
  const rng = mulberry32(seed);

  // Pre-alocar array de resultados
  const samples: SimSample[] = new Array(N);

  for (let sim = 0; sim < N; sim++) {
    let caja = cajaInicial;
    let utilidadAcumulada = 0;
    let mesQuiebre: number | null = null;

    for (let m = 1; m <= H; m++) {
      const ingresoMes = normalRandom(rng, ingresoMesBase, ingresoMesBase * sigma);
      const delta = ingresoMes - egresoMesBase;
      caja += delta;
      utilidadAcumulada += delta;

      if (caja < 0 && mesQuiebre === null) {
        mesQuiebre = m;
      }
    }

    samples[sim] = { caja, utilidadAcumulada, mesQuiebre };
  }

  // ── Distribuciones ──────────────────────────────────────────────────────
  const cajaFinalValues = new Array<number>(N);
  const utilidadValues = new Array<number>(N);
  const roiValues = new Array<number>(N);
  const quiebreMeses: number[] = [];
  let quiebreCount = 0;

  for (let i = 0; i < N; i++) {
    const s = samples[i];
    cajaFinalValues[i] = s.caja;
    utilidadValues[i] = s.utilidadAcumulada;
    if (inversionPPE > 0) {
      roiValues[i] = s.utilidadAcumulada / inversionPPE;
    }
    if (s.mesQuiebre !== null) {
      quiebreCount++;
      quiebreMeses.push(s.mesQuiebre);
    }
  }

  const probabilidadQuiebre12m = quiebreCount / N;

  // Mes de quiebre mediano (solo si prob >= 50%)
  let mesQuiebreMediano: number | null = null;
  if (probabilidadQuiebre12m >= 0.5 && quiebreMeses.length > 0) {
    quiebreMeses.sort((a, b) => a - b);
    mesQuiebreMediano = quiebreMeses[Math.floor((quiebreMeses.length - 1) * 0.5)];
  }

  const cajaFinal = computeDistribution(cajaFinalValues);
  const utilidadAcumulada = computeDistribution(utilidadValues);
  const roiProbabilistico: MonteCarloDistribution | null =
    inversionPPE > 0 ? computeDistribution(roiValues) : null;

  return {
    iterations: N,
    cajaFinal,
    utilidadAcumulada,
    roiProbabilistico,
    probabilidadQuiebre12m,
    mesQuiebreMediano,
    inversionPPE,
    seed,
    generatedAt: new Date().toISOString(),
  };
}
