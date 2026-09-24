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
//     por trabajadores que devenguen < 10 SMMLV SÓLO si el EMPLEADOR es
//     beneficiario del E.T. art. 114-1 (sociedades/personas jurídicas
//     declarantes de renta; personas naturales con 2+ trabajadores). La
//     condición la declara el workspace (`empleadorBeneficiario114_1`); sin
//     declarar NO se asume (auditoría contab-nomina-19: antes era
//     incondicional y subestimaba 13,5 % del salario a quien no califica).
//   - SENA 2% + ICBF 3%                      — exonerados igual que salud (114-1)
//   - Tope del IBC de seguridad social: 25 SMMLV (Ley 100/1993 art. 18, mod.
//     Ley 797/2003 art. 5). Los parafiscales se liquidan sobre la nómina, sin
//     ese tope.
//   - Salario integral (CST art. 132): ≥ 13 SMMLV (10 + 30 % factor
//     prestacional); aportes sobre el 70 % (Ley 789/2002 art. 49); no causa
//     prima, cesantías ni intereses; sí vacaciones.
//   - Caja de compensación 4%                — Ley 21/1982 (NO exonerada)
//   - ARL por clase de riesgo I..V           — Decreto 1772/1994 art. 13:
//     I 0,522% · II 1,044% · III 2,436% · IV 4,350% · V 6,960%
//   - Prima de servicios 8,33% (1/12)        — CST art. 306
//   - Cesantías 8,33% (1/12)                 — CST art. 249
//   - Intereses a las cesantías 1% mensual   — Ley 52/1975 (12% anual / 12)
//   - Vacaciones 4,17% (15 días / año)       — CST art. 186
//
// Independiente (dueño): base de cotización = 40 % del ingreso mensual (o del
// ingreso neto de costos imputables con los requisitos del Art. 107 E.T.),
// con piso de 1 SMMLV y tope de 25 SMMLV — Ley 2277/2022 art. 89 (texto en
// src/data/tax_docs/ley_2277_2022.md). La cita anterior (Ley 1955/2019 art.
// 244) fue declarada inexequible (C-068/2020). Salud 12,5 % y pensión 16 %
// sobre la base (Ley 100/1993 arts. 204 y 20). El Fondo de Solidaridad
// Pensional (base ≥ 4 SMMLV) queda N/D: su tarifa por tramos no está
// verificada tras la reforma pensional (auditoría contab-nomina-20).
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
/** Tope del IBC de seguridad social — Ley 100/1993 art. 18 (mod. Ley 797/2003). */
export const TOPE_IBC_SMMLV = 25;
/** Salario integral mínimo — CST art. 132 (10 SMMLV + 30 % factor prestacional). */
export const SALARIO_INTEGRAL_MIN_SMMLV = 13;
/** Fracción del salario integral que es base de aportes — Ley 789/2002 art. 49. */
export const FACTOR_IBC_INTEGRAL = 0.7;
/** Desde esta base el independiente aporta al Fondo de Solidaridad Pensional. */
export const FSP_DESDE_SMMLV = 4;

export type EstadoExoneracion114_1 =
  /** Empleador beneficiario y trabajador < 10 SMMLV: no paga salud/SENA/ICBF. */
  | 'aplicada'
  /** El trabajador devenga ≥ 10 SMMLV (o es salario integral). */
  | 'no_aplica_salario'
  /** El workspace declaró que el empleador NO es beneficiario. */
  | 'empleador_no_beneficiario'
  /** Condición del empleador no declarada: se liquida SIN exoneración. */
  | 'sin_confirmar';

export interface CostoEmpleadoOpciones {
  /** true beneficiario del Art. 114-1 · false no beneficiario · null/undefined sin declarar. */
  empleadorBeneficiario114_1?: boolean | null;
  /** Salario integral (CST art. 132). Exige ≥ 13 SMMLV. */
  salarioIntegral?: boolean;
}

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
  /** true cuando aplicó la exoneración del art. 114-1. */
  exoneracion114_1: boolean;
  /** Por qué se aplicó o no la exoneración (condición del empleador + salario). */
  exoneracion114_1Estado: EstadoExoneracion114_1;
  /**
   * Con la condición del empleador sin declarar: lo que se ahorraría si fuera
   * beneficiario (salud + SENA + ICBF, ya incluidos en el total). 0 si no aplica.
   */
  ahorroPotencial114_1Cop: number;
  /** IBC de seguridad social (tope 25 SMMLV; 70 % si es salario integral). */
  ibcCop: number;
  salarioIntegral: boolean;
  /** Costo total mensual estimado para el empleador (salario incluido). */
  totalMensualCop: number;
  /** Carga prestacional = (total − salario) / salario. */
  cargaPct: number;
}

/**
 * Costo mensual estimado de un empleado con contrato laboral.
 * La exoneración 114-1 sólo se aplica si el empleador fue declarado
 * beneficiario y el trabajador devenga menos de 10 SMMLV.
 */
