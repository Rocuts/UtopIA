'use client';

/**
 * EscudoArea — Ventana I: El Escudo (Estrategia Tributaria y Legal).
 *
 * Dashboard reutilizable. Encapsula:
 *  - Narrativa Instrument Serif
 *  - KPI dual (TEF + vencimientos próximos)
 *  - Grid 2x2 de submódulos navegables
 *
 * Se consume desde `/workspace/escudo/page.tsx` y puede reusarse como preview
 * mini en cualquier lugar (ExecutiveDashboard, etc.) pasando `compact`.
 *
 * NO depende de que el layout padre aplique `[data-theme='elite']` — las
 * utilidades `.glass-elite*` son globales y funcionan en cualquier subtree.
 * Aun así, esta área se renderiza envuelta en `data-theme="elite"` para que
 * cualquier dependencia futura al token tenga contexto correcto.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Shield,
  Calculator,
  Network,
  PiggyBank,
  AlertTriangle,
  ArrowRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useMemo } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { EliteCard } from '@/components/ui/EliteCard';
import { PremiumKpiCard } from '@/components/ui/PremiumKpiCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { calculateTef } from '@/lib/kpis/tax-efficiency';
import type { KpiResult } from '@/types/kpis';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type DeadlineSeverity = 'low' | 'medium' | 'high';

export interface EscudoDeadline {
  label: string;
  date: string;
  severity: DeadlineSeverity;
}

export interface EscudoAreaProps {
  kpi?: KpiResult;
  upcomingDeadlines?: EscudoDeadline[];
  /** Si true, renderiza una versión compacta (sin hero ni narrativa larga). */
  compact?: boolean;
  className?: string;
}

// ─── Submódulos de El Escudo ─────────────────────────────────────────────────

type SubmoduleKey =
  | 'defensaDian'
  | 'planeacionTributaria'
  | 'preciosTransferencia'
  | 'devoluciones';

interface SubmoduleDef {
  key: SubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** "listo" = endpoint activo / "pronto" = stub con redirect a chat. */
  status: 'listo' | 'pronto';
}

const SUBMODULES: SubmoduleDef[] = [
  {
    key: 'defensaDian',
    href: '/workspace/escudo/defensa-dian',
    icon: Shield,
    status: 'listo',
  },
  {
    key: 'planeacionTributaria',
    href: '/workspace/escudo/planeacion-tributaria',
    icon: Calculator,
    status: 'listo',
  },
  {
    key: 'preciosTransferencia',
    href: '/workspace/escudo/precios-transferencia',
    icon: Network,
    status: 'listo',
  },
  {
    key: 'devoluciones',
    href: '/workspace/escudo/devoluciones',
    icon: PiggyBank,
    status: 'pronto',
  },
];

// ─── Mock KPI input (fallback si no llega kpi prop) ──────────────────────────

/**
 * Mock inline de TEF — empresa mediana colombiana 2026.
 * revenue 4.800M, base gravable 1.200M baseline → 930M optimizado.
 * TEF ≈ (270*0.35) / (1200*0.35) = 22.5 %
 */
function buildMockTef(): KpiResult {
  return calculateTef({
    revenue: 4_800_000_000,
    taxableIncomeBaseline: 1_200_000_000,
    taxableIncomeOptimized: 930_000_000,
    taxRate: 0.35,
    periodPrevious: {
      taxableIncomeBaseline: 1_180_000_000,
      taxableIncomeOptimized: 1_010_000_000,
    },
  });
}

// ─── Deadlines mock ──────────────────────────────────────────────────────────

const MOCK_DEADLINES_ES: EscudoDeadline[] = [
  { label: 'Retención en la Fuente — Abril', date: '13 May 2026', severity: 'high' },
  { label: 'IVA 5.º bimestre (Sep–Oct)', date: '18 May 2026', severity: 'medium' },
  { label: 'Renta PN — Calendario DIAN', date: '09 Ago 2026', severity: 'low' },
];

