// ---------------------------------------------------------------------------
// Convención de signos del balance de prueba
// ---------------------------------------------------------------------------
// Los ERP colombianos exportan el balance de prueba en una de dos convenciones:
//
//   NATURAL     Cada clase se publica como magnitud de su naturaleza: activo,
//               pasivo, patrimonio, ingresos, gastos y costos, todos positivos.
//               Es la convención que asume el resto de UtopIA — `netIncome =
//               totalRevenue − gastos` (trial-balance.ts) sólo es correcto si el
//               ingreso llega positivo, y `equationBalance = activo − pasivo −
//               patrimonio` sólo cierra si los tres son magnitudes.
//
//   ALGEBRAICA  Partida doble literal: débitos positivos, créditos negativos.
//               Las clases 2 (Pasivo), 3 (Patrimonio) y 4 (Ingresos) llegan en
//               negativo y la suma de TODOS los saldos vale cero por definición.
//
// `parseTrialBalanceCSV` sólo derivaba el signo por naturaleza PUC en la rama de
// columnas débito/crédito separadas (`[1,5,6,7] ? debit − credit : credit −
// debit`), y esa rama es inalcanzable en cuanto el archivo trae cualquier
// columna que `isBalanceHeader` reconozca. Con un export algebraico el
// preprocesador leía el Pasivo y los Ingresos en negativo y nadie lo corregía
// aguas abajo.
//
// Por qué no lo atrapaba ninguna cuadratura: R8 (Cierre Virtual) calcula
// `residualGapBeforeCents = activo − pasivo − patrimonio` y lo absorbe ENTERO en
// la cuenta virtual 3710VC. El patrimonio pasa a ser idénticamente
// `activo − pasivo`, así que `A = P + K` cuadra contra sí misma por
// construcción. Medido sobre el único balance de cliente real del repo, ese
// tapón valía $8.773.827.814,43 — el 210% del activo — y `equationBalanced`
// seguía en `true`.
//
// La conversión correcta es una NEGACIÓN de las clases 2/3/4, no un valor
// absoluto por cuenta: 11 de las 26 cuentas de clase 2 de ese balance llevan
// saldo débito legítimo (IVA descontable, retenciones a favor). Negar preserva
// esos débitos como negativos bajo la convención natural, que es exactamente lo
// que el resto del sistema espera; `Math.abs` los convertiría en pasivos reales
// e inflaría el pasivo total.
// ---------------------------------------------------------------------------

import type { RawAccountRow } from './trial-balance';

/** Clases PUC de naturaleza crédito. Son las que cambian de signo. */
const CREDIT_NATURE_CLASSES = ['2', '3', '4'] as const;

/**
 * Umbral del detector. En convención algebraica `|Σ saldos| / |Σ clase 1|` vale
 * ~0 por partida doble; en natural vale `(A+P+K+I+G+C)/A`, del orden de 1,5–2.
 * Medido sobre los fixtures del repo: 0,0012–0,0024 (algebraica) frente a
 * 1,57–1,91 (natural) — tres órdenes de magnitud de separación, así que el
 * corte al 5% no es sensible a su valor exacto.
 */
const ALGEBRAIC_RATIO_THRESHOLD = 0.05;

/**
 * Piso de materialidad del activo. Por debajo de él la razón se vuelve ruidosa
 * y preferimos no tocar nada: un balance de juguete con activo de $1.000 puede
 * dar una razón pequeña por coincidencia.
 */
const MIN_ASSET_MAGNITUDE = 100_000;

export type SignConvention = 'natural' | 'algebraica';

export interface SignConventionDetection {
  convention: SignConvention;
  /** `|Σ saldos| / |Σ clase 1|` por periodo. Insumo auditable de la decisión. */
  ratioByPeriod: Record<string, number>;
  /** Periodos que se pudieron evaluar (activo material y filas suficientes). */
  periodsEvaluated: string[];
  /** Explicación legible para findings y notas técnicas del reporte. */
  reason: string;
}

