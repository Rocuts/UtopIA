'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  TrendingUp,
  ArrowLeft,
  OctagonAlert,
  TriangleAlert,
  Info,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'ok';

interface Finding {
  severity: Severity;
  title: string;
  description: string;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const FINDINGS: Finding[] = [
  {
    severity: 'critical',
    title: 'Contingencia fiscal IVA 2023',
    description: 'Provisión insuficiente $340M. Impacto en precio: −8%',
  },
  {
    severity: 'high',
    title: 'Contratos sin cláusula de ajuste',
    description: '3 contratos >$500M sin protección inflacionaria',
  },
  {
    severity: 'medium',
    title: 'Rotación de cartera',
    description: 'Plazo promedio 87 días vs. sector 62 días',
  },
  {
    severity: 'ok',
    title: 'Estructura societaria',
    description: 'Documentación completa y actualizada',
  },
];

// ─── Severity config ──────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  Severity,
  {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    iconClass: string;
    badgeClass: string;
    label: string;
  }
> = {
  critical: {
    icon: OctagonAlert,
    iconClass: 'text-red-400',
    badgeClass:
      'bg-red-500/15 text-red-400 border border-red-500/30',
    label: 'Crítico',
  },
  high: {
    icon: TriangleAlert,
    iconClass: 'text-amber-400',
    badgeClass:
      'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    label: 'Alto',
  },
  medium: {
    icon: Info,
    iconClass: 'text-teal-400',
    badgeClass:
      'bg-teal-500/15 text-teal-400 border border-teal-500/30',
    label: 'Medio',
  },
  ok: {
    icon: CheckCircle,
    iconClass: 'text-emerald-400',
    badgeClass:
      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    label: 'OK',
  },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DueDiligencePage() {
  const reduced = useReducedMotion();

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + i * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[520px] h-[520px] rounded-full blur-[130px] opacity-25"
          style={{ background: 'radial-gradient(circle, #B8934A55 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24 space-y-8">

        {/* Back link */}
        <motion.div {...fade(0)}>
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-1000 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Volver a El Valor
          </Link>
        </motion.div>

        {/* Subheading */}
        <motion.div {...fade(1)} className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-n-600">
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded"
              style={{ background: '#B8934A22' }}
            >
              <TrendingUp className="h-3.5 w-3.5" style={{ color: '#B8934A' }} strokeWidth={2} />
            </span>
            El Valor — Due Diligence
          </div>
          <h1 className="font-serif-elite text-4xl md:text-5xl text-n-1000 leading-tight">
            Due Diligence
          </h1>
          <p className="text-base text-n-700 max-w-2xl leading-relaxed">
            Auditoría preventiva para inversión, fusión o venta. Revelamos el valor oculto y los
            riesgos antes de la transacción.
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.section {...fade(2)} aria-label="Avance del due diligence">
          <div className="glass-elite-elevated border-elite-gold rounded-2xl p-6">
            <p className="text-xs uppercase tracking-widest font-medium text-n-600 mb-4">Avance</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

              {/* Avance 52% */}
              <div className="rounded-xl border border-[#B8934A33] bg-[#B8934A0d] p-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-n-600 font-medium">Avance</p>
                <p
                  className="font-serif-elite text-4xl leading-none tabular-nums"
                  style={{ color: '#B8934A' }}
                >
                  52%
                </p>
                {/* Progress bar */}
                <div className="h-1.5 rounded-full bg-[#B8934A22] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, #B8934A, #D4AA6A)' }}
                    initial={reduced ? false : { width: '0%' }}
                    animate={{ width: '52%' }}
                    transition={reduced ? undefined : { duration: 1.1, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* Ítems listos */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-n-600 font-medium">Ítems listos</p>
                <p className="font-serif-elite text-4xl leading-none tabular-nums text-emerald-400">
                  11
                </p>
              </div>

              {/* Hallazgos */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-n-600 font-medium">Hallazgos</p>
                <p className="font-serif-elite text-4xl leading-none tabular-nums text-amber-400">
                  4
                </p>
              </div>

            </div>
          </div>
        </motion.section>

        {/* Findings */}
        <motion.section {...fade(3)} aria-label="Hallazgos por severidad">
          <div className="glass-elite border border-[#B8934A22] rounded-2xl p-6">
            <p className="text-xs uppercase tracking-widest font-medium text-n-600 mb-5">
              Hallazgos por severidad
            </p>
            <ul role="list" className="space-y-3">
              {FINDINGS.map((finding, idx) => {
                const cfg = SEVERITY_CONFIG[finding.severity];
                const Icon = cfg.icon;
                return (
                  <motion.li
                    key={finding.title}
                    initial={reduced ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={
                      reduced
                        ? undefined
                        : { duration: 0.38, delay: 0.35 + idx * 0.07, ease: [0.16, 1, 0.3, 1] as const }
                    }
                    className={cn(
                      'flex items-start sm:items-center gap-3 rounded-xl border px-4 py-3',
                      finding.severity === 'critical' && 'border-red-500/20 bg-red-500/5',
                      finding.severity === 'high'     && 'border-amber-500/20 bg-amber-500/5',
                      finding.severity === 'medium'   && 'border-teal-500/20 bg-teal-500/5',
                      finding.severity === 'ok'       && 'border-emerald-500/20 bg-emerald-500/5',
                    )}
                  >
                    {/* Icon */}
                    <span aria-hidden="true" className="shrink-0 mt-0.5 sm:mt-0">
                      <Icon className={cn('h-5 w-5', cfg.iconClass)} strokeWidth={2} />
                    </span>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-n-1000 leading-snug">
                        {finding.title}
                      </p>
                      <p className="text-xs text-n-700 mt-0.5 leading-snug">
                        {finding.description}
                      </p>
                    </div>

                    {/* Badge */}
                    <span
                      className={cn(
                        'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold uppercase tracking-wide',
                        cfg.badgeClass,
                      )}
                    >
                      {cfg.label}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </motion.section>

      </div>
    </div>
  );
}
