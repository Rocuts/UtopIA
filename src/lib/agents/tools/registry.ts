// ---------------------------------------------------------------------------
// Centralized tool registry for all specialist agents
// ---------------------------------------------------------------------------
// Tool DEFINITIONS live here; tool IMPLEMENTATIONS remain in src/lib/tools/.
// Each specialist agent picks only the tools it needs via getToolsForAgent().
// ---------------------------------------------------------------------------

import type OpenAI from 'openai';
import { searchDocuments } from '@/lib/rag/vectorstore';
import { searchWeb, formatSearchResultsForLLM } from '@/lib/search/web-search';
import { calculateSanction, type SanctionResult, type SanctionCalculation } from '@/lib/tools/sanction-calculator';
import { analyzeDocument } from '@/lib/tools/document-analyzer';
import { generateDianResponse, type DianResponseRequest } from '@/lib/tools/dian-response-generator';
import { assessRisk, type RiskAssessment } from '@/lib/tools/risk-assessor';
import { getTaxCalendar } from '@/lib/tools/tax-calendar';

// ---------------------------------------------------------------------------
// Tool definition catalog
// ---------------------------------------------------------------------------

const SEARCH_DOCS: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_docs',
    description:
      'Search the LOCAL RAG knowledge base of Colombian tax regulations, DIAN doctrine, and accounting standards. ' +
      'Covers: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, ' +
      'normativa CTCP, procedimientos tributarios, sanciones, devoluciones, facturacion electronica. ' +
      'ALWAYS use this tool FIRST before answering any tax or accounting question.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A specific search query. Be precise — e.g., "sancion por extemporaneidad Art. 641 E.T."',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const SEARCH_WEB: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_web',
    description:
      'Search trusted Colombian tax and accounting sources on the internet ' +
      '(dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com). ' +
      'Use AFTER search_docs when local results are insufficient or for current regulatory updates.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A precise search query. Include legal terms, article numbers, or regulation names when possible.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const CALCULATE_SANCTION: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'calculate_sanction',
    description:
      'Calculate Colombian tax sanctions and interest. Types: ' +
      'extemporaneidad (Art. 641), correccion (Art. 644), inexactitud (Art. 647), intereses_moratorios (Art. 634). ' +
      'UVT 2026 = $52,374 COP. Minimum sanction = 10 UVT = $523,740 COP.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'],
          description: 'Type of sanction to calculate.',
        },
        taxDue: { type: 'number', description: 'Impuesto a cargo (COP). For extemporaneidad.' },
        grossIncome: { type: 'number', description: 'Ingresos brutos (COP). For extemporaneidad when taxDue is 0.' },
        difference: { type: 'number', description: 'Difference in tax (COP). For correccion/inexactitud.' },
        delayMonths: { type: 'number', description: 'Months of delay. For extemporaneidad.' },
        isVoluntary: { type: 'boolean', description: 'Voluntary correction (before DIAN notice)? Default: true.' },
        principal: { type: 'number', description: 'Capital amount (COP). For intereses_moratorios.' },
        annualRate: { type: 'number', description: 'Annual rate (%). Default: 27.44%.' },
        days: { type: 'number', description: 'Days of late payment. For intereses_moratorios.' },
      },
      required: ['type'],
    },
  },
};

const ANALYZE_DOCUMENT: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'analyze_document',
    description:
      'Analyze an uploaded tax/accounting document to extract key information, document type, ' +
      'financial figures, risks, and recommendations.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find the relevant uploaded document. E.g., "declaracion de renta 2025".',
        },
        filename: { type: 'string', description: 'Optional: filename to analyze.' },
      },
      required: ['query'],
    },
  },
};

const DRAFT_DIAN_RESPONSE: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'draft_dian_response',
    description:
      'Generate a professional draft response to a DIAN requirement (requerimiento). ' +
      'Follows official DIAN response format with header, body, evidence list, legal basis, and closing.',
    parameters: {
      type: 'object',
      properties: {
        requirementType: { type: 'string', description: 'Type: "Requerimiento Ordinario", "Requerimiento Especial", "Pliego de Cargos", etc.' },
        requirementNumber: { type: 'string', description: 'DIAN requirement number.' },
        requirementDate: { type: 'string', description: 'Date of the DIAN requirement.' },
        taxpayerName: { type: 'string', description: 'Full name of taxpayer or company.' },
        taxpayerNIT: { type: 'string', description: 'NIT of taxpayer.' },
        direccionSeccional: { type: 'string', description: 'DIAN Direccion Seccional.' },
        keyPoints: { type: 'array', items: { type: 'string' }, description: 'Key points DIAN is asking about.' },
        relevantFacts: { type: 'array', items: { type: 'string' }, description: 'Facts and circumstances of the case.' },
        supportingDocuments: { type: 'array', items: { type: 'string' }, description: 'Supporting documents to reference.' },
        additionalContext: { type: 'string', description: 'Additional context for drafting.' },
      },
      required: ['requirementType', 'taxpayerName', 'keyPoints', 'relevantFacts'],
    },
  },
};

