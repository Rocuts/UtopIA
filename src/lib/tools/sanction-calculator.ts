/**
 * Calculadora de Sanciones e Intereses Tributarios — Colombia
 *
 * Implementa los cálculos del Estatuto Tributario colombiano:
 * - Sanción por extemporaneidad (Art. 641 E.T., incisos 1º/2º/3º — con los
 *   topes de 5% ingresos / 10% patrimonio / doble saldo a favor / 2.500 UVT)
 * - Sanción por corrección (Art. 644 E.T. nums. 1 y 2 — el hito 10%→20% es el
 *   EMPLAZAMIENTO PARA CORREGIR del Art. 685 E.T., no el requerimiento especial)
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
 * Superintendencia Financiera de Colombia). El valor por defecto es solo un
 * fallback y el resultado queda marcado con `tasaPorDefectoUsada: true`;
 * en producción el caller DEBE pasar la tasa vigente del período.
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
const MIN_SANCTION = aproximarValorAbsolutoUvt(MIN_SANCTION_UVT * UVT_2026); // $524.000 COP

/**
 * Tope absoluto de la sanción por extemporaneidad cuando NO existe saldo a
 * favor — Art. 641 E.T., incisos 2º y 3º: 2.500 UVT.
 * 2.500 × $52.374 = $130.935.000 (2026).
 */
const TOPE_EXTEMPORANEIDAD_UVT = 2_500;
const TOPE_EXTEMPORANEIDAD = aproximarValorAbsolutoUvt(TOPE_EXTEMPORANEIDAD_UVT * UVT_2026); // $130.935.000

/**
 * Fallback de la tasa de interés moratorio. NO es "la tasa legal del período":
 * el Art. 635 E.T. (mod. Art. 279 Ley 1819/2016) exige la tasa de usura
 * certificada por la Superfinanciera para el MES de la mora, menos 2 puntos
 * porcentuales, y segmentar cuando la mora cruza varios meses.
 *
 * Valor verificado: 27,66% E.A. para AGOSTO DE 2026 = usura 29,66% − 2 pp
 * (Superintendencia Financiera, Resolución 1139 del 31-jul-2026).
 * Vigencia: mensual. Para cualquier otro mes este número es incorrecto, por lo
 * que el resultado se marca con `tasaPorDefectoUsada: true` y la explicación
 * advierte que la cifra no es liquidable sin confirmar la tasa del período.
 */
const DEFAULT_ANNUAL_RATE_EA = 27.66;
const DEFAULT_ANNUAL_RATE_VIGENCIA =
  'agosto de 2026 (usura 29,66% − 2 pp; Res. Superfinanciera 1139 del 31-jul-2026)';

export type InexactitudReduction =
  | 'none'            // Liquidación oficial firme — sanción plena 100%
  | 'art_713_half'    // Art. 713 E.T.: reducción a la mitad por aceptación frente a la liquidación de revisión
  | 'art_709_quarter' // Art. 709 E.T.: reducción a la cuarta parte por aceptación en respuesta al requerimiento especial
  | 'art_640_50'      // Art. 640 E.T.: sanción reducida AL 50% por gradualidad (sin antecedentes 4 años)
  | 'art_640_75';     // Art. 640 E.T.: sanción reducida AL 75% por gradualidad (sin antecedentes 2 años)

/**
 * Hito procesal que determina la tarifa de la sanción por corrección —
 * Art. 644 E.T., numerales 1 y 2 (en concordancia con el Art. 685 E.T.).
 * El hito NO es el requerimiento especial: es el EMPLAZAMIENTO PARA CORREGIR
 * (o el auto que ordene visita de inspección tributaria).
 */
export type CorreccionStage =
  | 'antes_emplazamiento'    // Art. 644 num. 1 E.T. — 10%
  | 'despues_emplazamiento'; // Art. 644 num. 2 E.T. — 20%

