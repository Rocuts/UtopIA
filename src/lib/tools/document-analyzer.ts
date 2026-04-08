/**
 * Document Analyzer — Automatic analysis of Colombian tax/accounting documents.
 *
 * Analyzes extracted text from uploaded documents and identifies:
 * - Document type (declaracion de renta, IVA, estado financiero, requerimiento DIAN, etc.)
 * - Key financial figures
 * - Risk indicators and inconsistencies
 * - Relevant Estatuto Tributario articles
 * - Recommended next actions
 */

import OpenAI from 'openai';

export interface DocumentAnalysis {
  documentType: string;
  documentTypeCode: string;
  keyFigures: KeyFigure[];
  riskIndicators: RiskIndicator[];
  relevantArticles: RelevantArticle[];
  recommendedActions: string[];
  summary: string;
}

export interface KeyFigure {
  label: string;
  value: string;
  category: 'ingreso' | 'costo' | 'deduccion' | 'impuesto' | 'patrimonio' | 'saldo' | 'otro';
}

export interface RiskIndicator {
  description: string;
  severity: 'bajo' | 'medio' | 'alto' | 'critico';
  recommendation: string;
}

export interface RelevantArticle {
  article: string;
  description: string;
  relevance: string;
}

const ANALYSIS_SYSTEM_PROMPT = `Eres un experto analizador de documentos contables y tributarios colombianos.
Tu tarea es analizar el texto extraido de un documento y devolver un analisis estructurado en formato JSON.

DEBES responder UNICAMENTE con un objeto JSON valido (sin markdown, sin backticks, sin texto adicional) con esta estructura exacta:

{
  "documentType": "Nombre descriptivo del tipo de documento",
  "documentTypeCode": "uno de: declaracion_renta, declaracion_iva, declaracion_retefuente, declaracion_ica, estado_financiero, requerimiento_dian, factura_electronica, certificado_ingresos, informacion_exogena, otro",
  "keyFigures": [
    {
      "label": "nombre del campo",
      "value": "valor encontrado con formato",
      "category": "uno de: ingreso, costo, deduccion, impuesto, patrimonio, saldo, otro"
    }
  ],
  "riskIndicators": [
    {
      "description": "descripcion del riesgo identificado",
      "severity": "uno de: bajo, medio, alto, critico",
      "recommendation": "accion recomendada"
    }
  ],
  "relevantArticles": [
    {
      "article": "Art. XXX E.T.",
      "description": "de que trata el articulo",
      "relevance": "por que es relevante para este documento"
    }
  ],
  "recommendedActions": [
    "accion recomendada 1",
    "accion recomendada 2"
  ],
  "summary": "Resumen ejecutivo del analisis del documento en 2-3 oraciones."
}

REGLAS:
- Identifica TODAS las cifras financieras mencionadas en el documento.
- Si detectas inconsistencias (ej. ingresos muy bajos vs patrimonio alto), reportalas como riskIndicators.
- Cita articulos especificos del Estatuto Tributario que apliquen.
- Las acciones recomendadas deben ser especificas y accionables.
- Si no puedes identificar el tipo de documento con certeza, usa "otro" y explica en el summary.
- SIEMPRE responde en espanol.
- El JSON debe ser valido y parseable directamente.`;

/**
 * Analyze a document's extracted text using OpenAI to identify type, figures, risks, and recommendations.
 */
export async function analyzeDocument(
  documentText: string,
  filename?: string
): Promise<DocumentAnalysis> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Truncate very long documents to avoid token limits
  const maxChars = 12000;
  const truncatedText = documentText.length > maxChars
    ? documentText.substring(0, maxChars) + '\n\n[... documento truncado por longitud ...]'
    : documentText;

  const userPrompt = filename
    ? `Analiza el siguiente documento (archivo: ${filename}):\n\n${truncatedText}`
    : `Analiza el siguiente documento:\n\n${truncatedText}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return fallbackAnalysis('No se obtuvo respuesta del modelo de analisis.');
    }

    // Parse the JSON response, stripping any accidental markdown fences
    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as DocumentAnalysis;

    // Validate required fields
    if (!parsed.documentType || !parsed.documentTypeCode) {
      return fallbackAnalysis('El analisis no pudo determinar el tipo de documento.');
    }

    return {
      documentType: parsed.documentType,
      documentTypeCode: parsed.documentTypeCode,
      keyFigures: Array.isArray(parsed.keyFigures) ? parsed.keyFigures : [],
      riskIndicators: Array.isArray(parsed.riskIndicators) ? parsed.riskIndicators : [],
      relevantArticles: Array.isArray(parsed.relevantArticles) ? parsed.relevantArticles : [],
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [],
      summary: parsed.summary || 'Analisis completado.',
    };
  } catch (error) {
    console.error('Document analysis failed:', error);
    return fallbackAnalysis(
      `Error durante el analisis del documento: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
}

function fallbackAnalysis(reason: string): DocumentAnalysis {
  return {
    documentType: 'Documento no identificado',
    documentTypeCode: 'otro',
    keyFigures: [],
    riskIndicators: [
      {
        description: reason,
        severity: 'medio',
        recommendation: 'Revise el documento manualmente o intente cargarlo nuevamente.',
      },
    ],
    relevantArticles: [],
    recommendedActions: [
      'Verifique que el documento fue cargado correctamente.',
      'Si es un PDF escaneado, asegurese de que el texto sea legible.',
      'Consulte con un Contador Publico para analisis manual.',
    ],
    summary: reason,
  };
}
