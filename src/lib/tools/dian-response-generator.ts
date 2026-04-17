/**
 * DIAN Response Draft Generator
 *
 * Generates professional response drafts for DIAN requirements in official format.
 * Follows Colombian tax procedure conventions and DIAN format requirements.
 */

import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';

export interface DianResponseRequest {
  requirementType: string;
  requirementNumber?: string;
  requirementDate?: string;
  taxpayerName: string;
  taxpayerNIT?: string;
  direccionSeccional?: string;
  keyPoints: string[];
  relevantFacts: string[];
  supportingDocuments?: string[];
  additionalContext?: string;
}

export interface DianResponseDraft {
  fullDraft: string;
  sections: {
    header: string;
    opening: string;
    body: string;
    evidenceList: string;
    legalBasis: string;
    closing: string;
  };
  citedArticles: string[];
  warnings: string[];
}

const GENERATION_SYSTEM_PROMPT = `Eres un experto en procedimiento tributario colombiano especializado en redactar respuestas formales a requerimientos de la DIAN.

Tu tarea es generar un borrador de respuesta profesional en formato oficial colombiano.

DEBES responder UNICAMENTE con un objeto JSON valido (sin markdown, sin backticks) con esta estructura:

{
  "sections": {
    "header": "Encabezado completo con destinatario, referencia, NIT",
    "opening": "Saludo formal e identificacion del requerimiento",
    "body": "Cuerpo estructurado respondiendo punto por punto, citando articulos",
    "evidenceList": "Lista numerada de anexos/documentos soporte",
    "legalBasis": "Fundamentos juridicos aplicables",
    "closing": "Cierre profesional con bloque de firma"
  },
  "citedArticles": ["Art. XXX E.T.", "Art. YYY E.T."],
  "warnings": ["Advertencia o nota importante para el contador"]
}

FORMATO DE LA RESPUESTA DIAN:
1. ENCABEZADO: Ciudad y fecha, "Senores DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES - DIAN", Direccion Seccional, Ciudad.
2. REFERENCIA: Tipo de requerimiento, numero y fecha.
3. ASUNTO: Respuesta al requerimiento con identificacion del contribuyente y NIT.
4. SALUDO: "Respetados senores:"
5. CUERPO: "En atencion al [tipo de requerimiento] No. [numero] del [fecha], me permito dar respuesta en los siguientes terminos:" seguido de respuesta punto por punto.
6. ANEXOS: "Para efectos probatorios, adjunto los siguientes documentos:" seguido de lista numerada "Anexo 1: ...", "Anexo 2: ...".
7. FUNDAMENTO LEGAL: Articulos del E.T. y doctrina aplicable.
8. CIERRE: "Cordialmente," seguido de nombre, NIT/CC, contador publico (si aplica), tarjeta profesional.

REGLAS:
- Usa lenguaje formal y juridico colombiano.
- Cita articulos especificos del Estatuto Tributario.
- Cada punto del requerimiento debe tener una respuesta estructurada.
- Incluye recomendaciones en warnings si detectas riesgos procesales.
- Si faltan datos (NIT, numero de requerimiento), usa placeholders como [NIT DEL CONTRIBUYENTE].
- SIEMPRE responde en espanol.`;

/**
 * Generate a professional DIAN response draft.
 */
