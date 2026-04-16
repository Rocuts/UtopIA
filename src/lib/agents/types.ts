// ---------------------------------------------------------------------------
// Shared types for the UtopIA multi-agent orchestration system
// ---------------------------------------------------------------------------

import type { NITContext } from '@/lib/security/pii-filter';

// ---------------------------------------------------------------------------
// Query Classification
// ---------------------------------------------------------------------------

/**
 * Agent domains — each maps to a specialist agent.
 *
 * - tax:        Colombian tax law, sanctions, calendar, E.T. articles
 * - accounting: NIIF/IFRS, CTCP, financial statements, ratios
 * - documents:  Deep analysis of uploaded docs, OCR extraction, cross-referencing
 * - strategy:   DIAN defense, risk management, compliance planning, action plans
 */
export type AgentDomain = 'tax' | 'accounting' | 'documents' | 'strategy';

export type CostTier = 'T1' | 'T2' | 'T3';

export interface QueryClassification {
  /** T1 = direct response, T2 = single specialist, T3 = multi-specialist */
  tier: CostTier;
  /** Which domain(s) are relevant */
  domains: AgentDomain[];
  /** Short intent label for debugging (e.g. "sanction_calculation", "greeting") */
  intent: string;
  /** Classifier confidence 0-1 */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Prompt Enhancement
// ---------------------------------------------------------------------------

export interface EnhancedQuery {
  /** The improved, more specific query */
  enhanced: string;
  /** Structured entities extracted from the message */
  extractedEntities: {
    articles?: string[];
    amounts?: number[];
    dates?: string[];
    institutions?: string[];
    documentNames?: string[];
  };
  /** For T3: per-domain sub-queries */
  subQueries?: { domain: AgentDomain; query: string }[];
}

// ---------------------------------------------------------------------------
// Specialist Context & Result
// ---------------------------------------------------------------------------

export interface SpecialistContext {
  language: 'es' | 'en';
  useCase: string;
  documentContext?: string;
  nitContext: NITContext | null;
  conversationHistory: { role: string; content: string }[];
  /** Callback for streaming progress events */
  onProgress?: (event: ProgressEvent) => void;
}

export interface SpecialistResult {
  content: string;
  webSearchUsed: boolean;
  webSources: string[];
  riskAssessment?: {
    level: string;
    score: number;
    factors: { description: string; severity: string }[];
    recommendations: string[];
  };
  sanctionCalculation?: {
    amount: number;
    formula: string;
    article: string;
    explanation: string;
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestrateOptions {
  language: 'es' | 'en';
  useCase: string;
  documentContext?: string;
  nitContext: NITContext | null;
  /** SSE progress callback */
  onProgress?: (event: ProgressEvent) => void;
}

export interface OrchestrateResult {
  role: 'assistant';
  content: string;
  tier: CostTier;
  agentsUsed: string[];
  enhancedQuery?: string;
  webSearchUsed: boolean;
  webSources?: string[];
  riskAssessment?: SpecialistResult['riskAssessment'];
  sanctionCalculation?: SpecialistResult['sanctionCalculation'];
}

// ---------------------------------------------------------------------------
// SSE Progress Events
// ---------------------------------------------------------------------------

export type ProgressEvent =
  | { type: 'classifying' }
  | { type: 'enhancing'; preview: string }
  | { type: 'routing'; agents: string[] }
  | { type: 'agent_working'; agent: string; status: string }
  | { type: 'synthesizing' }
  | { type: 'done' };
