/**
 * Constantes normativas Colombia 2026 — Contabilidad Pyme.
 *
 * Regla de la casa: ningún valor normativo se escribe sin su cita y su vigencia.
 * Cuando la norma es ESCALONADA (reforma laboral Ley 2466/2025, jornada
 * Ley 2101/2021) NO se colapsa en un solo número: se deja la tabla completa y
 * `calc.ts` resuelve la franja que corresponde a la fecha del hecho liquidado.
 *
 * La norma NUNCA es protagonista en pantalla: aquí vive el dato; en la UI se
 * muestra solo como nota pequeña gris al pie de cada concepto.
 *
 * Verificación normativa: 7 de agosto de 2026.
 */

/* ─────────────────── Jornada máxima semanal — Ley 2101/2021 ─────────────────── */

/**
 * Gradualidad de la reducción de la jornada máxima legal (Ley 2101 de 2021,
 * art. 3 parágrafo — reducción escalonada sin disminución de salario).
 *
 * `divisorMes` = (horasSemana / 6) × 30 → es el divisor con el que se obtiene el
 * valor de la hora ordinaria a partir del salario MENSUAL (el sueldo remunera
 * los 30 días del mes, incluidos los de descanso, no solo las horas laboradas).
 * Es el divisor que usan las tablas publicadas de recargos 2026.
 *
 * Fuente: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506
 *         https://actualicese.com/horas-extra-y-recargos-2026-en-colombia/
 *         https://www.portafolio.co/economia/empleo/asi-queda-el-valor-de-la-hora-en-colombia-horas-extras-recargo-nocturno-y-dominical-a-partir-del-15-de-julio-498233
 */
export const JORNADA_GRADUALIDAD = [
  { desde: '2023-07-15', horasSemana: 47, divisorMes: 235 },
  { desde: '2024-07-15', horasSemana: 46, divisorMes: 230 },
  { desde: '2025-07-15', horasSemana: 44, divisorMes: 220 },
  { desde: '2026-07-15', horasSemana: 42, divisorMes: 210 }, // franja vigente hoy
] as const;

/* ───────── Recargo dominical y festivo — Ley 2466/2025 (reforma laboral) ───────── */

/**
 * Art. 14 de la Ley 2466 de 2025 modificó el Art. 179 CST: el trabajo en día de
 * descanso obligatorio o festivo se remunera con recargo del 100 %, aplicable de
 * forma GRADUAL. El 75 % del texto original del Art. 179 dejó de regir el
 * 1-jul-2025.
 *
 * Liquidar un domingo con la franja equivocada genera salarios insolutos e
 * indemnización moratoria (Art. 65 CST), por eso la tabla se conserva completa:
 * una liquidación retroactiva DEBE usar la franja de la fecha en que se trabajó.
 *
 * Fuente: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676
 *         https://actualicese.com/liquidador-reforma-laboral-2025-valor-del-trabajo-en-dias-de-descanso-dominicales-y-festivos/
 */
export const RECARGO_DOMINICAL_GRADUALIDAD = [
  { desde: '1950-08-05', recargo: 0.75, norma: 'Art. 179 CST (texto original)' },
  { desde: '2025-07-01', recargo: 0.8, norma: 'Ley 2466/2025 art. 14 — gradualidad' },
  { desde: '2026-07-01', recargo: 0.9, norma: 'Ley 2466/2025 art. 14 — gradualidad' }, // vigente hoy
  { desde: '2027-07-01', recargo: 1.0, norma: 'Ley 2466/2025 art. 14 — plena aplicación' },
] as const;

/* ───────────── ARL — Decreto 1772/1994 art. 13 (compilado Dec. 1072/2015) ───────────── */

