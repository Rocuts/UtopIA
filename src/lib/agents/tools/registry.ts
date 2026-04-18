// ---------------------------------------------------------------------------
// Centralized tool registry for all specialist agents
// ---------------------------------------------------------------------------
// Tool DEFINITIONS live here; tool IMPLEMENTATIONS remain en src/lib/tools/.
// Each specialist agent picks only the tools it needs via getToolsForAgent().
//
// Migrado a AI SDK v6 (Vercel AI Gateway). Las tools se exponen ahora como
// `Record<string, Tool>` usando el helper `tool()` con `inputSchema` Zod.
//
// Decisión de diseño: las tools se definen SIN la propiedad `execute`. El loop
// manual en BaseSpecialist se encarga de despachar las llamadas a `executeTool`
// de este mismo módulo, inyectando el `ToolExecContext` (documentos cargados,
// conexiones ERP, etc.) que es por-llamada y no por-tool. Esto preserva la
// semántica del loop original con MAX_TOOL_ROUNDS y `withRetry`.
// ---------------------------------------------------------------------------

import { tool, type Tool } from 'ai';
import { z } from 'zod';
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
//
// Cada tool se define SIN `execute`. El despacho ocurre en el loop manual del
// especialista (ver BaseSpecialist) que invoca `executeTool(name, args, ctx)`.
// ---------------------------------------------------------------------------

const SEARCH_DOCS = tool({
  description:
    'Search the LOCAL RAG knowledge base of Colombian tax regulations, DIAN doctrine, and accounting standards. ' +
    'Covers: Estatuto Tributario, decretos reglamentarios, resoluciones DIAN, doctrina oficial, NIIF/IFRS, ' +
    'normativa CTCP, procedimientos tributarios, sanciones, devoluciones, facturacion electronica. ' +
    'ALWAYS use this tool FIRST before answering any tax or accounting question.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('A specific search query. Be precise — e.g., "sancion por extemporaneidad Art. 641 E.T."'),
  }),
});

const SEARCH_WEB = tool({
  description:
    'Search trusted Colombian tax and accounting sources on the internet ' +
    '(dian.gov.co, secretariasenado.gov.co, ctcp.gov.co, actualicese.com, gerencie.com). ' +
    'Use AFTER search_docs when local results are insufficient or for current regulatory updates.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('A precise search query. Include legal terms, article numbers, or regulation names when possible.'),
  }),
});

const CALCULATE_SANCTION = tool({
  description:
    'Calcula sanciones e intereses tributarios colombianos. Tipos: ' +
    'extemporaneidad (Art. 641 ET), correccion (Art. 644 ET), inexactitud (Art. 647 ET con reducciones Arts. 640/709), intereses_moratorios (Arts. 634-635 ET con INTERÉS DIARIO COMPUESTO). ' +
    'UVT 2026 = $52.374 COP. Sanción mínima = 10 UVT = $523.740 COP.',
  inputSchema: z.object({
    type: z
      .enum(['extemporaneidad', 'correccion', 'inexactitud', 'intereses_moratorios'])
      .describe('Tipo de sanción.'),
    taxDue: z.number().optional().describe('Impuesto a cargo (COP). Para extemporaneidad.'),
    grossIncome: z
      .number()
      .optional()
      .describe('Ingresos brutos (COP). Para extemporaneidad cuando taxDue = 0.'),
    difference: z.number().optional().describe('Diferencia (COP). Para correccion e inexactitud.'),
    delayMonths: z.number().optional().describe('Meses de retraso. Para extemporaneidad.'),
    isVoluntary: z
      .boolean()
      .optional()
      .describe(
        'SOLO para "correccion": voluntaria (10%) antes de requerimiento especial vs. provocada (20%). Default: true.',
      ),
    inexactitudReduction: z
      .enum(['none', 'art_709_half', 'art_709_quarter', 'art_640_50', 'art_640_75'])
      .optional()
      .describe(
        'SOLO para "inexactitud". Reducción aplicable sobre la base del 100%: none (plena), art_709_half (1/2 por aceptación post-requerimiento), art_709_quarter (1/4 por aceptación antes de ampliación), art_640_50 (gradualidad 50% sin antecedentes 4 años), art_640_75 (gradualidad 75% sin antecedentes 2 años). Default: none.',
      ),
    principal: z.number().optional().describe('Capital (COP). Para intereses_moratorios.'),
    annualRate: z
      .number()
      .optional()
      .describe(
        'Tasa efectiva anual (%): tasa de usura vigente del mes de mora MENOS 2 pp (Art. 635 ET). Obtener de certificación Superfinanciera. Si no se provee, usa fallback solo para estimación.',
      ),
    days: z.number().optional().describe('Días de mora. Para intereses_moratorios.'),
  }),
});

