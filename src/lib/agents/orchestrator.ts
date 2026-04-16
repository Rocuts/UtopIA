// ---------------------------------------------------------------------------
// Orchestrator — central coordinator for the multi-agent system
// ---------------------------------------------------------------------------
// Flow: classify -> (T1: direct | T2/T3: enhance -> route -> [synthesize])
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { classifyQuery } from './classifier';
import { enhancePrompt } from './prompt-enhancer';
import { synthesizeResponses } from './synthesizer';
import { taxAgent } from './specialists/tax-agent';
import { accountingAgent } from './specialists/accounting-agent';
import { documentAgent } from './specialists/document-agent';
import { strategyAgent } from './specialists/strategy-agent';
import type {
  OrchestrateOptions,
  OrchestrateResult,
  SpecialistContext,
  SpecialistResult,
  AgentDomain,
} from './types';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const SPECIALISTS = {
  tax: taxAgent,
  accounting: accountingAgent,
  documents: documentAgent,
  strategy: strategyAgent,
} as const;

// ---------------------------------------------------------------------------
// T1: Direct lightweight response (no specialist needed)
// ---------------------------------------------------------------------------

async function handleT1(
  messages: ChatMessage[],
  language: 'es' | 'en',
): Promise<OrchestrateResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const langInstruction = language === 'en'
    ? 'Respond in English.'
    : 'Responde en espanol.';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are UtopIA, a friendly AI assistant for Colombian accounting and tax advisory. ${langInstruction}
