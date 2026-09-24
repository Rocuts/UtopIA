/**
 * Contratos de entrada de la calculadora de sanciones — fuente única.
 *
 * La misma función pura (`calculateSanction`) se alcanza por tres superficies:
 *   1. Tool LLM `calculate_sanction` del chat orquestado (registry.ts).
 *   2. API REST `/api/tools/sanction`, que usa la voz Realtime.
 *   3. Definición de la tool en la sesión Realtime (route + hook de voz).
 * Cuando cada superficie declaraba sus campos a mano, Zod descartaba
 * `saldoAFavor`, `netEquityPriorYear` y `correccionStage`: con saldo a favor se
 * aplicaba el tope de 5 % / 2.500 UVT en vez del doble del saldo (Art. 641
 * E.T.) y sin ingresos salía la sanción mínima en vez del 1 % del patrimonio
 * líquido. Aquí se derivan las tres de `SANCTION_INPUT_FIELDS`; la prueba de
 * contrato (`__tests__/sanction-contract.test.ts`) exige que coincidan.
 *
 * Este módulo no importa nada de servidor: lo consume también el hook de voz.
 */

import { z } from 'zod';

import {
  CORRECCION_STAGES,
  INEXACTITUD_REDUCTIONS,
  REDUCCIONES_640,
  SANCTION_TYPES,
  type SanctionCalculationInput,
  type SanctionInputField,
} from './sanction-calculator';

// ---------------------------------------------------------------------------
// Descripciones compartidas (LLM y Realtime leen el mismo texto)
// ---------------------------------------------------------------------------

export const SANCTION_TOOL_DESCRIPTION =
  'Calcula sanciones e intereses tributarios colombianos. Tipos: ' +
  'extemporaneidad (Art. 641 E.T.), extemporaneidad_post_emplazamiento (Art. 642 E.T.), ' +
  'correccion (Art. 644 E.T.), inexactitud (Art. 647 E.T. con reducciones Arts. 640/709/713), ' +
  'intereses_moratorios (Arts. 634-635 E.T., interés simple diario). ' +
  'UVT 2026 = $52.374 (Res. DIAN 000238/2025). Sanción mínima = 10 UVT = $524.000 ' +
  '(Arts. 639 y 868 E.T.). Usar cuando el usuario pregunte cuánto pagaría en sanciones o intereses.';