const ANALYZE_DOCUMENT = tool({
  description:
    'Analyze an uploaded tax/accounting document to extract key information, document type, ' +
    'financial figures, risks, and recommendations.',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Search query to find the relevant uploaded document. E.g., "declaracion de renta 2025".'),
    filename: z.string().optional().describe('Optional: filename to analyze.'),
  }),
});

const DRAFT_DIAN_RESPONSE = tool({
  description:
    'Generate a professional draft response to a DIAN requirement (requerimiento). ' +
    'Follows official DIAN response format with header, body, evidence list, legal basis, and closing.',
  inputSchema: z.object({
    requirementType: z
      .string()
      .describe('Type: "Requerimiento Ordinario", "Requerimiento Especial", "Pliego de Cargos", etc.'),
    requirementNumber: z.string().optional().describe('DIAN requirement number.'),
    requirementDate: z.string().optional().describe('Date of the DIAN requirement.'),
    taxpayerName: z.string().describe('Full name of taxpayer or company.'),
    taxpayerNIT: z.string().optional().describe('NIT of taxpayer.'),
    direccionSeccional: z.string().optional().describe('DIAN Direccion Seccional.'),
    keyPoints: z.array(z.string()).describe('Key points DIAN is asking about.'),
    relevantFacts: z.array(z.string()).describe('Facts and circumstances of the case.'),
    supportingDocuments: z.array(z.string()).optional().describe('Supporting documents to reference.'),
    additionalContext: z.string().optional().describe('Additional context for drafting.'),
  }),
});

const ASSESS_RISK = tool({
  description:
    'Perform a risk assessment of a Colombian tax/accounting case. ' +
    'Returns risk level (bajo/medio/alto/critico), score (0-100), factors, and recommendations.',
  inputSchema: z.object({
    caseDescription: z
      .string()
      .describe(
        'Detailed description of the case: type, amounts, time elapsed, actions taken, DIAN interactions.',
      ),
  }),
});

const GET_TAX_CALENDAR = tool({
  description:
    'Get the Colombian tax filing calendar personalized for a specific NIT. ' +
    'Returns national and municipal obligations filtered for the NIT last digit.',
  inputSchema: z.object({
    nitLastDigit: z.number().describe('Last digit of the NIT (0-9), BEFORE the check digit.'),
    year: z.number().describe('Year for the tax calendar (e.g., 2026).'),
    taxpayerType: z
      .enum(['persona_juridica', 'persona_natural', 'gran_contribuyente'])
      .describe('Type of taxpayer.'),
    city: z.string().optional().describe('Municipality for municipal tax obligations (ICA, predial).'),
  }),
});

