'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Shield,
  TrendingUp,
  Scale,
  Compass,
  AlertTriangle,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { useLanguage } from '@/context/LanguageContext';

const NOVA_SPRING = { stiffness: 400, damping: 25 };

// Hardcoded sparkline polylines — 12 points each, plausible upward / lateral
// trends for a live executive dashboard preview. Coordinates target a
// 64×18 viewBox; uses currentColor so parent classes drive the stroke.
const SPARK_ESCUDO =
  '0,13 6,12 12,13 18,11 24,12 30,9 36,10 42,8 48,9 54,7 60,8 64,7';
const SPARK_VALOR =
  '0,15 6,13 12,11 18,12 24,9 30,10 36,7 42,8 48,5 54,6 60,3 64,2';
const SPARK_VERDAD =
  '0,9 6,8 12,9 18,7 24,8 30,6 36,7 42,5 48,6 54,4 60,5 64,4';
const SPARK_FUTURO =
  '0,12 6,11 12,9 18,10 24,7 30,8 36,6 42,7 48,4 54,5 60,3 64,4';

type PillarSpec = {
  eyebrow: string;
  concept: string;
  subtitle: string;
  metric: string;
  footer: string;
  Icon: typeof Shield;
  // tailwind text color class; drives both icon + sparkline (currentColor)
  colorClass: string;
  // dot bg color
  dotClass: string;
  // optional border tint for hover
  borderHoverClass: string;
  spark: string;
  // whether the footer is a CTA-style link (with arrow) or a status line (with dot)
  footerKind: 'link' | 'status';
};