/**
 * Filas que se suman para detectar. Se prefieren las transaccionales; cuando el
 * archivo no marca ninguna (fixtures que sólo traen auxiliares sin la columna
 * "Transaccional") se cae a todas las filas hoja para no doble contar los
 * totales de Clase/Grupo.
 */
function summableRows(rows: RawAccountRow[]): RawAccountRow[] {
  const transactional = rows.filter((r) => r.transactional);
  if (transactional.length > 0) return transactional;
  return rows.filter((r) => r.level === 'Auxiliar' || r.code.length >= 6);
}

/**
 * Detecta la convención de signos del archivo.
 *
 * Regla: en convención algebraica la suma de TODOS los saldos hoja es cero
 * (debe = haber). Se exige además que las clases de naturaleza crédito sumen
 * negativo, para que un balance natural que casualmente sume cerca de cero no
 * se reclasifique.
 */
export function detectSignConvention(rows: RawAccountRow[]): SignConventionDetection {
  const leaves = summableRows(rows);
  const periods = Array.from(
    new Set(leaves.flatMap((r) => Object.keys(r.balancesByPeriod))),
  ).sort();

  const ratioByPeriod: Record<string, number> = {};
  const periodsEvaluated: string[] = [];
  let algebraicVotes = 0;

  for (const period of periods) {
    let sumAll = 0;
    let sumAssets = 0;
    let sumCreditClasses = 0;
    for (const row of leaves) {
      const balance = row.balancesByPeriod[period];
      if (!Number.isFinite(balance)) continue;
      sumAll += balance;
      const cls = row.code[0];
      if (cls === '1') sumAssets += balance;
      if ((CREDIT_NATURE_CLASSES as readonly string[]).includes(cls)) {
        sumCreditClasses += balance;
      }
    }

    if (Math.abs(sumAssets) < MIN_ASSET_MAGNITUDE) continue;
    periodsEvaluated.push(period);

    const ratio = Math.abs(sumAll) / Math.abs(sumAssets);
    ratioByPeriod[period] = ratio;
    if (ratio < ALGEBRAIC_RATIO_THRESHOLD && sumCreditClasses < 0) algebraicVotes++;
  }

  // Mayoría estricta de los periodos evaluados. Un solo periodo dudoso no
  // arrastra un archivo multiperiodo.
  const isAlgebraic =
    periodsEvaluated.length > 0 && algebraicVotes * 2 > periodsEvaluated.length;

  const detail = periodsEvaluated
    .map((p) => `${p}: ${(ratioByPeriod[p] * 100).toFixed(2)}%`)
    .join(', ');

  return {
    convention: isAlgebraic ? 'algebraica' : 'natural',
    ratioByPeriod,
    periodsEvaluated,
    reason: isAlgebraic
      ? `Convención algebraica detectada (débitos positivos, créditos negativos): la suma de ` +
        `todos los saldos es ~0 frente al activo (${detail}). Las clases 2, 3 y 4 se ` +
        `normalizaron a magnitudes de su naturaleza.`
      : periodsEvaluated.length === 0
        ? 'Convención natural asumida: no hay periodos con activo material para evaluar.'
        : `Convención natural: la suma de todos los saldos no se aproxima a cero frente al ` +
          `activo (${detail}).`,
  };
}

/**
 * Normaliza las filas a convención natural si el archivo viene en algebraica.
 * Devuelve filas nuevas — no muta la entrada.
 */
export function normalizeSignConvention(rows: RawAccountRow[]): {
  rows: RawAccountRow[];
  detection: SignConventionDetection;
} {
  const detection = detectSignConvention(rows);
  if (detection.convention === 'natural') return { rows, detection };

  const normalized = rows.map((row) => {
    if (!(CREDIT_NATURE_CLASSES as readonly string[]).includes(row.code[0])) return row;
    const balancesByPeriod: Record<string, number> = {};
    for (const [period, balance] of Object.entries(row.balancesByPeriod)) {
      // `-0` rompe comparaciones estrictas y se serializa distinto; lo
      // colapsamos a 0.
      balancesByPeriod[period] = balance === 0 ? 0 : -balance;
    }
    return { ...row, balancesByPeriod };
  });

  return { rows: normalized, detection };
}