Keep responses concise and helpful. If the user greets you, greet them back warmly and offer to help.
If the user thanks you, acknowledge and ask if there's anything else.
If the user asks what you can do, briefly describe your 4 specialist capabilities:
1. **Tributario**: Consultas sobre Estatuto Tributario, IVA, renta, retenciones, facturacion electronica, calendario tributario
2. **Contable**: Normas NIIF/IFRS, analisis financiero, indicadores, presupuestos, revisoria fiscal
3. **Documental**: Analisis de documentos subidos — declaraciones, requerimientos, estados financieros, facturas
4. **Estrategia**: Defensa ante DIAN, calculo de sanciones, planes de accion, gestion de riesgo, devoluciones`,
      },
      ...messages.slice(-6),
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  return {
    role: 'assistant',
    content: response.choices[0].message.content || '',
    tier: 'T1',
    agentsUsed: [],
    webSearchUsed: false,
  };
}

// ---------------------------------------------------------------------------
// Main orchestration entry point
// ---------------------------------------------------------------------------

export async function orchestrate(
  messages: ChatMessage[],
  options: OrchestrateOptions,
): Promise<OrchestrateResult> {
  const { language, useCase, documentContext, nitContext, erpConnections, onProgress } = options;

  const lastMessage = messages[messages.length - 1].content;
  const conversationHistory = messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // -----------------------------------------------------------------------
  // Step 1: Classify the query
  // -----------------------------------------------------------------------
  onProgress?.({ type: 'classifying' });
  const classification = await classifyQuery(lastMessage, conversationHistory, useCase);

  // -----------------------------------------------------------------------
  // Step 2: T1 — Direct response (cheap, fast)
  // -----------------------------------------------------------------------
  if (classification.tier === 'T1') {
    const result = await handleT1(messages, language);
    onProgress?.({ type: 'done' });
    return result;
  }

  // -----------------------------------------------------------------------
  // Step 3: Enhance the prompt
  // -----------------------------------------------------------------------
  onProgress?.({ type: 'enhancing', preview: lastMessage.slice(0, 80) });
  const enhanced = await enhancePrompt(lastMessage, conversationHistory, classification, nitContext);

  // -----------------------------------------------------------------------
  // Step 4: Route to specialist(s)
  // -----------------------------------------------------------------------
  const domains = classification.domains.length > 0
    ? classification.domains
    : (['tax'] as AgentDomain[]);

  const agentNames = domains.map((d) => SPECIALISTS[d].displayName);
  onProgress?.({ type: 'routing', agents: agentNames });

  const specialistCtx: SpecialistContext = {
    language,
    useCase,
    documentContext,
    nitContext,
    erpConnections,
    conversationHistory,
    onProgress,
  };

  let finalContent: string;
  let allWebSearchUsed = false;
  const allWebSources: string[] = [];
  let finalRisk: SpecialistResult['riskAssessment'] | undefined;
  let finalSanction: SpecialistResult['sanctionCalculation'] | undefined;

  if (classification.tier === 'T2' || domains.length === 1) {
    // ----- T2: Single specialist -----
    const agent = SPECIALISTS[domains[0]];
    const query = enhanced.enhanced;

    try {
      const result = await agent.execute(query, specialistCtx);
      finalContent = result.content;
      allWebSearchUsed = result.webSearchUsed;
      allWebSources.push(...result.webSources);
      finalRisk = result.riskAssessment;
      finalSanction = result.sanctionCalculation;
    } catch (agentError) {
      console.error(`[orchestrator] ${agent.displayName} failed:`, agentError instanceof Error ? agentError.message : agentError);
      finalContent = language === 'es'
        ? 'Hubo un problema tecnico al procesar su consulta. Por favor intente de nuevo en unos segundos. Si el problema persiste, reformule su pregunta.'
        : 'There was a technical issue processing your query. Please try again in a few seconds. If the problem persists, try rephrasing your question.';
    }
  } else {
    // ----- T3: Multiple specialists in parallel with individual failure recovery -----
    const tasks = domains.map(async (domain) => {
      const agent = SPECIALISTS[domain];
      const subQuery =
        enhanced.subQueries?.find((sq) => sq.domain === domain)?.query || enhanced.enhanced;
      try {
        const result = await agent.execute(subQuery, specialistCtx);
        return { agent: agent.displayName, domain, result, failed: false as const };
      } catch (agentError) {
        console.error(`[orchestrator] ${agent.displayName} failed in T3:`, agentError instanceof Error ? agentError.message : agentError);
        return {
          agent: agent.displayName,
          domain,
          result: {
            content: `[${agent.displayName} no pudo completar el analisis por un error tecnico.]`,
            webSearchUsed: false,
            webSources: [] as string[],
          } as SpecialistResult,
          failed: true as const,
        };
      }
    });

    const results = await Promise.all(tasks);

    // If ALL agents failed, return error message
    if (results.every((r) => r.failed)) {
      finalContent = language === 'es'
        ? 'Todos los agentes especializados tuvieron problemas tecnicos. Por favor intente de nuevo.'
        : 'All specialist agents encountered technical issues. Please try again.';
      onProgress?.({ type: 'done' });
      return {
        role: 'assistant',
        content: finalContent,
        tier: classification.tier,
        agentsUsed: [],
        webSearchUsed: false,
      };
    }

    // Collect metadata from all specialists
    for (const { result } of results) {
      if (result.webSearchUsed) allWebSearchUsed = true;
      allWebSources.push(...result.webSources);
      if (result.riskAssessment) {
        // Keep the higher risk assessment
        if (!finalRisk || result.riskAssessment.score > finalRisk.score) {
          finalRisk = result.riskAssessment;
        }
      }
      if (result.sanctionCalculation) {
        finalSanction = result.sanctionCalculation;
      }
    }

    // Synthesize outputs
    onProgress?.({ type: 'synthesizing' });
    finalContent = await synthesizeResponses({
      originalQuery: enhanced.enhanced,
      specialistOutputs: results.map(({ agent, result }) => ({ agent, result })),
      language,
    });
  }

  onProgress?.({ type: 'done' });

  return {
    role: 'assistant',
    content: finalContent,
    tier: classification.tier,
    agentsUsed: agentNames,
    enhancedQuery: enhanced.enhanced,
    webSearchUsed: allWebSearchUsed,
    webSources: allWebSearchUsed ? [...new Set(allWebSources)] : undefined,
    riskAssessment: finalRisk,
    sanctionCalculation: finalSanction,
  };
}
