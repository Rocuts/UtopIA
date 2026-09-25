/**
 * Calculadora de Sanciones e Intereses Tributarios — Colombia
 *
 * Implementa los cálculos del Estatuto Tributario colombiano:
 * - Sanción por extemporaneidad (Art. 641 E.T., incisos 1º/2º/3º — con los
 *   topes de 5% ingresos / 10% patrimonio / doble saldo a favor / 2.500 UVT)
 * - Sanción por extemporaneidad posterior al emplazamiento (Art. 642 E.T. —
 *   10% mensual, tope 200%; 1% ingresos / 2% patrimonio; 4× saldo a favor /
 *   5.000 UVT)
 * - Sanción por corrección (Art. 644 E.T. nums. 1 y 2 — el hito 10%→20% es el
 *   EMPLAZAMIENTO PARA CORREGIR del Art. 685 E.T., no el requerimiento especial;
 *   antes del vencimiento del plazo no hay sanción; par. 1 suma 5% por mes de
 *   extemporaneidad de la declaración inicial)
 * - Gradualidad de las sanciones que liquida el propio contribuyente
 *   (Art. 640 nums. 1 y 2 E.T.: reducción al 50% / 75%), con el mínimo del
 *   Art. 639 aplicado DESPUÉS de reducir ("incluidas las sanciones reducidas").
 * - Sanción por inexactitud (Art. 647 E.T.) con reducciones Arts. 640, 709 y 713 E.T.
 * - Intereses moratorios (Arts. 634 y 635 E.T.) — INTERÉS SIMPLE liquidado día a día
 *   (Art. 635 E.T. mod. Art. 279 Ley 1819/2016; Concepto DIAN 013463 de 2023).
 *
 * UVT 2026 = $52.374 COP (Resolución DIAN 000238 del 15-dic-2025).
 *
 * APROXIMACIONES (obligatorias, no cosméticas):
 * - Art. 868 E.T. inciso final lit. c): todo valor absoluto derivado de la UVT
 *   se aproxima al múltiplo de mil más cercano cuando supera $10.000. Por eso
 *   la sanción mínima 2026 es $524.000 y no $523.740 (DIAN Concepto 65791/2013).
 * - Art. 577 E.T.: los valores diligenciados en las declaraciones tributarias
 *   se aproximan al múltiplo de mil más cercano.
 *
 * IMPORTANTE — tasa de interés:
 * El Art. 635 E.T. exige aplicar la "tasa de usura menos 2 puntos porcentuales"
 * vigente para el MES de la mora (certificada mensualmente por la
 * Superintendencia Financiera de Colombia). Sin `annualRate` se usa la del mes
 * de liquidación (hora de Colombia) si está en TASA_USURA_CERTIFICADA —marcada
 * con `tasaPorDefectoUsada: true`—; si el mes no está registrado los intereses
 * son N/D (SanctionInputError con el motivo).
 */

const UVT_2026 = 52_374;

/**
 * Aproximación de valores absolutos expresados en UVT — Art. 868 E.T., inciso
 * final (procedimiento de aproximaciones), vigente desde la Ley 1111 de 2006:
 *   a) se prescinde de fracciones de peso (entero más próximo) hasta $100;
 *   b) múltiplo de CIEN más cercano entre $100 y $10.000;
 *   c) múltiplo de MIL más cercano cuando el resultado supere $10.000.
 * Doctrina concordante: DIAN Concepto 65791 del 16-10-2013.
 *
 * Todo valor absoluto derivado de la UVT (sanción mínima, topes en UVT) DEBE
 * pasar por aquí antes de presentarse al usuario; de lo contrario la cifra no
 * es diligenciable en el formulario DIAN.
 */
export function aproximarValorAbsolutoUvt(valor: number): number {
  const entero = Math.round(valor);
  const abs = Math.abs(entero);
  if (abs <= 100) return entero;
  if (abs <= 10_000) return Math.round(entero / 100) * 100;
  return Math.round(entero / 1_000) * 1_000;
}

/**
 * Aproximación de los valores diligenciados en las declaraciones tributarias —
 * Art. 577 E.T.: se aproximan al múltiplo de mil (1.000) más cercano; la
 * fracción igual o superior a $500 sube al múltiplo de mil siguiente.
 * Vigente 2026. Aplica a las sanciones e intereses que el contribuyente
 * liquida en el formulario.
 */
export function aproximarValorDeclaracion(valor: number): number {
  return Math.round(valor / 1_000) * 1_000;
}

/**
 * Sanción mínima — Art. 639 E.T.: 10 UVT.
 * 10 × $52.374 = $523.740 → aproximado por Art. 868 lit. c) a $524.000 (2026).
 * UVT 2026: Resolución DIAN 000238 del 15-dic-2025.
 */
const MIN_SANCTION_UVT = 10;
export const MIN_SANCTION = aproximarValorAbsolutoUvt(MIN_SANCTION_UVT * UVT_2026); // $524.000 COP

/**
 * Tope absoluto de la sanción por extemporaneidad cuando NO existe saldo a
 * favor — Art. 641 E.T., incisos 2º y 3º: 2.500 UVT.
 * 2.500 × $52.374 = $130.935.000 (2026).
 */
const TOPE_EXTEMPORANEIDAD_UVT = 2_500;
const TOPE_EXTEMPORANEIDAD = aproximarValorAbsolutoUvt(TOPE_EXTEMPORANEIDAD_UVT * UVT_2026); // $130.935.000

/**
 * Tope absoluto de la sanción por extemporaneidad POSTERIOR al emplazamiento
 * cuando NO existe saldo a favor — Art. 642 E.T., inciso 2º: 5.000 UVT.
 * 5.000 × $52.374 = $261.870.000 (2026).
 */
const TOPE_EXTEMPORANEIDAD_POST_EMPLAZAMIENTO_UVT = 5_000;
const TOPE_EXTEMPORANEIDAD_POST_EMPLAZAMIENTO = aproximarValorAbsolutoUvt(
  TOPE_EXTEMPORANEIDAD_POST_EMPLAZAMIENTO_UVT * UVT_2026,
); // $261.870.000

