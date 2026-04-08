/**
 * Risk Assessment Engine for Colombian Tax Cases
 *
 * Evaluates a tax case/situation and returns a structured risk assessment
 * that can be displayed in the frontend RiskGauge component.
 */

import OpenAI from 'openai';

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

const RISK_SYSTEM_PROMPT = `Eres un experto evaluador de riesgos tributarios colombianos.
Tu tarea es evaluar el riesgo de un caso o situacion tributaria y devolver una evaluacion estructurada.

DEBES responder UNICAMENTE con un objeto JSON valido (sin markdown, sin backticks) con esta estructura:

{
  "level": "uno de: bajo, medio, alto, critico",
  "score": numero de 0 a 100,
  "factors": [
    {
      "description": "descripcion del factor de riesgo",
      "severity": "uno de: bajo, medio, alto, critico",
      "category": "categoria del riesgo (ej: procesal, sustancial, documental, temporal)"
    }
  ],
  "recommendations": [
    "recomendacion especifica y accionable"
  ],
  "timeline": [
    {
      "date": "fecha o plazo relevante",
      "description": "que vence o que debe hacerse",
      "urgency": "uno de: normal, importante, urgente"
    }
  ]
}

CRITERIOS DE EVALUACION:
- BAJO (0-25): Riesgo minimo. Cumplimiento adecuado, situacion controlada.
- MEDIO (26-50): Riesgo moderado. Hay aspectos que requieren atencion pero no son urgentes.
- ALTO (51-75): Riesgo significativo. Requiere accion inmediata para evitar sanciones o perjuicios.
- CRITICO (76-100): Riesgo critico. Posibles sanciones graves, perdida de plazos, o exposicion fiscal importante.

FACTORES A CONSIDERAR:
- Cumplimiento de plazos legales y procesales
- Magnitud economica de la contingencia
- Solidez de la posicion juridica
- Disponibilidad de pruebas y soportes documentales
- Antecedentes del contribuyente con la DIAN
- Posibilidad de sanciones acumuladas
- Riesgo de liquidacion oficial
- Firmeza de declaraciones
- Prescripcion de la accion de cobro

SIEMPRE responde en espanol.`;

/**
 * Assess the risk of a tax case based on the conversation context.
 */
export async function assessRisk(caseDescription: string): Promise<RiskAssessment> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: RISK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Evalua el riesgo tributario del siguiente caso:\n\n${caseDescription}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return fallbackRiskAssessment('No se obtuvo respuesta del modelo de evaluacion de riesgo.');
    }

    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);

    // Validate and sanitize
    const validLevels = ['bajo', 'medio', 'alto', 'critico'] as const;
    const level = validLevels.includes(parsed.level) ? parsed.level : 'medio';
    const score = typeof parsed.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 50;

    return {
      level,
      score,
      factors: Array.isArray(parsed.factors)
        ? parsed.factors.map((f: any) => ({
            description: f.description || 'Factor no especificado',
            severity: validLevels.includes(f.severity) ? f.severity : 'medio',
            category: f.category || 'general',
          }))
        : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      timeline: Array.isArray(parsed.timeline)
        ? parsed.timeline.map((t: any) => ({
            date: t.date || 'Por determinar',
            description: t.description || '',
            urgency: ['normal', 'importante', 'urgente'].includes(t.urgency) ? t.urgency : 'normal',
          }))
        : undefined,
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