/**
 * Tabla de cotización de riesgos laborales. Tres valores por clase:
 *  - `inicial`: el que cotiza TODA empresa que ingresa al sistema y el que se
 *    mantiene mientras no haya reclasificación (es el valor por defecto).
 *  - `minimo` / `maximo`: extremos alcanzables solo tras variación del monto de
 *    cotización por siniestralidad (Decreto 1772/1994 arts. 12 y 13).
 *
 * OJO: el Decreto 1607/2002 es la tabla de CLASIFICACIÓN de actividades
 * económicas, no la de tarifas. La tarifa la fija el Decreto 1772/1994.
 *
 * Fuente: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=8803
 *         https://www.arlsura.com/index.php/decretos/130-decreto-1772-agosto-3-de-1994
 * Vigencia: sin modificación en 2026.
 */
export const ARL_TARIFAS = {
  I: { minimo: 0.00348, inicial: 0.00522, maximo: 0.00696 },
  II: { minimo: 0.00435, inicial: 0.01044, maximo: 0.01653 },
  III: { minimo: 0.00783, inicial: 0.02436, maximo: 0.04089 },
  IV: { minimo: 0.0174, inicial: 0.0435, maximo: 0.0696 },
  V: { minimo: 0.03219, inicial: 0.0696, maximo: 0.087 },
} as const;

/* ─────────── Exoneración de aportes — Art. 114-1 E.T. ─────────── */

/**
 * La exoneración del Art. 114-1 E.T. es CONJUNTA: cubre a la vez el aporte a
 * SALUD a cargo del empleador (8,5 %), SENA (2 %) e ICBF (3 %), por cada
 * trabajador que devengue individualmente MENOS de 10 SMMLV. No es posible
 * exonerar SENA/ICBF y seguir cobrando el 8,5 % de salud.
 *
 * NO están exonerados: pensión (12 %), ARL y caja de compensación (Ley 21/1982).
 *
 * Beneficiarios: sociedades y personas jurídicas contribuyentes declarantes de
 * renta, y personas naturales empleadoras con DOS O MÁS trabajadores. Quedan por
 * fuera, entre otros, la persona natural con un solo trabajador y las entidades
 * no contribuyentes de renta.
 *
 * Norma: Art. 114-1 E.T. (adicionado por la Ley 1819/2016, antecedente Ley
 * 1607/2012, ajustes Ley 2010/2019).
 * Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_7163_2019.htm
 *         https://www.gerencie.com/exoneracion-de-aportes-a-seguridad-social-y-parafiscales.html
 * Vigencia: vigente en 2026 sin modificación.
 */
export const EXONERACION_114_1 = {
  umbralSMMLV: 10,
  /** Comparación estricta: exonera a quien devengue MENOS de 10 SMMLV. */
  comparacion: 'menor_estricto',
  exonera: ['salud_empleador', 'sena', 'icbf'],
  noExonera: ['pension_empleador', 'arl', 'ccf'],
  beneficiarios:
    'Sociedades y personas jurídicas declarantes de renta; personas naturales empleadoras con 2 o más trabajadores.',
} as const;

/* ────────────────────────── Cifras del año ────────────────────────── */

