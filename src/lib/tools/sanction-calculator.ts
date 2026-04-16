/**
 * Calculadora de Sanciones e Intereses Tributarios — Colombia
 *
 * Implementa los cálculos del Estatuto Tributario colombiano:
 * - Sanción por extemporaneidad (Art. 641 E.T.)
 * - Sanción por corrección (Art. 644 E.T.)
 * - Sanción por inexactitud (Art. 647 E.T.) con reducciones Arts. 640 y 709 E.T.
 * - Intereses moratorios (Arts. 634 y 635 E.T.) — INTERÉS COMPUESTO DIARIO.
 *
 * UVT 2026 = $52.374 COP (Resolución DIAN 000238 del 15-dic-2025).
 *
 * IMPORTANTE — tasa de interés:
 * El Art. 635 E.T. exige aplicar la "tasa de usura menos 2 puntos porcentuales"
 * vigente para el mes de la mora (publicada mensualmente por la Superfinanciera
 * de Colombia). El valor por defecto es solo un fallback para demostración;
 * en producción el caller DEBE pasar la tasa vigente del período.
 */

const UVT_2026 = 52_374;

const MIN_SANCTION_UVT = 10;
const MIN_SANCTION = MIN_SANCTION_UVT * UVT_2026; // $523.740 COP

/**
 * Fallback únicamente para demos. En producción pasar la tasa de usura
 * vigente certificada por la Superfinanciera para el mes de la mora,
 * MENOS 2 puntos porcentuales (Art. 635 E.T. modificado por Ley 1819/2016).
 */
const DEFAULT_ANNUAL_RATE_EA = 25.44;

export type InexactitudReduction =
  | 'none'            // Liquidación oficial firme — sanción plena 100%
  | 'art_709_half'    // Art. 709 E.T.: reducción a la mitad por aceptación tras requerimiento especial
  | 'art_709_quarter' // Art. 709 E.T.: reducción a un cuarto por aceptación antes de ampliación
  | 'art_640_50'      // Art. 640 E.T.: reducción 50% por gradualidad (sin antecedentes 4 años)
  | 'art_640_75';     // Art. 640 E.T.: reducción 75% por gradualidad (sin antecedentes 2 años)

