import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { redactPII, extractNITContext, type NITContext } from '@/lib/security/pii-filter';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import { calculateSanction, type SanctionResult, type SanctionCalculation } from '@/lib/tools/sanction-calculator';
import { analyzeDocument } from '@/lib/tools/document-analyzer';
import { generateDianResponse, type DianResponseRequest } from '@/lib/tools/dian-response-generator';
import { assessRisk, type RiskAssessment } from '@/lib/tools/risk-assessor';
import { chatRequestSchema } from '@/lib/validation/schemas';
import { getTaxCalendar } from '@/lib/tools/tax-calendar';
import { orchestrate } from '@/lib/agents/orchestrator';
import type { ProgressEvent } from '@/lib/agents/types';

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
// Legacy handler (original monolithic system — unchanged)
// ---------------------------------------------------------------------------

// Tool definitions
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_tax_docs',
      description:
        'Search the LOCAL RAG knowledge base of Colombian tax regulations, DIAN doctrine, and accounting standards. ' +
        'Covers: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, ' +
        'normativa CTCP, procedimientos tributarios, sanciones, devoluciones, facturacion electronica. ' +
        'ALWAYS use this tool FIRST before answering any tax or accounting question. You may call it multiple times with different queries.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A specific search query to find relevant tax/accounting information. Be precise — e.g., "sancion por extemporaneidad Art. 641 E.T." or "reconocimiento ingresos NIIF 15".',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'Search trusted Colombian tax and accounting sources on the internet ' +
        '(dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com, etc.). ' +
        'Use this tool AFTER search_tax_docs when: ' +
        '(1) The local RAG database returned no results or insufficient information for the question, ' +
        '(2) The user asks about a specific article, decree, resolution, or procedure NOT in the local database, ' +
        '(3) The user asks about recent regulatory changes, DIAN updates, or current tax calendar, ' +
        '(4) You need specific details like filing deadlines, UVT values, tax thresholds, or rate tables, ' +
        '(5) The user asks about DIAN electronic systems, MUISCA, or procedural requirements.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A precise search query about the tax/accounting topic. Include relevant legal terms, article numbers, or regulation names when possible. E.g., "calendario tributario DIAN 2026" or "requisitos devolucion saldo a favor IVA Art. 850 E.T.".',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_sanction',
      description:
        'Calculate Colombian tax sanctions and interest (moratorios). Use this tool when the user asks about: ' +
        '(1) Sancion por extemporaneidad (Art. 641 E.T.) — late filing penalties, ' +
        '(2) Sancion por correccion (Art. 644 E.T.) — penalties for amending a tax return, ' +
        '(3) Sancion por inexactitud (Art. 647 E.T.) — penalties for inaccurate reporting, ' +
        '(4) Intereses moratorios (Art. 634 E.T.) — late payment interest. ' +
        'Also use when the user provides specific numbers (tax due, delay months, difference amounts) and wants to know the penalty. ' +
        'UVT 2026 = $52,374 COP (Res. DIAN 000238 del 15-dic-2025). Minimum sanction = 10 UVT = $523,740 COP.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'],
            description: 'Type of sanction to calculate.',
          },
          taxDue: { type: 'number', description: 'Impuesto a cargo (tax due amount in COP). Used for extemporaneidad calculation.' },
          grossIncome: { type: 'number', description: 'Ingresos brutos (gross income in COP). Used for extemporaneidad when taxDue is 0.' },
          difference: { type: 'number', description: 'Mayor valor a pagar / difference in tax (COP). Used for correccion and inexactitud.' },
          delayMonths: { type: 'number', description: 'Meses de retraso (months of delay). Used for extemporaneidad.' },
          isVoluntary: { type: 'boolean', description: 'Whether the correction is voluntary (before DIAN notice) or provoked. Default: true.' },
          principal: { type: 'number', description: 'Capital amount for interest calculation (COP). Used for intereses_moratorios.' },
          annualRate: { type: 'number', description: 'Annual interest rate (%). Default: 27.44% (tasa de usura aprox 2026).' },
          days: { type: 'number', description: 'Days of late payment (dias de mora). Used for intereses_moratorios.' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_document',
      description:
        'Analyze an uploaded tax/accounting document to extract key information. Use this tool when: ' +
        '(1) The user has uploaded a document and wants it analyzed, ' +
        '(2) The user asks about the content of a previously uploaded document, ' +
        '(3) The user wants to identify the type of a document (declaracion de renta, requerimiento DIAN, factura, etc.), ' +
        '(4) The user wants to extract key financial figures from a document, ' +
        '(5) The user wants to identify risks or inconsistencies in a document. ' +
        'This tool uses the RAG knowledge base to retrieve the document text, then analyzes it.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A search query to find the relevant uploaded document in the knowledge base. E.g., "declaracion de renta 2025" or the filename.' },
          filename: { type: 'string', description: 'Optional: the name of the uploaded file to analyze.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_dian_response',
      description:
        'Generate a professional draft response to a DIAN requirement (requerimiento). Use this tool when: ' +
        '(1) The user needs to respond to a DIAN requerimiento ordinario, especial, o pliego de cargos, ' +
        '(2) The user asks for help drafting a formal response to the DIAN, ' +
        '(3) The user needs to prepare a written defense against a DIAN notice, ' +
        '(4) The user needs a response template citing specific E.T. articles. ' +
        'The generated draft follows official DIAN response format with header, body, evidence list, legal basis, and closing.',
      parameters: {
        type: 'object',
        properties: {
          requirementType: { type: 'string', description: 'Type of DIAN requirement: "Requerimiento Ordinario", "Requerimiento Especial", "Pliego de Cargos", "Emplazamiento para Declarar", "Emplazamiento para Corregir", "Liquidacion Oficial", etc.' },
          requirementNumber: { type: 'string', description: 'DIAN requirement number (numero del requerimiento).' },
          requirementDate: { type: 'string', description: 'Date of the DIAN requirement.' },
          taxpayerName: { type: 'string', description: 'Full name of the taxpayer or company (contribuyente).' },
          taxpayerNIT: { type: 'string', description: 'NIT of the taxpayer.' },
          direccionSeccional: { type: 'string', description: 'DIAN Direccion Seccional (e.g., "Direccion Seccional de Impuestos de Bogota").' },
          keyPoints: { type: 'array', items: { type: 'string' }, description: 'Key points that the DIAN is asking about and need to be addressed in the response.' },
          relevantFacts: { type: 'array', items: { type: 'string' }, description: 'Relevant facts and circumstances of the case to include in the response.' },
          supportingDocuments: { type: 'array', items: { type: 'string' }, description: 'List of supporting documents to reference as annexes.' },
          additionalContext: { type: 'string', description: 'Any additional context relevant to drafting the response.' },
        },
        required: ['requirementType', 'taxpayerName', 'keyPoints', 'relevantFacts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assess_risk',
      description:
        'Perform a risk assessment of a Colombian tax case or situation. Use this tool when: ' +
        '(1) The user asks about the risk level of their tax situation, ' +
        '(2) The user is facing a DIAN requirement and wants to know how serious it is, ' +
        '(3) The user wants an evaluation of potential sanctions or exposure, ' +
        '(4) The conversation involves a tax dispute, audit, or compliance issue, ' +
        '(5) The user asks "que tan grave es?" or "cual es el riesgo?" or similar risk questions. ' +
        'Returns a risk level (bajo/medio/alto/critico), score (0-100), risk factors, and recommendations.',
      parameters: {
        type: 'object',
        properties: {
          caseDescription: {
            type: 'string',
            description: 'Detailed description of the tax case or situation to assess. Include: type of issue, amounts involved, time elapsed, actions taken, DIAN interactions, etc.',
          },
        },
        required: ['caseDescription'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tax_calendar',
      description:
        'Get the Colombian tax filing calendar personalized for a specific NIT. ' +
        'Performs MULTIPLE targeted web searches to find EXACT filing dates for this taxpayer. ' +
        'Use when: (1) User asks about tax calendar, filing deadlines, or "calendario tributario", ' +
        '(2) User provides a NIT and wants personalized filing dates, ' +
        '(3) User asks "cuándo debo declarar?" or "plazos" or deadline questions.',
      parameters: {
        type: 'object',
        properties: {
          nitLastDigit: { type: 'number', description: 'Last digit of the NIT number (0-9), BEFORE the check digit.' },
          year: { type: 'number', description: 'Year for the tax calendar (e.g., 2026).' },
          taxpayerType: {
            type: 'string',
            enum: ['persona_juridica', 'persona_natural', 'gran_contribuyente'],
            description: 'Type of taxpayer.',
          },
          city: { type: 'string', description: 'Municipality/city for municipal tax obligations (ICA, predial, retención ICA).' },
        },
        required: ['nitLastDigit', 'year', 'taxpayerType'],
      },
    },
  },
];

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
USE CASE CONTEXT — REPORTE FINANCIERO NIIF (ELITE CORPORATIVA):
El usuario quiere generar un reporte financiero de nivel elite. Este caso de uso activa el pipeline de 3 agentes especializados a traves del endpoint /api/financial-report.
IMPORTANTE: Si el usuario sube datos contables (CSV, balance de prueba, exportacion ERP) y pide un reporte financiero completo, informa que:
1. Necesitas los datos de la empresa: razon social, NIT, tipo societario, periodo fiscal
2. Una vez tenga esa informacion, el sistema generara automaticamente:
   - Estados Financieros NIIF (Balance, P&L, Flujo de Efectivo, Cambios en Patrimonio)
   - Dashboard Ejecutivo de KPIs (Razon Corriente, Margen Neto, ROA, Endeudamiento)
   - Punto de Equilibrio y Flujo de Caja Proyectado
   - Notas a los Estados Financieros
   - Borrador de Acta de Asamblea de Accionistas
3. Para consultas simples contables/financieras dentro de este modo, responde normalmente con las herramientas disponibles.
- USE the analyze_document tool when the user uploads financial data.
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
You are **UtopIA**, an expert AI assistant specialized in Colombian accounting, tax law, and financial analysis. You operate as a senior advisor for accounting firms, combining deep knowledge of:

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
- When presenting tax information, be SPECIFIC and ACTIONABLE — the user chose UtopIA to get expert answers, not generic guidance they could find themselves.

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

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Build message list — inject uploaded document content so the AI always
  // has access to it, not only when it calls the analyze_document tool.
  const docInjection: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (documentContext && documentContext.trim()) {
    const DOC_PREVIEW_LIMIT = 30_000;
    const truncated = documentContext.length > DOC_PREVIEW_LIMIT;
    const preview = truncated
      ? documentContext.slice(0, DOC_PREVIEW_LIMIT)
      : documentContext;
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

  const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...docInjection,
    ...messages,
  ];

  const MAX_TOOL_ROUNDS = 8;
  let currentMessages = [...fullMessages];
  let webSearchUsed = false;
  const webSources: string[] = [];
  let riskAssessment: RiskAssessment | undefined;
  let sanctionCalculation: SanctionResult | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: currentMessages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.1,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      currentMessages.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Error: Invalid tool arguments. Please try again with valid JSON.',
          });
          continue;
        }

        try {
          if (toolCall.function.name === 'search_tax_docs') {
            const context = await searchDocuments(args.query as string, 12);
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: context });
          } else if (toolCall.function.name === 'search_web') {
            const searchResponse = await searchWeb(args.query as string);
            const formatted = formatSearchResultsForLLM(searchResponse.results);
            webSearchUsed = true;
            for (const r of searchResponse.results) {
              if (r.url) webSources.push(r.url);
            }
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: formatted || 'NO_RESULTS: No se encontraron resultados relevantes en fuentes web colombianas.',
            });
          } else if (toolCall.function.name === 'calculate_sanction') {
            const result = calculateSanction(args as unknown as SanctionCalculation);
            sanctionCalculation = result;
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result, null, 2) });
          } else if (toolCall.function.name === 'analyze_document') {
            let docText: string;
            if (documentContext) {
              docText = documentContext;
            } else {
              docText = await searchDocuments(args.query as string, 8, { type: 'user_upload' });
            }
            const analysis = await analyzeDocument(docText, args.filename as string | undefined);
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(analysis, null, 2) });
          } else if (toolCall.function.name === 'draft_dian_response') {
            const draft = await generateDianResponse(args as unknown as DianResponseRequest);
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(draft, null, 2) });
          } else if (toolCall.function.name === 'assess_risk') {
            const assessment = await assessRisk(args.caseDescription as string);
            riskAssessment = assessment;
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(assessment, null, 2) });
          } else if (toolCall.function.name === 'get_tax_calendar') {
            const calendarResult = await getTaxCalendar(
              args.nitLastDigit as number,
              args.year as number,
              args.taxpayerType as 'persona_juridica' | 'persona_natural' | 'gran_contribuyente',
              args.city as string | undefined,
            );
            webSearchUsed = true;
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(calendarResult, null, 2) });
          } else {
            currentMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Unknown tool: ${toolCall.function.name}` });
          }
        } catch {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error al ejecutar ${toolCall.function.name}. Informa al usuario que hubo un problema técnico.`,
          });
        }
      }
      continue;
    }

    return NextResponse.json({
      role: 'assistant',
      content: choice.message.content,
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

  const finalResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: currentMessages,
    temperature: 0.1,
  });

  return NextResponse.json({
    role: 'assistant',
    content: finalResponse.choices[0].message.content,
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
      return handleOrchestrated(messages, language, useCase, documentContext, nitContext, stream, erpConnections);
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
