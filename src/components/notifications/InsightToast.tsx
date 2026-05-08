'use client';

/**
 * InsightToast — toast premium bottom-right para insights de alta prioridad.
 *
 * Convive con el `<ToastProvider>` general (ese maneja toasts genéricos a
 * `z-200`); este vive a `z-210` y se monta on-demand desde el callsite que
 * recibe el insight (típicamente la suscripción a `/api/sentinel/alerts`).
 *
 * Auto-dismiss: 8s informativo, 15s advertencia, persistent crítico.
 */

import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '@/lib/utils';
import type { Insight } from '@/lib/notifications/insight-types';

const PILLAR_ACCENT: Record<Insight['pillar'], string> = {
  verdad: 'border-area-verdad/40 bg-area-verdad/8',
  escudo: 'border-area-escudo/40 bg-area-escudo/8',
  valor: 'border-area-valor/40 bg-area-valor/8',
  futuro: 'border-area-futuro/40 bg-area-futuro/8',
};

const PILLAR_DOT: Record<Insight['pillar'], string> = {
  verdad: 'bg-area-verdad',
  escudo: 'bg-area-escudo',
  valor: 'bg-area-valor',
  futuro: 'bg-area-futuro',
};

const SEVERITY_LABEL: Record<Insight['severity'], { es: string; en: string }> = {
  critico: { es: 'Crítico', en: 'Critical' },
  advertencia: { es: 'Advertencia', en: 'Warning' },
  informativo: { es: 'Informativo', en: 'Info' },
};

const DISMISS_MS: Record<Insight['severity'], number | null> = {
  informativo: 8000,
  advertencia: 15000,
  critico: null, // persistente — usuario debe cerrar manualmente
};

export interface InsightToastProps {
  insight: Insight | null;
  onDismiss: () => void;
  onAction?: (insight: Insight) => void;
}

export function InsightToast({ insight, onDismiss, onAction }: InsightToastProps) {
  const language = insight?.language ?? 'es';
  const isEs = language === 'es';

  useEffect(() => {
    if (!insight) return;
    const ms = DISMISS_MS[insight.severity];
    if (ms === null) return;
    const t = setTimeout(onDismiss, ms);
    return () => clearTimeout(t);
  }, [insight, onDismiss]);

  return (
    <AnimatePresence>
      {insight && (
        <motion.div
          key={insight.dedupKey}
          initial={{ opacity: 0, x: 60, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 60, scale: 0.95 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'fixed bottom-4 right-4 z-[210] pointer-events-auto',
            'w-[min(420px,calc(100vw-2rem))]',
          )}
          role="alert"
          aria-live="assertive"
          data-testid="insight-toast"
        >
          <div
            className={cn(
              'rounded-xl border backdrop-blur-md shadow-e3',
              'bg-n-0/95',
              PILLAR_ACCENT[insight.pillar],
            )}
          >
            <div className="flex items-start gap-3 p-4">
              <div className="flex flex-col items-center gap-1 shrink-0 pt-1">
                <span className={cn('h-2.5 w-2.5 rounded-full', PILLAR_DOT[insight.pillar])} aria-hidden="true" />
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-n-600 font-medium">
                  {capitalize(insight.pillar)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-n-700 font-semibold">
                    {SEVERITY_LABEL[insight.severity][language]}
                  </span>
                  <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={isEs ? 'Cerrar' : 'Dismiss'}
                    className="text-n-500 hover:text-n-1000 transition-colors"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </header>
                <p className="text-sm font-medium text-n-1000 leading-snug mb-1">
                  {insight.subject}
                </p>
                <p className="text-xs text-n-700 leading-relaxed mb-3">{insight.hallazgo}</p>
                <button
                  type="button"
                  onClick={() => {
                    onAction?.(insight);
                    if (insight.accionRecomendada.href) {
                      // Hard navigate para escapar el contexto del toast.
                      window.location.href = insight.accionRecomendada.href;
                    }
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-3 py-1.5',
                    'bg-gold-500 text-n-0 hover:bg-gold-600 transition-colors',
                    'text-xs font-semibold',
                  )}
                >
                  {insight.accionRecomendada.label}
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default InsightToast;