export interface SanctionCalculation {
  type: 'extemporaneidad' | 'correccion' | 'inexactitud' | 'intereses_moratorios';
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
  /** Reducciones aplicables Art. 647 — Arts. 640 / 709 ET. */
  inexactitudReduction?: InexactitudReduction;
  principal?: number;
  /** Tasa de usura - 2pp vigente (efectiva anual, %). Ver Art. 635 ET. */
  annualRate?: number;
  days?: number;
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
 * Sancion por extemporaneidad — Art. 641 E.T. (tres ramas excluyentes).
 *
 * Inciso 1º — con impuesto a cargo:
 *   5% del impuesto a cargo por mes o fraccion de mes, sin exceder el 100%
 *   del impuesto a cargo.
 *
 * Inciso 2º — sin impuesto a cargo pero con ingresos brutos:
 *   0,5% de los ingresos brutos por mes o fraccion, "sin exceder la cifra
 *   MENOR resultante de aplicar el 5% a dichos ingresos, o del doble del
 *   saldo a favor si lo hubiere, o de la suma de 2.500 UVT cuando no
 *   existiere saldo a favor".
 *
 * Inciso 3º — sin ingresos en el periodo:
 *   1% del patrimonio liquido del ano inmediatamente anterior por mes o
 *   fraccion, sin exceder la cifra MENOR entre el 10% de dicho patrimonio,
 *   el doble del saldo a favor si lo hubiere, o 2.500 UVT cuando no
 *   existiere saldo a favor.
 *
 * Topes 2026: 2.500 UVT = $130.935.000 (UVT $52.374, Res. DIAN 000238/2025).
 * Sancion minima: 10 UVT = $524.000 (Arts. 639 y 868 lit. c] E.T.).
 */