/**
 * Tasa de usura certificada por la Superintendencia Financiera (E.A., %) por
 * MES, con su fuente. Art. 635 E.T. (mod. Art. 279 Ley 1819/2016): el interés
 * de mora tributario es la tasa de usura vigente MENOS 2 puntos porcentuales,
 * y cambia cada mes.
 *
 * Sólo se registran meses con fuente verificada. Fase 2 de la auditoría
 * 2026-09-24 (tributario-calc-18): antes un único fallback de AGOSTO de 2026
 * se aplicaba en cualquier mes; ahora un mes sin tasa registrada da N/D (la
 * calculadora no produce cifra y pide `annualRate`). Para añadir un mes, citar
 * la resolución de la Superfinanciera que certifica la usura.
 */
export const TASA_USURA_CERTIFICADA: Readonly<Record<string, { usuraEA: number; fuente: string }>> = {
  '2026-08': { usuraEA: 29.66, fuente: 'Res. Superfinanciera 1139 del 31-jul-2026' },
};

/** Puntos porcentuales que el Art. 635 E.T. resta a la tasa de usura. */
const PUNTOS_MENOS_USURA = 2;

export interface TasaMoratoriaMes {
  mes: string;
  /** Tasa de interés moratorio E.A. (%) = usura − 2 pp. */
  tasaEA: number;
  usuraEA: number;
  fuente: string;
}

/** Tasa de mora del mes `YYYY-MM` (usura certificada − 2 pp) o `null` si no está registrada. */
export function tasaMoratoriaDelMes(mes: string): TasaMoratoriaMes | null {
  const t = TASA_USURA_CERTIFICADA[mes];
  if (!t) return null;
  return {
    mes,
    usuraEA: t.usuraEA,
    tasaEA: Math.round((t.usuraEA - PUNTOS_MENOS_USURA) * 100) / 100,
    fuente: t.fuente,
  };
}

/** Mes calendario `YYYY-MM` en hora de Colombia (America/Bogota), no la del servidor. */
export function mesColombia(fecha: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(fecha);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

/** Tipos de sanción soportados. Fuente única para los contratos de entrada. */
export const SANCTION_TYPES = [
  'extemporaneidad',                    // Art. 641 E.T.
  'extemporaneidad_post_emplazamiento', // Art. 642 E.T.
  'correccion',                         // Art. 644 E.T.
  'inexactitud',                        // Art. 647 E.T.
  'intereses_moratorios',               // Arts. 634 y 635 E.T.
] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];

export const INEXACTITUD_REDUCTIONS = [
  'none',            // Liquidación oficial firme — sanción plena 100%
  'art_713_half',    // Art. 713 E.T.: reducción a la mitad por aceptación frente a la liquidación de revisión
  'art_709_quarter', // Art. 709 E.T.: reducción a la cuarta parte por aceptación en respuesta al requerimiento especial
  'art_640_50',      // Art. 640 num. 3 E.T.: sanción reducida AL 50% por gradualidad (sin antecedentes 4 años)
  'art_640_75',      // Art. 640 num. 4 E.T.: sanción reducida AL 75% por gradualidad (sin antecedentes 2 años)
] as const;
export type InexactitudReduction = (typeof INEXACTITUD_REDUCTIONS)[number];

/**
 * Hito procesal que determina la tarifa de la sanción por corrección —
 * Art. 644 E.T., numerales 1 y 2 (en concordancia con el Art. 685 E.T.).
 * El hito NO es el requerimiento especial: es el EMPLAZAMIENTO PARA CORREGIR
 * (o el auto que ordene visita de inspección tributaria). Antes del
 * vencimiento del plazo para declarar la corrección no genera la sanción del
 * Art. 644: el num. 1 sólo grava la corrección "después del vencimiento del
 * plazo para declarar" (mod. art. 285 Ley 1819/2016).
 */
export const CORRECCION_STAGES = [
  'antes_vencimiento',     // Antes del vencimiento del plazo — sin sanción Art. 644
  'antes_emplazamiento',   // Art. 644 num. 1 E.T. — 10%
  'despues_emplazamiento', // Art. 644 num. 2 E.T. — 20%
] as const;
export type CorreccionStage = (typeof CORRECCION_STAGES)[number];

/**
 * Gradualidad de las sanciones que liquida el propio contribuyente —
 * Art. 640 E.T. (mod. art. 282 Ley 1819/2016):
 *   '50' — num. 1: sin la misma conducta en los 2 años anteriores;
 *   '75' — num. 2: sin la misma conducta en el año anterior;
 * en ambos casos siempre que la DIAN no haya proferido pliego de cargos,
 * requerimiento especial o emplazamiento previo por no declarar (lit. b).
 * Sólo el usuario puede afirmar esos hechos: sin ellos la sanción es plena.
 */
export const REDUCCIONES_640 = ['50', '75'] as const;
export type Reduccion640 = (typeof REDUCCIONES_640)[number];

export interface SanctionCalculation {
  type: SanctionType;
  taxDue?: number;
  grossIncome?: number;
  /** Patrimonio líquido del año inmediatamente anterior — Art. 641 inciso 3º E.T. */
  netEquityPriorYear?: number;
  /** Saldo a favor de la declaración, si lo hubiere — altera el tope del Art. 641 E.T. */
  saldoAFavor?: number;
  difference?: number;
  delayMonths?: number;
  /**
   * Hito procesal del Art. 644 E.T. Autoritativo cuando se suministra.
   * Preferir sobre `isVoluntary`, que es una simplificación binaria heredada.
   */
  correccionStage?: CorreccionStage;
  /**
   * LEGADO. `true` se interpreta como "antes del emplazamiento para corregir"
   * (10%) y `false` como "después del emplazamiento o del auto de inspección"
   * (20%) — Art. 644 nums. 1 y 2 E.T. Se ignora si viene `correccionStage`.
   */
  isVoluntary?: boolean;
  /**
   * Meses o fracción de mes entre el vencimiento del plazo y la presentación
   * de la declaración INICIAL, cuando ésta fue extemporánea — Art. 644 par. 1
   * E.T. (+5% del mayor valor por mes, total ≤ 100%). Sólo para corrección.
   */
  mesesExtemporaneidadInicial?: number;
  /** Gradualidad del Art. 640 nums. 1-2 E.T. — extemporaneidad (Art. 641) y corrección. */
  reduccion640?: Reduccion640;
  /** Reducciones aplicables Art. 647 — Arts. 640 / 709 ET. */
  inexactitudReduction?: InexactitudReduction;
  principal?: number;
  /** Tasa de usura - 2pp vigente (efectiva anual, %). Ver Art. 635 ET. */
  annualRate?: number;
  days?: number;
}

