// ---------------------------------------------------------------------------
// Métricas compartidas por pilares, tarjetas, Centro de Mando, Sentinel y PDF.
// ---------------------------------------------------------------------------
// Una sola definición por indicador (auditoría ratios-kpis-15/19/10/03):
//
//   - Base del periodo: un snapshot con etiqueta `YYYY-MM` viene del libro
//     mayor con resultados ACUMULADOS del año hasta ese mes (ver
//     src/lib/cache/preprocessed-balance.ts) ⇒ cubre MM meses. Cualquier otra
//     etiqueta (año del CSV/ERP) se trata como anual (12 meses). Las
//     anualizaciones /12 y /365 usan esta base, no un año supuesto.
//   - Razón corriente y prueba ácida: activo/pasivo corriente de controlTotals
//     (misma fórmula que computeDerivedKpis). Sin pasivo corriente ⇒ null, sin
//     centinela 999.
//   - Días de autonomía: efectivo (PUC 11) / egresos diarios del periodo
//     (clases 5+6+7 ÷ días cubiertos, base 365). Sin egresos ⇒ null (no se
//     inventan 365 días).
//   - Métricas fiscales (renta teórica, cobertura/reserva fiscal, provisión
//     tributaria futura, capacidad de inversión neta de renta): N/D. La
//     utilidad contable NO es base fiscal y el grupo 24 mezcla IVA, ICA y
//     retenciones; sin renta líquida / impuesto por pagar verificados no se
//     publica cifra (decisión del coordinador de la auditoría 2026-09).
// ---------------------------------------------------------------------------

import type { ControlTotals, PeriodSnapshot } from '@/lib/preprocessing/trial-balance';

import { computeEbitda } from './ebitda';
import type { ForensicSummary } from './types';

/** Meses cubiertos por los flujos de resultados del snapshot. */
export function monthsCovered(snapshot: Pick<PeriodSnapshot, 'period'>): number {
  const m = /^(\d{4})-(\d{2})$/.exec(snapshot.period ?? '');
  if (m) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) return month;
  }
  return 12;
}

/** Días cubiertos (base 365 días / 12 meses). */
export function daysCovered(snapshot: Pick<PeriodSnapshot, 'period'>): number {
  return (monthsCovered(snapshot) * 365) / 12;
}

/** true si dos snapshots cubren periodos de igual duración (comparables). */
export function periodsComparable(
  a: Pick<PeriodSnapshot, 'period'>,
  b: Pick<PeriodSnapshot, 'period'>,
): boolean {
  return monthsCovered(a) === monthsCovered(b);
}

/**
 * Ingresos del periodo netos de devoluciones (clase 4 − 4175, incluye el grupo
 * 42). Base de la utilidad neta del preprocesador y de `controlTotals.margenNeto`:
 * denominador del Margen Neto Real, del Ratio Operativo, del CAGR y de las
 * proyecciones de caja (ratios-kpis-04). Nunca la Σ bruta de la clase 4.
 */
export function ingresosNetosPeriodo(ct: ControlTotals): number {
  return ct.ingresosNetos ?? ct.ingresos;
}

/**
 * Ingresos operacionales netos = |Σ 41 (sin 4175)| − |Σ 4175| (decisión del
 * coordinador de la auditoría 2026-09: el grupo 42 va debajo de la utilidad
 * operacional). Prefiere el ancla del preprocesador; sin ella, la misma fórmula
 * sobre las hojas de la clase 4 (computeEbitda). `null` sin grupo 41.
 */
export function ingresosOperacionalesNetosPeriodo(snapshot: PeriodSnapshot): number | null {
  const fromDetail = computeEbitda(snapshot).ingresosOperacionalesNetos;
  if (fromDetail === null) return null;
  const anchor = snapshot.controlTotals.ingresosOperacionalesNetos;
  return typeof anchor === 'number' && Number.isFinite(anchor) ? anchor : fromDetail;
}