export const NORMATIVA_2026 = {
  // Decreto 1469/2025 (29-dic-2025). El Consejo de Estado lo suspendió
  // provisionalmente en feb-2026 y el Gobierno ratificó las mismas cifras con el
  // Decreto transitorio 0159 del 19-feb-2026.
  SMMLV: 1_750_905,
  AUX_TRANSPORTE: 249_095, // Decreto 1470/2025
  TOTAL_MINIMO: 2_000_000, // SMMLV + auxilio

  // Ley 2101/2021: 42 h/semana desde el 15-jul-2026 (antes 44 h).
  JORNADA_SEMANAL: 42,
  /** Divisor mensual vigente hoy = (42 / 6) × 30. Ver JORNADA_GRADUALIDAD. */
  HORAS_MES: 210,
  /** SMMLV / 210 = $8.337,6 → $8.338. Coincide con las tablas publicadas 2026. */
  HORA_ORDINARIA: 8_338,

  LIM_AUX_TRANSPORTE: 3_501_810, // 2 SMMLV — Art. 2 Decreto 1470/2025
  /** 10 SMMLV — umbral de la exoneración del Art. 114-1 E.T. (salud + SENA + ICBF). */
  LIM_EXENTO_PARAFISCAL: 17_509_050,

  // Resolución DIAN 000238 del 15-12-2025 (Art. 868 E.T.; IPC ingresos medios
  // 01-oct-2024 → 01-oct-2025 certificado por el DANE en 5,17 %).
  // Vigencia: 01-ene-2026 a 31-dic-2026. La UVT 2025 era $49.799 (Res. 000193/2024).
  UVT: 52_374,

  PILA: {
    salud: { empleador: 0.085, empleado: 0.04 }, // Ley 100/1993 Art.204 — 8,5% exonerable (Art.114-1 E.T.)
    pension: { empleador: 0.12, empleado: 0.04 }, // Ley 100/1993 Art.20
    /** Valor INICIAL clase I, Decreto 1772/1994 art. 13. El 0,348% es el mínimo por reclasificación. */
    arlClaseI: { empleador: ARL_TARIFAS.I.inicial, empleado: 0 },
    ccf: { empleador: 0.04, empleado: 0 }, // Ley 21/1982 — NO exonerada
    sena: { empleador: 0.02, empleado: 0, exentoBajo10SMMLV: true }, // Art. 114-1 E.T.
    icbf: { empleador: 0.03, empleado: 0, exentoBajo10SMMLV: true }, // Art. 114-1 E.T.
  },

  /**
   * Valores PILA al SMMLV, 30 días (para verificación rápida).
   * Empleador con exoneración del Art. 114-1 E.T. (caso por defecto del módulo):
   *   pensión 12 % + ARL 0,522 % + CCF 4 % = 16,522 % × 1.750.905 = $289.285.
   * Empleador SIN exoneración: 30,022 % × 1.750.905 = $525.657
   *   (salud 8,5 % + pensión 12 % + ARL 0,522 % + CCF 4 % + SENA 2 % + ICBF 3 %).
   * Empleado: salud 4 % + pensión 4 % = 8 % × 1.750.905 = $140.072.
   */
  PILA_AL_SMMLV: {
    empleadorTotal: 289_285,
    empleadorTotalSinExoneracion: 525_657,
    empleadoTotal: 140_072,
  },

  /**
   * Recargos que NO cambian con la reforma laboral.
   * El dominical/festivo vive en RECARGO_DOMINICAL_GRADUALIDAD porque es
   * escalonado; los combinados (dominical nocturno, extras en dominical) los
   * deriva `recargosVigentes()` en calc.ts sumando el dominical de la fecha.
   */
  RECARGOS: {
    heDiurna: 0.25, // Art. 168 CST — hora extra diurna
    heNocturna: 0.75, // Art. 168 CST — hora extra nocturna
    // Art. 168 CST. Ley 2466/2025 art. 10 movió la jornada nocturna a las
    // 7:00 p.m. (antes 9:00 p.m.) desde el 25-dic-2025; el porcentaje sigue en 35 %.
    recargoNocturno: 0.35,
  },

  /**
   * Provisión mensual de prestaciones — base = salario + auxilio = $2.000.000
   * (vacaciones solo sobre salario).
   */
  PRESTACIONES: {
    primaMensual: 166_667, // 30 días de salario/año · Art. 306 CST mod. Ley 1788/2016
    cesantiasMensual: 166_667, // 1 mes de salario/año · Art. 249 CST · Ley 50/1990
    // 12 % ANUAL sobre el saldo de cesantías (Ley 52/1975 art. 1): la provisión
    // mensual es 12 % de la cesantía causada en el mes = $166.667 × 0,12.
    interesesCesMensual: 20_000,
    vacacionesMensual: 72_954, // 15 días hábiles/año · Art. 186 CST (solo salario)
    totalMensual: 426_288,
  },

  /**
   * Costo real del empleado al mínimo, con exoneración del Art. 114-1 E.T.:
   * $2.000.000 devengado + $289.285 PILA empleador + $426.288 provisiones.
   */
  COSTO_REAL_EMPLEADO_MES: 2_715_573,
} as const;

export type Normativa2026 = typeof NORMATIVA_2026;