/**
 * Lista de campos de entrada. Los contratos (tool LLM, API REST, Realtime)
 * se construyen y se prueban contra ella: un campo que la función usa pero un
 * contrato no transmite es un tope o una rama del E.T. que nunca se activa.
 */
export const SANCTION_INPUT_FIELDS = [
  'type',
  'taxDue',
  'grossIncome',
  'netEquityPriorYear',
  'saldoAFavor',
  'difference',
  'delayMonths',
  'correccionStage',
  'isVoluntary',
  'mesesExtemporaneidadInicial',
  'reduccion640',
  'inexactitudReduction',
  'principal',
  'annualRate',
  'days',
] as const satisfies ReadonlyArray<keyof SanctionCalculation>;
export type SanctionInputField = (typeof SANCTION_INPUT_FIELDS)[number];

/** Falla la compilación si `SanctionCalculation` gana un campo que la lista no tiene. */
type AssertNever<T extends never> = T;
export type SanctionInputFieldsExhaustive = AssertNever<
  Exclude<keyof SanctionCalculation, SanctionInputField>
>;

/**
 * Entrada tolerante: los contratos hacia el LLM usan `null` para "no aplica"
 * (strict mode). `calculateSanction` normaliza `null` a ausente.
 */
export type SanctionCalculationInput = { type: SanctionType } & {
  [K in Exclude<SanctionInputField, 'type'>]?: SanctionCalculation[K] | null;
};

/** Entrada contradictoria (p. ej. corrección "antes del vencimiento" de una declaración extemporánea). */
export class SanctionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanctionInputError';
  }
}

export interface SanctionResult {
  type: string;
  amount: number;
  amountFormatted: string;
  formula: string;
  article: string;
  explanation: string;
  recommendations: string[];
  details: Record<string, string | number | boolean>;
}

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Parámetros de la sanción por extemporaneidad. Los Arts. 641 y 642 E.T.
 * comparten estructura (tres ramas excluyentes) y difieren sólo en tarifas y
 * topes; el Art. 642 aplica cuando la declaración se presenta DESPUÉS del
 * emplazamiento previo por no declarar (Art. 715 E.T.).
 */
interface ReglaExtemporaneidad {
  articulo: string;
  tipo: string;
  tasaImpuesto: number;
  topeImpuesto: number;
  tasaIngresos: number;
  topeIngresos: number;
  tasaPatrimonio: number;
  topePatrimonio: number;
  multiploSaldoAFavor: number;
  topeUvt: number;
  topeUvtCop: number;
  /** Art. 640 nums. 1-2 lit. b): no hay gradualidad si ya hubo emplazamiento. */
  admiteReduccion640: boolean;
}

const REGLA_ART_641: ReglaExtemporaneidad = {
  articulo: 'Art. 641 E.T.',
  tipo: 'Sancion por Extemporaneidad',
  tasaImpuesto: 0.05,
  topeImpuesto: 1,
  tasaIngresos: 0.005,
  topeIngresos: 0.05,
  tasaPatrimonio: 0.01,
  topePatrimonio: 0.1,
  multiploSaldoAFavor: 2,
  topeUvt: TOPE_EXTEMPORANEIDAD_UVT,
  topeUvtCop: TOPE_EXTEMPORANEIDAD,
  admiteReduccion640: true,
};

const REGLA_ART_642: ReglaExtemporaneidad = {
  articulo: 'Art. 642 E.T.',
  tipo: 'Sancion por Extemporaneidad posterior al Emplazamiento',
  tasaImpuesto: 0.1,
  topeImpuesto: 2,
  tasaIngresos: 0.01,
  topeIngresos: 0.1,
  tasaPatrimonio: 0.02,
  topePatrimonio: 0.2,
  multiploSaldoAFavor: 4,
  topeUvt: TOPE_EXTEMPORANEIDAD_POST_EMPLAZAMIENTO_UVT,
  topeUvtCop: TOPE_EXTEMPORANEIDAD_POST_EMPLAZAMIENTO,
  admiteReduccion640: false,
};

const FACTOR_REDUCCION_640: Record<Reduccion640, number> = { '50': 0.5, '75': 0.75 };

const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;

/**
 * Gradualidad del Art. 640 nums. 1-2 E.T. sobre una sanción que liquida el
 * contribuyente. Devuelve el monto reducido y el texto explicativo; el mínimo
 * del Art. 639 se aplica después, sobre el monto reducido.
 */
function aplicarReduccion640(
  amount: number,
  reduccion: Reduccion640 | undefined,
  admite: boolean,
): { amount: number; nota: string; aplicada: Reduccion640 | 'none' } {
  if (!reduccion) return { amount, nota: '', aplicada: 'none' };
  if (!admite) {
    return {
      amount,
      aplicada: 'none',
      nota:
        ' No se aplica la reducción del Art. 640 E.T. solicitada: sus numerales 1 y 2 ' +
        'exigen que la Administración no haya proferido pliego de cargos, requerimiento ' +
        'especial o emplazamiento previo por no declarar (lit. b), y esta sanción parte ' +
        'precisamente de un emplazamiento.',
    };
  }
  const factor = FACTOR_REDUCCION_640[reduccion];
  const reducida = amount * factor;
  const numeral = reduccion === '50' ? '1' : '2';
  const periodo = reduccion === '50' ? 'los dos (2) años anteriores' : 'el año (1) anterior';
  return {
    amount: reducida,
    aplicada: reduccion,
    nota:
      ` Gradualidad Art. 640 num. ${numeral} E.T.: la sanción se reduce al ${reduccion}% ` +
      `(${formatCOP(amount)} → ${formatCOP(reducida)}), condicionada a que el contribuyente no ` +
      `haya cometido la misma conducta en ${periodo} y a que la DIAN no haya proferido pliego ` +
      `de cargos, requerimiento especial ni emplazamiento previo por no declarar.`,
  };
}

