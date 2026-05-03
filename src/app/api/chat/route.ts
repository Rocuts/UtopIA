import { NextResponse } from 'next/server';
import { generateText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { MODELS } from '@/lib/config/models';
import { redactPII, extractNITContext, type NITContext } from '@/lib/security/pii-filter';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import { calculateSanction, type SanctionResult, type SanctionCalculation } from '@/lib/tools/sanction-calculator';
import { analyzeDocument } from '@/lib/tools/document-analyzer';
import { generateDianResponse, type DianResponseRequest } from '@/lib/tools/dian-response-generator';
import { assessRisk, type RiskAssessment } from '@/lib/tools/risk-assessor';
import { chatRequestSchema, DOCUMENT_MAX_CHARS } from '@/lib/validation/schemas';
import { getTaxCalendar } from '@/lib/tools/tax-calendar';
import { orchestrate } from '@/lib/agents/orchestrator';
import type { ProgressEvent } from '@/lib/agents/types';

// Vercel Fluid Compute: 300s ceiling for T3 parallel specialists + SSE.
// `export const runtime = 'nodejs'` removido en Ola 2: incompatible con
// `nextConfig.cacheComponents: true` (nodejs es default).
export const maxDuration = 300;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ---------------------------------------------------------------------------
// Feature flag: set UTOPIA_AGENT_MODE=orchestrated to enable multi-agent
// ---------------------------------------------------------------------------
const useOrchestration = () => process.env.UTOPIA_AGENT_MODE === 'orchestrated';

// ---------------------------------------------------------------------------
// Orchestrated handler (new multi-agent system with SSE streaming)
// ---------------------------------------------------------------------------

async function handleOrchestrated(
  req: Request,
  messages: ChatMessage[],
  language: 'es' | 'en',
  useCase: string,
  documentContext: string | undefined,
  nitContext: NITContext | null,
  stream: boolean,
  erpConnections?: Array<{ provider: string; credentials: Record<string, string> }>,
) {
  if (stream) {
    const encoder = new TextEncoder();
    // Forward the request's abort signal (e.g. client disconnects or hits Stop)
    // to in-flight OpenAI calls.
    const abortSignal = req.signal;

    const readableStream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        // If the client disconnects, stop enqueueing
        const onAbort = () => { closed = true; };
        abortSignal.addEventListener('abort', onAbort);

        try {
          const result = await orchestrate(messages, {
            language,
            useCase,
            documentContext,
            nitContext,
            erpConnections,
            onProgress: (event: ProgressEvent) => send('progress', event),
            onStreamToken: (delta: string) => send('content', { delta }),
            abortSignal,
          });
          send('result', result);
        } catch (error) {
          const isAbort = error instanceof Error && (
            error.name === 'AbortError' ||
            /abort/i.test(error.message)
          );
          if (!isAbort) {
            console.error('[chat] Orchestration error:', error instanceof Error ? error.message : error);
            send('error', { error: 'Internal server error during consultation.' });
          }
        } finally {
          abortSignal.removeEventListener('abort', onAbort);
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Non-streaming: return JSON (backward compat)
  const result = await orchestrate(messages, {
    language,
    useCase,
    documentContext,
    nitContext,
    erpConnections,
  });

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// Legacy handler (original monolithic system — migrado a AI SDK v6)
// ---------------------------------------------------------------------------
//
// Las definiciones de tools se construyen DENTRO del handler para poder cerrar
// sobre el `documentContext` y los buffers de side-effects (`webSearchUsed`,
// `webSources`, `riskAssessment`, `sanctionCalculation`) que se devuelven en
// la respuesta final. El loop manual de tool-calls del handler legacy original
// se reemplaza por `generateText({ tools, stopWhen: stepCountIs(MAX_TOOL_ROUNDS) })`,
// patrón canónico de AI SDK v6 (ver node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx).
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 8;

const USE_CASE_CONTEXT: Record<string, string> = {
  'dian-defense': `
USE CASE CONTEXT — DEFENSA ANTE REQUERIMIENTOS DIAN:
You are helping with a DIAN tax defense case. Focus on:
- Procedimiento tributario (Arts. 684-719 Estatuto Tributario)
- Tipos de requerimientos: ordinario (Art. 684), especial (Art. 685), pliego de cargos
- Liquidaciones oficiales: de revision (Art. 702), de aforo (Art. 715), de correccion aritmetica (Art. 697)
- Plazos de respuesta y recursos: reconsideracion (Art. 720), apelacion
- Sanciones: por inexactitud (Art. 647), extemporaneidad (Art. 641), por no declarar (Art. 643)
- Firmeza de declaraciones (Art. 714) y prescripcion
- Estrategias de defensa y atenuacion de sanciones
- USE the calculate_sanction tool when specific sanction amounts need to be computed.
- USE the draft_dian_response tool when the user needs a response draft.
- USE the assess_risk tool to evaluate the severity of the case.
`,
  'tax-refund': `
USE CASE CONTEXT — DEVOLUCION DE SALDOS A FAVOR:
You are helping with a tax refund recovery case. Focus on:
- Procedimiento de devoluciones (Arts. 850-865 Estatuto Tributario)
- Requisitos formales: solicitud, garantias, documentacion soporte
- Plazos: 50 dias habiles (general), 30 dias (produccion de bienes exentos), 10 dias (con garantia)
- Compensacion vs. devolucion (Art. 815)
- Causales de rechazo e inadmision (Art. 857)
- Devolucion con compensacion de deudas fiscales
- Intereses moratorios a favor del contribuyente (Art. 863)
- Saldo a favor en IVA, renta, retencion en la fuente
- USE the assess_risk tool to evaluate the likelihood of refund approval.
`,
  'due-diligence': `
USE CASE CONTEXT — PREPARACION PARA INVERSION/CREDITO/VENTA:
You are helping prepare a company for investment, credit, or sale. Focus on:
- Revision de cumplimiento tributario: declaraciones, pagos, sanciones pendientes
- Estados financieros bajo NIIF: razonabilidad, revelaciones, politicas contables
- Contingencias fiscales y provisiones
- Litigios tributarios en curso
- Estructura societaria y optimizacion fiscal
- Precios de transferencia (si aplica)
- Certificados de paz y salvo DIAN, seguridad social, parafiscales
- Dictamen del revisor fiscal
- USE the analyze_document tool when the user uploads financial statements or tax returns for review.
- USE the assess_risk tool to provide an overall risk profile.
`,
  'financial-intelligence': `
USE CASE CONTEXT — INTELIGENCIA FINANCIERA:
You are helping transform accounting data into actionable financial intelligence. Focus on:
- Analisis de indicadores financieros: liquidez, endeudamiento, rentabilidad, actividad
- Flujo de caja: operativo, de inversion, de financiacion
- Punto de equilibrio y analisis de contribucion marginal
- Presupuestos y proyecciones financieras
- Analisis de costos y estructura de gastos
- Benchmarking sectorial
- Modelacion financiera para toma de decisiones
- Impacto fiscal en decisiones de negocio
- Optimizacion de carga tributaria legal
- USE the analyze_document tool when the user uploads financial data for analysis.
`,
  'financial-report': `
USE CASE CONTEXT — REPORTE FINANCIERO NIIF (CHAT DE SEGUIMIENTO):

MODO DE OPERACION: Estas sirviendo un chat de seguimiento adjunto a un reporte YA GENERADO. El \`documentContext\` contiene:
(a) el REPORTE FINANCIERO consolidado en Markdown,
(b) el BALANCE DE PRUEBA ORIGINAL (texto extraido del XLSX/CSV).

Ambas fuentes estan disponibles INMEDIATAMENTE. NO necesitas pedirle archivos al usuario. NO necesitas "proceder con la herramienta" — los datos ya estan aqui.

REGLAS DE COMPORTAMIENTO DECISIVO (CRITICAS):

1. **Si el usuario cuestiona un numero** ("revisa bien, el activo es X", "el patrimonio esta mal", "no cuadra Y"), DEBES:
   a. Extraer del reporte el valor que tu sistema reporto (buscar "TOTAL ACTIVO", "TOTAL PATRIMONIO", etc. en el Markdown del reporte).
   b. Extraer del balance de prueba original el valor real (sumar auxiliares de la Clase PUC relevante: 1xxx Activo, 2xxx Pasivo, 3xxx Patrimonio, 4xxx Ingresos, 5xxx Gastos, 6xxx Costos, 7xxx Costos de produccion).
   c. Calcular la diferencia y DETERMINAR la causa (ej. "la utilidad del ejercicio \$1.439M no se sumo al patrimonio del balance").
   d. PROPONER la correccion usando el sentinel \`<<<PATCH_REPORT>>>\\n<reporte corregido completo>\\n<<<END_PATCH>>>\` — esto activa el boton "Aplicar al reporte" en la UI.
   e. NO ofrecer "¿te gustaria que proceda?", NO preguntar permiso para usar la herramienta. Hacer el trabajo.

2. **Si el usuario pide validar la ecuacion contable**, DEBES ejecutar el calculo AHORA mismo con los numeros del reporte — no mandarlo a revisar en otro lado. Calcula Activo - Pasivo - Patrimonio y reporta si cuadra o no, y por cuanto.

3. **Si detectas inconsistencia interna** (Balance dice Patrimonio = X pero Estado de Cambios dice Y, o Activo != Pasivo + Patrimonio), declaralo prominente al inicio de la respuesta y propone el fix. NO la ocultes ni la normalices ("puede haber diferencias naturales" es FALSO).

4. **Cuando uses numeros del balance de prueba**, recuerda la convencion PUC colombiana:
   - Clase 1 (Activo) y 5/6/7 (Gastos/Costos): naturaleza DEBITO. Saldo = Debe - Haber.
   - Clase 2 (Pasivo), 3 (Patrimonio), 4 (Ingresos): naturaleza CREDITO. Saldo = Haber - Debe.
   - Utilidad del ejercicio = Clase 4 - Clase 5 - Clase 6 - Clase 7. Si el balance esta ANTES del cierre contable, esta utilidad no esta en Clase 3 y hay que sumarla manualmente al patrimonio para que cuadre la ecuacion.

5. **Prohibiciones explicitas**:
   - NO respondas "puedo usar la herramienta de analisis si lo deseas" — tienes los datos, usa los datos.
   - NO respondas "te sugiero revisar las cuentas individuales" sin haberlas revisado tu primero.
   - NO listes "posibles discrepancias" genericas ("errores de calculo", "cuentas no incluidas") — diagnostica la REAL.
   - NO termines con preguntas retoricas cuando el usuario te dio informacion suficiente para actuar.

6. **Formato de respuesta cuando hay cifra en disputa**:
   - Encabezado: "Revision de [metrica]" con el diagnostico en 1 linea.
   - Tabla comparativa: Reportado | Correcto | Diferencia.
   - Causa raiz en 1-2 frases.
   - Patch propuesto con el sentinel si la correccion es clara.

7. Si el usuario recien empieza y sube un archivo nuevo (no hay reporte aun), ese caso lo maneja el flujo de intake — no deberias recibirlo aqui. Si llega, pidele que vaya a "Nueva Consulta > Reporte NIIF Elite".

- USE the analyze_document tool solo si el documentContext esta vacio o es insuficiente. Normalmente NO sera necesario.
`,
};

async function handleLegacy(
  messages: ChatMessage[],
  language: 'es' | 'en',
  useCase: string,
  documentContext: string | undefined,
  nitContext: NITContext | null,
) {
  const rawUserMessage = messages[messages.length - 1].content;

  // Language detection
  const userMsg = rawUserMessage.toLowerCase();
  const englishSignals = /\b(hello|hi|hey|help|need|tax|DIAN|refund|accounting|company|financial|investment|credit|report)\b/i;
  const spanishSignals = /\b(hola|necesito|ayuda|requerimiento|DIAN|impuesto|saldo|contabilidad|empresa|tributario|factura|declaracion|sancion)\b/i;
  let detectedLang = language;
  if (englishSignals.test(userMsg) && !spanishSignals.test(userMsg)) {
    detectedLang = 'en';
  } else if (spanishSignals.test(userMsg)) {
    detectedLang = 'es';
  }

  const langInstruction = detectedLang === 'en'
    ? 'CRITICAL: YOU MUST RESPOND IN ENGLISH. The user is communicating in English.'
    : 'CRITICO: DEBES RESPONDER COMPLETAMENTE EN ESPANOL. El usuario se comunica en espanol.';

  const useCaseContext = USE_CASE_CONTEXT[useCase] || '';

  let taxpayerContext = '';
  if (nitContext) {
    const typeLabel = nitContext.presumedType === 'persona_juridica'
      ? 'Persona Jurídica' : 'Persona Natural';
    taxpayerContext =
      '\nTAXPAYER CONTEXT (extracted from user NIT — personalize your response):\n' +
      '- Último dígito del NIT: ' + nitContext.lastDigit + '\n' +
      '- Últimos dos dígitos del NIT: ' + nitContext.lastTwoDigits + '\n' +
      '- Dígito de verificación: ' + (nitContext.checkDigit !== null ? nitContext.checkDigit : 'No proporcionado') + '\n' +
      '- Tipo presunto: ' + typeLabel + '\n' +
      '- YOU ALREADY KNOW the NIT last digit is ' + nitContext.lastDigit + '. Personalize ALL deadlines and obligations for this digit ONLY.\n';
  }

  const systemPrompt = `
You are **1+1** (Directorio Ejecutivo Digital), an expert AI assistant specialized in Colombian accounting, tax law, and financial analysis. You operate as a senior advisor for accounting firms, combining deep knowledge of:

1. **COLOMBIAN TAX LAW**: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial
2. **ACCOUNTING STANDARDS**: NIIF/IFRS (NIC), NIIF para PYMES (Grupo 2), normativa CTCP
3. **TAX PROCEDURES**: Requerimientos, liquidaciones oficiales, recursos, sanciones, devoluciones (Arts. 850-865 E.T.)
4. **FINANCIAL ANALYSIS**: Indicadores financieros, flujo de caja, modelacion, rentabilidad, estructura de costos
5. **DUE DILIGENCE**: Preparacion empresarial para inversion, credito bancario, M&A
6. **ELECTRONIC INVOICING**: Facturacion electronica, documentos soporte, nomina electronica

BEHAVIOR RULES:
- Always cite specific articles of the Estatuto Tributario, DIAN doctrine concepts, or NIIF standards when applicable
- When analyzing a DIAN requirement, identify: type of requirement, applicable articles, response deadlines, risk level, and defense strategy
- For tax refunds, verify: legal basis, required documentation, common rejection causes
- For financial analysis, provide actionable metrics and clear recommendations
- Use professional accounting terminology in the detected language
- If uncertain about current regulations, use web search to verify
- Always assess risk level: BAJO (low), MEDIO (medium), ALTO (high), CRITICO (critical)
- Format responses with clear sections, bullet points, and actionable next steps

ANTI-HALLUCINATION RULES (CRITICAL — NEVER VIOLATE):
- ONLY cite article numbers, deadlines, percentages, or UVT values if they appear VERBATIM in the retrieved documents or web search results.
- If search_tax_docs returns "NO_RESULTS" and search_web also returns no results, you MUST tell the user: "No encontré información confiable sobre este tema en mis fuentes. Te recomiendo consultar directamente en dian.gov.co o con un Contador Público certificado."
- NEVER invent article numbers, decree numbers, resolution numbers, or legal citations.
- NEVER guess sanction percentages, deadlines, or UVT amounts — use the calculate_sanction tool for calculations.
- If retrieved documents provide partial information, clearly state what is confirmed vs. what requires verification.
- Prefer saying "No tengo certeza sobre este punto específico" over generating plausible-sounding but unverified guidance.

PERSONALIZATION RULES (CRITICAL — ALWAYS FOLLOW):
- When a NIT is provided or available in the TAXPAYER CONTEXT below, personalize ALL responses for that specific NIT.
- For filing deadlines: show ONLY the specific dates for the NIT's last digit, NOT a generic table with all 10 digits.
- NEVER respond with "verifique según el último dígito de su NIT" or send the user to search elsewhere when you KNOW the NIT digit — USE IT to give specific, actionable dates.
- For calendar/deadline questions: ALWAYS use the \`get_tax_calendar\` tool for comprehensive, targeted searches.
- Structure calendar responses as organized tables sorted chronologically: Mes | Obligación | Fecha Límite | Base Legal.
- Classify obligations as: Nacional (DIAN) vs. Municipal. Include both when the user asks for "todas las obligaciones".
- Highlight upcoming deadlines (within 30 days from today) prominently.
- When presenting tax information, be SPECIFIC and ACTIONABLE — the user chose 1+1 to get expert answers, not generic guidance they could find themselves.

${taxpayerContext}
CRITICAL: You are an AI assistant, not a certified public accountant. Always recommend validation by a CPA (Contador Publico) for final decisions.

TOOL USAGE — MULTI-TIER SYSTEM:
You have access to SEVEN tools. Use them strategically:

**Tier 1 — \`search_tax_docs\` (Local RAG Database):**
1. ALWAYS call this tool FIRST before answering any tax or accounting question.
2. You may call it MULTIPLE TIMES with different queries to gather comprehensive context.
3. Use retrieved context to ground your response with specific citations.

**Tier 2 — \`search_web\` (Internet Search — Trusted Colombian Sources):**
4. If search_tax_docs returns NO results or INSUFFICIENT information, call \`search_web\` to find current information from the internet.
5. This searches trusted sources: dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com, and other Colombian tax/accounting databases.
6. When using web results, ALWAYS cite the source URL so the user can verify.
7. Mark web-sourced info with "Fuente:" followed by the URL.
8. Use this for: regulatory updates, filing deadlines, UVT values, DIAN resolutions, specific article text, procedures not in the local database.

**Tier 3 — Specialized Tools:**
9. \`calculate_sanction\`: Use when the user asks about sanctions, penalties, fines, or interest. ALWAYS use this for numerical calculations instead of computing manually. Present the structured result clearly.
10. \`analyze_document\`: Use when discussing uploaded documents or when the user wants document analysis. Retrieves document text from RAG and analyzes it.
11. \`draft_dian_response\`: Use when the user needs a formal response to a DIAN requirement. Collect the necessary information from the conversation first.
12. \`assess_risk\`: Use when the user asks about risk level, case severity, or when the situation warrants a risk evaluation. Include the risk assessment in your response.

**Calendar & Deadlines:**
13. \`get_tax_calendar\`: Use when the user asks about filing deadlines, calendario tributario, or tax schedules. This performs MULTIPLE targeted web searches for the SPECIFIC NIT digit and taxpayer type, returning comprehensive calendar data from trusted sources. ALWAYS prefer this over generic \`search_web\` calls for calendar/deadline questions. Use the taxpayer context to set the correct NIT digit and type. IMPORTANT: If the user mentions a city (Bogotá, Medellín, Cali, etc.), pass it as the \`city\` parameter for targeted municipal tax searches (ICA, predial). If the user asks for "todas las obligaciones" including municipal but doesn't specify a city, ASK which city/municipality they operate in before calling the tool — municipal calendars vary significantly by city.

${useCaseContext}

${langInstruction}
`;

  // Build message list — inject uploaded document content so the AI always
  // has access to it, not only when it calls the analyze_document tool.
  // Refactor T1+T5: limite unico via DOCUMENT_MAX_CHARS (antes hardcoded
  // 30_000 en este handler legacy — inconsistente con orchestrator y
  // base-agent que usaban 80_000).
  const docInjection: ModelMessage[] = [];
  if (documentContext && documentContext.trim()) {
    const truncated = documentContext.length > DOCUMENT_MAX_CHARS;
    const preview = truncated
      ? documentContext.slice(0, DOCUMENT_MAX_CHARS)
      : documentContext;
    if (truncated) {
      console.warn(
        `[chat/route legacy] documento truncado de ${documentContext.length} a ${DOCUMENT_MAX_CHARS} chars (DOCUMENT_MAX_CHARS)`,
      );
    }
    docInjection.push({
      role: 'system',
      content:
        'DOCUMENTO CARGADO POR EL USUARIO — CONTENIDO EXTRAIDO:\n' +
        'El usuario ha subido un documento. A continuacion se encuentra el texto extraido. ' +
        'DEBES usar esta informacion para responder cualquier pregunta sobre el documento del usuario. ' +
        'Si necesitas un analisis estructurado mas profundo (cifras clave, riesgos, articulos relevantes), ' +
        'usa la herramienta analyze_document.\n\n' +
        preview +
        (truncated
          ? '\n\n[... documento truncado por longitud. Para el analisis completo usa la herramienta analyze_document ...]'
          : ''),
    });
  }

  const fullMessages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    ...docInjection,
    ...messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
  ];

  // Side-effects acumulados durante el loop de tools — se exponen en la respuesta
  // final para que el cliente pueda mostrar fuentes web, riesgo y cálculos.
  let webSearchUsed = false;
  const webSources: string[] = [];
  let riskAssessment: RiskAssessment | undefined;
  let sanctionCalculation: SanctionResult | undefined;

  // ---------------------------------------------------------------------------
  // Tools — formato AI SDK v6. Mantenemos los MISMOS nombres que el systemPrompt
  // legacy (search_tax_docs, etc.) para no romper las instrucciones del modelo.
  // El loop de tool-calls lo maneja el SDK vía `stopWhen: stepCountIs(...)`.
  // ---------------------------------------------------------------------------
  const tools = {
    search_tax_docs: tool({
      description:
        'Search the LOCAL RAG knowledge base of Colombian tax regulations, DIAN doctrine, and accounting standards. ' +
        'Covers: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, ' +
        'normativa CTCP, procedimientos tributarios, sanciones, devoluciones, facturacion electronica. ' +
        'ALWAYS use this tool FIRST before answering any tax or accounting question. You may call it multiple times with different queries.',
      inputSchema: z.object({
        query: z.string().describe(
          'A specific search query to find relevant tax/accounting information. Be precise — e.g., "sancion por extemporaneidad Art. 641 E.T." or "reconocimiento ingresos NIIF 15".',
        ),
      }),
      execute: async ({ query }) => searchDocuments(query, 12),
    }),

    search_web: tool({
      description:
        'Search trusted Colombian tax and accounting sources on the internet ' +
        '(dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com, etc.). ' +
        'Use this tool AFTER search_tax_docs when: ' +
        '(1) The local RAG database returned no results or insufficient information for the question, ' +
        '(2) The user asks about a specific article, decree, resolution, or procedure NOT in the local database, ' +
        '(3) The user asks about recent regulatory changes, DIAN updates, or current tax calendar, ' +
        '(4) You need specific details like filing deadlines, UVT values, tax thresholds, or rate tables, ' +
        '(5) The user asks about DIAN electronic systems, MUISCA, or procedural requirements.',
      inputSchema: z.object({
        query: z.string().describe(
          'A precise search query about the tax/accounting topic. Include relevant legal terms, article numbers, or regulation names when possible. E.g., "calendario tributario DIAN 2026" or "requisitos devolucion saldo a favor IVA Art. 850 E.T.".',
        ),
      }),
      execute: async ({ query }) => {
        const searchResponse = await searchWeb(query);
        const formatted = formatSearchResultsForLLM(searchResponse.results);
        webSearchUsed = true;
        for (const r of searchResponse.results) {
          if (r.url) webSources.push(r.url);
        }
        return formatted || 'NO_RESULTS: No se encontraron resultados relevantes en fuentes web colombianas.';
      },
    }),

    calculate_sanction: tool({
      description:
        'Calculate Colombian tax sanctions and interest (moratorios). Use this tool when the user asks about: ' +
        '(1) Sancion por extemporaneidad (Art. 641 E.T.) — late filing penalties, ' +
        '(2) Sancion por correccion (Art. 644 E.T.) — penalties for amending a tax return, ' +
        '(3) Sancion por inexactitud (Art. 647 E.T.) — penalties for inaccurate reporting, ' +
        '(4) Intereses moratorios (Art. 634 E.T.) — late payment interest. ' +
        'Also use when the user provides specific numbers (tax due, delay months, difference amounts) and wants to know the penalty. ' +
        'UVT 2026 = $52,374 COP (Res. DIAN 000238 del 15-dic-2025). Minimum sanction = 10 UVT = $523,740 COP.',
      inputSchema: z.object({
        type: z.enum(['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'])
          .describe('Type of sanction to calculate.'),
        taxDue: z.number().optional().describe('Impuesto a cargo (tax due amount in COP). Used for extemporaneidad calculation.'),
        grossIncome: z.number().optional().describe('Ingresos brutos (gross income in COP). Used for extemporaneidad when taxDue is 0.'),
        difference: z.number().optional().describe('Mayor valor a pagar / difference in tax (COP). Used for correccion and inexactitud.'),
        delayMonths: z.number().optional().describe('Meses de retraso (months of delay). Used for extemporaneidad.'),
        isVoluntary: z.boolean().optional().describe('Whether the correction is voluntary (before DIAN notice) or provoked. Default: true.'),
        principal: z.number().optional().describe('Capital amount for interest calculation (COP). Used for intereses_moratorios.'),
        annualRate: z.number().optional().describe('Annual interest rate (%). Default: 27.44% (tasa de usura aprox 2026).'),
        days: z.number().optional().describe('Days of late payment (dias de mora). Used for intereses_moratorios.'),
      }),
      execute: async (args) => {
        const result = calculateSanction(args as unknown as SanctionCalculation);
        sanctionCalculation = result;
        return JSON.stringify(result, null, 2);
      },
    }),

    analyze_document: tool({
      description:
        'Analyze an uploaded tax/accounting document to extract key information. Use this tool when: ' +
        '(1) The user has uploaded a document and wants it analyzed, ' +
        '(2) The user asks about the content of a previously uploaded document, ' +
        '(3) The user wants to identify the type of a document (declaracion de renta, requerimiento DIAN, factura, etc.), ' +
        '(4) The user wants to extract key financial figures from a document, ' +
        '(5) The user wants to identify risks or inconsistencies in a document. ' +
        'This tool uses the RAG knowledge base to retrieve the document text, then analyzes it.',
      inputSchema: z.object({
        query: z.string().describe(
          'A search query to find the relevant uploaded document in the knowledge base. E.g., "declaracion de renta 2025" or the filename.',
        ),
        filename: z.string().optional().describe('Optional: the name of the uploaded file to analyze.'),
      }),
      execute: async ({ query, filename }) => {
        const docText = documentContext || (await searchDocuments(query, 8, { type: 'user_upload' }));
        const analysis = await analyzeDocument(docText, filename);
        return JSON.stringify(analysis, null, 2);
      },
    }),

    draft_dian_response: tool({
      description:
        'Generate a professional draft response to a DIAN requirement (requerimiento). Use this tool when: ' +
        '(1) The user needs to respond to a DIAN requerimiento ordinario, especial, o pliego de cargos, ' +
        '(2) The user asks for help drafting a formal response to the DIAN, ' +
        '(3) The user needs to prepare a written defense against a DIAN notice, ' +
        '(4) The user needs a response template citing specific E.T. articles. ' +
        'The generated draft follows official DIAN response format with header, body, evidence list, legal basis, and closing.',
      inputSchema: z.object({
        requirementType: z.string().describe('Type of DIAN requirement: "Requerimiento Ordinario", "Requerimiento Especial", "Pliego de Cargos", "Emplazamiento para Declarar", "Emplazamiento para Corregir", "Liquidacion Oficial", etc.'),
        requirementNumber: z.string().optional().describe('DIAN requirement number (numero del requerimiento).'),
        requirementDate: z.string().optional().describe('Date of the DIAN requirement.'),
        taxpayerName: z.string().describe('Full name of the taxpayer or company (contribuyente).'),
        taxpayerNIT: z.string().optional().describe('NIT of the taxpayer.'),
        direccionSeccional: z.string().optional().describe('DIAN Direccion Seccional (e.g., "Direccion Seccional de Impuestos de Bogota").'),
        keyPoints: z.array(z.string()).describe('Key points that the DIAN is asking about and need to be addressed in the response.'),
        relevantFacts: z.array(z.string()).describe('Relevant facts and circumstances of the case to include in the response.'),
        supportingDocuments: z.array(z.string()).optional().describe('List of supporting documents to reference as annexes.'),
        additionalContext: z.string().optional().describe('Any additional context relevant to drafting the response.'),
      }),
      execute: async (args) => {
        const draft = await generateDianResponse(args as unknown as DianResponseRequest);
        return JSON.stringify(draft, null, 2);
      },
    }),

    assess_risk: tool({
      description:
        'Perform a risk assessment of a Colombian tax case or situation. Use this tool when: ' +
        '(1) The user asks about the risk level of their tax situation, ' +
        '(2) The user is facing a DIAN requirement and wants to know how serious it is, ' +
        '(3) The user wants an evaluation of potential sanctions or exposure, ' +
        '(4) The conversation involves a tax dispute, audit, or compliance issue, ' +
        '(5) The user asks "que tan grave es?" or "cual es el riesgo?" or similar risk questions. ' +
        'Returns a risk level (bajo/medio/alto/critico), score (0-100), risk factors, and recommendations.',
      inputSchema: z.object({
        caseDescription: z.string().describe(
          'Detailed description of the tax case or situation to assess. Include: type of issue, amounts involved, time elapsed, actions taken, DIAN interactions, etc.',
        ),
      }),
      execute: async ({ caseDescription }) => {
        const assessment = await assessRisk(caseDescription);
        riskAssessment = assessment;
        return JSON.stringify(assessment, null, 2);
      },
    }),

    get_tax_calendar: tool({
      description:
        'Get the Colombian tax filing calendar personalized for a specific NIT. ' +
        'Performs MULTIPLE targeted web searches to find EXACT filing dates for this taxpayer. ' +
        'Use when: (1) User asks about tax calendar, filing deadlines, or "calendario tributario", ' +
        '(2) User provides a NIT and wants personalized filing dates, ' +
        '(3) User asks "cuándo debo declarar?" or "plazos" or deadline questions.',
      inputSchema: z.object({
        nitLastDigit: z.number().describe('Last digit of the NIT number (0-9), BEFORE the check digit.'),
        year: z.number().describe('Year for the tax calendar (e.g., 2026).'),
        taxpayerType: z.enum(['persona_juridica', 'persona_natural', 'gran_contribuyente']).describe('Type of taxpayer.'),
        city: z.string().optional().describe('Municipality/city for municipal tax obligations (ICA, predial, retención ICA).'),
      }),
      execute: async ({ nitLastDigit, year, taxpayerType, city }) => {
        const calendarResult = await getTaxCalendar(nitLastDigit, year, taxpayerType, city);
        webSearchUsed = true;
        return JSON.stringify(calendarResult, null, 2);
      },
    }),
  };

  // Loop nativo de tool-calling de AI SDK v6: hasta MAX_TOOL_ROUNDS pasos.
  // Si el modelo emite una herramienta no listada o args inválidos, el SDK
  // alimenta automáticamente el error de vuelta para que el modelo se recupere.
  let result;
  try {
    result = await generateText({
      model: MODELS.CHAT,
      messages: fullMessages,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_ROUNDS),
      temperature: 0.1,
    });
  } catch (err) {
    console.error('[chat] generateText error (legacy):', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Internal server error during consultation.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    role: 'assistant',
    content: result.text || '',
    webSearchUsed,
    webSources: webSearchUsed ? [...new Set(webSources)] : undefined,
    riskAssessment: riskAssessment
      ? {
          level: riskAssessment.level,
          score: riskAssessment.score,
          factors: riskAssessment.factors.map((f) => ({ description: f.description, severity: f.severity })),
          recommendations: riskAssessment.recommendations,
        }
      : undefined,
    sanctionCalculation: sanctionCalculation
      ? { amount: sanctionCalculation.amount, formula: sanctionCalculation.formula, article: sanctionCalculation.article, explanation: sanctionCalculation.explanation }
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// POST handler — entry point
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request format.' }, { status: 400 });
    }

    const { messages, language, useCase, documentContext, erpConnections } = parsed.data;

    // Extract NIT context BEFORE PII redaction
    let nitContext: NITContext | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        nitContext = extractNITContext(messages[i].content);
        if (nitContext) break;
      }
    }

    // Redact PII from the latest user message
    const lastUserMessage = redactPII(messages[messages.length - 1].content);
    messages[messages.length - 1].content = lastUserMessage;

    // Check for streaming request (header or query param)
    const url = new URL(req.url);
    const stream = req.headers.get('X-Stream') === 'true' || url.searchParams.get('stream') === '1';

    if (useOrchestration()) {
      return handleOrchestrated(req, messages, language, useCase, documentContext, nitContext, stream, erpConnections);
    }

    return handleLegacy(messages, language, useCase, documentContext, nitContext);
  } catch (error) {
    console.error('[chat] API error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Internal server error during consultation.' },
      { status: 500 },
    );
  }
}
