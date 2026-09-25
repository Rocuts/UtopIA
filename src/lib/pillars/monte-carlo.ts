// ---------------------------------------------------------------------------
// Monte Carlo — ESCENARIO SIMULADO de flujo de caja a 12 meses.
// ---------------------------------------------------------------------------
// Supuestos (se exponen en `MonteCarloResult.supuestos` y la UI los muestra —
// auditoría valoracion-22):
//   - Sólo varían los ingresos mensuales: normal i.i.d. con σ = 15 % del
//     ingreso mensual base (σ anual relativo ≈ 15 % / √12). Por defecto 9.600
//     iteraciones y semilla 42 (reproducible).
//   - Egresos = egresos contables del periodo repartidos por mes, fijos; no se
//     modelan impuestos, capital de trabajo ni estacionalidad.
//   - Base mensual = ingresos NETOS (4175) y egresos del periodo divididos por
//     los meses cubiertos del snapshot (shared-metrics.monthsCovered: la regla
//     del preprocesador para 'AAAA-MM', 'AAAA-Qn' y rangos). El contrato
//     público exige un resultado; el Centro de Mando debe omitir la
//     simulación cuando `mesesCubiertos(snapshot) === null` (NM-01).
//   - "ROI" = utilidad simulada a 12 meses / PPE neto (cuentas 15xx de la
//     clase 1, netas de 1592/1597-1599). Sin PPE ⇒ N/D (ratios-kpis-21: antes
//     buscaba una "clase 15" inexistente y caía al activo no corriente).
//   - El histograma se construye con los ROI SIMULADOS (no con una PDF normal).
// Exports públicos:
//   mulberry32(seed)          → PRNG de 32 bits, determinístico
//   normalRandom(rng, m, s)   → variate normal via Box-Muller
//   computeDistribution(arr)  → p10/p50/p90/mean/stdev
//   buildHistogram(arr, n)    → bins empíricos
//   runMonteCarlo(snapshot)   → MonteCarloResult completo
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

import { isVirtualCuratorAccount } from './ebitda';
import { ingresosNetosPeriodo, monthsCovered } from './shared-metrics';
import type {
  MonteCarloHistogramBin,
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

/**
 * Histograma empírico de `values` con `nBins` intervalos de igual ancho en
 * [min, max]. Los conteos suman values.length.
 */
export function buildHistogram(values: number[], nBins = 20): MonteCarloHistogramBin[] {
  const n = values.length;
  if (n === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return [{ from: min, to: max, count: n }];
  const width = (max - min) / nBins;
  const bins: MonteCarloHistogramBin[] = Array.from({ length: nBins }, (_, i) => ({
    from: min + i * width,
    to: i === nBins - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(nBins - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}

/** PPE neto = Σ cuentas de la clase 1 con prefijo 15 (incluye correctoras
 *  1592/1597-1599 con su saldo crédito). null si no hay grupo 15 o es ≤ 0. */
function ppeNeto(snapshot: PeriodSnapshot): number | null {
  const clase1 = snapshot.classes.find((c) => c.code === 1);
  const cuentas = (clase1?.accounts ?? []).filter(
    (a) => a.code.startsWith('15') && !isVirtualCuratorAccount(a.code),
  );
  if (cuentas.length === 0) return null;
  const neto = cuentas.reduce((s, a) => s + a.balance, 0);
  return neto > 0 ? neto : null;
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

  const { controlTotals } = snapshot;

  // Parámetros base (mensuales, sobre los meses cubiertos por el snapshot)
  const meses = monthsCovered(snapshot);
  const ingresoMesBase = ingresosNetosPeriodo(controlTotals) / meses;
  const egresoMesBase = controlTotals.gastos / meses;
  const cajaInicial = controlTotals.efectivoCuenta11;

  // PPE neto (grupo 15 de la clase 1). null ⇒ ROI N/D.
  const inversionPPE = ppeNeto(snapshot);

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
    if (inversionPPE !== null) {
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
    inversionPPE !== null ? computeDistribution(roiValues) : null;
  const roiHistograma = inversionPPE !== null ? buildHistogram(roiValues) : null;

  return {
    iterations: N,
    cajaFinal,
    utilidadAcumulada,
    roiProbabilistico,
    roiHistograma,
    probabilidadQuiebre12m,
    mesQuiebreMediano,
    inversionPPE,
    seed,
    supuestos: {
      distribucion: 'normal-iid-mensual',
      variable: 'ingresos',
      ingresoSigmaMensual: sigma,
      horizonteMeses: H,
      iteraciones: N,
      semilla: seed,
      mesesBase: meses,
      exclusionesEs:
        'Egresos contables fijos; no modela impuestos, capital de trabajo ni estacionalidad. Escenario simulado, no pronóstico.',
      exclusionesEn:
        'Fixed book outflows; does not model taxes, working capital or seasonality. Simulated scenario, not a forecast.',
    },
    generatedAt: new Date().toISOString(),
  };
}
