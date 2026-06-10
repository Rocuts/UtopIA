'use client';

/**
 * SintetizadorCard — Dictamen ejecutivo del Modo Supervivencia (Módulo 8).
 * Top 3 recomendaciones, exposición fiscal estimada, reducción posible.
 * Abre modal con markdown completo.
 */

import { useState, useCallback } from 'react';
import { Sparkles, FileText, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, useReducedMotion } from 'motion/react';
import { GlassModal } from '@/components/ui/GlassModal';
import { NormaCitation } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30 dark:bg-n-700/30', className)}
    />
  );
}

interface SintetizadorCardProps {
  data?: SupervivenciaModuleResult;
  loading?: boolean;
  t: {
    title: string;
    cta: string;
    exposicionLabel: string;
    reduccionLabel: string;
    accionesLabel: string;
  };
  language?: 'es' | 'en';
}

export function SintetizadorCard({ data, loading, t, language = 'es' }: SintetizadorCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const reduced = useReducedMotion();

  const handleOpen = useCallback(() => setModalOpen(true), []);
  const handleClose = useCallback(() => setModalOpen(false), []);

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <>
      <motion.div
        {...motionProps}
        className={cn(
          'relative overflow-hidden rounded-xl p-6 md:p-8',
          'glass-elite-elevated glow-wine',
          'ring-1 ring-[rgb(168_56_56_/_0.4)]',
          'flex flex-col md:flex-row md:items-start gap-6 md:gap-8',
        )}
      >
        {/* Ambient glow */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-[320px] h-[320px] rounded-full blur-[90px] opacity-25"
          style={{ background: 'radial-gradient(circle, rgb(168 56 56 / 0.7) 0%, transparent 70%)' }}
        />

        {/* Left */}
        <div className="relative flex items-start gap-3 flex-1 min-w-0">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.20)] text-area-escudo shrink-0"
          >
            <Sparkles className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-eyebrow text-area-escudo font-medium mb-1">
              {t.title}
            </p>

            {loading ? (
              <div className="flex flex-col gap-2 mt-1">
                <Shimmer className="h-4 w-48" />
                <Shimmer className="h-4 w-64" />
                <Shimmer className="h-4 w-40" />
              </div>
            ) : data ? (
              <div className="flex flex-col gap-4">
                {/* Exposición + reducción */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-md bg-[rgb(239_68_68_/_0.08)] ring-1 ring-[rgb(239_68_68_/_0.2)]">
                    <span className="block text-xs text-n-500 mb-0.5">{t.exposicionLabel}</span>
                    <span className="font-bold text-danger tabular-nums text-lg">
                      {fmtCop(data.data.exposicionFiscalEstimada)}
                    </span>
                  </div>
                  <div className="p-3 rounded-md bg-[rgb(34_197_94_/_0.08)] ring-1 ring-[rgb(34_197_94_/_0.2)]">
                    <span className="block text-xs text-n-500 mb-0.5">{t.reduccionLabel}</span>
                    <span className="font-bold text-success tabular-nums text-lg">
                      {fmtCop(data.data.exposicionMitigada)}
                    </span>
                  </div>
                </div>

                {/* Acciones inmediatas */}
                {data.data.accionesInmediatas.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-2">
                      {t.accionesLabel}
                    </p>
                    <ol role="list" className="flex flex-col gap-2">
                      {data.data.accionesInmediatas.slice(0, 3).map((a) => (
                        <li key={a.prioridad} className="flex items-start gap-2.5 text-sm">
                          <span
                            aria-hidden="true"
                            className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(168_56_56_/_0.2)] text-area-escudo text-[11px] font-bold mt-0.5"
                          >
                            {a.prioridad}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-n-800 dark:text-n-700">{a.accion}</span>
                            <span className="ml-1.5 text-success text-xs font-medium tabular-nums">
                              ({fmtCop(a.impactoEstimado)})
                            </span>
                            <span className="ml-1.5">
                              <NormaCitation norma={a.norma} />
                            </span>
                            {a.fechaLimite && (
                              <span className="ml-1.5 text-warning text-xs">
                                {language === 'es' ? `Límite: ${a.fechaLimite}` : `Deadline: ${a.fechaLimite}`}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-n-500 mt-1">
                {language === 'es' ? 'Ejecute el análisis para ver el dictamen ejecutivo.' : 'Run the analysis to see the executive report.'}
              </p>
            )}
          </div>
        </div>

        {/* CTA */}
        {data && (
          <div className="relative md:ml-auto shrink-0">
            <button
              type="button"
              onClick={handleOpen}
              aria-label={language === 'es' ? 'Ver dictamen completo del Modo Supervivencia' : 'View full Survival Mode report'}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg',
                'bg-[rgb(168_56_56_/_0.18)] hover:bg-[rgb(168_56_56_/_0.30)] text-area-escudo',
                'border border-[rgb(168_56_56_/_0.40)] hover:border-[rgb(168_56_56_/_0.60)]',
                'text-sm font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
              )}
            >
              <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {t.cta}
              <ExternalLink className="h-3.5 w-3.5 opacity-60" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </motion.div>

      {/* Full markdown modal */}
      <GlassModal
        open={modalOpen}
        onClose={handleClose}
        title={language === 'es' ? 'Dictamen Supervivencia Élite' : 'Elite Survival Report'}
        description={language === 'es' ? 'Análisis consolidado del Módulo 8' : 'Consolidated Module 8 analysis'}
        size="xl"
      >
        {data && (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-serif-elite prose-headings:tracking-tight prose-a:text-area-escudo prose-strong:text-n-900 dark:prose-strong:text-n-100 pb-4">
            <ReactMarkdown>{data.markdown}</ReactMarkdown>
          </div>
        )}
      </GlassModal>
    </>
  );
}
