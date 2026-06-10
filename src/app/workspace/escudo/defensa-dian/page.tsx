'use client';

/**
 * /workspace/escudo/defensa-dian — Defensa DIAN sub-page.
 *
 * Displays a breadcrumb, stats row, vertical stepper pipeline, and cases list.
 * Preserves `openIntakeForType('dian_defense')` CTA.
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  Shield,
  ArrowLeft,
  Gavel,
  CheckCircle2,
  Circle,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { EliteButton } from '@/components/ui/EliteButton';

// ── Design token ────────────────────────────────────────────────────────────
const AC = '#A83838'; // escudo wine-red accent

// ── Types ────────────────────────────────────────────────────────────────────
type StepState = 'done' | 'active' | 'pending';

interface Step {
  label: string;
  description: string;
  state: StepState;
}

interface CaseItem {
  title: string;
  meta: string;
  status: 'warning' | 'success';
  statusLabel: string;
}

// ── Data ─────────────────────────────────────────────────────────────────────
const STEPS: Step[] = [
  {
    label: 'Recepción del requerimiento',
    description: 'Notificación recibida el 12 de mayo de 2026.',
    state: 'done',
  },
  {
    label: 'Diagnóstico de riesgo',
    description: 'Riesgo medio. Inconsistencia en información exógena.',
    state: 'done',
  },
  {
    label: 'Borrador de respuesta',
    description: 'Redacción de respuesta técnica con soporte probatorio.',
    state: 'active',
  },
  {
    label: 'Radicación',
    description: 'Envío formal dentro del término legal.',
    state: 'pending',
  },
  {
    label: 'Seguimiento',
    description: 'Monitoreo de la respuesta de la administración.',
    state: 'pending',
  },
];

const CASES: CaseItem[] = [
  {
    title: 'Requerimiento ordinario renta',
    meta: 'En curso · vence en 11 días',
    status: 'warning',
    statusLabel: 'En curso',
  },
  {
    title: 'Pliego de cargos IVA 2024',
    meta: 'Resuelto a favor',
    status: 'success',
    statusLabel: 'Ganado',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-n-200/60 bg-n-0/60 px-5 py-4 backdrop-blur-sm dark:border-n-800/60 dark:bg-n-900/40">
      <span className="text-xs font-medium uppercase tracking-wider text-n-500">{label}</span>
      <span
        className="text-3xl font-semibold tabular-nums leading-none"
        style={accent ? { color: AC } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function StepIndicator({ state, index }: { state: StepState; index: number }) {
  if (state === 'done') {
    return (
      <span
        className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ background: AC }}
        aria-label="Completado"
      >
        <CheckCircle2 className="h-4 w-4 text-white" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span
        className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-n-0 text-sm font-bold dark:bg-n-950"
        style={{ borderColor: AC, color: AC }}
        aria-label="En progreso"
      >
        {index + 1}
      </span>
    );
  }
  return (
    <span
      className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-n-300 bg-n-0 text-sm text-n-400 dark:border-n-700 dark:bg-n-950"
      aria-label="Pendiente"
    >
      <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

function VerticalStepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isDone = step.state === 'done';
        const isActive = step.state === 'active';

        return (
          <li key={step.label} className="relative flex gap-4">
            {/* connector line */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute left-4 top-8 h-[calc(100%-8px)] w-0.5 -translate-x-1/2"
                style={{
                  background: isDone ? AC : 'rgb(var(--color-n-200-rgb, 220 220 220))',
                }}
              />
            )}

            <StepIndicator state={step.state} index={i} />

            <div className="pb-7 pt-0.5 min-w-0">
              <p
                className="text-sm leading-tight"
                style={
                  isActive
                    ? { fontWeight: 700, color: AC }
                    : isDone
                    ? { fontWeight: 600 }
                    : { color: 'var(--color-n-500, #888)' }
                }
              >
                {step.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-n-500">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BadgePill({ status, label }: { status: 'warning' | 'success'; label: string }) {
  const styles =
    status === 'success'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>
      {label}
    </span>
  );
}

