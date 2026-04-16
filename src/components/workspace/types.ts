import type { RiskLevel } from '@/lib/storage/conversation-history';

export interface UploadedDocument {
  filename: string;
  size: number;
  chunks: number;
  uploadedAt: string;
  textPreview?: string;
  /** Full extracted text — used to rebuild documentContext on removal */
  extractedText?: string;
}

export interface RiskAssessmentData {
  level: RiskLevel;
  score: number;
  factors: { description: string; severity: string }[];
  recommendations: string[];
}

export interface SanctionCalculation {
  amount: number;
  formula: string;
  article: string;
  explanation: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  webSearchUsed?: boolean;
  riskAssessment?: RiskAssessmentData;
  sanctionCalculation?: SanctionCalculation;
  /** Cost tier used by the orchestrator (T1/T2/T3) */
  tier?: string;
  /** Which specialist agents handled this message */
  agentsUsed?: string[];
  /** The enhanced query produced by the prompt engineer agent */
  enhancedQuery?: string;
  /** When set, this message renders as a typed error with an optional Retry button */
  errorKind?: 'network' | 'timeout' | 'rate_limit' | 'server' | 'unknown';
  /** Callback for the inline Retry button on error messages */
  onRetry?: () => void;
}

export interface LegalReference {
  article: string;
  description: string;
}

export const USE_CASE_LABELS = {
  es: {
    'dian-defense': 'Defensa DIAN',
    'tax-refund': 'Devolución de Saldos',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Inteligencia Financiera',
  },
  en: {
    'dian-defense': 'DIAN Defense',
    'tax-refund': 'Tax Refund',
    'due-diligence': 'Due Diligence',
    'financial-intelligence': 'Financial Intelligence',
  },
} as const;

export type UseCase = keyof typeof USE_CASE_LABELS.es;