/**
 * Margen bruto = (ingresos operacionales netos − costos de las clases 6 y 7) /
 * ingresos operacionales netos — misma utilidad bruta que el preprocesador
 * (`controlTotals.utilidadBruta`). `null` sin grupo 41 o con ingresos ≤ 0.
 */
export function margenBruto(snapshot: PeriodSnapshot): number | null {
  const ingresosOp = ingresosOperacionalesNetosPeriodo(snapshot);
  if (ingresosOp === null || !(ingresosOp > 0)) return null;
  const anchor = snapshot.controlTotals.utilidadBruta;
  const utilidadBruta =
    typeof anchor === 'number' && Number.isFinite(anchor)
      ? anchor
      : ingresosOp - computeEbitda(snapshot).costos;
  return utilidadBruta / ingresosOp;
}

/**
 * Score forense publicable como integridad de los asientos: sólo con cobertura
 * COMPLETA (auditoria-calidad-19). Un escaneo parcial (reglas que no se
 * pudieron evaluar) no equivale a "limpio".
 */
export function forensicIntegrityScore(forensic: ForensicSummary | null | undefined): number | null {
  if (!forensic || forensic.coverage === 'parcial') return null;
  return Number.isFinite(forensic.score) ? forensic.score : null;
}

export function razonCorriente(ct: ControlTotals): number | null {
  if (!(ct.pasivoCorriente > 0)) return null;
  return ct.activoCorriente / ct.pasivoCorriente;
}

export function pruebaAcida(ct: ControlTotals): number | null {
  if (!(ct.pasivoCorriente > 0)) return null;
  return (ct.activoCorriente - (ct.inventarios14 ?? 0)) / ct.pasivoCorriente;
}

export interface DiasAutonomia {
  value: number | null;
  /** Egresos diarios del periodo (clases 5+6+7 / días cubiertos). */
  egresoDiario: number | null;
  reasonEs: string | null;
  reasonEn: string | null;
}

/**
 * Días de autonomía = efectivo PUC 11 (menos `ajusteCaja`, p. ej. CapEx
 * comprometido) / egresos diarios del periodo.
 */
export function diasAutonomia(snapshot: PeriodSnapshot, ajusteCaja = 0): DiasAutonomia {
  const ct = snapshot.controlTotals;
  const dias = daysCovered(snapshot);
  if (!(ct.gastos > 0)) {
    return {
      value: null,
      egresoDiario: null,
      reasonEs: 'N/D — sin egresos del periodo para medir el consumo de caja.',
      reasonEn: 'N/A — no period outflows to measure cash burn.',
    };
  }
  const egresoDiario = ct.gastos / dias;
  return {
    value: (ct.efectivoCuenta11 - ajusteCaja) / egresoDiario,
    egresoDiario,
    reasonEs: null,
    reasonEn: null,
  };
}

export const FISCAL_ND_REASON_ES =
  'N/D — requiere base fiscal verificada (renta líquida e impuesto de renta por pagar neto de ' +
  'anticipos). La utilidad contable no es base fiscal y el grupo 24 incluye IVA, ICA y retenciones.';
export const FISCAL_ND_REASON_EN =
  'N/A — requires a verified tax base (taxable income and income tax payable net of advances). ' +
  'Book profit is not a tax base and PUC group 24 mixes VAT, ICA and withholdings.';

export interface CapacidadInversion {
  value: number | null;
  reasonEs: string;
  reasonEn: string;
}

/**
 * Capacidad de inversión = caja − impuesto de renta pendiente − reserva de 60
 * días de egresos. Una sola función para pilar y tarjeta (ratios-kpis-19). El
 * término fiscal exige base verificada; hoy no existe ⇒ N/D con motivo.
 */
export function capacidadInversion(snapshot: PeriodSnapshot): CapacidadInversion {
  void snapshot;
  return { value: null, reasonEs: FISCAL_ND_REASON_ES, reasonEn: FISCAL_ND_REASON_EN };
}