export const SANCTION_FIELD_DESCRIPTIONS: Record<SanctionInputField, string> = {
  type: 'Tipo de sanción.',
  taxDue:
    'Impuesto a cargo o retención objeto de la declaración (COP). Para extemporaneidad (Arts. 641/642 E.T.).',
  grossIncome:
    'Ingresos brutos del período declarado (COP). Para extemporaneidad cuando no hay impuesto a cargo.',
  netEquityPriorYear:
    'Patrimonio líquido del año inmediatamente anterior (COP). Para extemporaneidad cuando no hay ' +
    'impuesto a cargo NI ingresos en el período: 1% mensual (Art. 641) o 2% (Art. 642). Sin este dato ' +
    'y sin ingresos, la tool solo puede devolver la sanción mínima.',
  saldoAFavor:
    'Saldo a favor de la declaración (COP), si lo hay. En extemporaneidad sin impuesto a cargo el tope ' +
    'pasa a ser el doble del saldo a favor (Art. 641) o cuatro veces (Art. 642) en lugar de 2.500 / 5.000 UVT.',
  difference:
    'Mayor valor a pagar o menor saldo a favor (COP), sin incluir la propia sanción. Para correccion e inexactitud.',
  delayMonths: 'Meses o fracción de mes calendario de retardo. Para extemporaneidad (Arts. 641/642).',
  correccionStage:
    'SOLO para "correccion". Hito procesal del Art. 644 E.T.: antes_vencimiento = corrección antes del ' +
    'vencimiento del plazo para declarar (sin sanción); antes_emplazamiento = después del vencimiento y ' +
    'antes de notificarse el EMPLAZAMIENTO PARA CORREGIR (Art. 685 E.T.) o el auto de inspección tributaria ' +
    '(10%, num. 1); despues_emplazamiento = después de notificado ese emplazamiento o auto y antes del ' +
    'requerimiento especial o pliego de cargos (20%, num. 2). Prevalece sobre isVoluntary.',
  isVoluntary:
    'LEGADO, SOLO para "correccion" y solo si no se envía correccionStage: true = corrección antes de ' +
    'notificarse el emplazamiento para corregir (Art. 685 E.T.) o el auto de inspección (10%, Art. 644 ' +
    'num. 1); false = después de ese emplazamiento (20%, num. 2). El hito es el emplazamiento, no el ' +
    'requerimiento especial.',
  mesesExtemporaneidadInicial:
    'SOLO para "correccion": meses o fracción entre el vencimiento del plazo y la presentación de la ' +
    'declaración INICIAL, si ésta fue extemporánea. Suma 5% del mayor valor por mes, con tope total del ' +
    '100% (Art. 644 par. 1 E.T.).',
  reduccion640:
    'SOLO para extemporaneidad (Art. 641) y correccion: gradualidad del Art. 640 E.T. para sanciones que ' +
    'liquida el propio contribuyente. "50" = no cometió la misma conducta en los 2 años anteriores ' +
    '(num. 1); "75" = no la cometió en el año anterior (num. 2); en ambos casos la DIAN no debe haber ' +
    'proferido pliego de cargos, requerimiento especial ni emplazamiento previo por no declarar. Usar null ' +
    'si el usuario no confirmó esos hechos.',
  inexactitudReduction:
    'SOLO para "inexactitud". Reducción aplicable sobre la base del 100%: none (plena), art_713_half (a la ' +
    'mitad por aceptación frente a la liquidación de revisión, Art. 713 E.T.), art_709_quarter (a la cuarta ' +
    'parte por aceptación en respuesta al requerimiento especial, Art. 709 E.T.), art_640_50 (reducida AL ' +
    '50%, sin antecedentes 4 años, Art. 640 num. 3), art_640_75 (reducida AL 75%, sin antecedentes 2 años, ' +
    'Art. 640 num. 4). Default: none.',
  principal: 'Capital (COP) sobre el que corren los intereses. Para intereses_moratorios.',
  annualRate:
    'Tasa efectiva anual (%): tasa de usura certificada por la Superfinanciera para el mes de la mora ' +
    'MENOS 2 puntos porcentuales (Art. 635 E.T.). Si se omite, la tool usa la tasa certificada ' +
    'registrada para el mes de liquidación (hora de Colombia) y marca la cifra como NO liquidable; si ese ' +
    'mes no tiene tasa registrada, devuelve error N/D y hay que pedir la tasa.',
  days: 'Días de mora. Para intereses_moratorios.',
};

const D = SANCTION_FIELD_DESCRIPTIONS;

// ---------------------------------------------------------------------------
// 1. Tool LLM — todas las claves presentes; `null` = no aplica (strict-compatible)
// ---------------------------------------------------------------------------

const montoLlm = (desc: string) => z.number().nonnegative().nullable().describe(desc);

export const sanctionToolInputSchema = z.object({
  type: z.enum(SANCTION_TYPES).describe(D.type),
  taxDue: montoLlm(D.taxDue),
  grossIncome: montoLlm(D.grossIncome),
  netEquityPriorYear: montoLlm(D.netEquityPriorYear),
  saldoAFavor: montoLlm(D.saldoAFavor),
  difference: montoLlm(D.difference),
  delayMonths: z.number().nonnegative().max(240).nullable().describe(D.delayMonths),
  correccionStage: z.enum(CORRECCION_STAGES).nullable().describe(D.correccionStage),
  isVoluntary: z.boolean().nullable().describe(D.isVoluntary),
  mesesExtemporaneidadInicial: z
    .number()
    .nonnegative()
    .max(240)
    .nullable()
    .describe(D.mesesExtemporaneidadInicial),
  reduccion640: z.enum(REDUCCIONES_640).nullable().describe(D.reduccion640),
  inexactitudReduction: z.enum(INEXACTITUD_REDUCTIONS).nullable().describe(D.inexactitudReduction),
  principal: montoLlm(D.principal),
  annualRate: z.number().min(0).max(100).nullable().describe(D.annualRate),
  days: z.number().int().nonnegative().max(3_650).nullable().describe(D.days),
});