const MOCK_DEADLINES_EN: EscudoDeadline[] = [
  { label: 'Withholding Tax — April', date: 'May 13, 2026', severity: 'high' },
  { label: 'VAT 5th bi-month (Sep–Oct)', date: 'May 18, 2026', severity: 'medium' },
  { label: 'Personal Income Tax — DIAN Calendar', date: 'Aug 9, 2026', severity: 'low' },
];

const SEVERITY_DOT: Record<DeadlineSeverity, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-n-500',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function EscudoArea({
  kpi,
  upcomingDeadlines,
  compact = false,
  className,
}: EscudoAreaProps) {
  const { t, language } = useLanguage();
  const escudo = t.elite.areas.escudo;
  const reduced = useReducedMotion();

  const kpiData = useMemo<KpiResult>(() => kpi ?? buildMockTef(), [kpi]);
  const deadlines = useMemo<EscudoDeadline[]>(
    () =>
      upcomingDeadlines ??
      (language === 'es' ? MOCK_DEADLINES_ES : MOCK_DEADLINES_EN),
    [upcomingDeadlines, language],
  );

  // Fade-in stagger helpers
  const fadeItem = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + index * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      className={cn(
        'relative w-full',
        compact ? '' : 'min-h-full',
        className,
      )}
    >
      {!compact && (
        <>
          {/* Hero */}
          <motion.div {...fadeItem(0)} className="mb-10">
            <SectionHeader
              eyebrow={language === 'es' ? 'I. Resiliencia' : 'I. Resilience'}
              title={escudo.concept}
              subtitle={escudo.subtitle}
              align="left"
              accent="wine"
              divider
            />
          </motion.div>

          {/* Narrative */}
          <motion.p
            {...fadeItem(1)}
            className={cn(
              'font-serif-elite font-medium tracking-tight',
              'text-xl md:text-2xl leading-relaxed',
              'text-n-800 max-w-3xl mb-12',
            )}
          >
            {escudo.narrative}
          </motion.p>
        </>
      )}

      {/* KPI Hero dual */}
      <motion.div
        {...fadeItem(2)}
        className={cn(
          'grid gap-5',
          'grid-cols-1 md:grid-cols-5',
          compact ? 'mb-8' : 'mb-14',
        )}
      >
        {/* Primary KPI — TEF */}
        <div className="md:col-span-3">
          <PremiumKpiCard
            label={escudo.kpiPrimary}
            value={kpiData.formatted}
            subvalue={
              kpiData.breakdown?.find((b) => b.label === 'Ahorro total')?.formatted ??
              undefined
            }
            trend={
              kpiData.trend
                ? {
                    direction: kpiData.trend.direction,
                    delta: kpiData.trend.delta,
                    label:
                      kpiData.trend.periodLabel ??
                      (language === 'es' ? 'vs periodo anterior' : 'vs previous period'),
                  }
                : undefined
            }
            severity={kpiData.severity}
            accent="gold"
            icon={Shield}
            glow
          />
        </div>

        {/* Secondary KPI — Vencimientos próximos */}
        <DeadlinesCard
          title={escudo.kpiSecondary}
          count={deadlines.length}
          deadlines={deadlines}
          language={language}
        />
      </motion.div>

      {/* Grid submódulos */}
      <motion.div {...fadeItem(3)} className="grid gap-5 grid-cols-1 md:grid-cols-2">
        {SUBMODULES.map((sub, i) => (
          <SubmoduleCard
            key={sub.key}
            submodule={sub}
            title={escudo.submodules[sub.key].title}
            description={escudo.submodules[sub.key].description}
            ctaLabel={language === 'es' ? 'Entrar' : 'Enter'}
            readyLabel={language === 'es' ? 'Listo' : 'Ready'}
            upcomingLabel={
              language === 'es' ? 'Próximamente IA' : 'Coming soon'
            }
            delay={i}
            reduced={reduced}
          />
        ))}
      </motion.div>
    </div>
  );
}

// ─── Vencimientos card ───────────────────────────────────────────────────────

interface DeadlinesCardProps {
  title: string;
  count: number;
  deadlines: EscudoDeadline[];
  language: 'es' | 'en';
}

