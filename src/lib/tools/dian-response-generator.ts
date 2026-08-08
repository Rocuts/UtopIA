/**
 * DIAN Response Draft Generator
 *
 * Generates professional response drafts for DIAN requirements in official format.
 * Follows Colombian tax procedure conventions and DIAN format requirements.
 *
 * Auditoria 2026-08: esta es la superficie donde un output truncado hace mas
 * dano. El borrador se descarga y se radica ante la DIAN; un corte por `length`
 * despues de la seccion `body` producia un escrito sin fundamento legal ni
 * bloque de firma que `JSON.parse` aceptaba sin chistar, porque el modelo
 * cerraba el objeto. Ahora la llamada pasa por `callStructuredTool`
 * (finishReason auditado + validacion Zod + telemetria) y cualquier corte cae
 * al `fallbackDraft`, que SI le dice al usuario que el borrador es de respaldo.
 */

import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { callStructuredTool } from './structured-tool-call';

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

// ---------------------------------------------------------------------------
// Contrato de salida (strict mode 2026 — ver docs/spec/zod-strict-mode-2026.md)
// ---------------------------------------------------------------------------
// Las 6 secciones son obligatorias y no vacias. Esa es justamente la garantia
// que faltaba: `legalBasis` y `closing` son las ultimas que emite el modelo y
// por tanto las primeras que desaparecen cuando el output se corta. Un escrito
// sin fundamento legal ni bloque de firma NO puede salir presentado como
// completo.

const DianSectionsSchema = z.object({
  header: z.string().min(1).describe('Ciudad y fecha, destinatario DIAN, Direccion Seccional, referencia y NIT'),
  opening: z.string().min(1).describe('Saludo formal ("Respetados senores:") e identificacion del requerimiento'),
  body: z.string().min(1).describe('Cuerpo punto por punto, con fundamento normativo en cada respuesta'),
  evidenceList: z.string().min(1).describe('Anexos numerados: "Anexo 1: ...", "Anexo 2: ..."'),
  legalBasis: z.string().min(1).describe('Articulos del E.T. y doctrina aplicable'),
  closing: z.string().min(1).describe('"Cordialmente," + nombre, NIT/CC, contador publico y tarjeta profesional si aplica'),
});

export const DianResponseDraftSchema = z.object({
  sections: DianSectionsSchema,
  // Los articulos del ejemplo son solo ilustrativos del FORMATO de la cita; el
  // codigo no depende de ellos. Verificados vigentes a 2026-08:
  //   Art. 705 E.T.   — Termino para notificar el requerimiento especial
  //                     (3 anos; termino elevado de 2 a 3 por la Ley 1819/2016).
  //   Art. 771-2 E.T. — Procedencia de costos, deducciones e impuestos
  //                     descontables (exige factura o documento equivalente).
  citedArticles: z.array(z.string().min(1)).describe('Ej: ["Art. 705 E.T.", "Art. 771-2 E.T."]'),
  warnings: z.array(z.string().min(1)).describe('Riesgos procesales o datos faltantes que el contador debe revisar'),
});

// El schema NO va en prosa — lo enforza `Output.object({ schema })`. Aqui solo
// queda la estructura formal del escrito y las reglas de juicio.
const GENERATION_SYSTEM_PROMPT = `Eres un experto en procedimiento tributario colombiano especializado en redactar respuestas formales a requerimientos de la DIAN.

<task>Redactar el borrador de una respuesta formal en el formato oficial colombiano.</task>

<constraints>
  - NEVER cites articulos, doctrina, cifras o hechos que no consten en el requerimiento o en los hechos relevantes recibidos.
  - Estructura del escrito: encabezado (ciudad y fecha, "Senores DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES - DIAN", Direccion Seccional, Ciudad); referencia (tipo de requerimiento, numero y fecha); asunto con identificacion del contribuyente y NIT; saludo "Respetados senores:"; cuerpo que abre con "En atencion al [tipo] No. [numero] del [fecha], me permito dar respuesta en los siguientes terminos:" y responde punto por punto; anexos numerados precedidos de "Para efectos probatorios, adjunto los siguientes documentos:"; fundamento legal; cierre "Cordialmente," con bloque de firma.
  - Lenguaje formal y juridico colombiano.
  - Cada punto del requerimiento debe tener su respuesta con fundamento normativo.
  - If faltan datos (NIT, numero de requerimiento, fecha) then usa un placeholder explicito como [NIT DEL CONTRIBUYENTE] y anotalo en warnings, otherwise no agregues placeholders.
  - If detectas un riesgo procesal (termino por vencer, carga probatoria no cubierta) then registralo en warnings.
  - Responde siempre en espanol.
</constraints>`;

/**
 * Generate a professional DIAN response draft.
 */
export async function generateDianResponse(
  request: DianResponseRequest
): Promise<DianResponseDraft> {
  const userPrompt = buildPromptFromRequest(request);

  try {
    const json = await callStructuredTool({
      toolName: 'dian-response-generator',
      model: MODELS.CHAT,
      schema: DianResponseDraftSchema,
      system: GENERATION_SYSTEM_PROMPT,
      userContent: userPrompt,
      maxOutputTokens: 3000,
      temperature: 0.2,
    });

    const { sections } = json;
    const fullDraft = [
      sections.header,
      '',
      sections.opening,
      '',
      sections.body,
      '',
      sections.evidenceList,
      '',
      sections.legalBasis,
      '',
      sections.closing,
    ].join('\n');

    return {
      fullDraft,
      sections,
      citedArticles: json.citedArticles,
      warnings: json.warnings,
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
