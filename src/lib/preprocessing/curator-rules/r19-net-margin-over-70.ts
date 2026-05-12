// ---------------------------------------------------------------------------
// R19 — Margen neto > 70% (subregistro de costos, Parte 5 spec v2.0)
// ---------------------------------------------------------------------------
// Un margen neto sostenido > 70% es estadísticamente raro fuera de sectores
// muy específicos (licencias de software, regalías). En la mayoría de las
// empresas colombianas (comercio, manufactura, servicios profesionales) un
// margen > 70% sugiere:
//
//   - Subregistro de costos (típico: comercializadora sin descargue de CMV
//     en grupo 6135). NIA 240 §A1-A6 marca este patrón como red flag de
//     fraude por manipulación de utilidades.
//   - Costos clasificados incorrectamente en grupo de Ingresos (signo
//     invertido en 41xx).
//   - Asientos de gasto trasladados directamente a Patrimonio sin pasar
//     por el P&L.
//
// La regla NO muta saldos — sólo emite finding warning con la advertencia
// para que el auditor verifique. R19 corre DESPUÉS de R8 (Cierre Virtual)
// para usar la utilidad NETA autoritativa (no la transitoria).
//
// Usa `ingresosNetos` (post-devoluciones 4175) como denominador — coherente
// con la convención Wave 2.F4 fuente única de verdad.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';
import type { CuratorFinding } from './types';

/** Umbral por encima del cual el margen es sospechosamente alto. */
const NET_MARGIN_THRESHOLD = 0.70; // 70%
/** Materialidad mínima de ingresos — empresas con < $10M ingresos quedan exentas. */
const REVENUE_MATERIALITY = 10_000_000; // $10M COP

export interface R19Result {
  findings: CuratorFinding[];
  /** Ratio calculado (utilidadNeta / ingresosNetos), o null si no aplicable. */
  netMarginRatio: number | null;
  /** True si el ratio supera el umbral. */
  exceedsThreshold: boolean;
}

export function runR19(snapshot: PeriodSnapshot): R19Result {
  const findings: CuratorFinding[] = [];
  const ingresosNetos =
    snapshot.controlTotals.ingresosNetos ??
    Math.abs(snapshot.controlTotals.ingresos);
  const utilidadNeta = snapshot.controlTotals.utilidadNeta;

  // Guard: empresa sin ingresos o con ingresos no materiales (start-up,
  // primer mes operativo). El ratio no es estadísticamente significativo.
  if (ingresosNetos <= 0 || ingresosNetos < REVENUE_MATERIALITY) {
    return { findings, netMarginRatio: null, exceedsThreshold: false };
  }

  // Guard: utilidad negativa nunca dispara R19 (es la patología opuesta —
  // R18 patrimonio negativo o costos sobrerregistrados, no R19).
  if (utilidadNeta <= 0) {
    const ratio = utilidadNeta / ingresosNetos;
    return { findings, netMarginRatio: ratio, exceedsThreshold: false };
  }

  const ratio = utilidadNeta / ingresosNetos;
  if (ratio <= NET_MARGIN_THRESHOLD) {
    return { findings, netMarginRatio: ratio, exceedsThreshold: false };
  }

  const pct = (ratio * 100).toFixed(1);
  const costoVentas6 = snapshot.controlTotals.costoVentas6 ?? 0;
  const costoProduccion7 = snapshot.controlTotals.costoProduccion7 ?? 0;
  const costosTotales = costoVentas6 + costoProduccion7;
  const costoRatio =
    ingresosNetos > 0 ? (costosTotales / ingresosNetos) * 100 : 0;

  findings.push({
    code: 'CUR-R19',
    severity: 'medio',
    title: `Margen neto > 70% (${pct}%) — posible subregistro de costos`,
    description:
      `El margen neto observado es ${pct}% (Utilidad Neta $${formatCOP(utilidadNeta)} / ` +
      `Ingresos Netos $${formatCOP(ingresosNetos)}). Costos directos (Clase 6 + Clase 7) ` +
      `representan ${costoRatio.toFixed(1)}% de los ingresos netos. Un margen sostenido ` +
      `superior al 70% es estadísticamente raro fuera de sectores de licencias o ` +
      `regalías; en empresas de comercio, manufactura o servicios profesionales sugiere ` +
      `subregistro de costo de ventas o reclasificación incorrecta de gastos.`,
    normReference:
      'NIA 240 §A1-A6 (fraude por subregistro de costos / manipulación de utilidades) + NIIF 15 §73 (medición de ingresos)',
    recommendation:
      'Verificar: (a) auxiliares 6135xx (CMV) si la entidad comercializa inventarios; ' +
      '(b) reclasificación de gastos administrativos/operativos a clase 6 o 7 cuando ' +
      'correspondan al costo del producto vendido; (c) saldo de inventarios — un ' +
      'inventario alto sin descargue indica costo represado.',
    impact:
      'Sin verificación, la utilidad neta reportada puede estar sobrestimada, lo cual ' +
      'expone a la entidad a (i) cuestionamientos DIAN por subregistro de gastos ' +
      'deducibles (mayor renta líquida que la real), y (ii) responsabilidad del ' +
      'revisor fiscal por no advertir indicios de fraude (Ley 43/1990 Art. 8).',
    period: snapshot.period,
  });

  return { findings, netMarginRatio: ratio, exceedsThreshold: true };
}

function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `-${formatted}` : formatted;
}
