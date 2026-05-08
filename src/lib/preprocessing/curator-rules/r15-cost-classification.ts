// ---------------------------------------------------------------------------
// R15 — Costos sin grupo 6135 (costeo incompleto en comercializadoras)
// ---------------------------------------------------------------------------
// Si la entidad reporta ingresos de comercialización (clase 41) AND la cuenta
// 6135 (Costo de mercancías vendidas) está en cero PERO hay movimiento en
// clase 7 etiquetado como costo (típicamente 7405 — Materia prima consumida),
// el costeo está incompleto: la entidad usa la clase 7 como if fuera costo
// directo pero no descarga el inventario contra 6135.
//
// La regla NO muta el snapshot — sólo escribe `snapshot.findings.costeoIncompleto`
// y emite un finding cualitativo. El renderer NO calcula margen bruto cuando
// el flag está activo, o lo hace con warning prominente.
// ---------------------------------------------------------------------------

import type { PUCClass, PeriodSnapshot } from '../trial-balance';
import type { CostClassificationAudit, CuratorFinding } from './types';

/** Umbral mínimo de ingresos para disparar la advertencia. */
const INGRESOS_MATERIALITY_FLOOR = 1_000_000; // $1M COP

/** Tolerancia para considerar 6135 ≈ 0. */
const ZERO_TOLERANCE = 1_000; // $1K COP

export interface R15Result {
  audit: CostClassificationAudit;
  findings: CuratorFinding[];
}

export function runR15(snapshot: PeriodSnapshot): R15Result {
  const findings: CuratorFinding[] = [];

  const class4 = snapshot.classes.find((c: PUCClass) => c.code === 4);
  const class6 = snapshot.classes.find((c: PUCClass) => c.code === 6);
  const class7 = snapshot.classes.find((c: PUCClass) => c.code === 7);

  // -------------------------------------------------------------------------
  // 1. Ingresos de comercialización: grupo 41 (operacionales). Tomamos el
  //    sub-grupo 4135 si existe; si no, todo el grupo 41 como proxy.
  // -------------------------------------------------------------------------
  const ingresos4135 = (class4?.accounts ?? [])
    .filter((a) => a.code.startsWith('4135'))
    .reduce((s, a) => s + a.balance, 0);
  const ingresos41 = (class4?.accounts ?? [])
    .filter((a) => a.code.startsWith('41'))
    .reduce((s, a) => s + a.balance, 0);
  const ingresosComercializacion = ingresos4135 > 0 ? ingresos4135 : ingresos41;

  // -------------------------------------------------------------------------
  // 2. Costo de mercancías vendidas (cuenta 6135).
  // -------------------------------------------------------------------------
  const costo6135 = (class6?.accounts ?? [])
    .filter((a) => a.code.startsWith('6135'))
    .reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 3. Costo en clase 7 (típicamente 7405 — Materia prima consumida).
  // -------------------------------------------------------------------------
  const costoClase7 = (class7?.accounts ?? []).reduce((s, a) => s + a.balance, 0);

  // -------------------------------------------------------------------------
  // 4. Determinación.
  // -------------------------------------------------------------------------
  const ingresosMateriales = ingresosComercializacion > INGRESOS_MATERIALITY_FLOOR;
  const sinCosto6135 = Math.abs(costo6135) <= ZERO_TOLERANCE;
  const conCostoClase7 = costoClase7 > ZERO_TOLERANCE;
  const costeoIncompleto = ingresosMateriales && sinCosto6135 && conCostoClase7;

  const audit: CostClassificationAudit = {
    ingresosComercializacionCop: ingresosComercializacion,
    costo6135Cop: costo6135,
    costoClase7Cop: costoClase7,
    costeoIncompleto,
  };

  if (!snapshot.findings) snapshot.findings = {};
  snapshot.findings.costeoIncompleto = costeoIncompleto;
  snapshot.costClassificationAudit = audit;

  if (costeoIncompleto) {
    findings.push({
      code: 'CUR-R15',
      severity: 'alto',
      title: 'Costeo incompleto — clase 7 usada como costo sin descargue de inventarios (6135)',
      description:
        `La entidad reporta ingresos de comercialización por $${formatCOP(ingresosComercializacion)} ` +
        `(grupo 41xx) y movimiento en clase 7 por $${formatCOP(costoClase7)}, pero la cuenta ` +
        `6135 (Costo de mercancías vendidas) está en $${formatCOP(costo6135)}. La clase 7 ` +
        `(Costos de Producción) se usa como if fuera el costo directo, sin pasar el ` +
        `descargue de inventarios de mercancías a 6135.`,
      normReference: 'Decreto 2650/1993 + Sección 13 NIIF para PYMES (Inventarios) + NIC 2',
      recommendation:
        'Si la entidad es netamente comercializadora, mover el costo de la clase 7 a ' +
        'la cuenta 6135 y dejar la clase 7 sólo para procesos productivos reales. Si la ' +
        'entidad es manufacturera, complementar el costeo con descargue de inventario de ' +
        'productos terminados (Cr. 1430 Productos terminados, Dr. 6135) al momento de la venta.',
      impact:
        'Sin la cuenta 6135, no se puede calcular margen bruto comparable con el sector. ' +
        'El renderer marca el margen como "no calculable" y los pilares Valor / Verdad ' +
        'omiten esa métrica para no inducir interpretación errónea.',
      period: snapshot.period,
    });
  }

  return { audit, findings };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