function CaseRow({ item }: { item: CaseItem }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-n-200/60 bg-n-0/60 px-4 py-3 backdrop-blur-sm dark:border-n-800/50 dark:bg-n-900/40">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(168,56,56,0.12)', color: AC }}
        aria-hidden="true"
      >
        <Gavel className="h-4.5 w-4.5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-n-900 dark:text-n-100">{item.title}</p>
        <p className="mt-0.5 text-xs text-n-500">{item.meta}</p>
      </div>
      <BadgePill status={item.status} label={item.statusLabel} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DefensaDianPage() {
  const { language } = useLanguage();
  const reduced = useReducedMotion();
  const { openIntakeForType } = useWorkspace();

  const handleStart = useCallback(() => {
    openIntakeForType('dian_defense');
  }, [openIntakeForType]);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay: 0.04 + i * 0.07, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      {/* ambient glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-[15%] left-[10%] h-[480px] w-[480px] rounded-full blur-[120px] opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(168,56,56,0.45) 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative z-[1] max-w-[860px] mx-auto px-5 md:px-10 pt-6 pb-24 space-y-8">

        {/* Back link */}
        <motion.div {...fade(0)}>
          <Link
            href="/workspace/escudo"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-800 transition-colors dark:hover:text-n-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {language === 'es' ? 'El Escudo' : 'The Shield'}
          </Link>
        </motion.div>

        {/* Sub-header */}
        <motion.div {...fade(1)} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: AC }}>
            <Shield className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            <span>{language === 'es' ? 'El Escudo — Defensa DIAN' : 'The Shield — DIAN Defense'}</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-n-1000">
            {language === 'es' ? 'Defensa DIAN' : 'DIAN Defense'}
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-n-700">
            {language === 'es'
              ? 'Estructuramos su defensa ante requerimientos, pliegos de cargos y liquidaciones oficiales — del diagnóstico a la radicación.'
              : 'We structure your defense against notices, charges, and official assessments — from diagnosis to filing.'}
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.section {...fade(2)} aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-n-500">
            {language === 'es' ? 'Resumen' : 'Summary'}
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={language === 'es' ? 'Casos activos' : 'Active cases'} value={2} />
            <StatCard label={language === 'es' ? 'Ganados' : 'Won'} value={14} />
            <StatCard label={language === 'es' ? 'Tasa de éxito' : 'Success rate'} value="92%" accent />
          </div>
        </motion.section>

        {/* Pipeline stepper */}
        <motion.section {...fade(3)} aria-labelledby="pipeline-heading">
          <div className="mb-4 flex flex-col gap-0.5">
            <h2 id="pipeline-heading" className="text-sm font-semibold uppercase tracking-wider text-n-500">
              {language === 'es' ? 'Proceso del caso actual' : 'Current case pipeline'}
            </h2>
            <p className="text-xs text-n-500">
              {language === 'es'
                ? 'Requerimiento ordinario — Grupo 2tres S.A.S.'
                : 'Ordinary notice — Grupo 2tres S.A.S.'}
            </p>
          </div>
          <div className="rounded-xl border border-n-200/60 bg-n-0/60 px-6 py-6 backdrop-blur-sm dark:border-n-800/50 dark:bg-n-900/40">
            <VerticalStepper steps={STEPS} />
          </div>
        </motion.section>

        {/* Cases list */}
        <motion.section {...fade(4)} aria-labelledby="cases-heading">
          <h2 id="cases-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-n-500">
            {language === 'es' ? 'Casos' : 'Cases'}
          </h2>
          <div className="flex flex-col gap-2.5">
            {CASES.map((c) => (
              <CaseRow key={c.title} item={c} />
            ))}
          </div>
        </motion.section>

        {/* CTA */}
        <motion.div {...fade(5)}>
          <EliteButton
            variant="wine"
            size="lg"
            onClick={handleStart}
            glow
          >
            {language === 'es' ? 'Iniciar caso de defensa' : 'Start defense case'}
          </EliteButton>
        </motion.div>

      </div>
    </div>
  );
}
