// ---------------------------------------------------------------------------
// prestaciones.ts — Costo laboral mensual estimado Colombia 2026
// ---------------------------------------------------------------------------
// Funciones puras para el módulo de nómina simple Pyme. Calculan lo que le
// cuesta al empleador cada persona (empleado con contrato laboral) y el
// aporte del dueño como independiente.
//
// Marco legal de los factores (estables, no cambian con el año salvo reforma):
//   - Pensión empleador 12%                  — Ley 100/1993 art. 20 (Ley 797/2003)
//   - Salud empleador 8,5%                   — Ley 100/1993 art. 204; EXONERADA
//     para empleadores de trabajadores que devenguen < 10 SMMLV (E.T. art.
//     114-1, Ley 1607/2012 / Ley 2010/2019)
//   - SENA 2% + ICBF 3%                      — exonerados igual que salud (114-1)
//   - Caja de compensación 4%                — Ley 21/1982 (NO exonerada)
//   - ARL por clase de riesgo I..V           — Decreto 1772/1994 art. 13:
//     I 0,522% · II 1,044% · III 2,436% · IV 4,350% · V 6,960%
//   - Prima de servicios 8,33% (1/12)        — CST art. 306
//   - Cesantías 8,33% (1/12)                 — CST art. 249
//   - Intereses a las cesantías 1% mensual   — Ley 52/1975 (12% anual / 12)
//   - Vacaciones 4,17% (15 días / año)       — CST art. 186
//
// Independiente (dueño): base de cotización = 40% del ingreso mensual con
// piso de 1 SMMLV (Ley 1955/2019 art. 244); salud 12,5% y pensión 16% sobre
// la base (Ley 100/1993 arts. 204 y 20).
//
// ESTIMACIÓN, no liquidación: no incluye auxilio de transporte, horas extra,
// recargos, dotación ni retención en la fuente. La UI lo declara.
// ---------------------------------------------------------------------------

import { SMMLV_2026 } from '@/lib/tax/taxCalculator';

export type ArlClase = 1 | 2 | 3 | 4 | 5;

/** Tarifas ARL por clase de riesgo — Decreto 1772/1994 art. 13. */
export const ARL_RATES: Record<ArlClase, number> = {
  1: 0.00522,
  2: 0.01044,
  3: 0.02436,
  4: 0.0435,
  5: 0.0696,
};

/** Umbral de exoneración de salud/SENA/ICBF — E.T. art. 114-1 (10 SMMLV). */
export const EXONERACION_114_1_SMMLV = 10;

export interface CostoEmpleadoBreakdown {
  salarioCop: number;
  /** Aportes del empleador a seguridad social. */
  pensionCop: number;
  saludCop: number;
  arlCop: number;
  /** Parafiscales. */
  cajaCop: number;
  senaCop: number;
  icbfCop: number;
  /** Prestaciones sociales provisionadas mensualmente. */
  primaCop: number;
  cesantiasCop: number;
  interesesCesantiasCop: number;
  vacacionesCop: number;
  /** true cuando aplicó la exoneración del art. 114-1 (salario < 10 SMMLV). */
  exoneracion114_1: boolean;
  /** Costo total mensual estimado para el empleador (salario incluido). */
  totalMensualCop: number;
  /** Carga prestacional = (total − salario) / salario. */
  cargaPct: number;
}

/**
 * Costo mensual estimado de un empleado con contrato laboral.
 * La exoneración 114-1 se aplica automáticamente cuando el salario es
 * inferior a 10 SMMLV (el caso típico del tendero Pyme).
 */
export function costoEmpleado(
  salarioCop: number,
  arlClase: ArlClase = 1,
): CostoEmpleadoBreakdown {
  const salario = Math.max(0, salarioCop);
  const exonerado = salario < EXONERACION_114_1_SMMLV * SMMLV_2026;

  const pensionCop = salario * 0.12;
  const saludCop = exonerado ? 0 : salario * 0.085;
  const arlCop = salario * (ARL_RATES[arlClase] ?? ARL_RATES[1]);
  const cajaCop = salario * 0.04;
  const senaCop = exonerado ? 0 : salario * 0.02;
  const icbfCop = exonerado ? 0 : salario * 0.03;
  const primaCop = salario / 12;
  const cesantiasCop = salario / 12;
  const interesesCesantiasCop = cesantiasCop * 0.12;
  const vacacionesCop = (salario * 15) / 360;

  const cargas =
    pensionCop +
    saludCop +
    arlCop +
    cajaCop +
    senaCop +
    icbfCop +
    primaCop +
    cesantiasCop +
    interesesCesantiasCop +
    vacacionesCop;

  const totalMensualCop = salario + cargas;

  return {
    salarioCop: salario,
    pensionCop,
    saludCop,
    arlCop,
    cajaCop,
    senaCop,
    icbfCop,
    primaCop,
    cesantiasCop,
    interesesCesantiasCop,
    vacacionesCop,
    exoneracion114_1: exonerado,
    totalMensualCop,
    cargaPct: salario > 0 ? cargas / salario : 0,
  };
}

export interface AporteIndependienteBreakdown {
  ingresoMensualCop: number;
  /** Base de cotización: max(40% del ingreso, 1 SMMLV) — Ley 1955/2019 art. 244. */
  baseCotizacionCop: number;
  saludCop: number; // 12,5% de la base
  pensionCop: number; // 16% de la base
  totalMensualCop: number;
}

/** Aporte mensual del dueño cotizando como independiente. */
export function aporteIndependiente(
  ingresoMensualCop: number,
): AporteIndependienteBreakdown {
  const ingreso = Math.max(0, ingresoMensualCop);
  const baseCotizacionCop = Math.max(ingreso * 0.4, SMMLV_2026);
  const saludCop = baseCotizacionCop * 0.125;
  const pensionCop = baseCotizacionCop * 0.16;
  return {
    ingresoMensualCop: ingreso,
    baseCotizacionCop,
    saludCop,
    pensionCop,
    totalMensualCop: saludCop + pensionCop,
  };
}

/**
 * Aporte PILA mensual del empleador por un empleado (lo que se paga vía
 * planilla: seguridad social + parafiscales — las prestaciones sociales se
 * provisionan pero no pasan por PILA).
 */
export function aportePilaEmpleado(
  salarioCop: number,
  arlClase: ArlClase = 1,
): number {
  const b = costoEmpleado(salarioCop, arlClase);
  return b.pensionCop + b.saludCop + b.arlCop + b.cajaCop + b.senaCop + b.icbfCop;
}
