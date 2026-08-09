'use client';

import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { MARKDOWN_SANITIZE_SCHEMA } from '@/lib/security/markdown-sanitize-schema';
import {
  Globe,
  WifiOff,
  Clock,
  AlertTriangle,
  RefreshCw,
  Calculator,
  Scale,
} from 'lucide-react';
import { DSBadge } from '@/design-system/components/Badge';
import { CitationBadge } from '@/design-system/components/CitationBadge';
import { RiskMeter } from '@/design-system/components/RiskMeter';
import { StreamingText } from '@/design-system/components/StreamingText';
import { cn } from '@/lib/utils';
import { SPRING } from './constants';
import { extractLegalReferences, formatTime } from './utils';
import { CollapsibleSection } from './CollapsibleSection';
import { CodeBlockPre } from './CodeBlockPre';
import { MessageActions } from './MessageActions';
import type { ChatMessage } from '../types';
import type { AgentTier } from '@/types/platform';

interface AssistantMessageProps {
  message: ChatMessage;
  language: 'es' | 'en';
  useCase: string;
  isStreaming?: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

export function AssistantMessage({
  message,
  language,
  useCase,
  isStreaming,
  canRegenerate,
  onRegenerate,
}: AssistantMessageProps) {
  const safeContent = typeof message.content === 'string' ? message.content : '';
  const legalRefs = extractLegalReferences(safeContent);
  const hasContent = !!safeContent.trim();

  // Error message with Retry button
  if (message.errorKind) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', ...SPRING }}
        className="border-b border-danger/30 px-6 py-6"
      >
        <div className="max-w-[var(--chat-reading-width)] mx-auto w-full bg-danger/10 border border-danger/30 rounded-lg px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              {message.errorKind === 'network' ? <WifiOff className="w-4 h-4 text-danger" /> :
               message.errorKind === 'timeout' ? <Clock className="w-4 h-4 text-danger" /> :
               message.errorKind === 'rate_limit' ? <AlertTriangle className="w-4 h-4 text-warning" /> :
               <AlertTriangle className="w-4 h-4 text-danger" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-danger mb-1">
                {language === 'es' ? 'No se pudo completar la consulta' : 'Could not complete the query'}
              </p>
              <p className="text-sm text-danger leading-relaxed">{safeContent}</p>
              {message.onRetry && (
                <button
                  type="button"
                  onClick={message.onRetry}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-n-900 text-n-0 hover:bg-n-700 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  {language === 'es' ? 'Reintentar' : 'Retry'}
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', ...SPRING }}
      className="border-b border-n-200/40 px-6 py-8 group"
    >
      <div className="max-w-[var(--chat-reading-width)] mx-auto w-full flex gap-4">
        {/* 24px gold avatar */}
        <div
          aria-hidden="true"
          className="shrink-0 w-6 h-6 rounded-full bg-gold-500 text-n-0 flex items-center justify-center text-xs-mono font-semibold font-mono mt-1"
        >
          1
        </div>

        <div className="flex-1 min-w-0">
          {/* Inline header: author + meta */}
          <div className="flex items-center gap-2 mb-2 text-xs">
            <span className="font-medium text-n-900">1+1</span>
            <span className="text-n-500">·</span>
            <span className="text-n-600 font-mono">
              {language === 'es' ? 'Análisis' : 'Analysis'}
            </span>
            {message.tier && (
              <>
                <span className="text-n-500">·</span>
                <DSBadge variant="tier" tier={message.tier as AgentTier} label="" size="sm" />
              </>
            )}
            <time
              dateTime={message.timestamp}
              className="text-n-600 font-mono ml-auto num"
            >
              {formatTime(message.timestamp)}
            </time>
          </div>

          {/* Web search indicator */}
          {message.webSearchUsed && (
            <div className="flex items-center gap-1.5 mb-3">
              <Globe className="w-3.5 h-3.5 text-n-600" />
              <span className="text-xs text-n-600 font-mono">
                {language === 'es' ? 'Complementado con búsqueda web' : 'Enhanced with web search'}
              </span>
            </div>
          )}

          {/* Markdown body — with optional streaming cursor */}
          <div className="prose-chat text-n-800 prose-headings:text-n-900 prose-headings:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-gold-500 prose-strong:text-n-900 prose-code:text-n-600 prose-code:bg-n-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-xs prose-code:text-xs prose-code:font-mono">
            <StreamingText isStreaming={!!isStreaming}>
              {hasContent ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  // El plugin va INVOCADO con el schema endurecido: pasarlo a secas
                  // aplicaba el schema por defecto, que admite <img src=https://...>.
                  // Con la CSP dejando img-src https: abierta, esa etiqueta era el
                  // canal de exfiltración zero-click del contexto del tenant cuando
                  // la respuesta del modelo venía contaminada por prompt injection.
                  rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
                  components={{
                    pre: ({ children, className }) => (
                      <CodeBlockPre className={className}>{children}</CodeBlockPre>
                    ),
                    thead: ({ children }) => (
                      <thead className="sticky top-0 bg-n-50 z-[1] shadow-[0_1px_0_0_var(--color-n-200)]">
                        {children}
                      </thead>
                    ),
                  }}
                >
                  {safeContent}
                </ReactMarkdown>
              ) : (
                <span className="sr-only">
                  {language === 'es' ? 'Generando respuesta...' : 'Generating response...'}
                </span>
              )}
            </StreamingText>
          </div>

          {/* Risk Assessment */}
          {message.riskAssessment && (
            <div className="mt-4 pt-4 border-t border-n-200/50">
              <RiskMeter
                score={message.riskAssessment.score}
                level={
                  ({ bajo: 'low', medio: 'medium', alto: 'high', critico: 'critical' } as const)[message.riskAssessment.level]
                }
              />
              {message.riskAssessment.factors.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-xs font-medium text-n-600 mb-1.5 uppercase tracking-eyebrow">
                    {language === 'es' ? 'Factores de Riesgo' : 'Risk Factors'}
                  </h4>
                  <ul className="space-y-1">
                    {message.riskAssessment.factors.map((f, i) => (
                      <li key={i} className="text-xs text-n-600 flex items-start gap-1.5">
                        <span className={cn(
                          'mt-1 w-1.5 h-1.5 rounded-full shrink-0',
                          f.severity === 'alto' || f.severity === 'high' ? 'bg-danger' :
                          f.severity === 'medio' || f.severity === 'medium' ? 'bg-warning' : 'bg-success'
                        )} />
                        {f.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Sanction Calculation */}
          {message.sanctionCalculation && (
            <div className="mt-4">
              <CollapsibleSection
                title={language === 'es' ? 'Cálculo de Sanción' : 'Sanction Calculation'}
                icon={Calculator}
                defaultOpen
              >
                <div className="bg-n-50 border border-n-200 rounded-lg p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-xs text-n-600 font-mono">
                      {message.sanctionCalculation.article}
                    </span>
                    <span className="text-lg font-bold text-n-900 font-mono num">
                      ${message.sanctionCalculation.amount.toLocaleString('es-CO')}
                    </span>
                  </div>
                  <p className="text-xs text-n-600 font-mono mb-1">
                    {message.sanctionCalculation.formula}
                  </p>
                  <p className="text-xs text-n-600">{message.sanctionCalculation.explanation}</p>
                </div>
              </CollapsibleSection>
            </div>
          )}

          {/* Legal References */}
          {legalRefs.length > 0 && (
            <div className="mt-4">
              <CollapsibleSection
                title={language === 'es' ? 'Referencias Legales' : 'Legal References'}
                icon={Scale}
              >
                <div className="flex flex-wrap gap-1.5">
                  {legalRefs.map((ref, i) => (
                    <CitationBadge
                      key={i}
                      article={ref.article}
                      source="Estatuto Tributario"
                      normText={ref.description}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            </div>
          )}

          {/* Actions row — hidden while streaming */}
          {!isStreaming && hasContent && (
            <MessageActions
              message={message}
              language={language}
              useCase={useCase}
              canRegenerate={canRegenerate}
              onRegenerate={onRegenerate}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}