const ASSESS_RISK: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'assess_risk',
    description:
      'Perform a risk assessment of a Colombian tax/accounting case. ' +
      'Returns risk level (bajo/medio/alto/critico), score (0-100), factors, and recommendations.',
    parameters: {
      type: 'object',
      properties: {
        caseDescription: {
          type: 'string',
          description: 'Detailed description of the case: type, amounts, time elapsed, actions taken, DIAN interactions.',
        },
      },
      required: ['caseDescription'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const GET_TAX_CALENDAR: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_tax_calendar',
    description:
      'Get the Colombian tax filing calendar personalized for a specific NIT. ' +
      'Returns national and municipal obligations filtered for the NIT last digit.',
    parameters: {
      type: 'object',
      properties: {
        nitLastDigit: { type: 'number', description: 'Last digit of the NIT (0-9), BEFORE the check digit.' },
        year: { type: 'number', description: 'Year for the tax calendar (e.g., 2026).' },
        taxpayerType: {
          type: 'string',
          enum: ['persona_juridica', 'persona_natural', 'gran_contribuyente'],
          description: 'Type of taxpayer.',
        },
        city: { type: 'string', description: 'Municipality for municipal tax obligations (ICA, predial).' },
      },
      required: ['nitLastDigit', 'year', 'taxpayerType'],
    },
  },
};

// ---------------------------------------------------------------------------
// Agent -> Tool mapping
// ---------------------------------------------------------------------------

const AGENT_TOOLS = {
  tax: [SEARCH_DOCS, SEARCH_WEB, CALCULATE_SANCTION, DRAFT_DIAN_RESPONSE, ASSESS_RISK, GET_TAX_CALENDAR],
  accounting: [SEARCH_DOCS, SEARCH_WEB, ANALYZE_DOCUMENT, ASSESS_RISK],
} as const;

export type AgentName = keyof typeof AGENT_TOOLS;

export function getToolsForAgent(agent: AgentName): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [...AGENT_TOOLS[agent]];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolExecContext {
  documentContext?: string;
}

export interface ToolExecResult {
  content: string;
  /** Side-effect metadata */
  meta?: {
    webSearchUsed?: boolean;
    webSources?: string[];
    riskAssessment?: RiskAssessment;
    sanctionCalculation?: SanctionResult;
  };
}

/**
 * Execute a tool call by name. Returns the string content to feed back to the
 * model plus optional structured metadata for the orchestrator.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<ToolExecResult> {
  switch (toolName) {
    case 'search_docs': {
      const content = await searchDocuments(args.query as string, 12);
      return { content };
    }

    case 'search_web': {
      const searchResponse = await searchWeb(args.query as string);
      const formatted = formatSearchResultsForLLM(searchResponse.results);
      const urls = searchResponse.results.map((r) => r.url).filter(Boolean) as string[];
      return {
        content: formatted || 'NO_RESULTS: No se encontraron resultados relevantes.',
        meta: { webSearchUsed: true, webSources: urls },
      };
    }

    case 'calculate_sanction': {
      const result = calculateSanction(args as unknown as SanctionCalculation);
      return {
        content: JSON.stringify(result, null, 2),
        meta: { sanctionCalculation: result },
      };
    }

    case 'analyze_document': {
      let docText: string;
      if (ctx.documentContext) {
        docText = ctx.documentContext;
      } else {
        docText = await searchDocuments(args.query as string, 8, { type: 'user_upload' });
      }
      const analysis = await analyzeDocument(docText, args.filename as string | undefined);
      return { content: JSON.stringify(analysis, null, 2) };
    }

    case 'draft_dian_response': {
      const draft = await generateDianResponse(args as unknown as DianResponseRequest);
      return { content: JSON.stringify(draft, null, 2) };
    }

    case 'assess_risk': {
      const assessment = await assessRisk(args.caseDescription as string);
      return {
        content: JSON.stringify(assessment, null, 2),
        meta: { riskAssessment: assessment },
      };
    }

    case 'get_tax_calendar': {
      const result = await getTaxCalendar(
        args.nitLastDigit as number,
        args.year as number,
        args.taxpayerType as 'persona_juridica' | 'persona_natural' | 'gran_contribuyente',
        args.city as string | undefined,
      );
      return {
        content: JSON.stringify(result, null, 2),
        meta: { webSearchUsed: true },
      };
    }

    default:
      return { content: `Unknown tool: ${toolName}` };
  }
}
