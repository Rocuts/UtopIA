'use client';

/**
 * SurvivalModeSection — Wrapper del Módulo 8 (Supervivencia Élite).
 *
 * Se activa automáticamente cuando score > 60 o cuando el usuario elige
 * mode='supervivencia'. Muestra el banner de activación + las 5 sub-cards +
 * el sintetizador.
 */

import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TetCard } from './TetCard';
import { EscudoRetencionesCard } from './EscudoRetencionesCard';
import { AntiDianCard } from './AntiDianCard';
import { ReservaContingenciaCard } from './ReservaContingenciaCard';
import { OptimizacionDividendosCard } from './OptimizacionDividendosCard';
import { SintetizadorCard } from './SintetizadorCard';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

interface SurvivalModeSectionProps {
  data?: SupervivenciaModuleResult;
  loading?: boolean;
  language?: 'es' | 'en';
  t: {
    activeBanner: string;
    activeSubtitle: string;
    cards: {
      tet: { title: string; metric: string; norma: string };
      retention: { title: string; metric: string; norma: string };
      antiDian: { title: string; metric: string; norma: string };
      reserve: { title: string; metric: string; norma: string };
      dividend: { title: string; metric: string; norma: string };
    };
    synthesis: {
      title: string;
      cta: string;
      exposicionLabel: string;
      reduccionLabel: string;
      accionesLabel: string;
    };
  };
}

export function SurvivalModeSection({ data, loading, language = 'es', t }: SurvivalModeSectionProps) {
  return (
    <section aria-label={t.activeBanner} className="flex flex-col gap-6">
      {/* Activation banner */}
      <div
        className={cn(
          'flex items-center gap-3 px-5 py-3 rounded-xl',
          'bg-[rgb(239_68_68_/_0.12)] ring-1 ring-[rgb(239_68_68_/_0.45)]',
        )}
        role="status"
        aria-live="polite"
      >
        <Zap className="h-5 w-5 text-danger shrink-0 animate-pulse" strokeWidth={2} aria-hidden="true" />
        <div>
          <span className="font-semibold text-danger text-sm uppercase tracking-wider">
            {t.activeBanner}
          </span>
          {t.activeSubtitle && (
            <p className="text-xs text-n-700 dark:text-n-400 mt-0.5">{t.activeSubtitle}</p>
          )}
        </div>
      </div>

      {/* Sintetizador — full width */}
      <SintetizadorCard
        data={data}
        loading={loading}
        t={t.synthesis}
        language={language}
      />

      {/* 5 sub-cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <TetCard
          data={data?.data.tet}
          loading={loading}
          t={t.cards.tet}
          language={language}
        />
        <EscudoRetencionesCard
          data={data?.data.escudoRetenciones}
          loading={loading}
          t={t.cards.retention}
          language={language}
        />
        <AntiDianCard
          data={data?.data.antiDian}
          loading={loading}
          t={t.cards.antiDian}
          language={language}
        />
        <ReservaContingenciaCard
          data={data?.data.reservaContingencia}
          loading={loading}
          t={t.cards.reserve}
          language={language}
        />
        <div className="md:col-span-2">
          <OptimizacionDividendosCard
            data={data?.data.dividendos}
            loading={loading}
            t={t.cards.dividend}
            language={language}
          />
        </div>
      </div>
    </section>
  );
}
