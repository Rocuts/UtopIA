// ---------------------------------------------------------------------------
// Puente P&L del Centro de Mando (/workspace/comando) — auditoría ratios-kpis-13
// ---------------------------------------------------------------------------
// Antes: ingresos BRUTOS − clase 5 COMPLETA (que ya incluye 53 y 54) − otra vez
// 5305 − el SALDO del pasivo 24 (con IVA) como "Impuestos", con la barra final
// anclada a la utilidad neta: los niveles intermedios eran falsos y el gráfico
// no lo delataba.
//
// Ahora cada barra es un bloque disjunto del P&L del snapshot:
//   ingresos operacionales netos (41 − 4175)
//   + otros ingresos no operacionales (grupo 42 y demás de la clase 4)
//     = ingresos netos − ingresos operacionales (IW4 / ratios-kpis-04: el 42
//       va debajo de la utilidad operacional, decisión del coordinador)
//   − costos (clases 6 + 7)
//   − gastos operacionales (grupos 51 + 52)
//   − no operacionales (grupo 53 y cualquier otro grupo de la clase 5 ≠ 54)
//   − impuesto de renta causado (grupo 54)
//   = utilidad neta   ← se VERIFICA al centavo; si no cierra ⇒ null (no se pinta)
// Sin grupo 41 identificable la barra inicial son los ingresos netos y no hay
// barra de otros ingresos (no se inventa la separación).
// ---------------------------------------------------------------------------

import type { PeriodSnapshot, PUCClass } from '@/lib/preprocessing/trial-balance';

import { isVirtualCuratorAccount } from './ebitda';
import { ingresosOperacionalesNetosPeriodo } from './shared-metrics';

export interface PnlBridge {
  /** Ingresos operacionales netos (41 − 4175); ingresos netos si no hay
   *  desglose del grupo 41 (entonces `otrosIngresos` no viene). */
  ingresos: number;
  /** Ingresos no operacionales (grupo 42 y demás de la clase 4 ≠ 41). */
  otrosIngresos?: number;
  costos: number;
  gastosOperacionales: number;
  /** Grupo 53 (financieros, extraordinarios, diversos) y otros grupos de la
   *  clase 5 distintos de 51, 52 y 54. */
  gastosFinancieros: number;
  /** Impuesto de renta causado (grupo 54). */
  impuestos: number;
  utilidadNeta: number;
}

function toCents(n: number): bigint {
  return BigInt(Math.round((Number.isFinite(n) ? n : 0) * 100));
}

function sumClass(cl: PUCClass | undefined, pred: (code: string) => boolean): bigint {
  let acc = BigInt(0);
  for (const a of cl?.accounts ?? []) {
    if (isVirtualCuratorAccount(a.code) || !pred(a.code)) continue;
    acc += toCents(a.balance);
  }
  return acc;
}

/**
 * Construye el puente. Devuelve `null` si los bloques no cierran exactamente
 * (al centavo) contra la utilidad neta del snapshot: un puente descuadrado no
 * se dibuja.
 */
export function buildPnlBridge(snapshot: PeriodSnapshot): PnlBridge | null {
  const ct = snapshot.controlTotals;
  const c5 = snapshot.classes.find((c) => c.code === 5);
  const c6 = snapshot.classes.find((c) => c.code === 6);
  const c7 = snapshot.classes.find((c) => c.code === 7);

  const ingresosNetosC =
    ct.cents?.ingresosNetos ?? toCents(ct.ingresosNetos ?? ct.ingresos);
  const ingresosOp = ingresosOperacionalesNetosPeriodo(snapshot);
  // Centavos exactos del preprocesador cuando existen; si no, desde pesos.
  const ingresosC =
    ingresosOp === null
      ? ingresosNetosC
      : ct.cents?.ingresosOperacionalesNetos ?? toCents(ingresosOp);
  const otrosIngresosC = ingresosOp === null ? null : ingresosNetosC - ingresosC;
  const costosC = sumClass(c6, () => true) + sumClass(c7, () => true);
  const opC = sumClass(c5, (code) => code.startsWith('51') || code.startsWith('52'));
  const impC = sumClass(c5, (code) => code.startsWith('54'));
  const otrosC = sumClass(
    c5,
    (code) => !code.startsWith('51') && !code.startsWith('52') && !code.startsWith('54'),
  );
  const utilidadC = ct.cents?.utilidadNeta ?? toCents(ct.utilidadNeta);

  const cierre = ingresosC + (otrosIngresosC ?? BigInt(0)) - costosC - opC - otrosC - impC;
  if (cierre !== utilidadC) return null;

  const n = (c: bigint) => Number(c) / 100;
  return {
    ingresos: n(ingresosC),
    ...(otrosIngresosC === null ? {} : { otrosIngresos: n(otrosIngresosC) }),
    costos: n(costosC),
    gastosOperacionales: n(opC),
    gastosFinancieros: n(otrosC),
    impuestos: n(impC),
    utilidadNeta: n(utilidadC),
  };
}
