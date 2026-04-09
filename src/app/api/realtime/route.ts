import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        tools: [
          {
            type: 'function',
            name: 'search_tax_docs',
            description: 'Busca en la base de conocimiento LOCAL de normativa tributaria colombiana. Cubre: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, CTCP, procedimientos tributarios, sanciones, devoluciones, facturación electrónica. SIEMPRE usa esta herramienta PRIMERO antes de responder cualquier pregunta tributaria o contable.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Consulta específica sobre normativa tributaria o contable colombiana' }
              },
              required: ['query']
            }
          },
          {
            type: 'function',
            name: 'search_web',
            description: 'Busca en fuentes colombianas confiables de internet (dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com). Usar DESPUÉS de search_tax_docs cuando no hay suficiente información local, o para datos actualizados como calendarios tributarios, UVT vigente, o resoluciones recientes.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Consulta precisa sobre temas tributarios/contables. Incluir artículos, decretos o resoluciones cuando sea posible.' }
              },
              required: ['query']
            }
          },
          {
            type: 'function',
            name: 'calculate_sanction',
            description: 'Calcula sanciones tributarias colombianas: extemporaneidad (Art. 641 E.T.), corrección (Art. 644), inexactitud (Art. 647), e intereses moratorios (Art. 634). Usar cuando el usuario pregunte cuánto tendría que pagar en sanciones, multas, o intereses.',
            parameters: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'], description: 'Tipo de sanción a calcular' },
                taxDue: { type: 'number', description: 'Impuesto a cargo en COP' },
                grossIncome: { type: 'number', description: 'Ingresos brutos en COP' },
                difference: { type: 'number', description: 'Mayor valor a pagar (para corrección/inexactitud)' },
                delayMonths: { type: 'number', description: 'Meses de retraso' },
                isVoluntary: { type: 'boolean', description: '¿Corrección voluntaria?' },
                principal: { type: 'number', description: 'Capital para intereses moratorios' },
                annualRate: { type: 'number', description: 'Tasa de interés anual (default 27.44%)' },
                days: { type: 'number', description: 'Días de mora' }
              },
              required: ['type']
            }
          },
          {
            type: 'function',
            name: 'get_platform_info',
            description: 'Obtiene información sobre los servicios y capacidades de la plataforma UtopIA. Usar cuando el usuario pregunte qué puede hacer UtopIA, qué servicios ofrece, cómo funciona, o necesite orientación sobre qué caso de uso elegir.',
            parameters: {
              type: 'object',
              properties: {
                topic: { type: 'string', enum: ['servicios', 'defensa_dian', 'devolucion', 'due_diligence', 'inteligencia_financiera', 'como_funciona', 'precios'], description: 'Tema sobre el que el usuario pregunta' }
              },
              required: ['topic']
            }
          },
          {
            type: 'function',
            name: 'get_tax_calendar',
            description: 'Obtiene el calendario tributario colombiano personalizado para un NIT específico. Realiza múltiples búsquedas web dirigidas para encontrar las fechas EXACTAS de vencimiento. Usar cuando: (1) el usuario pregunte por calendario tributario o plazos, (2) el usuario mencione un NIT y quiera saber sus fechas, (3) preguntas como "cuándo debo declarar?". EXTRAER el último dígito del NIT de lo que el usuario dijo (antes del dígito de verificación).',
            parameters: {
              type: 'object',
              properties: {
                nitLastDigit: { type: 'number', description: 'Último dígito del NIT (0-9), ANTES del dígito de verificación. Ej: NIT 860001317-4 → último dígito es 7.' },
                year: { type: 'number', description: 'Año del calendario tributario (ej: 2026).' },
                taxpayerType: { type: 'string', enum: ['persona_juridica', 'persona_natural', 'gran_contribuyente'], description: 'Tipo de contribuyente. NITs que empiezan con 8 o 9 son típicamente persona_juridica.' },
                city: { type: 'string', description: 'Ciudad/municipio para obligaciones municipales (ICA, predial). Ej: "Bogotá", "Medellín". Si el usuario no la menciona, PREGUNTAR antes de llamar esta herramienta.' }
              },
              required: ['nitLastDigit', 'year', 'taxpayerType']
            }
          }
        ],
        tool_choice: 'auto',
        instructions: `
          You are **UtopIA**, an expert AI assistant specialized in Colombian accounting, tax law, and financial analysis via real-time voice conversation.

          YOUR AREAS OF EXPERTISE:
          - Colombian Tax Law (Estatuto Tributario) — obligations, declarations, sanctions, procedures, deadlines, UVT calculations.
          - DIAN Procedures — requerimientos ordinarios y especiales, liquidaciones oficiales, recursos de reconsideración, fiscalización.
          - Accounting Standards (NIIF/IFRS) — NIC, NIIF para PYMES (Grupo 2), normativa CTCP, recognition, measurement, disclosure.
          - Tax Refunds (Devoluciones) — saldos a favor en IVA/renta, requisitos, plazos, garantías, causales de rechazo (Arts. 850-865 E.T.).
          - Financial Analysis — indicadores financieros, flujo de caja, rentabilidad, estructura de costos, punto de equilibrio, modelación.
          - Due Diligence — preparación empresarial para inversión, crédito bancario, M&A, cumplimiento tributario, contingencias fiscales.
          - Electronic Invoicing — facturación electrónica, documentos soporte, nómina electrónica, resoluciones DIAN.

          CORE RULES:
          1. PROVIDE DIRECT ADVICE: Analyze the user's situation and give concrete tax/accounting guidance and action steps. Be specific with article citations and regulatory references.
          2. USE TOOLS — TWO-TIER SEARCH: You have TWO tools:
             - 'search_tax_docs': Searches the LOCAL RAG database of Colombian tax regulations and accounting standards. ALWAYS use this FIRST.
             - 'search_web': Searches the INTERNET for current tax/accounting info from trusted Colombian sources (dian.gov.co, actualicese.com, gerencie.com, etc.). Use this AFTER search_tax_docs if local results are empty or insufficient.
          3. SMART FALLBACK: If both tools return no results, you may still assist using your general expertise. Indicate when you're providing general guidance.
          4. CITE AUTHORITY: Reference specific articles of the Estatuto Tributario, DIAN doctrine (conceptos, oficios), NIIF standards, or decrees. When citing web sources, mention the source name.
          5. RISK ASSESSMENT: Always assess risk level when relevant: BAJO (low), MEDIO (medium), ALTO (high), CRÍTICO (critical).
          6. BE PROFESSIONAL & CLEAR: Speak with the confidence of a senior tax advisor. Be warm, conversational, and professional. Many callers are dealing with urgent DIAN requirements or complex financial decisions.
          7. BILINGUAL (AUTO-DETECT): Respond fluently in the SAME language the user speaks to you. If they speak English, respond in English. If they speak Spanish, respond in Spanish. Match their language naturally and immediately.
          8. DISCLAIMER: You are an AI assistant, not a certified public accountant (Contador Público). Always recommend validation by a CPA for final decisions.
          9. SCOPE: If after clarifying questions a topic is truly outside Colombian tax/accounting/financial law, briefly provide any useful general guidance you can, then recommend a specialized professional. Never just say "I can't help with that" — always offer something useful.
          10. PERSONALIZATION: When the user mentions a NIT, extract the last digit (BEFORE the check digit) and use it to personalize ALL deadlines and obligations. Example: NIT 860001317-4 → last digit is 7, check digit is 4. NEVER give generic "verifique según su NIT" responses — you HEARD the NIT, so USE IT to give specific dates.
          11. TAX CALENDAR: When asked about filing deadlines or "calendario tributario", ALWAYS use the get_tax_calendar tool with the extracted NIT digit. Present dates as a clear, organized list ONLY for that specific digit. Classify obligations as Nacional (DIAN) vs. Municipal. Never present a generic table with all 10 digits.
        `,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Return the ephemeral token to the client
    return NextResponse.json({
      client_secret: data.client_secret.value,
    });
  } catch (error) {
    console.error('Realtime token generation error.');
    return NextResponse.json(
      { error: 'Failed to generate ephemeral token.' },
      { status: 500 }
    );
  }
}