export interface SanctionCalculation {
  type: 'extemporaneidad' | 'correccion' | 'inexactitud' | 'intereses_moratorios';
  taxDue?: number;
  grossIncome?: number;
  difference?: number;
  delayMonths?: number;
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
 * Sanción por inexactitud — Art. 647 E.T.
 *
 * Base: 100% del mayor valor a pagar o menor saldo a favor.
 *
 * Reducciones aplicables (se aplican sobre la base del 100%):
 *   - Art. 709 E.T. (corrección provocada): mitad si se acepta en respuesta al
 *     requerimiento especial; un cuarto si se acepta antes de la ampliación.
 *   - Art. 640 E.T. (gradualidad): 50% o 75% si el contribuyente no tiene
 *     antecedentes sancionatorios del mismo tipo en los últimos 2 o 4 años
 *     respectivamente, según el caso.
 *
 * Sanción mínima: 10 UVT (Art. 639 E.T.).
 */
function calcInexactitud(params: SanctionCalculation): SanctionResult {
  const { difference = 0, inexactitudReduction = 'none' } = params;

  // Base: 100% de la diferencia (Art. 647 inciso 1º E.T.)
  const base = difference;

  // Factor de reducción sobre la base del 100%
  const reductionMap: Record<InexactitudReduction, { factor: number; label: string; article: string }> = {
    none:           { factor: 1.00, label: '100% (plena)',          article: 'Art. 647 E.T.' },
    art_709_half:   { factor: 0.50, label: '50% (reducida)',        article: 'Art. 709 E.T.' },
    art_709_quarter:{ factor: 0.25, label: '25% (reducida)',        article: 'Art. 709 E.T.' },
    art_640_50:     { factor: 0.50, label: '50% por gradualidad',   article: 'Art. 640 E.T.' },
    art_640_75:     { factor: 0.25, label: '25% por gradualidad',   article: 'Art. 640 E.T.' },
  };
  const { factor, label, article } = reductionMap[inexactitudReduction];

  let amount = Math.round(base * factor);
  const formula = `${formatCOP(base)} x ${label} = ${formatCOP(amount)}`;

  let explanation =
    `La sanción por inexactitud (Art. 647 E.T.) parte de una base del 100% sobre la diferencia ` +
    `de ${formatCOP(difference)}. ` +
    (inexactitudReduction === 'none'
      ? `No se aplica reducción, por lo que la sanción es ${formatCOP(amount)}.`
      : `Se aplica la reducción del ${article} (${label}), resultando en ${formatCOP(amount)}.`);

  if (amount < MIN_SANCTION) {
    amount = MIN_SANCTION;
    explanation += ` Ajustado a la sanción mínima de 10 UVT (${formatCOP(MIN_SANCTION)}).`;
  }

  return {
    type: 'Sanción por Inexactitud',
    amount,
    amountFormatted: formatCOP(amount),
    formula: amount === MIN_SANCTION
      ? `${formula} -> Ajustado a sanción mínima: ${formatCOP(MIN_SANCTION)}`
      : formula,
    article: 'Art. 647 E.T. (con reducciones Arts. 640 y 709 E.T. cuando apliquen)',
    explanation,
    recommendations: [
      'Verifique si la inexactitud se origina en diferencias de criterio interpretativo — el parágrafo del Art. 647 E.T. puede eliminar la sanción en ese caso.',
      'Evalúe Art. 709 E.T.: aceptación total de los hechos del requerimiento especial reduce la sanción a la mitad o a un cuarto según el momento.',
      'Evalúe Art. 640 E.T.: sin antecedentes en 2/4 años aplica reducción adicional del 75%/50%.',
      'Documente exhaustivamente las pruebas que sustentan la cifra declarada originalmente.',
      'Considere conciliación contencioso-administrativa (Art. 101 Ley 2277/2022) si hay litigio en curso.',
    ],
    details: {
      difference,
      inexactitudReduction,
      effectiveRate: label,
      minSanction: MIN_SANCTION,
    },
  };
}

/**
 * Intereses moratorios — Arts. 634 y 635 E.T. (modificado por Ley 1819/2016).
 *
 * Fórmula correcta: INTERÉS DIARIO COMPUESTO sobre la tasa de usura -2 pp
 * vigente en el mes de la mora.
 *
 *   Interés = Principal × [ (1 + iEA)^(d/365) − 1 ]
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
  const {
    principal = 0,
    annualRate = DEFAULT_ANNUAL_RATE_EA,
    days = 30,
  } = params;

  const iEA = annualRate / 100;
  // Interés compuesto diario: (1 + iEA)^(d/365) - 1
  const factor = Math.pow(1 + iEA, days / 365) - 1;
  const amount = Math.round(principal * factor);
  const dailyEquivalent = (Math.pow(1 + iEA, 1 / 365) - 1) * 100;

  const formula =
    `${formatCOP(principal)} × [ (1 + ${annualRate}%)^(${days}/365) − 1 ] = ${formatCOP(amount)}`;

  const explanation =
    `Los intereses moratorios se calculan con INTERÉS DIARIO COMPUESTO (Art. 635 E.T.) ` +
    `sobre un capital de ${formatCOP(principal)}, a una tasa efectiva anual del ${annualRate}% ` +
    `(= tasa de usura vigente del período − 2 puntos porcentuales). Tasa diaria equivalente: ` +
    `${dailyEquivalent.toFixed(6)}%. Por ${days} días de mora, el factor acumulado es ` +
    `${(factor * 100).toFixed(4)}%, resultando en ${formatCOP(amount)}.`;

  return {
    type: 'Intereses Moratorios',
    amount,
    amountFormatted: formatCOP(amount),
    formula,
    article: 'Arts. 634 y 635 E.T. (interés diario compuesto)',
    explanation,
    recommendations: [
      'Los intereses moratorios se causan día a día de forma compuesta. Pague lo antes posible para minimizar.',
      'La tasa aplicable es la tasa de usura vigente del mes de mora MENOS 2 puntos porcentuales (Art. 635 E.T. mod. Ley 1819/2016). Consulte la certificación mensual de la Superfinanciera.',
      'Si la mora abarca varios meses, aplique la tasa vigente de cada mes por separado — esta función asume una única tasa.',
      'Considere facilidades de pago (Art. 814 E.T.) si el monto total es significativo.',
      'Los intereses se liquidan sobre el impuesto o retención a cargo — NO sobre las sanciones.',
    ],
    details: {
      principal,
      annualRate,
      dailyEquivalentPct: Number(dailyEquivalent.toFixed(6)),
      days,
      compoundFactorPct: Number((factor * 100).toFixed(4)),
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
