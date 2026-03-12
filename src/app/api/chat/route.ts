import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { redactPII } from '@/lib/security/pii-filter';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Tool definitions — RAG (local knowledge) + Web Search (internet fallback)
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_legal_docs',
      description:
        'Search the LOCAL RAG legal knowledge base for relevant U.S. law context. ' +
        'Covers: FLSA (wages, overtime, misclassification), EEOC/Title VII (discrimination, harassment, ADA), ' +
        'OSHA (workplace safety, workers comp, whistleblower), Immigration (worker protections, visas, I-9/E-Verify), ' +
        'and Personal Injury & Auto Accidents (fault/no-fault, PIP, rideshare liability, statute of limitations). ' +
        'ALWAYS use this tool FIRST before answering any legal question. You may call it multiple times with different queries.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A specific search query to find relevant legal information. Be precise — e.g., "overtime pay requirements FLSA" or "workplace discrimination Title VII".',
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
        'Search the INTERNET for current, up-to-date legal information from trusted government and legal sources ' +
        '(dol.gov, eeoc.gov, osha.gov, uscis.gov, law.cornell.edu, congress.gov, etc.). ' +
        'Use this tool AFTER search_legal_docs when: ' +
        '(1) The local RAG database returned no results or insufficient information for the question, ' +
        '(2) The user asks about a specific law, statute, regulation, or procedure NOT in the local database, ' +
        '(3) The user asks about recent legal changes, updates, or current events, ' +
        '(4) You need specific details like statute numbers, filing deadlines, monetary thresholds, or state-specific rules, ' +
        '(5) The user asks about a jurisdiction or state-specific law not covered locally.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A precise search query about the legal topic. Include relevant legal terms, law names, or statute numbers when possible. E.g., "California meal break law requirements 2026" or "FMLA eligibility requirements".',
          },
        },
        required: ['query'],
      },
    },
  },
];