/**
 * Sancion por extemporaneidad — Art. 641 E.T. (tres ramas excluyentes) y
 * Art. 642 E.T. (misma estructura, posterior al emplazamiento).
 *
 * Art. 641 inciso 1º — con impuesto a cargo:
 *   5% del impuesto a cargo por mes o fraccion de mes, sin exceder el 100%
 *   del impuesto a cargo.
 *
 * Art. 641 inciso 2º — sin impuesto a cargo pero con ingresos brutos:
 *   0,5% de los ingresos brutos por mes o fraccion, "sin exceder la cifra
 *   MENOR resultante de aplicar el 5% a dichos ingresos, o del doble del
 *   saldo a favor si lo hubiere, o de la suma de 2.500 UVT cuando no
 *   existiere saldo a favor".
 *
 * Art. 641 inciso 3º — sin ingresos en el periodo:
 *   1% del patrimonio liquido del ano inmediatamente anterior por mes o
 *   fraccion, sin exceder la cifra MENOR entre el 10% de dicho patrimonio,
 *   el doble del saldo a favor si lo hubiere, o 2.500 UVT cuando no
 *   existiere saldo a favor.
 *
 * Art. 642: 10% (tope 200%) / 1% de ingresos (tope 10%, 4× saldo a favor o
 * 5.000 UVT) / 2% del patrimonio (tope 20%, 4× saldo a favor o 5.000 UVT).
 *
 * Topes 2026: 2.500 UVT = $130.935.000; 5.000 UVT = $261.870.000
 * (UVT $52.374, Res. DIAN 000238/2025).
 * Sancion minima: 10 UVT = $524.000 (Arts. 639 y 868 lit. c] E.T.), aplicada
 * despues de la gradualidad del Art. 640.
 */
