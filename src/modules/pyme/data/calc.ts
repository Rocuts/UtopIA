/**
 * Lógica de cálculo de nómina y liquidación — Contabilidad Pyme.
 * Funciones puras sobre NORMATIVA_2026. Sin estado, sin efectos.
 *
 * Se ubica en `data/` (capa de datos = constantes + cálculos derivados) para
 * respetar el alcance de 3 directorios del módulo (components/ design/ data/).
 *
 * Las normas escalonadas (recargo dominical de la Ley 2466/2025, jornada de la
 * Ley 2101/2021) se resuelven POR FECHA: una liquidación retroactiva debe usar
 * la franja vigente el día en que se causó el hecho, no la de hoy.
 *
 * Verificación normativa: 7 de agosto de 2026.
 */
import {
  NORMATIVA_2026 as N,
  JORNADA_GRADUALIDAD,
  RECARGO_DOMINICAL_GRADUALIDAD,
  EXONERACION_114_1,
} from './normativa2026';

/**
 * 10 SMMLV — umbral de la exoneración del Art. 114-1 E.T.
 * Cubre CONJUNTAMENTE salud a cargo del empleador (8,5 %), SENA (2 %) e ICBF (3 %).
 */
export const DIEZ_SMMLV = N.SMMLV * EXONERACION_114_1.umbralSMMLV;

/* ─────────────────────── Resolución por fecha ─────────────────────── */

export type FechaLike = Date | string;