export function WorkspaceTeaser() {
  const { language, t } = useLanguage();
  const wt = t.workspace;

  const pillars: PillarSpec[] = [
    {
      eyebrow: wt.pillarEscudoEyebrow,
      concept: wt.pillarEscudoConcept,
      subtitle: wt.pillarEscudoSubtitle,
      metric: '22.4%',
      footer: wt.pillarEscudoFooter,
      Icon: Shield,
      colorClass: 'text-area-escudo',
      dotClass: 'bg-area-escudo',
      borderHoverClass: 'group-hover:border-area-escudo/60',
      spark: SPARK_ESCUDO,
      footerKind: 'status',
    },
    {
      eyebrow: wt.pillarValorEyebrow,
      concept: wt.pillarValorConcept,
      subtitle: wt.pillarValorSubtitle,
      metric: '$5.20B',
      footer: wt.pillarValorFooter,
      Icon: TrendingUp,
      colorClass: 'text-area-valor',
      dotClass: 'bg-area-valor',
      borderHoverClass: 'group-hover:border-area-valor/60',
      spark: SPARK_VALOR,
      footerKind: 'link',
    },
    {
      eyebrow: wt.pillarVerdadEyebrow,
      concept: wt.pillarVerdadConcept,
      subtitle: wt.pillarVerdadSubtitle,
      metric: '95/100',
      footer: wt.pillarVerdadFooter,
      Icon: Scale,
      colorClass: 'text-area-verdad',
      dotClass: 'bg-area-verdad',
      borderHoverClass: 'group-hover:border-area-verdad/60',
      spark: SPARK_VERDAD,
      footerKind: 'status',
    },
    {
      eyebrow: wt.pillarFuturoEyebrow,
      concept: wt.pillarFuturoConcept,
      subtitle: wt.pillarFuturoSubtitle,
      metric: '14.4%',
      footer: wt.pillarFuturoFooter,
      Icon: Compass,
      colorClass: 'text-area-futuro',
      dotClass: 'bg-area-futuro',
      borderHoverClass: 'group-hover:border-area-futuro/60',
      spark: SPARK_FUTURO,
      footerKind: 'link',
    },
  ];

  return (
    <section
      id="ai-consult"
      className="py-20 md:py-28 relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-[var(--content-width)]"
    >
      <div className="text-center mb-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING }}
        >
          <span className="inline-flex items-center gap-2 text-xs tracking-eyebrow uppercase text-n-700 font-medium">
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
            {language === 'es' ? 'Workspace Profesional' : 'Professional Workspace'}
            <span className="h-px w-5 bg-n-300" aria-hidden="true" />
          </span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.05 }}
          className="font-serif-elite text-4xl md:text-5xl font-medium tracking-tight mb-4 text-n-1000 leading-display"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 0, "WONK" 0, "wght" 500' }}
        >
          {t.chat.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.1 }}
          className="text-lg text-n-700 mb-2"
        >
          {wt.workspaceTeaser}
        </motion.p>
      </div>

      {/* Workspace Preview Mockup — Centro de Comando */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.15 }}
        className="mb-8"
      >
        <GlassPanel className="overflow-hidden">
          {/* A. Header bar */}
          <div className="h-10 border-b border-n-200 flex items-center px-4 gap-3 bg-n-0">
            <div className="inline-flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-gold-500" aria-hidden="true" />
              <span className="text-xs font-bold text-n-1000 tracking-tight">1+1</span>
            </div>
            <div className="h-3 w-px bg-n-200" aria-hidden="true" />
            <span className="text-[10px] sm:text-xs text-n-700 font-mono uppercase tracking-eyebrow truncate">
              {wt.previewEyebrow}
            </span>
            <div className="flex-1" />
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-success/10 border border-success/30">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden="true" />
              <span className="text-[10px] sm:text-xs text-success font-mono font-medium">
                {wt.previewStatus}
              </span>
            </div>
          </div>

          {/* B + C + D body */}
          <div className="bg-n-0 p-4 sm:p-5 space-y-3 sm:space-y-4">
            {/* B. Title row */}
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <h3
                  className="font-serif-elite text-base sm:text-lg font-semibold text-n-1000 leading-tight"
                  style={{ fontVariationSettings: '"opsz" 144, "wght" 500' }}
                >
                  {wt.previewTitle}
                </h3>
                <p className="text-[11px] sm:text-xs text-n-700 mt-0.5">
                  {wt.previewSubtitle}
                </p>
              </div>
            </div>

            {/* C. Alert banner */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-area-escudo/10 border border-area-escudo/30">
              <AlertTriangle className="w-3.5 h-3.5 text-area-escudo shrink-0" aria-hidden="true" />
              <span className="text-[10px] sm:text-xs font-mono font-semibold text-area-escudo uppercase tracking-tight whitespace-nowrap">
                {wt.previewAlertCritical}
              </span>
              <span className="hidden sm:inline-block h-3 w-px bg-area-escudo/30" aria-hidden="true" />
              <span className="text-[10px] sm:text-xs text-n-700 truncate">
                {wt.previewAlertItems}
              </span>
            </div>

            {/* D. Grid 2×2 of mini-pillars */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {pillars.map((p) => (
                <div
                  key={p.concept}
                  className={`group relative rounded-sm border border-n-200 ${p.borderHoverClass} bg-n-0 p-2.5 sm:p-3 transition-colors`}
                >
                  {/* Top row: dot + eyebrow + icon */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotClass}`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-[9px] sm:text-[10px] font-mono uppercase tracking-eyebrow font-semibold ${p.colorClass} truncate`}
                      >
                        {p.eyebrow}
                      </span>
                    </div>
                    <p.Icon
                      className={`w-3.5 h-3.5 shrink-0 ${p.colorClass} opacity-80`}
                      aria-hidden="true"
                    />
                  </div>

                  {/* Concept */}
                  <h4
                    className="mt-1.5 font-serif-elite text-sm sm:text-base font-semibold text-n-1000 leading-tight"
                    style={{ fontVariationSettings: '"opsz" 144, "wght" 600' }}
                  >
                    {p.concept}
                  </h4>

                  {/* Subtitle */}
                  <p className="text-[10px] sm:text-xs text-n-700 leading-snug mt-0.5 line-clamp-2">
                    {p.subtitle}
                  </p>

                  {/* Metric + sparkline */}
                  <div className="mt-2 sm:mt-2.5 flex items-end justify-between gap-2">
                    <span
                      className={`text-base sm:text-lg font-mono font-semibold tabular-nums ${p.colorClass} leading-none`}
                    >
                      {p.metric}
                    </span>
                    <svg
                      width="64"
                      height="18"
                      viewBox="0 0 64 18"
                      className={p.colorClass}
                      aria-hidden="true"
                    >
                      <polyline
                        points={p.spark}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>

                  {/* Footer */}
                  <div className="mt-2 pt-2 border-t border-n-200 flex items-center gap-1.5">
                    {p.footerKind === 'status' ? (
                      <>
                        <div
                          className={`w-1 h-1 rounded-full shrink-0 ${p.dotClass}`}
                          aria-hidden="true"
                        />
                        <span className="text-[9px] sm:text-[10px] text-n-700 font-mono truncate">
                          {p.footer}
                        </span>
                      </>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-mono ${p.colorClass} truncate`}
                      >
                        {p.footer}
                        <ArrowRight className="w-2.5 h-2.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      </motion.div>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', ...NOVA_SPRING, delay: 0.2 }}
        className="text-center"
      >
        <Link
          href="/workspace"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-sm text-base font-medium bg-gold-500 hover:bg-gold-600 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2"
        >
          {wt.openWorkspace}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-n-700 mt-4">
          {t.chat.confidential}
        </p>
      </motion.div>
    </section>
  );
}