function calcExtemporaneidad(params: SanctionCalculation): SanctionResult {
  const {
    taxDue = 0,
    grossIncome = 0,
    netEquityPriorYear = 0,
    saldoAFavor = 0,
    delayMonths = 1,
  } = params;
  const months = Math.max(1, Math.ceil(delayMonths));

  let amount: number;
  let formula: string;
  let explanation: string;
  let capApplied: number | null = null;
  let capLabel = '';

  /**
   * Tope alterno del Art. 641 incisos 2º y 3º: el doble del saldo a favor si
   * lo hubiere; 2.500 UVT cuando NO existiere saldo a favor.
   */
  const topeAlterno = saldoAFavor > 0 ? saldoAFavor * 2 : TOPE_EXTEMPORANEIDAD;
  const topeAlternoLabel =
    saldoAFavor > 0
      ? `2 x saldo a favor (${formatCOP(saldoAFavor * 2)})`
      : `2.500 UVT (${formatCOP(TOPE_EXTEMPORANEIDAD)})`;

  if (taxDue > 0) {
    const rawAmount = taxDue * 0.05 * months;
    const maxAmount = taxDue; // tope 100% del impuesto a cargo — Art. 641 inciso 1º
    capApplied = maxAmount;
    capLabel = `100% del impuesto a cargo (${formatCOP(maxAmount)})`;
    amount = Math.min(rawAmount, maxAmount);
    formula = `min(${formatCOP(taxDue)} x 5% x ${months} meses, ${formatCOP(taxDue)} [tope 100%])`;
    explanation =
      `Con un impuesto a cargo de ${formatCOP(taxDue)} y ${months} mes(es) de retraso, ` +
      `la sancion se calcula al 5% mensual sobre el impuesto a cargo (Art. 641 inciso 1º E.T.). ` +
      (rawAmount > maxAmount
        ? `El calculo bruto (${formatCOP(rawAmount)}) excede el tope del 100%, por lo que se aplica el maximo de ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else if (grossIncome > 0) {
    const rawAmount = grossIncome * 0.005 * months;
    // Tope = MENOR entre 5% de ingresos brutos y el tope alterno (2x saldo a
    // favor, o 2.500 UVT si no hay saldo a favor) — Art. 641 inciso 2º E.T.
    const cap5pct = grossIncome * 0.05;
    const maxAmount = Math.min(cap5pct, topeAlterno);
    capApplied = maxAmount;
    capLabel =
      maxAmount === cap5pct
        ? `5% de los ingresos brutos (${formatCOP(cap5pct)})`
        : topeAlternoLabel;
    amount = Math.min(rawAmount, maxAmount);
    formula =
      `min(${formatCOP(grossIncome)} x 0.5% x ${months} meses, ` +
      `min[5% ingresos = ${formatCOP(cap5pct)}, ${topeAlternoLabel}])`;
    explanation =
      `Sin impuesto a cargo, se aplica el 0.5% mensual sobre los ingresos brutos de ${formatCOP(grossIncome)} ` +
      `(Art. 641 inciso 2º E.T.). Con ${months} mes(es) de retraso el calculo bruto es ${formatCOP(rawAmount)}. ` +
      `El tope legal es la cifra MENOR entre el 5% de los ingresos (${formatCOP(cap5pct)}) y ${topeAlternoLabel}, ` +
      `es decir ${formatCOP(maxAmount)}. ` +
      (rawAmount > maxAmount
        ? `El calculo bruto excede ese tope, por lo que la sancion queda en ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else if (netEquityPriorYear > 0) {
    // Art. 641 inciso 3º E.T. — sin ingresos en el periodo.
    const rawAmount = netEquityPriorYear * 0.01 * months;
    const cap10pct = netEquityPriorYear * 0.10;
    const maxAmount = Math.min(cap10pct, topeAlterno);
    capApplied = maxAmount;
    capLabel =
      maxAmount === cap10pct
        ? `10% del patrimonio liquido (${formatCOP(cap10pct)})`
        : topeAlternoLabel;
    amount = Math.min(rawAmount, maxAmount);
    formula =
      `min(${formatCOP(netEquityPriorYear)} x 1% x ${months} meses, ` +
      `min[10% patrimonio = ${formatCOP(cap10pct)}, ${topeAlternoLabel}])`;
    explanation =
      `Sin impuesto a cargo y sin ingresos en el periodo, la sancion es del 1% mensual sobre el ` +
      `patrimonio liquido del ano inmediatamente anterior (${formatCOP(netEquityPriorYear)}), ` +
      `conforme al Art. 641 inciso 3º E.T. Con ${months} mes(es) de retraso el calculo bruto es ` +
      `${formatCOP(rawAmount)}. El tope legal es la cifra MENOR entre el 10% del patrimonio ` +
      `(${formatCOP(cap10pct)}) y ${topeAlternoLabel}, es decir ${formatCOP(maxAmount)}. ` +
      (rawAmount > maxAmount
        ? `El calculo bruto excede ese tope, por lo que la sancion queda en ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else {
    amount = MIN_SANCTION;
    formula = `Sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation =
      'Sin impuesto a cargo, sin ingresos brutos y sin patrimonio liquido del ano anterior ' +
      'reportados, se aplica la sancion minima de 10 UVT (Art. 639 E.T.). Si la empresa si ' +
      'tuvo patrimonio liquido en el ano anterior, suministre `netEquityPriorYear`: la rama del ' +
      'Art. 641 inciso 3º puede arrojar una sancion muy superior a la minima.';
  }

  // Sancion minima — Art. 639 E.T.
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    formula += ` -> Ajustado a sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation += ` Nota: El valor calculado es inferior a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}), por lo que se aplica el minimo.`;
  }

  // Art. 577 E.T. — los valores de las declaraciones se aproximan al mil.
  const amountRaw = amount;
  amount = aproximarValorDeclaracion(amount);

  return {
    type: 'Sancion por Extemporaneidad',
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article: 'Art. 641 del Estatuto Tributario (incisos 1º, 2º y 3º)',
    explanation,
    recommendations: [
      'Presente la declaracion lo antes posible para minimizar la sancion.',
      'Verifique si aplica alguna reduccion del Art. 640 E.T. por ausencia de antecedentes.',
      'Considere solicitar facilidades de pago si el monto es significativo (Art. 814 E.T.).',
      'Recuerde que la sancion se liquida por cada mes o fraccion de mes calendario de retardo.',
      'Sin impuesto a cargo, la sancion nunca excede la cifra MENOR entre el porcentaje de la base, el doble del saldo a favor y 2.500 UVT ($130.935.000 en 2026) — Art. 641 incisos 2º y 3º E.T.',
    ],
    details: {
      taxDue,
      grossIncome,
      netEquityPriorYear,
      saldoAFavor,
      delayMonths: months,
      capApplied: capApplied ?? 0,
      capLabel,
      tope2500Uvt: TOPE_EXTEMPORANEIDAD,
      amountBeforeRounding: amountRaw,
      minSanction: MIN_SANCTION,
      uvt2026: UVT_2026,
    },
  };
}

/**
 * Sancion por correccion — Art. 644 E.T., numerales 1 y 2.
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
 * Vigencia: sin cambios para 2026.
 *
 * La base excluye la propia sancion del Art. 644 (paragrafo 1º).
 * Sancion minima: 10 UVT (Art. 639 E.T.).
 */
function calcCorreccion(params: SanctionCalculation): SanctionResult {
  const { difference = 0, correccionStage, isVoluntary = true } = params;

  // `correccionStage` es autoritativo; `isVoluntary` es el legado binario.
  const stage: CorreccionStage =
    correccionStage ?? (isVoluntary ? 'antes_emplazamiento' : 'despues_emplazamiento');
  const antesEmplazamiento = stage === 'antes_emplazamiento';

  const rate = antesEmplazamiento ? 0.10 : 0.20;
  const rateLabel = antesEmplazamiento ? '10%' : '20%';
  const context = antesEmplazamiento
    ? 'correccion presentada ANTES de que se notifique el emplazamiento para corregir (Art. 685 E.T.) o el auto que ordene visita de inspeccion tributaria — Art. 644 num. 1 E.T.'
    : 'correccion presentada DESPUES de notificado el emplazamiento para corregir o el auto de inspeccion tributaria, y antes del requerimiento especial o pliego de cargos — Art. 644 num. 2 E.T.';

  const rawAmount = Math.round(difference * rate);
  let amount = rawAmount;
  const formula = `${formatCOP(difference)} x ${rateLabel} = ${formatCOP(rawAmount)}`;

  let explanation =
    `Para una ${context}, la sancion es del ${rateLabel} sobre la mayor diferencia ` +
    `a pagar (o menor saldo a favor) de ${formatCOP(difference)}, resultando en ${formatCOP(rawAmount)}. ` +
    `La base NO incluye la propia sancion por correccion (Art. 644 paragrafo 1º E.T.).`;

  let minApplied = false;
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    minApplied = true;
    explanation += ` Ajustado a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}).`;
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
    article: 'Art. 644 del Estatuto Tributario (nums. 1 y 2, en concordancia con el Art. 685 E.T.)',
    explanation,
    recommendations: antesEmplazamiento
      ? [
          'Mientras la DIAN no notifique el EMPLAZAMIENTO PARA CORREGIR (Art. 685 E.T.) ni un auto de inspeccion tributaria, la tarifa es del 10%. Proceda cuanto antes: la notificacion del emplazamiento la eleva al 20%.',
          'Verifique en el buzon electronico / notificaciones DIAN que no exista emplazamiento ni auto de inspeccion ya notificado antes de liquidar al 10%.',
          'Asegurese de corregir TODOS los errores identificados para evitar un requerimiento especial posterior.',
          'Conserve copia de la declaracion original y de la correccion como soporte.',
          'Considere la reduccion de sanciones del Art. 640 E.T. si aplica.',
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
function calcInteresesMoratorios(params: SanctionCalculation): SanctionResult {
  const { principal = 0, days = 30 } = params;

  // El fallback NO es la tasa legal del período: se marca para que ni el LLM
  // ni la UI lo presenten como cifra liquidable ante la DIAN.
  const tasaPorDefectoUsada =
    params.annualRate === undefined || params.annualRate === null;
  const annualRate = tasaPorDefectoUsada ? DEFAULT_ANNUAL_RATE_EA : params.annualRate!;

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
    ? ` ADVERTENCIA — VALOR NO LIQUIDABLE: no se suministró la tasa del período. Se usó el ` +
      `fallback de ${DEFAULT_ANNUAL_RATE_EA}% E.A., correspondiente a ${DEFAULT_ANNUAL_RATE_VIGENCIA}. ` +
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
        `se calculó con el fallback de ${DEFAULT_ANNUAL_RATE_EA}% E.A. (${DEFAULT_ANNUAL_RATE_VIGENCIA}), ` +
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
      tasaFallbackVigencia: tasaPorDefectoUsada ? DEFAULT_ANNUAL_RATE_VIGENCIA : 'n/a',
      dailyRatePct: Number(dailyRate.toFixed(6)),
      days,
      simpleFactorPct: Number((factor * 100).toFixed(4)),
      amountBeforeRounding: amountRaw,
    },
  };
}

/**
 * Main entry point — routes to the appropriate calculator based on type.
 */
export function calculateSanction(params: SanctionCalculation): SanctionResult {
  switch (params.type) {
    case 'extemporaneidad':
      return calcExtemporaneidad(params);
    case 'correccion':
      return calcCorreccion(params);
    case 'inexactitud':
      return calcInexactitud(params);
    case 'intereses_moratorios':
      return calcInteresesMoratorios(params);
    default:
      throw new Error(
        `Tipo de sancion no reconocido: "${(params as unknown as Record<string, unknown>).type}". ` +
        `Tipos validos: extemporaneidad, correccion, inexactitud, intereses_moratorios.`
      );
  }
}
