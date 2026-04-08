/**
 * Calculadora de Sanciones e Intereses Tributarios — Colombia
 *
 * Implements Colombian tax sanction calculations based on the Estatuto Tributario:
 * - Sancion por extemporaneidad (Art. 641 E.T.)
 * - Sancion por correccion (Art. 644 E.T.)
 * - Sancion por inexactitud (Art. 647 E.T.)
 * - Intereses moratorios (Art. 634 E.T.)
 *
 * UVT 2026 = $52,374 COP (Resolución DIAN 000238 del 15-dic-2025)
 * UVT 2025 = $49,799 COP (valor anterior, ya no vigente)
 */

// UVT value for 2026 (Resolución DIAN 000238 del 15 de diciembre de 2025)
const UVT_2026 = 52_374;

// Minimum sanction: 10 UVT
const MIN_SANCTION_UVT = 10;
const MIN_SANCTION = MIN_SANCTION_UVT * UVT_2026; // $523,740 COP

// Default annual interest rate (tasa de usura aproximada 2026)
const DEFAULT_ANNUAL_RATE = 27.44;

export interface SanctionCalculation {
  type: 'extemporaneidad' | 'correccion' | 'inexactitud' | 'intereses_moratorios';
  taxDue?: number;
  grossIncome?: number;
  difference?: number;
  delayMonths?: number;
  isVoluntary?: boolean;
  principal?: number;
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
 * Sancion por extemporaneidad — Art. 641 E.T.
 *
 * If there is tax due (impuesto a cargo):
 *   5% of tax due per month or fraction of delay, max 100% of tax due.
 *
 * If there is NO tax due (impuesto a cargo = 0):
 *   0.5% of gross income per month or fraction of delay, max 5% of gross income.
 *
 * Minimum sanction: 10 UVT.
 */
function calcExtemporaneidad(params: SanctionCalculation): SanctionResult {
  const { taxDue = 0, grossIncome = 0, delayMonths = 1 } = params;
  const months = Math.max(1, Math.ceil(delayMonths));

  let amount: number;
  let formula: string;
  let explanation: string;

  if (taxDue > 0) {
    const rawAmount = taxDue * 0.05 * months;
    const maxAmount = taxDue; // 100% cap
    amount = Math.min(rawAmount, maxAmount);
    formula = `min(${formatCOP(taxDue)} x 5% x ${months} meses, ${formatCOP(taxDue)} [tope 100%])`;
    explanation =
      `Con un impuesto a cargo de ${formatCOP(taxDue)} y ${months} mes(es) de retraso, ` +
      `la sancion se calcula al 5% mensual sobre el impuesto a cargo. ` +
      (rawAmount > maxAmount
        ? `El calculo bruto (${formatCOP(rawAmount)}) excede el tope del 100%, por lo que se aplica el maximo de ${formatCOP(maxAmount)}.`
        : `El resultado es ${formatCOP(amount)}.`);
  } else if (grossIncome > 0) {
    const rawAmount = grossIncome * 0.005 * months;
    const maxAmount = grossIncome * 0.05; // 5% cap
    amount = Math.min(rawAmount, maxAmount);
    formula = `min(${formatCOP(grossIncome)} x 0.5% x ${months} meses, ${formatCOP(grossIncome)} x 5% [tope])`;
    explanation =
      `Sin impuesto a cargo, se aplica el 0.5% mensual sobre los ingresos brutos de ${formatCOP(grossIncome)}. ` +
      `Con ${months} mes(es) de retraso, ` +
      (rawAmount > maxAmount
        ? `el calculo bruto (${formatCOP(rawAmount)}) excede el tope del 5%, aplicandose el maximo de ${formatCOP(maxAmount)}.`
        : `el resultado es ${formatCOP(amount)}.`);
  } else {
    amount = MIN_SANCTION;
    formula = `Sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation =
      'Sin impuesto a cargo ni ingresos brutos reportados, se aplica la sancion minima de 10 UVT.';
  }

  // Enforce minimum sanction
  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    formula += ` -> Ajustado a sancion minima: 10 UVT = ${formatCOP(MIN_SANCTION)}`;
    explanation += ` Nota: El valor calculado es inferior a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}), por lo que se aplica el minimo.`;
  }

  return {
    type: 'Sancion por Extemporaneidad',
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article: 'Art. 641 del Estatuto Tributario',
    explanation,
    recommendations: [
      'Presente la declaracion lo antes posible para minimizar la sancion.',
      'Verifique si aplica alguna reduccion por correccion voluntaria bajo Art. 640 E.T.',
      'Considere solicitar facilidades de pago si el monto es significativo.',
      'Recuerde que la sancion se liquida por cada mes o fraccion de mes calendario de retardo.',
    ],
    details: {
      taxDue,
      grossIncome,
      delayMonths: months,
      minSanction: MIN_SANCTION,
      uvt2026: UVT_2026,
    },
  };
}

/**
 * Sancion por correccion — Art. 644 E.T.
 *
 * Voluntary correction (before DIAN notice): 10% of the difference.
 * After DIAN requerimiento: 20% of the difference.
 *
 * Minimum sanction: 10 UVT.
 */
function calcCorreccion(params: SanctionCalculation): SanctionResult {
  const { difference = 0, isVoluntary = true } = params;
  const rate = isVoluntary ? 0.10 : 0.20;
  const rateLabel = isVoluntary ? '10%' : '20%';
  const context = isVoluntary
    ? 'correccion voluntaria (antes de notificacion del requerimiento especial o pliego de cargos)'
    : 'correccion provocada (despues de notificacion del requerimiento especial o pliego de cargos de la DIAN)';

  let amount = Math.round(difference * rate);
  const formula = `${formatCOP(difference)} x ${rateLabel} = ${formatCOP(amount)}`;

  let explanation =
    `Para una ${context}, la sancion es del ${rateLabel} sobre la mayor diferencia ` +
    `a pagar de ${formatCOP(difference)}, resultando en ${formatCOP(amount)}.`;

  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    explanation += ` Ajustado a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}).`;
  }

  return {
    type: 'Sancion por Correccion',
    amount,
    amountFormatted: formatCOP(amount),
    formula: amount === MIN_SANCTION
      ? `${formula} -> Ajustado a sancion minima: ${formatCOP(MIN_SANCTION)}`
      : formula,
    article: 'Art. 644 del Estatuto Tributario',
    explanation,
    recommendations: isVoluntary
      ? [
          'La correccion voluntaria tiene una sancion reducida del 10%. Proceda cuanto antes.',
          'Asegurese de corregir TODOS los errores identificados para evitar un requerimiento posterior.',
          'Conserve copia de la declaracion original y la correccion como soporte.',
          'Considere la reduccion de sanciones del Art. 640 E.T. si aplica.',
        ]
      : [
          'Ya que la correccion es provocada por la DIAN, la sancion es del 20%.',
          'Responda dentro del plazo legal para evitar sanciones adicionales.',
          'Evalue si es conveniente aceptar la correccion o interponer recurso de reconsideracion.',
          'Documente exhaustivamente los soportes de la correccion.',
        ],
    details: {
      difference,
      isVoluntary,
      rate: rateLabel,
      minSanction: MIN_SANCTION,
    },
  };
}

/**
 * Sancion por inexactitud — Art. 647 E.T.
 *
 * 100% of the difference in tax due (o menor saldo a favor).
 * Reduced to 50% if corrected before liquidacion oficial de revision.
 *
 * Minimum sanction: 10 UVT.
 */
function calcInexactitud(params: SanctionCalculation): SanctionResult {
  const { difference = 0, isVoluntary = true } = params;
  const rate = isVoluntary ? 0.50 : 1.00;
  const rateLabel = isVoluntary ? '50%' : '100%';
  const context = isVoluntary
    ? 'con aceptacion y correccion antes de la liquidacion oficial de revision (sancion reducida)'
    : 'determinada en liquidacion oficial de revision';

  let amount = Math.round(difference * rate);
  const formula = `${formatCOP(difference)} x ${rateLabel} = ${formatCOP(amount)}`;

  let explanation =
    `La sancion por inexactitud ${context} se calcula como el ${rateLabel} sobre la diferencia ` +
    `de ${formatCOP(difference)}, resultando en ${formatCOP(amount)}.`;

  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    explanation += ` Ajustado a la sancion minima de 10 UVT (${formatCOP(MIN_SANCTION)}).`;
  }

  return {
    type: 'Sancion por Inexactitud',
    amount,
    amountFormatted: formatCOP(amount),
    formula: amount === MIN_SANCTION
      ? `${formula} -> Ajustado a sancion minima: ${formatCOP(MIN_SANCTION)}`
      : formula,
    article: 'Art. 647 del Estatuto Tributario',
    explanation,
    recommendations: [
      isVoluntary
        ? 'Al aceptar antes de la liquidacion oficial, la sancion se reduce al 50%. Esta es la opcion mas favorable.'
        : 'La sancion plena del 100% aplica cuando hay liquidacion oficial. Evalue recursos legales.',
      'Revise si la inexactitud se origina en diferencias de criterio (Art. 647 paragrafo) que podrian reducir o eliminar la sancion.',
      'Documente todas las pruebas que sustenten las cifras declaradas originalmente.',
      'Considere la posibilidad de una conciliacion contencioso-administrativa si el caso lo amerita.',
      'Evalue la reduccion de sanciones del Art. 640 E.T. por gradualidad.',
    ],
    details: {
      difference,
      isVoluntary,
      rate: rateLabel,
      minSanction: MIN_SANCTION,
    },
  };
}

/**
 * Intereses moratorios — Art. 634 E.T.
 *
 * Apply the tasa de usura (bank interest rate) on the outstanding principal.
 * Calculated on a daily basis: (principal * dailyRate * days)
 */
function calcInteresesMoratorios(params: SanctionCalculation): SanctionResult {
  const {
    principal = 0,
    annualRate = DEFAULT_ANNUAL_RATE,
    days = 30,
  } = params;

  const dailyRate = annualRate / 100 / 365;
  const amount = Math.round(principal * dailyRate * days);
  const formula = `${formatCOP(principal)} x (${annualRate}% / 365) x ${days} dias = ${formatCOP(amount)}`;

  const explanation =
    `Los intereses moratorios se calculan sobre un capital de ${formatCOP(principal)} ` +
    `a la tasa efectiva anual del ${annualRate}% (tasa de usura vigente), ` +
    `equivalente a una tasa diaria de ${(dailyRate * 100).toFixed(6)}%, ` +
    `por ${days} dias de mora, resultando en ${formatCOP(amount)}.`;

  return {
    type: 'Intereses Moratorios',
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article: 'Art. 634 del Estatuto Tributario',
    explanation,
    recommendations: [
      'Los intereses moratorios se causan dia a dia. Pague lo antes posible para minimizar el monto.',
      'Verifique la tasa de usura vigente certificada por la Superfinanciera para el periodo de mora.',
      'Los intereses moratorios son deducibles del impuesto sobre la renta en ciertos casos.',
      'Considere solicitar facilidades de pago (Art. 814 E.T.) si el monto total es significativo.',
      'Recuerde que los intereses se calculan sobre el impuesto o retencion a cargo, no sobre las sanciones.',
    ],
    details: {
      principal,
      annualRate,
      dailyRate: Number((dailyRate * 100).toFixed(6)),
      days,
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
        `Tipo de sancion no reconocido: "${(params as any).type}". ` +
        `Tipos validos: extemporaneidad, correccion, inexactitud, intereses_moratorios.`
      );
  }
}