export function costoEmpleado(
  salarioCop: number,
  arlClase: ArlClase = 1,
  opciones: CostoEmpleadoOpciones = {},
): CostoEmpleadoBreakdown {
  const salario = Math.max(0, salarioCop);
  const integral = opciones.salarioIntegral === true;
  if (integral && salario < SALARIO_INTEGRAL_MIN_SMMLV * SMMLV_2026) {
    throw new RangeError(
      `Salario integral inferior a ${SALARIO_INTEGRAL_MIN_SMMLV} SMMLV (CST art. 132).`,
    );
  }

  // Base de aportes: 70 % si es integral; tope 25 SMMLV para seguridad social.
  const baseAportes = integral ? salario * FACTOR_IBC_INTEGRAL : salario;
  const ibc = Math.min(baseAportes, TOPE_IBC_SMMLV * SMMLV_2026);

  const bajoUmbral = !integral && salario < EXONERACION_114_1_SMMLV * SMMLV_2026;
  const beneficiario = opciones.empleadorBeneficiario114_1;
  const exoneracion114_1Estado: EstadoExoneracion114_1 = !bajoUmbral
    ? 'no_aplica_salario'
    : beneficiario === true
      ? 'aplicada'
      : beneficiario === false
        ? 'empleador_no_beneficiario'
        : 'sin_confirmar';
  const exonerado = exoneracion114_1Estado === 'aplicada';

  const pensionCop = ibc * 0.12;
  const saludCop = exonerado ? 0 : ibc * 0.085;
  const arlCop = ibc * (ARL_RATES[arlClase] ?? ARL_RATES[1]);
  // Parafiscales sobre la nómina (70 % si es integral), sin el tope del IBC.
  const cajaCop = baseAportes * 0.04;
  const senaCop = exonerado ? 0 : baseAportes * 0.02;
  const icbfCop = exonerado ? 0 : baseAportes * 0.03;
  // El salario integral ya incluye prima, cesantías e intereses.
  const primaCop = integral ? 0 : salario / 12;
  const cesantiasCop = integral ? 0 : salario / 12;
  const interesesCesantiasCop = cesantiasCop * 0.12;
  const vacacionesCop = (salario * 15) / 360;
  const ahorroPotencial114_1Cop =
    exoneracion114_1Estado === 'sin_confirmar' ? saludCop + senaCop + icbfCop : 0;

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
    exoneracion114_1Estado,
    ahorroPotencial114_1Cop,
    ibcCop: ibc,
    salarioIntegral: integral,
    totalMensualCop,
    cargaPct: salario > 0 ? cargas / salario : 0,
  };
}

export interface AporteIndependienteBreakdown {
  ingresoMensualCop: number;
  /** Costos imputados (Art. 107 E.T.) restados del ingreso; null si no se informaron. */
  costosImputadosCop: number | null;
  /**
   * Base de cotización: 40 % del ingreso (neto de costos si se informaron),
   * piso 1 SMMLV y tope 25 SMMLV — Ley 2277/2022 art. 89.
   */
  baseCotizacionCop: number;
  /** true si la base se calculó sin costos: es una cota superior. */
  baseSinCostos: boolean;
  /** true si se aplicó el tope de 25 SMMLV. */
  topeAplicado: boolean;
  saludCop: number; // 12,5% de la base
  pensionCop: number; // 16% de la base
  /**
   * Fondo de Solidaridad Pensional: 0 si la base es < 4 SMMLV; null (N/D) si
   * la supera — tarifa por tramos no verificada; NO incluido en el total.
   */
  fondoSolidaridadCop: number | null;
  /** Salud + pensión (sin FSP cuando es N/D). */
  totalMensualCop: number;
  /** true cuando el total excluye un componente N/D (FSP). */
  totalIncompleto: boolean;
  /** Motivos de N/D o supuestos, para mostrar al usuario. */
  notas: string[];
}

export interface AporteIndependienteOpciones {
  /** Costos y deducciones soportados (Art. 107 E.T.) del mes, en COP. */
  costosImputadosCop?: number | null;
}

/** Aporte mensual del dueño cotizando como independiente por cuenta propia. */
export function aporteIndependiente(
  ingresoMensualCop: number,
  opciones: AporteIndependienteOpciones = {},
): AporteIndependienteBreakdown {
  const ingreso = Math.max(0, ingresoMensualCop);
  const costos =
    opciones.costosImputadosCop === null || opciones.costosImputadosCop === undefined
      ? null
      : Math.max(0, opciones.costosImputadosCop);
  const neto = costos === null ? ingreso : Math.max(0, ingreso - costos);
  const tope = TOPE_IBC_SMMLV * SMMLV_2026;
  const base40 = Math.max(neto * 0.4, SMMLV_2026);
  const baseCotizacionCop = Math.min(base40, tope);
  const saludCop = baseCotizacionCop * 0.125;
  const pensionCop = baseCotizacionCop * 0.16;
  const aplicaFsp = baseCotizacionCop >= FSP_DESDE_SMMLV * SMMLV_2026;
  const notas: string[] = [];
  if (costos === null) {
    notas.push(
      'Base sin imputación de costos (Art. 107 E.T.) ni esquema de presunción de costos UGPP: es una cota superior.',
    );
  }
  if (aplicaFsp) {
    notas.push(
      'Fondo de Solidaridad Pensional N/D: la base supera 4 SMMLV y la tarifa por tramos vigente no está verificada.',
    );
  }
  return {
    ingresoMensualCop: ingreso,
    costosImputadosCop: costos,
    baseCotizacionCop,
    baseSinCostos: costos === null,
    topeAplicado: base40 > tope,
    saludCop,
    pensionCop,
    fondoSolidaridadCop: aplicaFsp ? null : 0,
    totalMensualCop: saludCop + pensionCop,
    totalIncompleto: aplicaFsp,
    notas,
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
  opciones: CostoEmpleadoOpciones = {},
): number {
  const b = costoEmpleado(salarioCop, arlClase, opciones);
  return b.pensionCop + b.saludCop + b.arlCop + b.cajaCop + b.senaCop + b.icbfCop;
}