function calcExtemporaneidad(
  params: SanctionCalculation,
  regla: ReglaExtemporaneidad = REGLA_ART_641,
): SanctionResult {
  const {
    taxDue = 0,
    grossIncome = 0,
    netEquityPriorYear = 0,
    saldoAFavor = 0,
    delayMonths = 1,
  } = params;
  const months = Math.max(1, Math.ceil(delayMonths));
  const art = regla.articulo;

  let amount: number;
  let formula: string;
  let explanation: string;
  let capApplied: number | null = null;
  let capLabel = '';

  /**
   * Tope alterno de las ramas sin impuesto a cargo: el doble (Art. 641) o
   * cuatro veces (Art. 642) el saldo a favor si lo hubiere; 2.500 / 5.000 UVT
   * cuando NO existiere saldo a favor.
   */
  const topeSaldo = saldoAFavor * regla.multiploSaldoAFavor;
  const topeAlterno = saldoAFavor > 0 ? topeSaldo : regla.topeUvtCop;
  const topeAlternoLabel =
    saldoAFavor > 0
      ? `${regla.multiploSaldoAFavor} x saldo a favor (${formatCOP(topeSaldo)})`
      : `${new Intl.NumberFormat('es-CO').format(regla.topeUvt)} UVT (${formatCOP(regla.topeUvtCop)})`;

  if (taxDue > 0) {
    const rawAmount = taxDue * regla.tasaImpuesto * months;
    const maxAmount = taxDue * regla.topeImpuesto;
    capApplied = maxAmount;
    capLabel = `${pct(regla.topeImpuesto)} del impuesto a cargo (${formatCOP(maxAmount)})`;
    amount = Math.min(rawAmount, maxAmount);
    formula =
      `min(${formatCOP(taxDue)} x ${pct(regla.tasaImpuesto)} x ${months} meses, ` +
      `${formatCOP(maxAmount)} [tope ${pct(regla.topeImpuesto)}])`;
    explanation =
      `Con un impuesto a cargo de ${formatCOP(taxDue)} y ${months} mes(es) de retraso, ` +
      `la sancion se calcula al ${pct(regla.tasaImpuesto)} mensual sobre el impuesto a cargo (${art}). ` +
      (rawAmount > maxAmount
        ? `El calculo bruto (${formatCOP(rawAmount)}) excede el tope del ${pct(regla.topeImpuesto)}, por lo que se aplica el maximo de ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else if (grossIncome > 0) {
    const rawAmount = grossIncome * regla.tasaIngresos * months;
    const capPct = grossIncome * regla.topeIngresos;
    const maxAmount = Math.min(capPct, topeAlterno);
    capApplied = maxAmount;
    capLabel =
      maxAmount === capPct
        ? `${pct(regla.topeIngresos)} de los ingresos brutos (${formatCOP(capPct)})`
        : topeAlternoLabel;
    amount = Math.min(rawAmount, maxAmount);
    formula =
      `min(${formatCOP(grossIncome)} x ${pct(regla.tasaIngresos)} x ${months} meses, ` +
      `min[${pct(regla.topeIngresos)} ingresos = ${formatCOP(capPct)}, ${topeAlternoLabel}])`;
    explanation =
      `Sin impuesto a cargo, se aplica el ${pct(regla.tasaIngresos)} mensual sobre los ingresos brutos de ${formatCOP(grossIncome)} ` +
      `(${art}, rama sin impuesto a cargo). Con ${months} mes(es) de retraso el calculo bruto es ${formatCOP(rawAmount)}. ` +
      `El tope legal es la cifra MENOR entre el ${pct(regla.topeIngresos)} de los ingresos (${formatCOP(capPct)}) y ${topeAlternoLabel}, ` +
      `es decir ${formatCOP(maxAmount)}. ` +
      (rawAmount > maxAmount
        ? `El calculo bruto excede ese tope, por lo que la sancion queda en ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else if (netEquityPriorYear > 0) {
    // Rama sin ingresos en el periodo.
    const rawAmount = netEquityPriorYear * regla.tasaPatrimonio * months;
    const capPct = netEquityPriorYear * regla.topePatrimonio;
    const maxAmount = Math.min(capPct, topeAlterno);
    capApplied = maxAmount;
    capLabel =
      maxAmount === capPct
        ? `${pct(regla.topePatrimonio)} del patrimonio liquido (${formatCOP(capPct)})`
        : topeAlternoLabel;
    amount = Math.min(rawAmount, maxAmount);
    formula =
      `min(${formatCOP(netEquityPriorYear)} x ${pct(regla.tasaPatrimonio)} x ${months} meses, ` +
      `min[${pct(regla.topePatrimonio)} patrimonio = ${formatCOP(capPct)}, ${topeAlternoLabel}])`;
    explanation =
      `Sin impuesto a cargo y sin ingresos en el periodo, la sancion es del ${pct(regla.tasaPatrimonio)} mensual sobre el ` +
      `patrimonio liquido del ano inmediatamente anterior (${formatCOP(netEquityPriorYear)}), ` +
      `conforme al ${art} (rama sin ingresos). Con ${months} mes(es) de retraso el calculo bruto es ` +
      `${formatCOP(rawAmount)}. El tope legal es la cifra MENOR entre el ${pct(regla.topePatrimonio)} del patrimonio ` +
      `(${formatCOP(capPct)}) y ${topeAlternoLabel}, es decir ${formatCOP(maxAmount)}. ` +
      (rawAmount > maxAmount
        ? `El calculo bruto excede ese tope, por lo que la sancion queda en ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else {
    amount = MIN_SANCTION;
    formula = `Sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation =
      'Sin impuesto a cargo, sin ingresos brutos y sin patrimonio liquido del ano anterior ' +
      'reportados, se aplica la sancion minima de 10 UVT (Art. 639 E.T.). Si la empresa si ' +
      'tuvo patrimonio liquido en el ano anterior, suministre `netEquityPriorYear`: la rama ' +
      `sin ingresos del ${art} puede arrojar una sancion muy superior a la minima.`;
  }

  // Gradualidad del Art. 640 nums. 1-2 (sanción liquidada por el contribuyente).
  const sancionPlena = amount;
  const reduccion = aplicarReduccion640(amount, params.reduccion640, regla.admiteReduccion640);
  amount = reduccion.amount;
  explanation += reduccion.nota;
  if (reduccion.aplicada !== 'none') {
    formula += ` x ${reduccion.aplicada}% [Art. 640 E.T.]`;
  }

  // Sancion minima — Art. 639 E.T. ("incluidas las sanciones reducidas").
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    formula += ` -> Ajustado a sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation += ` Nota: El valor calculado es inferior a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}), por lo que se aplica el minimo (Art. 639 E.T., incluidas las sanciones reducidas).`;
  }

  // Art. 577 E.T. — los valores de las declaraciones se aproximan al mil.
  const amountRaw = amount;
  amount = aproximarValorDeclaracion(amount);

  const recommendations =
    regla === REGLA_ART_641
      ? [
          'Presente la declaracion lo antes posible para minimizar la sancion.',
          'Si el contribuyente no cometio la misma conducta en los 2 anos anteriores (o en el ano anterior) y la DIAN no ha proferido pliego de cargos, requerimiento especial ni emplazamiento previo por no declarar, la sancion se reduce al 50% (o al 75%) — Art. 640 nums. 1 y 2 E.T. Confirme esos hechos antes de aplicar la reduccion.',
          'Considere solicitar facilidades de pago si el monto es significativo (Art. 814 E.T.).',
          'Recuerde que la sancion se liquida por cada mes o fraccion de mes calendario de retardo.',
          'Sin impuesto a cargo, la sancion nunca excede la cifra MENOR entre el porcentaje de la base, el doble del saldo a favor y 2.500 UVT ($130.935.000 en 2026) — Art. 641 incisos 2º y 3º E.T.',
        ]
      : [
          'Con emplazamiento previo por no declarar ya notificado, la sancion es la del Art. 642 E.T. (10% mensual, tope 200%). Presente la declaracion dentro del plazo del emplazamiento para evitar la sancion por no declarar (Art. 643 E.T.).',
          'La gradualidad del Art. 640 nums. 1 y 2 no procede cuando ya existe emplazamiento previo por no declarar (lit. b).',
          'Considere solicitar facilidades de pago si el monto es significativo (Art. 814 E.T.).',
          'Sin impuesto a cargo, la sancion nunca excede la cifra MENOR entre el porcentaje de la base, cuatro veces el saldo a favor y 5.000 UVT ($261.870.000 en 2026) — Art. 642 E.T.',
        ];

  return {
    type: regla.tipo,
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article:
      regla === REGLA_ART_641
        ? 'Art. 641 del Estatuto Tributario (incisos 1º, 2º y 3º)' +
          (reduccion.aplicada !== 'none' ? '; gradualidad Art. 640 E.T.' : '')
        : 'Art. 642 del Estatuto Tributario (extemporaneidad posterior al emplazamiento)',
    explanation,
    recommendations,
    details: {
      taxDue,
      grossIncome,
      netEquityPriorYear,
      saldoAFavor,
      delayMonths: months,
      capApplied: capApplied ?? 0,
      capLabel,
      topeUvtCop: regla.topeUvtCop,
      tope2500Uvt: TOPE_EXTEMPORANEIDAD,
      sancionPlena,
      reduccion640: reduccion.aplicada,
      amountBeforeRounding: amountRaw,
      minSanction: MIN_SANCTION,
      uvt2026: UVT_2026,
    },
  };
}

/**
 * Sancion por correccion — Art. 644 E.T., numerales 1 y 2.
 *
 * Antes del vencimiento del plazo para declarar — sin sanción: el num. 1
 *   (mod. art. 285 Ley 1819/2016) sólo grava la corrección realizada
 *   "después del vencimiento del plazo para declarar".
 *
 * num. 1 — 10% del mayor valor a pagar o del menor saldo a favor: cuando la
 *   correccion se realiza DESPUES del vencimiento del plazo para declarar y
 *   ANTES de que se notifique el EMPLAZAMIENTO PARA CORREGIR (Art. 685 E.T.)
 *   o el auto que ordene visita de inspeccion tributaria.
 *
 * num. 2 — 20%: cuando la correccion se realiza DESPUES de notificado el
 *   emplazamiento para corregir o el auto de inspeccion tributaria, y antes
 *   de notificarse el requerimiento especial o el pliego de cargos.
 *
 * El hito que dispara el 20% es el EMPLAZAMIENTO, NO el requerimiento
 * especial: entre uno y otro existe una ventana real en la que la tarifa ya
 * es del 20%. Liquidar 10% en esa ventana hace rechazable la correccion.
 *
 * Par. 1 — si la declaración inicial fue extemporánea, la sanción aumenta en
 *   5% del mayor valor por cada mes o fracción entre el vencimiento del plazo
 *   y la presentación de la declaración inicial, sin exceder el 100%.
 * Par. 3 — la base NO incluye la propia sanción por corrección.
 * Gradualidad: Art. 640 nums. 1-2 E.T. (sanción liquidada por el contribuyente).
 * Sancion minima: 10 UVT (Art. 639 E.T.), aplicada después de reducir.
 */
function calcCorreccion(params: SanctionCalculation): SanctionResult {
  const { difference = 0, correccionStage, isVoluntary = true } = params;
  const mesesInicial = Math.max(0, Math.ceil(params.mesesExtemporaneidadInicial ?? 0));

  // `correccionStage` es autoritativo; `isVoluntary` es el legado binario.
  const stage: CorreccionStage =
    correccionStage ?? (isVoluntary ? 'antes_emplazamiento' : 'despues_emplazamiento');

  if (stage === 'antes_vencimiento') {
    if (mesesInicial > 0) {
      throw new SanctionInputError(
        'Entrada contradictoria: una declaración inicial extemporánea no puede corregirse ' +
          'antes del vencimiento del plazo para declarar. Indique el hito de la corrección ' +
          '(antes_emplazamiento / despues_emplazamiento).',
      );
    }
    return {
      type: 'Sancion por Correccion',
      amount: 0,
      amountFormatted: formatCOP(0),
      formula: 'Correccion antes del vencimiento del plazo para declarar: sin sancion (Art. 644 num. 1 E.T.)',
      article: 'Art. 644 del Estatuto Tributario (num. 1, mod. art. 285 Ley 1819/2016)',
      explanation:
        'La sancion por correccion del Art. 644 E.T. solo se causa cuando la correccion se realiza ' +
        'DESPUES del vencimiento del plazo para declarar (num. 1). Una correccion presentada antes ' +
        'de ese vencimiento no genera sancion por correccion, y la sancion minima del Art. 639 no ' +
        'aplica porque no hay sancion que liquidar. Si la correccion aumenta el valor a pagar, el ' +
        'pago debe hacerse dentro del plazo para evitar intereses moratorios.',
      recommendations: [
        'Confirme la fecha de vencimiento del plazo para declarar segun el ultimo digito del NIT (sin DV).',
        'Si la correccion se presenta despues del vencimiento, la sancion es del 10% del mayor valor (Art. 644 num. 1 E.T.).',
      ],
      details: {
        difference,
        correccionStage: stage,
        hito: 'antes del vencimiento del plazo para declarar',
        rate: '0%',
        amountBeforeRounding: 0,
        minSanction: MIN_SANCTION,
      },
    };
  }

  const antesEmplazamiento = stage === 'antes_emplazamiento';

  const rate = antesEmplazamiento ? 0.10 : 0.20;
  const rateLabel = antesEmplazamiento ? '10%' : '20%';
  const context = antesEmplazamiento
    ? 'correccion presentada DESPUES del vencimiento del plazo y ANTES de que se notifique el emplazamiento para corregir (Art. 685 E.T.) o el auto que ordene visita de inspeccion tributaria — Art. 644 num. 1 E.T.'
    : 'correccion presentada DESPUES de notificado el emplazamiento para corregir o el auto de inspeccion tributaria, y antes del requerimiento especial o pliego de cargos — Art. 644 num. 2 E.T.';

  // Par. 1 — incremento por extemporaneidad de la declaración inicial.
  const incremento = 0.05 * mesesInicial;
  const tasaTotal = Math.min(rate + incremento, 1);
  const rawAmount = Math.round(difference * tasaTotal);
  let amount = rawAmount;
  let formula =
    mesesInicial > 0
      ? `${formatCOP(difference)} x min(${rateLabel} + 5% x ${mesesInicial} meses [Art. 644 par. 1], 100%) = ${formatCOP(rawAmount)}`
      : `${formatCOP(difference)} x ${rateLabel} = ${formatCOP(rawAmount)}`;

  let explanation =
    `Para una ${context}, la sancion es del ${rateLabel} sobre la mayor diferencia ` +
    `a pagar (o menor saldo a favor) de ${formatCOP(difference)}` +
    (mesesInicial > 0
      ? `, aumentada en 5% por cada uno de los ${mesesInicial} mes(es) de extemporaneidad de la declaracion inicial ` +
        `(Art. 644 par. 1 E.T.), sin exceder el 100% del mayor valor`
      : '') +
    `: ${formatCOP(rawAmount)}. ` +
    `La base NO incluye la propia sancion por correccion (Art. 644 paragrafo 3 E.T.).`;

  // Gradualidad del Art. 640 nums. 1-2 (sanción liquidada por el contribuyente).
  const sancionPlena = amount;
  const reduccion = aplicarReduccion640(amount, params.reduccion640, true);
  amount = Math.round(reduccion.amount);
  explanation += reduccion.nota;
  if (reduccion.aplicada !== 'none') {
    formula += ` x ${reduccion.aplicada}% [Art. 640 E.T.] = ${formatCOP(amount)}`;
  }

  let minApplied = false;
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    minApplied = true;
    explanation += ` Ajustado a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}) — Art. 639 E.T., incluidas las sanciones reducidas.`;
  }

  // Art. 577 E.T. — aproximacion al multiplo de mil mas cercano.
  const amountBeforeRounding = amount;
  amount = aproximarValorDeclaracion(amount);

  return {
    type: 'Sancion por Correccion',
    amount,
    amountFormatted: formatCOP(amount),
    formula: minApplied
      ? `${formula} -> Ajustado a sancion minima: ${formatCOP(MIN_SANCTION)}`
      : formula,
    article:
      'Art. 644 del Estatuto Tributario (nums. 1 y 2, en concordancia con el Art. 685 E.T.)' +
      (reduccion.aplicada !== 'none' ? '; gradualidad Art. 640 E.T.' : ''),
    explanation,
    recommendations: antesEmplazamiento
      ? [
          'Mientras la DIAN no notifique el EMPLAZAMIENTO PARA CORREGIR (Art. 685 E.T.) ni un auto de inspeccion tributaria, la tarifa es del 10%. Proceda cuanto antes: la notificacion del emplazamiento la eleva al 20%.',
          'Verifique en el buzon electronico / notificaciones DIAN que no exista emplazamiento ni auto de inspeccion ya notificado antes de liquidar al 10%.',
          'Asegurese de corregir TODOS los errores identificados para evitar un requerimiento especial posterior.',
          'Conserve copia de la declaracion original y de la correccion como soporte.',
          'Si no cometio la misma conducta en los 2 anos anteriores (o en el ano anterior) y la DIAN no ha proferido pliego de cargos ni requerimiento especial, la sancion se reduce al 50% (o al 75%) — Art. 640 nums. 1 y 2 E.T.',
        ]
      : [
          'Con emplazamiento para corregir o auto de inspeccion ya notificado, la tarifa es del 20% (Art. 644 num. 2 E.T.) — liquidar el 10% hace rechazable la correccion.',
          'Presente la correccion antes de que se notifique el requerimiento especial o el pliego de cargos; despues de ese hito ya no procede el Art. 644 sino la sancion por inexactitud (Art. 647 E.T.).',
          'Responda dentro del plazo legal para evitar sanciones adicionales.',
          'Documente exhaustivamente los soportes de la correccion.',
        ],
    details: {
      difference,
      correccionStage: stage,
      isVoluntary: antesEmplazamiento,
      hito: antesEmplazamiento
        ? 'antes del emplazamiento para corregir (Art. 685 E.T.) o auto de inspeccion'
        : 'despues del emplazamiento para corregir o auto de inspeccion, antes del requerimiento especial',
      rate: rateLabel,
      mesesExtemporaneidadInicial: mesesInicial,
      tasaTotal: pct(tasaTotal),
      sancionPlena,
      reduccion640: reduccion.aplicada,
      amountBeforeRounding,
      minSanction: MIN_SANCTION,
    },
  };
}

/**
 * Sanción por inexactitud — Art. 647 E.T.
 *
 * Base: 100% del mayor valor a pagar o menor saldo a favor.
 *
 * Reducciones aplicables (se aplican sobre la base del 100%):
 *   - Art. 709 E.T.: a la CUARTA PARTE (25%) si se aceptan los hechos en
 *     respuesta al requerimiento especial o su ampliación.
 *   - Art. 713 E.T.: a la MITAD (50%) si se aceptan los hechos dentro del
 *     término para recurrir la liquidación oficial de revisión.
 *   - Art. 640 E.T. (gradualidad): la sanción se reduce AL 50% (sin
 *     antecedentes del mismo tipo en 4 años) o AL 75% (sin antecedentes
 *     en 2 años) cuando la impone la DIAN.
 *
 * Sanción mínima: 10 UVT (Art. 639 E.T.).
 */
function calcInexactitud(params: SanctionCalculation): SanctionResult {
  const { difference = 0, inexactitudReduction = 'none' } = params;

  // Base: 100% de la diferencia (Art. 647 inciso 1º E.T.)
  const base = difference;

  // Factor de reducción sobre la base del 100%
  const reductionMap: Record<InexactitudReduction, { factor: number; label: string; article: string }> = {
    none:           { factor: 1.00, label: '100% (plena)',                 article: 'Art. 647 E.T.' },
    art_713_half:   { factor: 0.50, label: '50% (reducida a la mitad)',    article: 'Art. 713 E.T.' },
    art_709_quarter:{ factor: 0.25, label: '25% (reducida a la cuarta parte)', article: 'Art. 709 E.T.' },
    art_640_50:     { factor: 0.50, label: 'reducida al 50% por gradualidad', article: 'Art. 640 E.T.' },
    art_640_75:     { factor: 0.75, label: 'reducida al 75% por gradualidad', article: 'Art. 640 E.T.' },
  };
  const { factor, label, article } = reductionMap[inexactitudReduction];

  const rawAmount = Math.round(base * factor);
  let amount = rawAmount;
  const formula = `${formatCOP(base)} x ${label} = ${formatCOP(rawAmount)}`;

  let explanation =
    `La sanción por inexactitud (Art. 647 E.T.) parte de una base del 100% sobre la diferencia ` +
    `de ${formatCOP(difference)}. ` +
    (inexactitudReduction === 'none'
      ? `No se aplica reducción, por lo que la sanción es ${formatCOP(rawAmount)}.`
      : `Se aplica la reducción del ${article} (${label}), resultando en ${formatCOP(rawAmount)}.`);

  let minApplied = false;
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    minApplied = true;
    explanation += ` Ajustado a la sanción mínima de 10 UVT (${formatCOP(MIN_SANCTION)}).`;
  }

  // Art. 577 E.T. — aproximación al múltiplo de mil más cercano.
  const amountBeforeRounding = amount;
  amount = aproximarValorDeclaracion(amount);

  return {
    type: 'Sanción por Inexactitud',
    amount,
    amountFormatted: formatCOP(amount),
    formula: minApplied
      ? `${formula} -> Ajustado a sanción mínima: ${formatCOP(MIN_SANCTION)}`
      : formula,
    article: 'Art. 647 E.T. (con reducciones Arts. 640, 709 y 713 E.T. cuando apliquen)',
    explanation,
    recommendations: [
      'Verifique si la inexactitud se origina en diferencias de criterio interpretativo — el parágrafo del Art. 647 E.T. puede eliminar la sanción en ese caso.',
      'Evalúe Art. 709 E.T.: aceptación de los hechos en respuesta al requerimiento especial reduce la sanción a la cuarta parte (25%).',
      'Evalúe Art. 713 E.T.: aceptación frente a la liquidación oficial de revisión reduce la sanción a la mitad (50%).',
      'Evalúe Art. 640 E.T.: sin antecedentes en 4/2 años la sanción impuesta por la DIAN se reduce al 50%/75%.',
      'Documente exhaustivamente las pruebas que sustentan la cifra declarada originalmente.',
      'Considere conciliación contencioso-administrativa (Art. 101 Ley 2277/2022) si hay litigio en curso.',
    ],
    details: {
      difference,
      inexactitudReduction,
      effectiveRate: label,
      amountBeforeRounding,
      minSanction: MIN_SANCTION,
    },
  };
}

/**
 * Intereses moratorios — Arts. 634 y 635 E.T.
 *
 * Desde la modificación del Art. 635 E.T. por el Art. 279 de la Ley 1819/2016,
 * el interés de mora tributario es SIMPLE: se liquida como la sumatoria de los
 * intereses diarios causados a la tasa de usura vigente menos 2 puntos
 * porcentuales, sin capitalización (fórmula DIAN, Concepto DIAN 013463 de 2023):
 *
 *   Interés = Principal × iEA × d / 365
 *
 * donde:
 *   iEA = (tasa de usura vigente − 2 pp) / 100, expresada como efectiva anual.
 *   d   = número de días de mora.
 *
 * NOTA: la tasa de usura cambia mes a mes (publicada por Superfinanciera).
 * Si la mora cruza varios meses, lo técnicamente correcto es segmentar por
 * mes y aplicar la tasa de cada período; esta función asume una única tasa
 * para simplificar. El caller es responsable de pasar la tasa vigente.
 */
function calcInteresesMoratorios(params: SanctionCalculation, hoy: Date): SanctionResult {
  const { principal = 0, days = 30 } = params;

  // Sin tasa del caller se usa la del MES de liquidación (hora de Colombia) si
  // está registrada con su fuente; si no, N/D: no se reutiliza la de otro mes
  // (tributario-calc-18). La tasa por defecto se marca para que ni el LLM ni la
  // UI la presenten como la tasa de cada mes de la mora.
  const tasaPorDefectoUsada =
    params.annualRate === undefined || params.annualRate === null;
  let tasaMes: TasaMoratoriaMes | null = null;
  if (tasaPorDefectoUsada) {
    const mes = mesColombia(hoy);
    tasaMes = tasaMoratoriaDelMes(mes);
    if (!tasaMes) {
      throw new SanctionInputError(
        `Intereses moratorios N/D: no hay tasa de usura certificada registrada para ${mes}. ` +
          'Indique annualRate = tasa de usura certificada por la Superfinanciera para el mes de la mora ' +
          'menos 2 puntos porcentuales (Art. 635 E.T.); si la mora cruza varios meses, liquide cada mes con su tasa.',
      );
    }
  }
  const annualRate = tasaMes ? tasaMes.tasaEA : params.annualRate!;
  const vigencia = tasaMes
    ? `${tasaMes.mes} (usura ${String(tasaMes.usuraEA).replace('.', ',')}% − 2 pp; ${tasaMes.fuente})`
    : 'n/a';

  const iEA = annualRate / 100;
  // Interés simple diario: iEA × d / 365 (sin capitalización — Art. 635 E.T.)
  const factor = (iEA * days) / 365;
  const amountRaw = Math.round(principal * factor);
  // Art. 577 E.T. — los valores del formulario se aproximan al múltiplo de mil.
  const amount = aproximarValorDeclaracion(amountRaw);
  const dailyRate = (iEA / 365) * 100;

  const formula =
    `${formatCOP(principal)} × ${annualRate}% × ${days} / 365 = ${formatCOP(amount)}`;

  const avisoFallback = tasaPorDefectoUsada
    ? ` ADVERTENCIA — VALOR NO LIQUIDABLE: no se suministró la tasa del período. Se usó la ` +
      `tasa de ${annualRate}% E.A. del mes de liquidación, ${vigencia}. ` +
      `La tasa cambia cada mes; si la mora corresponde a otro mes o cruza varios meses, esta cifra ` +
      `NO puede llevarse a la declaración: reliquide con la tasa certificada por la Superfinanciera ` +
      `para cada mes de la mora, menos 2 puntos porcentuales (Art. 635 E.T.).`
    : '';

  const explanation =
    `Los intereses moratorios se liquidan con INTERÉS SIMPLE diario (Art. 635 E.T. ` +
    `mod. Art. 279 Ley 1819/2016) sobre un capital de ${formatCOP(principal)}, a una tasa efectiva ` +
    `anual del ${annualRate}% (= tasa de usura certificada del mes de la mora − 2 puntos porcentuales). ` +
    `Tasa diaria: ${dailyRate.toFixed(6)}%. Por ${days} días de mora, el factor acumulado es ` +
    `${(factor * 100).toFixed(4)}%, resultando en ${formatCOP(amount)}.` +
    avisoFallback;

  const recommendations = [
    'Los intereses moratorios se causan día a día SIN capitalización (interés simple). Pague lo antes posible para minimizar.',
    'La tasa aplicable es la tasa de usura certificada por la Superfinanciera para el mes de la mora MENOS 2 puntos porcentuales (Art. 635 E.T. mod. Art. 279 Ley 1819/2016) — NO es la tasa de usura a secas.',
    'Si la mora abarca varios meses, aplique la tasa vigente de cada mes por separado — esta función asume una única tasa.',
    'Considere facilidades de pago (Art. 814 E.T.) si el monto total es significativo.',
    'Los intereses se liquidan sobre el impuesto o retención a cargo — NO sobre las sanciones.',
  ];

  if (tasaPorDefectoUsada) {
    // La recomendación de acción queda condicionada: la cifra no está verificada
    // para el período del usuario y no debe alimentar una decisión de pago.
    recommendations.unshift(
      `NO use esta cifra para pagar ni para declarar sin antes confirmar la tasa del período: ` +
        `se calculó con la tasa de ${annualRate}% E.A. de ${vigencia}, ` +
        `no con la tasa certificada de los meses en que efectivamente ocurrió la mora.`,
    );
  }

  return {
    type: 'Intereses Moratorios',
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article: 'Arts. 634 y 635 E.T. (interés simple diario, mod. Art. 279 Ley 1819/2016)',
    explanation,
    recommendations,
    details: {
      principal,
      annualRate,
      tasaPorDefectoUsada,
      tasaFallbackVigencia: vigencia,
      tasaMes: tasaMes ? tasaMes.mes : 'n/a',
      tasaFuente: tasaMes ? tasaMes.fuente : 'n/a',
      dailyRatePct: Number(dailyRate.toFixed(6)),
      days,
      simpleFactorPct: Number((factor * 100).toFixed(4)),
      amountBeforeRounding: amountRaw,
    },
  };
}

/** Normaliza `null` (contratos strict hacia el LLM) a ausente. */
function sinNulos(params: SanctionCalculationInput): SanctionCalculation {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as unknown as SanctionCalculation;
}

/**
 * Main entry point — routes to the appropriate calculator based on type.
 * Acepta `null` en cualquier campo opcional (se trata como ausente).
 */
export function calculateSanction(
  input: SanctionCalculationInput,
  opts: { hoy?: Date } = {},
): SanctionResult {
  const params = sinNulos(input);
  switch (params.type) {
    case 'extemporaneidad':
      return calcExtemporaneidad(params, REGLA_ART_641);
    case 'extemporaneidad_post_emplazamiento':
      return calcExtemporaneidad(params, REGLA_ART_642);
    case 'correccion':
      return calcCorreccion(params);
    case 'inexactitud':
      return calcInexactitud(params);
    case 'intereses_moratorios':
      return calcInteresesMoratorios(params, opts.hoy ?? new Date());
    default:
      throw new SanctionInputError(
        `Tipo de sancion no reconocido: "${(params as unknown as Record<string, unknown>).type}". ` +
        `Tipos validos: ${SANCTION_TYPES.join(', ')}.`
      );
  }
}