function DeadlinesCard({ title, count, deadlines, language }: DeadlinesCardProps) {
  const hasHigh = deadlines.some((d) => d.severity === 'high');
  return (
    <div className="md:col-span-2 relative flex flex-col gap-4 p-6 rounded-xl glass-elite-elevated border-elite-gold glow-wine">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          boxShadow: hasHigh
            ? 'inset 0 0 0 1px rgb(168 56 56 / 0.55)'
            : 'inset 0 0 0 1px rgb(184 147 74 / 0.32)',
        }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full shrink-0',
              hasHigh ? 'bg-area-escudo' : 'bg-gold-500',
            )}
          />
          <span className="uppercase tracking-eyebrow text-xs font-medium text-n-500 truncate">
            {title}
          </span>
        </div>
        <div
          aria-hidden="true"
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(168_56_56_/_0.16)] text-area-escudo"
        >
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-serif-elite font-normal text-n-1000 leading-[1] text-4xl md:text-5xl num">
          {count}
        </span>
        <span className="text-sm text-n-500">
          {language === 'es' ? 'vencimientos' : 'deadlines'}
        </span>
      </div>

      <ul role="list" className="flex flex-col gap-2.5 mt-1">
        {deadlines.map((d) => (
          <li
            key={`${d.label}-${d.date}`}
            className="flex items-start gap-2.5 text-sm leading-snug"
          >
            <span
              aria-hidden="true"
              className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', SEVERITY_DOT[d.severity])}
            />
            <span className="flex-1 min-w-0 flex items-center justify-between gap-3">
              <span className="text-n-800 truncate">{d.label}</span>
              <span className="text-n-500 shrink-0 inline-flex items-center gap-1">
                <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                {d.date}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Submódulo card ──────────────────────────────────────────────────────────

interface SubmoduleCardProps {
  submodule: SubmoduleDef;
  title: string;
  description: string;
  ctaLabel: string;
  readyLabel: string;
  upcomingLabel: string;
  delay: number;
  reduced: boolean | null;
}

function SubmoduleCard({
  submodule,
  title,
  description,
  ctaLabel,
  readyLabel,
  upcomingLabel,
  delay,
  reduced,
}: SubmoduleCardProps) {
  const { icon: Icon, href, status } = submodule;
  const isReady = status === 'listo';

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: {
          duration: 0.45,
          delay: 0.25 + delay * 0.08,
          ease: [0.16, 1, 0.3, 1] as const,
        },
      };

  return (
    <motion.div {...motionProps} className="h-full">
      <Link
        href={href}
        prefetch={false}
        className="block h-full group focus-visible:outline-none"
        aria-label={`${title}. ${description}`}
      >
        <EliteCard
          variant="glass"
          hover="lift"
          interactive
          padding="md"
          className="h-full min-h-[180px] flex flex-col gap-4 focus-within:ring-2 focus-within:ring-gold-500 focus-within:ring-offset-2 focus-within:ring-offset-n-1000"
        >
          <div className="flex items-start justify-between gap-4">
            <div
              aria-hidden="true"
              className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[rgb(168_56_56_/_0.18)] text-area-escudo group-hover:bg-[rgb(168_56_56_/_0.28)] group-hover:text-[rgb(229_176_186)] transition-colors"
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-label',
                isReady
                  ? 'bg-[rgb(34_197_94_/_0.12)] text-success border border-[rgb(34_197_94_/_0.3)]'
                  : 'bg-[rgb(184_147_74_/_0.12)] text-gold-600 border border-[rgb(184_147_74_/_0.3)]',
              )}
            >
              {isReady ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-block h-1 w-1 rounded-full bg-success"
                  />
                  {readyLabel}
                </>
              ) : (
                <>
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                  {upcomingLabel}
                </>
              )}
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-1.5">
            <h3 className="font-serif-elite text-xl leading-tight font-medium tracking-tight text-n-1000">
              {title}
            </h3>
            <p className="text-base leading-relaxed text-n-500 max-w-md">
              {description}
            </p>
          </div>

          <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-eyebrow text-gold-500 group-hover:text-gold-600 transition-colors">
            <span>{ctaLabel}</span>
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>
        </EliteCard>
      </Link>
    </motion.div>
  );
}

export default EscudoArea;
