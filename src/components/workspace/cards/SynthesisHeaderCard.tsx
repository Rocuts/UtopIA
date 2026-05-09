'use client';

/**
 * SynthesisHeaderCard — Executive synthesis above the 5-card grid.
 * Shows top recommendations summary and a CTA that opens the full markdown
 * dictamen in a GlassModal.
 */

import { useState, useCallback } from 'react';
import { FileText, Sparkles, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, useReducedMotion } from 'motion/react';
import { GlassModal } from '@/components/ui/GlassModal';
import { NormaCitation } from './SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCOP } from '@/hooks/useEscudoSurvival';
import type { SynthesisResult } from '@/lib/agents/financial/escudo-survival/types';

interface SynthesisHeaderCardProps {
  data?: SynthesisResult;
  loading?: boolean;
  t: {
    title: string;
    cta: string;
  };
  language?: 'es' | 'en';
}

// Shimmer line
function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded animate-pulse bg-n-300/30 dark:bg-n-700/30', className)}
    />
  );
}

export function SynthesisHeaderCard({ data, loading, t, language = 'es' }: SynthesisHeaderCardProps) {
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
        {/* Ambient glow — wine */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-[320px] h-[320px] rounded-full blur-[90px] opacity-25"
          style={{
            background: 'radial-gradient(circle, rgb(168 56 56 / 0.7) 0%, transparent 70%)',
          }}
        />

        {/* Left: icon + title */}
        <div className="relative shrink-0 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.20)] text-area-escudo"
          >
            <Sparkles className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
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
              <div className="flex flex-col gap-3">
                {/* Top recommendations */}
                {data.topRecommendations.length > 0 && (
                  <ol
                    role="list"
                    aria-label={language === 'es' ? 'Recomendaciones principales' : 'Top recommendations'}
                    className="flex flex-col gap-2 mt-1"
                  >
                    {data.topRecommendations.slice(0, 3).map((rec) => (
                      <li
                        key={rec.orden}
                        className="flex items-start gap-2.5 text-sm"
                      >
                        <span
                          aria-hidden="true"
                          className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(168_56_56_/_0.2)] text-area-escudo text-[11px] font-bold mt-0.5"
                        >
                          {rec.orden}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-n-800 dark:text-n-200">
                            {rec.titulo}
                          </span>
                          {rec.impacto > 0 && (
                            <span className="ml-1.5 text-success text-xs font-medium num">
                              (+{formatCOP(rec.impacto)})
                            </span>
                          )}
                          <span className="ml-1.5">
                            <NormaCitation norma={rec.norma} />
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <p className="text-sm text-n-500 mt-1">
                {language === 'es'
                  ? 'Ejecute el análisis para ver el dictamen ejecutivo.'
                  : 'Run the analysis to see the executive report.'}
              </p>
            )}
          </div>
        </div>

        {/* Right: CTA */}
        {data && (
          <div className="relative md:ml-auto shrink-0">
            <button
              type="button"
              onClick={handleOpen}
              aria-label={language === 'es' ? 'Ver dictamen completo' : 'View full report'}
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

      {/* ── Full dictamen modal ───────────────────────────────────────────── */}
      <GlassModal
        open={modalOpen}
        onClose={handleClose}
        title={language === 'es' ? 'Dictamen ejecutivo completo' : 'Full executive report'}
        description={language === 'es'
          ? 'Análisis consolidado del Modo Supervivencia Élite'
          : 'Consolidated Survival Mode analysis'}
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