export async function generateDianResponse(
  request: DianResponseRequest
): Promise<DianResponseDraft> {
  const userPrompt = buildPromptFromRequest(request);

  try {
    const result = await generateText({
      model: MODELS.CHAT,
      messages: [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      maxOutputTokens: 3000,
    });

    const content = result.text?.trim();
    if (!content) {
      return fallbackDraft(request, 'No se obtuvo respuesta del modelo.');
    }

    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);

    // Assemble the full draft from sections
    const sections = parsed.sections || {};
    const fullDraft = [
      sections.header || '',
      '',
      sections.opening || '',
      '',
      sections.body || '',
      '',
      sections.evidenceList || '',
      '',
      sections.legalBasis || '',
      '',
      sections.closing || '',
    ].join('\n');

    return {
      fullDraft,
      sections: {
        header: sections.header || '',
        opening: sections.opening || '',
        body: sections.body || '',
        evidenceList: sections.evidenceList || '',
        legalBasis: sections.legalBasis || '',
        closing: sections.closing || '',
      },
      citedArticles: Array.isArray(parsed.citedArticles) ? parsed.citedArticles : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch (error) {
    console.error('DIAN response generation failed:', error);
    return fallbackDraft(
      request,
      `Error generando la respuesta: ${error instanceof Error ? error.message : 'Error desconocido'}`
    );
  }
}

function buildPromptFromRequest(request: DianResponseRequest): string {
  const lines: string[] = [
    `Genera un borrador de respuesta formal para el siguiente requerimiento de la DIAN:`,
    '',
    `TIPO DE REQUERIMIENTO: ${request.requirementType}`,
  ];

  if (request.requirementNumber) {
    lines.push(`NUMERO: ${request.requirementNumber}`);
  }
  if (request.requirementDate) {
    lines.push(`FECHA DEL REQUERIMIENTO: ${request.requirementDate}`);
  }

  lines.push(`CONTRIBUYENTE: ${request.taxpayerName}`);

  if (request.taxpayerNIT) {
    lines.push(`NIT: ${request.taxpayerNIT}`);
  }
  if (request.direccionSeccional) {
    lines.push(`DIRECCION SECCIONAL: ${request.direccionSeccional}`);
  }

  lines.push('', 'PUNTOS A RESPONDER:');
  for (const point of request.keyPoints) {
    lines.push(`- ${point}`);
  }

  lines.push('', 'HECHOS RELEVANTES:');
  for (const fact of request.relevantFacts) {
    lines.push(`- ${fact}`);
  }

  if (request.supportingDocuments && request.supportingDocuments.length > 0) {
    lines.push('', 'DOCUMENTOS SOPORTE DISPONIBLES:');
    for (const doc of request.supportingDocuments) {
      lines.push(`- ${doc}`);
    }
  }

  if (request.additionalContext) {
    lines.push('', `CONTEXTO ADICIONAL: ${request.additionalContext}`);
  }

  return lines.join('\n');
}

function fallbackDraft(request: DianResponseRequest, reason: string): DianResponseDraft {
  const header =
    `Bogota D.C., [FECHA]\n\n` +
    `Senores\n` +
    `DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES - DIAN\n` +
    `${request.direccionSeccional || 'Direccion Seccional [CIUDAD]'}\n` +
    `Ciudad\n\n` +
    `Referencia: ${request.requirementType} ${request.requirementNumber ? `No. ${request.requirementNumber}` : 'No. [NUMERO]'}\n` +
    `NIT: ${request.taxpayerNIT || '[NIT DEL CONTRIBUYENTE]'}\n` +
    `Contribuyente: ${request.taxpayerName}`;

  const opening =
    `Respetados senores:\n\n` +
    `En atencion al ${request.requirementType} ` +
    `${request.requirementNumber ? `No. ${request.requirementNumber}` : ''} ` +
    `${request.requirementDate ? `del ${request.requirementDate}` : ''}, ` +
    `me permito dar respuesta en los siguientes terminos:`;

  const body = request.keyPoints.map((point, i) =>
    `${i + 1}. Respecto a: ${point}\n[Desarrollar respuesta con fundamento legal]`
  ).join('\n\n');

  const evidenceList = (request.supportingDocuments || []).map((doc, i) =>
    `Anexo ${i + 1}: ${doc}`
  ).join('\n');

  return {
    fullDraft: [header, opening, body, evidenceList, 'Cordialmente,', request.taxpayerName].join('\n\n'),
    sections: {
      header,
      opening,
      body: body || '[Desarrollar respuesta]',
      evidenceList: evidenceList || 'Anexo 1: [Documentos soporte]',
      legalBasis: '[Incluir articulos del E.T. aplicables]',
      closing: `Cordialmente,\n\n${request.taxpayerName}\nNIT: ${request.taxpayerNIT || '[NIT]'}`,
    },
    citedArticles: [],
    warnings: [
      reason,
      'Este es un borrador basico generado como respaldo. Revise y complete manualmente.',
      'Consulte con un abogado tributarista antes de presentar la respuesta.',
    ],
  };
}