/** `YYYY-MM-DD` en hora local (evita el corrimiento de `toISOString()` en UTC-5). */
function aISO(fecha: FechaLike = new Date()): string {
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Última franja de la tabla cuyo `desde` ya se cumplió en `fecha`. */
function franjaVigente<T extends { readonly desde: string }>(
  tabla: readonly T[],
  fecha?: FechaLike,
): T {
  const iso = aISO(fecha);
  let elegida = tabla[0];
  for (const f of tabla) if (f.desde <= iso) elegida = f;
  return elegida;
}

/**
 * Recargo por trabajo en domingo o festivo vigente en `fecha`.
 * Ley 2466/2025 art. 14 (mod. Art. 179 CST): 80 % desde el 1-jul-2025,
 * 90 % desde el 1-jul-2026, 100 % desde el 1-jul-2027. Antes: 75 %.
 */
export function recargoDominicalVigente(fecha?: FechaLike): number {
  return franjaVigente(RECARGO_DOMINICAL_GRADUALIDAD, fecha).recargo;
}

/** Jornada máxima semanal vigente en `fecha` (Ley 2101/2021). */
export function horasSemanaVigentes(fecha?: FechaLike): number {
  return franjaVigente(JORNADA_GRADUALIDAD, fecha).horasSemana;
}

/**
 * Divisor mensual para obtener el valor de la hora ordinaria a partir del
 * salario MENSUAL: (horas/semana ÷ 6) × 30. 220 hasta el 14-jul-2026,
 * 210 desde el 15-jul-2026.
 */
export function divisorHorasMes(fecha?: FechaLike): number {
  return franjaVigente(JORNADA_GRADUALIDAD, fecha).divisorMes;
}

/** Valor de la hora ordinaria = salario mensual ÷ divisor de la jornada vigente. */
export function horaOrdinaria(salario: number = N.SMMLV, fecha?: FechaLike): number {
  return salario / divisorHorasMes(fecha);
}

/* ───────────────────────── Formato peso/tasa ───────────────────────── */

/** $1.234.567 (entero) o $1.234.567,89 (con decimales). Punto miles, coma decimal. */
export function formatCOP(value: number, decimals = false): string {
  const neg = value < 0;
  const abs = Math.abs(value);
  if (decimals) {
    const [int, dec] = abs.toFixed(2).split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${neg ? '-' : ''}$${intFmt},${dec}`;
  }
  const intFmt = String(Math.round(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}$${intFmt}`;
}

/** 8,5% · 0,522% · 12% — coma decimal, sin ceros sobrantes. */
export function formatRate(frac: number): string {
  const pct = frac * 100;
  const s = Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `${s.replace('.', ',')}%`;
}

/* ───────────────────────────── IBC ───────────────────────────── */

/**
 * IBC = max(SMMLV, salario) × (díasCotizados / 30).
 * El auxilio de transporte NO entra en el IBC.
 */
export function ibc(salario: number, diasCotizados = 30): number {
  return Math.max(N.SMMLV, salario) * (diasCotizados / 30);
}

/* ──────────────────────────── PILA ──────────────────────────── */

export interface PilaEmpleadorDesglose {
  ibc: number;
  salud: number;
  pension: number;
  arl: number;
  ccf: number;
  sena: number;
  icbf: number;
  total: number;
  /**
   * true → aplica la exoneración del Art. 114-1 E.T.: no se pagan salud del
   * empleador (8,5 %), SENA (2 %) ni ICBF (3 %).
   */
  exentoParafiscal: boolean;
}

export interface PilaEmpleadorOpciones {
  /**
   * ¿El empleador es beneficiario del Art. 114-1 E.T.? (sociedad o persona
   * jurídica declarante de renta, o persona natural con 2 o más trabajadores).
   * Por defecto `true`: es el caso típico de la pyme. Si se pone en `false`
   * se pagan salud 8,5 %, SENA 2 % e ICBF 3 % completos.
   */
  exoneradoArt114_1?: boolean;
  /** Tarifa ARL. Por defecto el valor inicial de la clase I (0,522 %). */
  tarifaArl?: number;
}

/**
 * PILA a cargo del empleador.
 *
 * Sin exoneración: IBC × (salud 8,5 % + pensión 12 % + ARL 0,522 % + CCF 4 %
 *   + SENA 2 % + ICBF 3 %) = 30,022 % ⇒ $525.657 al SMMLV (30 días).
 * Con exoneración del Art. 114-1 E.T. (trabajador que devenga MENOS de 10
 *   SMMLV): quedan pensión 12 % + ARL 0,522 % + CCF 4 % = 16,522 % ⇒ $289.285.
 *
 * La exoneración es CONJUNTA (salud del empleador + SENA + ICBF): no existe el
 * caso de exonerar parafiscales y seguir cobrando el 8,5 % de salud.
 * Pensión, ARL y caja de compensación (Ley 21/1982) NUNCA se exoneran.
 *
 * ASUNCIÓN: en el límite exacto de 10 SMMLV los aportes SÍ se pagan (la norma
 * exonera a quien devengue "menos de" 10 SMMLV).
 */
export function pilaEmpleador(
  salario: number,
  diasCotizados = 30,
  opciones: PilaEmpleadorOpciones = {},
): PilaEmpleadorDesglose {
  const { exoneradoArt114_1 = true, tarifaArl = N.PILA.arlClaseI.empleador } = opciones;
  const base = ibc(salario, diasCotizados);
  const p = N.PILA;

  const exentoParafiscal = exoneradoArt114_1 && salario < DIEZ_SMMLV;

  const salud = exentoParafiscal ? 0 : base * p.salud.empleador;
  const sena = exentoParafiscal ? 0 : base * p.sena.empleador;
  const icbf = exentoParafiscal ? 0 : base * p.icbf.empleador;

  const pension = base * p.pension.empleador;
  const arl = base * tarifaArl;
  const ccf = base * p.ccf.empleador;

  const total = salud + pension + arl + ccf + sena + icbf;
  return { ibc: base, salud, pension, arl, ccf, sena, icbf, total, exentoParafiscal };
}

export interface PilaEmpleadoDesglose {
  ibc: number;
  salud: number;
  pension: number;
  total: number;
}

/** PILA empleado = IBC × (salud 4% + pensión 4%) = IBC × 8%. Al SMMLV ⇒ $140.072. */
export function pilaEmpleado(salario: number, diasCotizados = 30): PilaEmpleadoDesglose {
  const base = ibc(salario, diasCotizados);
  const salud = base * N.PILA.salud.empleado;
  const pension = base * N.PILA.pension.empleado;
  return { ibc: base, salud, pension, total: salud + pension };
}

/* ─────────────────────────── Recargos ─────────────────────────── */

export interface RecargosVigentes {
  /** Hora extra diurna, Art. 168 CST. */
  heDiurna: number;
  /** Hora extra nocturna, Art. 168 CST. */
  heNocturna: number;
  /** Recargo nocturno (no es hora extra), Art. 168 CST. Jornada nocturna 7 p.m.–6 a.m. */
  recargoNocturno: number;
  /** Dominical/festivo diurno, Art. 179 CST mod. Ley 2466/2025 — escalonado. */
  dominicalDiurno: number;
  /** Dominical nocturno = dominical + 35 %. Hoy 125 %. */
  dominicalNocturno: number;
  /** Hora extra diurna en dominical = dominical + 25 %. Hoy 115 %. */
  heDominicalDiurna: number;
  /** Hora extra nocturna en dominical = dominical + 75 %. Hoy 165 %. */
  heDominicalNocturna: number;
}

/**
 * Recargos vigentes en `fecha`. Los combinados se derivan sumando el recargo
 * dominical de la franja (Ley 2466/2025) con el recargo del Art. 168 CST.
 * Al 7-ago-2026: dominical 90 %, dominical nocturno 125 %, extra diurna
 * dominical 115 %, extra nocturna dominical 165 %.
 */
export function recargosVigentes(fecha?: FechaLike): RecargosVigentes {
  const dominicalDiurno = recargoDominicalVigente(fecha);
  const { heDiurna, heNocturna, recargoNocturno } = N.RECARGOS;
  return {
    heDiurna,
    heNocturna,
    recargoNocturno,
    dominicalDiurno,
    dominicalNocturno: dominicalDiurno + recargoNocturno,
    heDominicalDiurna: dominicalDiurno + heDiurna,
    heDominicalNocturna: dominicalDiurno + heNocturna,
  };
}

export interface RecargoHoraTarifas {
  extraDiurna: number;
  extraNocturna: number;
  nocturna: number;
  dominicalDiurna: number;
  dominicalNocturna: number;
  extraDominicalDiurna: number;
  extraDominicalNocturna: number;
}

/**
 * Tarifas de referencia POR HORA (lo que vale la hora ya recargada) = hora × (1 + factor).
 * Al SMMLV y a 7-ago-2026 (hora ordinaria $8.338): extra diurna $10.423,
 * extra nocturna $14.592, nocturna $11.256, dominical diurna $15.842,
 * dominical nocturna $18.761, extra diurna dominical $17.927,
 * extra nocturna dominical $22.096.
 */
export function recargosHora(fecha?: FechaLike, salario: number = N.SMMLV): RecargoHoraTarifas {
  const hora = horaOrdinaria(salario, fecha);
  const r = recargosVigentes(fecha);
  return {
    extraDiurna: hora * (1 + r.heDiurna),
    extraNocturna: hora * (1 + r.heNocturna),
    nocturna: hora * (1 + r.recargoNocturno),
    dominicalDiurna: hora * (1 + r.dominicalDiurno),
    dominicalNocturna: hora * (1 + r.dominicalNocturno),
    extraDominicalDiurna: hora * (1 + r.heDominicalDiurna),
    extraDominicalNocturna: hora * (1 + r.heDominicalNocturna),
  };
}

/** Tarifas al SMMLV vigentes hoy (las que muestra la pantalla «Cifras 2026»). */
export const RECARGO_HORA: RecargoHoraTarifas = recargosHora();

/** Hora extra diurna = horaOrdinaria × 1.25 (valor pagado por hora). */
export function horaExtraDiurna(fecha?: FechaLike, salario: number = N.SMMLV): number {
  return horaOrdinaria(salario, fecha) * (1 + N.RECARGOS.heDiurna);
}
/** Hora extra nocturna = horaOrdinaria × 1.75. */
export function horaExtraNocturna(fecha?: FechaLike, salario: number = N.SMMLV): number {
  return horaOrdinaria(salario, fecha) * (1 + N.RECARGOS.heNocturna);
}
/** Recargo nocturno = horaOrdinaria × 0.35 (sobre la hora, NO es hora extra). */
export function recargoNocturno(fecha?: FechaLike, salario: number = N.SMMLV): number {
  return horaOrdinaria(salario, fecha) * N.RECARGOS.recargoNocturno;
}

/**
 * Recargo por un día dominical o festivo trabajado = (salario / 30) × recargo
 * vigente en la fecha del domingo trabajado (90 % desde el 1-jul-2026,
 * Ley 2466/2025 art. 14; 80 % entre el 1-jul-2025 y el 30-jun-2026).
 * Es solo el RECARGO: el salario ordinario del día se paga aparte (Art. 179 CST).
 */
export function dominicalDiurnoDia(salario: number, fecha?: FechaLike): number {
  return (salario / 30) * recargoDominicalVigente(fecha);
}

/* ───────────────────────── Incapacidad ───────────────────────── */

export interface IncapacidadComun {
  diasEmpleador: number;
  diasEps: number;
  pagaEmpleador: number;
  pagaEps: number;
  total: number;
}

/**
 * Incapacidad por enfermedad común al 66,67% del salario diario:
 * días 1-2 los paga el empleador; día 3+ la EPS.
 * (Para accidente laboral / ATEL NO se calcula aquí — la UI muestra aviso.)
 */
export function incapacidadComun(salario: number, dias: number): IncapacidadComun {
  const diario = salario / 30;
  const tasa = 0.6667;
  const diasEmpleador = Math.min(Math.max(dias, 0), 2);
  const diasEps = Math.max(0, dias - 2);
  const pagaEmpleador = diario * tasa * diasEmpleador;
  const pagaEps = diario * tasa * diasEps;
  return { diasEmpleador, diasEps, pagaEmpleador, pagaEps, total: pagaEmpleador + pagaEps };
}

/* ─────────────────── Auxilio de transporte y provisiones ─────────────────── */

/** Auxilio de transporte: aplica si el salario ≤ 2 SMMLV; si no, $0. */
export function auxTransporteAplicable(salario: number): number {
  return salario <= N.LIM_AUX_TRANSPORTE ? N.AUX_TRANSPORTE : 0;
}

export interface ProvisionesDesglose {
  prima: number;
  cesantias: number;
  intereses: number;
  vacaciones: number;
  total: number;
}

/** Tasa anual de intereses a las cesantías — Ley 52/1975 art. 1. */
export const TASA_INTERESES_CESANTIAS = 0.12;

/**
 * Provisión mensual de prestaciones (lo que el patrón debe ir guardando).
 * Cada componente se redondea antes de sumar para empatar con los valores
 * normativos publicados (al SMMLV + auxilio ⇒ total $426.288).
 *   prima      = (salario+aux) / 12          · 30 días/año, Art. 306 CST mod. Ley 1788/2016
 *   cesantías  = (salario+aux) / 12          · 1 mes/año, Art. 249 CST · Ley 50/1990
 *   intereses  = cesantías del mes × 12 %    · Ley 52/1975 art. 1 (12 % ANUAL sobre el saldo)
 *   vacaciones = salario / 24                · 15 días hábiles/año, Art. 186 CST (solo salario)
 *
 * OJO: los intereses son el 12 % del saldo, no el 1 % del saldo. Al mínimo son
 * $20.000/mes ($240.000/año). Provisionar de menos deja al empleador sin caja el
 * 31 de enero y activa la sanción de la Ley 52/1975 art. 1 num. 3 (una suma
 * adicional igual a los intereses debidos, por una sola vez).
 */
export function provisionesMensuales(salario: number, auxTransporte: number): ProvisionesDesglose {
  const base = salario + auxTransporte;
  const prima = Math.round(base / 12);
  const cesantias = Math.round(base / 12);
  const intereses = Math.round((base / 12) * TASA_INTERESES_CESANTIAS);
  const vacaciones = Math.round(salario / 24);
  return { prima, cesantias, intereses, vacaciones, total: prima + cesantias + intereses + vacaciones };
}

/* ──────────────────── Neto y costo real ──────────────────── */

/** Neto empleado = totalDevengado − PILA empleado − otros descuentos. */
export function netoEmpleado(
  totalDevengado: number,
  salario: number,
  diasCotizados = 30,
  otrosDescuentos = 0,
): number {
  return totalDevengado - pilaEmpleado(salario, diasCotizados).total - otrosDescuentos;
}

/** Costo real empleado = totalDevengado + PILA empleador (+ provisiones, para dashboard). */
export function costoRealEmpleado(
  totalDevengado: number,
  salario: number,
  diasCotizados = 30,
  provisiones = 0,
): number {
  return totalDevengado + pilaEmpleador(salario, diasCotizados).total + provisiones;
}

/* ─────────────────────── Liquidación ─────────────────────── */

export type CausaTerminacion =
  | 'renuncia'
  | 'mutuo_acuerdo'
  | 'justa_causa'
  | 'despido_sin_justa_causa';

export interface LiquidacionInput {
  salario: number;
  auxTransporte: number;
  /** Antigüedad total liquidable, en días. */
  diasTotales: number;
  causa: CausaTerminacion;
  /** Base de cesantías sobre la que corren intereses. Por defecto = cesantías del período. */
  cesantiasPendientes?: number;
  /**
   * Días del año en curso sobre los que corren los intereses de cesantías.
   * Por defecto min(diasTotales, 360): los intereses son 12 % ANUAL y nunca
   * superan el 12 % del saldo en un mismo período (Ley 52/1975 art. 1).
   */
  diasIntereses?: number;
}

export interface LiquidacionResultado {
  cesantias: number;
  interesesCesantias: number;
  primaProporcional: number;
  vacaciones: number;
  indemnizacion: number;
  total: number;
  /** Solo el despido sin justa causa genera indemnización (Art. 64 CST). */
  tieneIndemnizacion: boolean;
}

/**
 * Liquidación definitiva.
 *   Cesantías          = (salario+aux) × díasTotales / 360      · Art. 249 CST · Ley 50/1990
 *   Intereses cesantías= cesantíasPendientes × 12 % × días/360  · Ley 52/1975 art. 1
 *   Prima proporcional = (salario+aux) × díasTotales / 360      · Art. 306 CST mod. Ley 1788/2016
 *   Vacaciones         = salario × díasTotales / 720            · Art. 186 CST (15 días hábiles/año)
 *
 * La prima de servicios equivale a TREINTA (30) días de salario por año,
 * reconocidos en dos pagos de 15 días. Los 15 días del semestre NO son "medio
 * salario al año": la proporcional se liquida con la misma base anual de 30 días
 * que las cesantías, sin factor 0,5.
 *
 * Indemnización por despido sin justa causa en contrato a término indefinido
 * (Art. 64 CST, mod. Ley 789/2002 art. 28), proporcional por fracción:
 *   salario < 10 SMMLV → 30 días por el primer año + 20 días por año adicional
 *   salario ≥ 10 SMMLV → 20 días por el primer año + 15 días por año adicional
 *
 * ASUNCIÓN: salario diario = salario / 30; intereses sobre las cesantías del
 * período cuando no se pasa `cesantiasPendientes`; el contrato es a término
 * indefinido (en término fijo u obra labor la indemnización es el salario del
 * tiempo faltante, que este módulo no calcula).
 */
export function liquidacion(input: LiquidacionInput): LiquidacionResultado {
  const { salario, auxTransporte, diasTotales, causa } = input;
  const base = salario + auxTransporte;
  const diario = salario / 30;

  const cesantias = (base * diasTotales) / 360;
  const baseIntereses = input.cesantiasPendientes ?? cesantias;
  const diasIntereses = input.diasIntereses ?? Math.min(diasTotales, 360);
  const interesesCesantias = baseIntereses * TASA_INTERESES_CESANTIAS * (diasIntereses / 360);
  const primaProporcional = (base * diasTotales) / 360;
  const vacaciones = (salario * diasTotales) / 720;

  const tieneIndemnizacion = causa === 'despido_sin_justa_causa';
  let indemnizacion = 0;
  if (tieneIndemnizacion) {
    // Art. 64 CST: el tramo depende de si el salario llega a 10 SMMLV.
    const diasPrimerAnio = salario < DIEZ_SMMLV ? 30 : 20;
    const diasPorAnioAdicional = salario < DIEZ_SMMLV ? 20 : 15;
    if (diasTotales <= 360) {
      indemnizacion = diario * diasPrimerAnio;
    } else {
      const aniosAdicionalesDias = diasTotales - 360;
      indemnizacion =
        diario * (diasPrimerAnio + diasPorAnioAdicional * (aniosAdicionalesDias / 360));
    }
  }

  const total = cesantias + interesesCesantias + primaProporcional + vacaciones + indemnizacion;
  return {
    cesantias,
    interesesCesantias,
    primaProporcional,
    vacaciones,
    indemnizacion,
    total,
    tieneIndemnizacion,
  };
}
