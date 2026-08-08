/**
 * Risk Assessment Engine for Colombian Tax Cases
 *
 * Evaluates a tax case/situation and returns a structured risk assessment
 * that can be displayed in the frontend RiskGauge component.
 *
 * Auditoria 2026-08: la llamada pasa por `callStructuredTool` (finishReason
 * auditado + validacion Zod + telemetria). Antes se hacia
 * `JSON.parse(result.text)` y se "saneaba" a mano coaccionando cualquier valor
 * desconocido a 'medio' / 50. Esa coaccion silenciosa es peor que fallar: un
 * output truncado por `length` se presentaba en el RiskGauge como una
 * evaluacion de riesgo medio legitima, sin decirle a nadie que estaba
 * incompleta.
 */

import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { callStructuredTool } from './structured-tool-call';

// ---------------------------------------------------------------------------
// Contrato de salida (strict mode 2026 — ver docs/spec/zod-strict-mode-2026.md)
// ---------------------------------------------------------------------------
// `timeline` es `.nullable()`, NUNCA `.optional()`: con `strict: true` OpenAI
// exige que todas las claves esten en `required`; la ausencia se expresa con
// null, no omitiendo el campo.

const RiskLevelEnum = z.enum(['bajo', 'medio', 'alto', 'critico']);
const UrgencyEnum = z.enum(['normal', 'importante', 'urgente']);

const RiskFactorSchema = z.object({
  description: z.string().min(1).describe('Factor de riesgo concreto'),
  severity: RiskLevelEnum,
  category: z.string().min(1).describe('Ej: procesal, sustancial, documental, temporal'),
});

const TimelineItemSchema = z.object({
  date: z.string().min(1).describe('Fecha o plazo relevante'),
  description: z.string().min(1).describe('Que vence o que debe hacerse'),
  urgency: UrgencyEnum,
});

export const RiskAssessmentSchema = z.object({
  level: RiskLevelEnum,
  score: z.number().int().min(0).max(100).describe('Score de riesgo 0-100 coherente con `level`'),
  factors: z.array(RiskFactorSchema),
  recommendations: z.array(z.string().min(1)),
  timeline: z
    .array(TimelineItemSchema)
    .nullable()
    .describe('Vencimientos relevantes; null si el caso no tiene plazos identificables'),
});

export interface RiskAssessment {
  level: 'bajo' | 'medio' | 'alto' | 'critico';
  score: number; // 0-100
  factors: RiskFactor[];
  recommendations: string[];
  timeline?: TimelineItem[];
}

export interface RiskFactor {
  description: string;
  severity: 'bajo' | 'medio' | 'alto' | 'critico';
  category: string;
}

export interface TimelineItem {
  date: string;
  description: string;
  urgency: 'normal' | 'importante' | 'urgente';
}

// El schema NO va en prosa — lo enforza `Output.object({ schema })`.
const RISK_SYSTEM_PROMPT = `Eres un experto evaluador de riesgos tributarios colombianos.

<task>Evaluar el riesgo de un caso o situacion tributaria y devolver la evaluacion estructurada.</task>

<constraints>
  - NEVER inventes plazos, cifras ni actuaciones de la DIAN que no consten en el caso descrito.
  - Bandas de score: bajo 0-25 (cumplimiento adecuado); medio 26-50 (aspectos que requieren atencion, no urgentes); alto 51-75 (accion inmediata para evitar sanciones); critico 76-100 (sanciones graves, perdida de plazos o exposicion fiscal importante).
  - Factores a ponderar: cumplimiento de plazos legales y procesales, magnitud economica de la contingencia, solidez de la posicion juridica, disponibilidad de pruebas y soportes, antecedentes con la DIAN, acumulacion de sanciones, riesgo de liquidacion oficial, firmeza de declaraciones y prescripcion de la accion de cobro.
  - If el caso menciona vencimientos o terminos then registralos en timeline, otherwise devuelve timeline en null.
  - Cada recomendacion debe ser especifica y accionable.
  - Responde siempre en espanol.
</constraints>

<success_criteria>El score cae dentro de la banda que corresponde al level reportado.</success_criteria>`;

/**
 * Assess the risk of a tax case based on the conversation context.
 */
export async function assessRisk(caseDescription: string): Promise<RiskAssessment> {
  try {
    const json = await callStructuredTool({
      toolName: 'risk-assessor',
      model: MODELS.CHAT,
      schema: RiskAssessmentSchema,
      system: RISK_SYSTEM_PROMPT,
      userContent: `Evalua el riesgo tributario del siguiente caso:\n\n${caseDescription}`,
      maxOutputTokens: 1500,
    });

    return {
      level: json.level,
      score: json.score,
      factors: json.factors,
      recommendations: json.recommendations,
      // El contrato JSON usa null (strict mode); la interfaz publica de la tool
      // usa `undefined` para no romper a los consumidores existentes.
      timeline: json.timeline ?? undefined,
    };
  } catch (error) {
    console.error('Risk assessment failed:', error);
    return fallbackRiskAssessment(
      `Error en la evaluacion de riesgo: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
}

function fallbackRiskAssessment(reason: string): RiskAssessment {
  return {
    level: 'medio',
    score: 50,
    factors: [
      {
        description: reason,
        severity: 'medio',
        category: 'sistema',
      },
    ],
    recommendations: [
      'No fue posible completar la evaluacion automatica de riesgo.',
      'Consulte con un Contador Publico o abogado tributarista para una evaluacion manual.',
      'Recopile toda la documentacion relevante del caso para un analisis detallado.',
    ],
  };
}