// ---------------------------------------------------------------------------
// 2. API REST — campos opcionales; acepta null (la voz reenvía los argumentos
//    crudos del modelo Realtime). Este schema no viaja al LLM.
// ---------------------------------------------------------------------------

const montoApi = () => z.number().nonnegative().nullable().optional();

export const sanctionRequestSchema = z.object({
  type: z.enum(SANCTION_TYPES),
  taxDue: montoApi(),
  grossIncome: montoApi(),
  netEquityPriorYear: montoApi(),
  saldoAFavor: montoApi(),
  difference: montoApi(),
  delayMonths: z.number().nonnegative().max(240).nullable().optional(),
  correccionStage: z.enum(CORRECCION_STAGES).nullable().optional(),
  isVoluntary: z.boolean().nullable().optional(),
  mesesExtemporaneidadInicial: z.number().nonnegative().max(240).nullable().optional(),
  reduccion640: z.enum(REDUCCIONES_640).nullable().optional(),
  inexactitudReduction: z.enum(INEXACTITUD_REDUCTIONS).nullable().optional(),
  principal: montoApi(),
  annualRate: z.number().min(0).max(100).nullable().optional(),
  days: z.number().int().nonnegative().max(3_650).nullable().optional(),
});

export type SanctionToolInput = z.infer<typeof sanctionToolInputSchema>;
export type SanctionRequest = z.infer<typeof sanctionRequestSchema>;

/** Adapta cualquiera de los dos contratos Zod a la entrada de `calculateSanction`. */
export function toSanctionCalculation(
  input: SanctionToolInput | SanctionRequest,
): SanctionCalculationInput {
  return input as SanctionCalculationInput;
}

// ---------------------------------------------------------------------------
// 3. Realtime — JSON Schema de la sesión de voz (route + hook)
// ---------------------------------------------------------------------------

type JsonProp =
  | { type: 'number'; description: string }
  | { type: 'boolean'; description: string }
  | { type: 'string'; enum: readonly string[]; description: string };

const REALTIME_PROPERTIES: Record<SanctionInputField, JsonProp> = {
  type: { type: 'string', enum: SANCTION_TYPES, description: D.type },
  taxDue: { type: 'number', description: D.taxDue },
  grossIncome: { type: 'number', description: D.grossIncome },
  netEquityPriorYear: { type: 'number', description: D.netEquityPriorYear },
  saldoAFavor: { type: 'number', description: D.saldoAFavor },
  difference: { type: 'number', description: D.difference },
  delayMonths: { type: 'number', description: D.delayMonths },
  correccionStage: { type: 'string', enum: CORRECCION_STAGES, description: D.correccionStage },
  isVoluntary: { type: 'boolean', description: D.isVoluntary },
  mesesExtemporaneidadInicial: { type: 'number', description: D.mesesExtemporaneidadInicial },
  reduccion640: { type: 'string', enum: REDUCCIONES_640, description: D.reduccion640 },
  inexactitudReduction: {
    type: 'string',
    enum: INEXACTITUD_REDUCTIONS,
    description: D.inexactitudReduction,
  },
  principal: { type: 'number', description: D.principal },
  annualRate: { type: 'number', description: D.annualRate },
  days: { type: 'number', description: D.days },
};

export const SANCTION_REALTIME_TOOL = {
  type: 'function',
  name: 'calculate_sanction',
  description: SANCTION_TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: REALTIME_PROPERTIES,
    required: ['type'],
  },
} as const;