export async function POST(req: Request) {
  try {
    const { messages, language = 'en', jurisdiction = 'Federal' } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Invalid messages.' }, { status: 400 });
    }

    // Redact PII from the latest user message
    const rawUserMessage = messages[messages.length - 1].content;
    const lastUserMessage = redactPII(rawUserMessage);
    messages[messages.length - 1].content = lastUserMessage;

    // Language detection
    const userMsg = lastUserMessage.toLowerCase();
    const englishSignals = /\b(hello|hi|hey|help|my|the|is|are|was|were|have|has|can|could|would|should|what|how|when|where|why|who|which|please|thank|need|want|work|boss|fired|paid|wage|hurt|injured|accident)\b/i;
    const detectedLang = englishSignals.test(userMsg) ? 'en' : language;

    const langInstruction = detectedLang === 'en'
      ? 'CRITICAL: YOU MUST RESPOND IN ENGLISH. The user is communicating in English.'
      : 'CRÍTICO: DEBES RESPONDER COMPLETAMENTE EN ESPAÑOL. El usuario se comunica en español.';

    const systemPrompt = `
You are **AiVocate**, a powerful and comprehensive U.S. legal advisor for workers. You are an expert across ALL of the following areas:

🔹 **Employment Discrimination (EEOC / Title VII / ADA / ADEA)** — Race, color, religion, sex (including LGBTQ+), national origin, age (40+), disability, genetics, harassment, hostile work environment, wrongful termination, constructive dismissal, reasonable accommodations, DEI compliance.
🔹 **Wages & Hours (FLSA)** — Minimum wage (federal & state), overtime (1.5x over 40hrs), exempt vs. non-exempt classification, tipped employees, child labor, recordkeeping, contractor vs. employee misclassification, wage theft.
🔹 **Workplace Safety & Workers' Compensation (OSHA)** — Safe workplace rights, injury reporting, whistleblower/retaliation protection, medical coverage, employer notification mandates, heat illness standards, OSHA inspections and fines.
🔹 **Immigration & Employment Law** — Worker protections regardless of documentation status, U Visas (crime victims), T Visas (trafficking victims), Deferred Action for labor enforcement, H-1B/H-2A/H-2B visas, I-9/E-Verify compliance, EAD renewals, ICE enforcement policies, state-level protections.
🔹 **Retaliation & Whistleblower Protections** — Protections against employer retaliation for exercising any labor right, filing complaints, or cooperating with investigations.
🔹 **Personal Injury & Auto Accidents** — Car/truck/motorcycle accidents (fault vs. no-fault states, PIP, comparative negligence), work-related vehicle accidents, rideshare accidents, statute of limitations by state, types of damages, uninsured/underinsured motorist claims, undocumented immigrant rights.

YOUR MISSION: Provide direct, specific, and actionable legal guidance to workers based on U.S. federal and state labor laws. You advocate FOR the worker.

TOOL USAGE — TWO-TIER SEARCH SYSTEM:
You have access to TWO search tools. Use them in this order:

**Tier 1 — \`search_legal_docs\` (Local RAG Database):**
1. ALWAYS call this tool FIRST before answering any legal question.
2. You may call it MULTIPLE TIMES with different queries to gather comprehensive context.
3. Use retrieved context to ground your response with specific citations.

**Tier 2 — \`search_web\` (Internet Search — Trusted Legal Sources):**
4. If search_legal_docs returns NO results or INSUFFICIENT information, call \`search_web\` to find current legal information from the internet.
5. This searches trusted sources: dol.gov, eeoc.gov, osha.gov, uscis.gov, law.cornell.edu, congress.gov, and other legal databases.
6. When using web results, ALWAYS cite the source URL so the user can verify.
7. Mark web-sourced info with "📌 Source:" followed by the URL.
8. Use this for: state-specific laws, recent legal changes, filing deadlines, specific statute text, procedures not in the local database.

CRITICAL BEHAVIOR — ASK BEFORE DECLINING:
When a user mentions a topic that MIGHT relate to your areas (e.g., a traffic accident, a slip and fall, an injury), you MUST first ask clarifying questions to determine if it connects to employment law BEFORE deciding it's out of scope.

CORE RULES:
1. **PROVIDE DIRECT ADVICE**: Analyze the situation and provide concrete legal advice, action steps, and directly address their case.
2. **CITE SOURCES**: When using retrieved context, cite the specific laws, acts, or source documents.
3. **JURISDICTION AWARENESS**: Tailor advice to the user's jurisdiction: **${jurisdiction}**. Clarify when a law is Federal vs. state-specific.
4. **BE AUTHORITATIVE & EMPATHETIC**: Speak with the confidence of an experienced attorney advocating for the worker. Be warm and human.
5. **SCOPE BOUNDARIES**: If a question falls completely outside U.S. labor/employment/immigration law, politely explain your specialization and suggest they seek appropriate counsel.

${langInstruction}
`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build the conversation with system prompt
    const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    // Tool-calling loop: let the model call search_legal_docs and search_web as needed
    const MAX_TOOL_ROUNDS = 5; // increased to allow RAG → web search → follow-up
    let currentMessages = [...fullMessages];
    let webSearchUsed = false;
    const webSources: string[] = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: currentMessages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
      });

      const choice = response.choices[0];

      // If the model wants to call tools, execute them and loop
      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        currentMessages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          // Type guard: only process standard function tool calls
          if (toolCall.type !== 'function') continue;
          const args = JSON.parse(toolCall.function.arguments);

          if (toolCall.function.name === 'search_legal_docs') {
            // Tier 1: Local RAG search
            const context = await searchDocuments(args.query, 5);
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: context,
            });
          } else if (toolCall.function.name === 'search_web') {
            // Tier 2: Internet search via Tavily
            console.log(`🌐 Web search (round ${round + 1}): "${args.query}"`);
            const searchResponse = await searchWeb(args.query);
            const formatted = formatSearchResultsForLLM(searchResponse.results);
            webSearchUsed = true;
            for (const r of searchResponse.results) {
              if (r.url) webSources.push(r.url);
            }
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: formatted || 'No relevant web results found. Provide guidance based on your general legal expertise.',
            });
          }
        }

        continue;
      }

      // Model is done — return the final response
      return NextResponse.json({
        role: 'assistant',
        content: choice.message.content,
        webSearchUsed,
        webSources: webSearchUsed ? [...new Set(webSources)] : undefined,
      });
    }

    // Safety fallback: if we hit max rounds, do one final call without tools
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
    });

  } catch (error: any) {
    console.error("❌ Error in chat API route:", error);
    return NextResponse.json(
      { error: "Internal server error during legal consultation." },
      { status: 500 }
    );
  }
}