const QUERY_ERP = tool({
  description:
    'Consulta datos contables en tiempo real desde el ERP conectado del usuario. ' +
    'Usa esta herramienta cuando el usuario pregunte sobre datos financieros reales de su empresa: ' +
    'balances, facturas, movimientos contables, terceros, o plan de cuentas. ' +
    'NO la uses para preguntas teoricas o normativas — solo para datos reales de la empresa.',
  inputSchema: z.object({
    type: z
      .enum(['trial_balance', 'invoices', 'journal_entries', 'contacts', 'chart_of_accounts'])
      .describe(
        'Tipo de datos a consultar: trial_balance (balance de prueba), invoices (facturas), ' +
          'journal_entries (movimientos contables), contacts (terceros/clientes/proveedores), ' +
          'chart_of_accounts (plan de cuentas PUC)',
      ),
    period: z
      .string()
      .optional()
      .describe(
        'Periodo fiscal: "2025" (año completo), "2025-Q1" (trimestre), "2025-06" (mes). ' +
          'Usar para trial_balance y chart_of_accounts.',
      ),
    dateFrom: z
      .string()
      .optional()
      .describe('Fecha inicio ISO (YYYY-MM-DD). Para invoices y journal_entries.'),
    dateTo: z
      .string()
      .optional()
      .describe('Fecha fin ISO (YYYY-MM-DD). Para invoices y journal_entries.'),
    accountCode: z
      .string()
      .optional()
      .describe('Codigo de cuenta PUC para filtrar (ej: "41" para ingresos, "52" para gastos de ventas).'),
  }),
});

// ---------------------------------------------------------------------------
// Agent -> Tool mapping
// ---------------------------------------------------------------------------
//
// Mapeo de cada agente al subset de tools que tiene disponibles.
// Las claves del Record son los nombres de las tools que el modelo verá.
// ---------------------------------------------------------------------------

const AGENT_TOOLS = {
  tax: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    calculate_sanction: CALCULATE_SANCTION,
    analyze_document: ANALYZE_DOCUMENT,
    assess_risk: ASSESS_RISK,
    get_tax_calendar: GET_TAX_CALENDAR,
    query_erp: QUERY_ERP,
  },
  accounting: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    analyze_document: ANALYZE_DOCUMENT,
    assess_risk: ASSESS_RISK,
    query_erp: QUERY_ERP,
  },
  documents: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    analyze_document: ANALYZE_DOCUMENT,
    assess_risk: ASSESS_RISK,
  },
  strategy: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    calculate_sanction: CALCULATE_SANCTION,
    analyze_document: ANALYZE_DOCUMENT,
    draft_dian_response: DRAFT_DIAN_RESPONSE,
    assess_risk: ASSESS_RISK,
    get_tax_calendar: GET_TAX_CALENDAR,
    query_erp: QUERY_ERP,
  },
  litigation: {
    search_docs: SEARCH_DOCS,
    search_web: SEARCH_WEB,
    calculate_sanction: CALCULATE_SANCTION,
    analyze_document: ANALYZE_DOCUMENT,
    draft_dian_response: DRAFT_DIAN_RESPONSE,
    assess_risk: ASSESS_RISK,
    get_tax_calendar: GET_TAX_CALENDAR,
  },
} as const satisfies Record<string, Record<string, Tool>>;

export type AgentName = keyof typeof AGENT_TOOLS;

/**
 * Devuelve el conjunto de tools (formato AI SDK) para el especialista dado.
 *
 * Las tools se devuelven SIN `execute` — el despacho lo hace el loop manual
 * vía `executeTool(name, args, ctx)` para inyectar el `ToolExecContext`
 * por-llamada (documentos, ERP, etc.).
 */
export function getToolsForAgent(agent: AgentName): Record<string, Tool> {
  return { ...AGENT_TOOLS[agent] };
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolExecContext {
  documentContext?: string;
  erpConnections?: Array<{ provider: string; credentials: Record<string, string> }>;
}

export interface ToolExecResult {
  content: string;
  /** Side-effect metadata */
  meta?: {
    webSearchUsed?: boolean;
    webSources?: string[];
    riskAssessment?: RiskAssessment;
    sanctionCalculation?: SanctionResult;
    erpProvider?: string;
    erpRecordCount?: number;
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

    case 'query_erp': {
      const { queryERP } = await import('@/lib/tools/erp-query');
      const connections = (ctx.erpConnections || []) as import('@/lib/tools/erp-query').ERPConnectionInfo[];
      const result = await queryERP(args as any, connections);
      return {
        content: result.content,
        meta: { erpProvider: result.provider, erpRecordCount: result.recordCount },
      };
    }

    default:
      return { content: `Unknown tool: ${toolName}` };
  }
}
