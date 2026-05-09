'use client';

/**
 * SurvivalModePanel — Contenedor principal del Modo Supervivencia Élite.
 *
 * Flow:
 *   idle     → Formulario de carga (FileUploadZone + campos de empresa)
 *   running  → Grid con cards en shimmer + barra de progreso SSE
 *   done     → Grid completo con 5 cards + SynthesisHeaderCard
 *   error    → Mensaje de error con CTA "Intentar de nuevo"
 *
 * NOTA LENIS: NO se agrega overflow-y-auto interno — la página hereda
 * data-lenis-prevent del workspace shell.
 */

import { useCallback, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Play,
  RotateCcw,
  X,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { FileUploadZone } from '@/design-system/components/FileUploadZone';
import { TetCard } from '@/components/workspace/cards/TetCard';
import { RetentionShieldCard } from '@/components/workspace/cards/RetentionShieldCard';
import { AntiDianCard } from '@/components/workspace/cards/AntiDianCard';
import { ContingencyReserveCard } from '@/components/workspace/cards/ContingencyReserveCard';
import { DividendOptimizerCard } from '@/components/workspace/cards/DividendOptimizerCard';
import { SynthesisHeaderCard } from '@/components/workspace/cards/SynthesisHeaderCard';
import { useEscudoSurvival } from '@/hooks/useEscudoSurvival';
import type { EscudoSurvivalProgressStage } from '@/lib/agents/financial/escudo-survival/types';

// ---------------------------------------------------------------------------
// Progress bar helper
// ---------------------------------------------------------------------------

const STAGE_ORDER: EscudoSurvivalProgressStage[] = [
  'preprocessing',
  'tet',
  'retention',
  'antiDian',
  'reserve',
  'dividend',
  'synthesis',
  'validation',
];

function progressPercent(
  stages: Array<{ stage: EscudoSurvivalProgressStage; status: 'started' | 'completed' | 'failed' }>,
): number {
  const completed = stages.filter((s) => s.status === 'completed').length;
  return Math.round((completed / STAGE_ORDER.length) * 100);
}

// ---------------------------------------------------------------------------
// Stage status indicator
// ---------------------------------------------------------------------------

function StageIndicator({
  status,
  label,
}: {
  status: 'pending' | 'started' | 'completed' | 'failed';
  label: string;
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 rounded-full shrink-0 transition-colors',
          status === 'completed' && 'bg-success',
          status === 'started' && 'bg-warning animate-pulse',
          status === 'failed' && 'bg-danger',
          status === 'pending' && 'bg-n-400/40',
        )}
      />
      <span
        className={cn(
          'transition-colors',
          status === 'completed' && 'text-n-700 dark:text-n-400',
          status === 'started' && 'text-n-800 dark:text-n-200 font-medium',
          status === 'pending' && 'text-n-400',
          status === 'failed' && 'text-danger',
        )}
      >
        {label}
      </span>
      {status === 'started' && (
        <span aria-label="Analizando" className="ml-auto text-[10px] text-warning uppercase tracking-wider">
          ···
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SurvivalModePanel() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { state, start, cancel, reset } = useEscudoSurvival();

  const survival = t.elite.areas.escudo.modes.supervivenciaElite;

  // Form fields
  const [rawData, setRawData] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyNit, setCompanyNit] = useState('');

  const handleFileUpload = useCallback(async (file: File) => {
    const text = await file.text();
    setRawData(text);
  }, []);

  const handleRun = useCallback(() => {
    if (!rawData.trim()) return;
    start({
      rawData,
      company: {
        name: companyName.trim() || undefined,
        nit: companyNit.trim() || undefined,
      },
      language,
    });
  }, [rawData, companyName, companyNit, language, start]);

  const handleReset = useCallback(() => {
    reset();
    setRawData('');
  }, [reset]);

  const fadeItem = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay: 0.05 * index,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  // Compute per-stage statuses from progress events
  function stageStatus(
    stage: EscudoSurvivalProgressStage,
    progress: Array<{ stage: EscudoSurvivalProgressStage; status: 'started' | 'completed' | 'failed' }>,
  ): 'pending' | 'started' | 'completed' | 'failed' {
    const events = progress.filter((e) => e.stage === stage);
    if (events.some((e) => e.status === 'completed')) return 'completed';
    if (events.some((e) => e.status === 'failed')) return 'failed';
    if (events.some((e) => e.status === 'started')) return 'started';
    return 'pending';
  }

  const isRunning = state.status === 'running';
  const isDone = state.status === 'done';
  const isError = state.status === 'error';
  const isIdle = state.status === 'idle';

  const progressEvents = state.status !== 'idle' ? state.progress : [];
  const report = isDone ? state.report : undefined;

  // Card loading: true if stage not yet completed
  function cardLoading(stage: EscudoSurvivalProgressStage): boolean {
    if (!isRunning) return false;
    return stageStatus(stage, progressEvents) !== 'completed';
  }

  return (
    <div className="relative w-full flex flex-col gap-10">
      {/* ── Idle: upload form ─────────────────────────────────────────────── */}
      {isIdle && (
        <motion.section {...fadeItem(0)} aria-label={survival.actions.upload}>
          <div className={cn('rounded-xl p-6 md:p-8 glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]')}>
            <p className="text-base text-n-700 dark:text-n-400 mb-6 leading-relaxed max-w-2xl">
              {survival.intro}
            </p>

            {/* File drop zone */}
            <FileUploadZone
              accept=".csv,.xlsx,.xls,.pdf,.docx,.txt"
              onUpload={handleFileUpload}
              label={survival.actions.upload}
              sublabel={language === 'es' ? 'CSV, Excel o PDF — máx. 25 MB' : 'CSV, Excel or PDF — max 25 MB'}
              className="mb-5"
            />

            {/* Company fields (optional) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="survival-company-name"
                  className="text-xs uppercase tracking-eyebrow text-n-500 font-medium"
                >
                  {language === 'es' ? 'Nombre de la empresa (opcional)' : 'Company name (optional)'}
                </label>
                <input
                  id="survival-company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={language === 'es' ? 'Ej. Inversiones XYZ S.A.S.' : 'E.g. XYZ Investments S.A.S.'}
                  className={cn(
                    'h-10 px-3 rounded-md text-sm',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                    'border border-n-300/60 dark:border-n-700/60',
                    'text-n-800 dark:text-n-200 placeholder:text-n-400',
                    'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo',
                    'transition-[border-color,box-shadow]',
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="survival-company-nit"
                  className="text-xs uppercase tracking-eyebrow text-n-500 font-medium"
                >
                  NIT (opcional)
                </label>
                <input
                  id="survival-company-nit"
                  type="text"
                  value={companyNit}
                  onChange={(e) => setCompanyNit(e.target.value)}
                  placeholder="900.123.456-7"
                  className={cn(
                    'h-10 px-3 rounded-md text-sm',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                    'border border-n-300/60 dark:border-n-700/60',
                    'text-n-800 dark:text-n-200 placeholder:text-n-400',
                    'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo',
                    'transition-[border-color,box-shadow]',
                  )}
                />
              </div>
            </div>

            {/* Run button */}
            <button
              type="button"
              onClick={handleRun}
              disabled={!rawData.trim()}
              aria-disabled={!rawData.trim()}
              className={cn(
                'inline-flex items-center gap-2 px-6 py-3 rounded-lg',
                'text-sm font-semibold transition-all duration-150',
                'bg-area-escudo text-n-0 hover:bg-[rgb(140_40_40)] active:scale-[0.98]',
                'border border-[rgb(168_56_56_/_0.3)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
                'disabled:opacity-40 disabled:pointer-events-none',
              )}
            >
              <Play className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {survival.statusLabels.idle}
              <ChevronRight className="h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </motion.section>
      )}

      {/* ── Running: progress ─────────────────────────────────────────────── */}
      {isRunning && (
        <motion.section
          {...fadeItem(0)}
          aria-label={survival.statusLabels.running}
          aria-live="polite"
          aria-atomic="false"
        >
          <div className={cn('rounded-xl p-6 glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]')}>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full bg-area-escudo animate-pulse"
                />
                <span className="text-sm font-medium text-n-800 dark:text-n-200">
                  {survival.statusLabels.running}
                </span>
              </div>
              <button
                type="button"
                onClick={cancel}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                  'text-n-600 hover:text-n-800 dark:hover:text-n-200',
                  'bg-n-100/50 dark:bg-n-800/50 hover:bg-n-200/60 dark:hover:bg-n-700/60',
                  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-n-500',
                )}
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {survival.actions.cancel}
              </button>
            </div>

            {/* Progress bar */}
            <div
              role="progressbar"
              aria-valuenow={progressPercent(progressEvents)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={survival.statusLabels.running}
              className="h-1.5 w-full rounded-full bg-n-200/40 dark:bg-n-800/40 overflow-hidden mb-4"
            >
              <motion.div
                className="h-full rounded-full bg-area-escudo"
                animate={{ width: `${progressPercent(progressEvents)}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>

            {/* Stage list */}
            <ul role="list" className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
              {STAGE_ORDER.map((stage) => (
                <StageIndicator
                  key={stage}
                  status={stageStatus(stage, progressEvents)}
                  label={survival.progressStages[stage as keyof typeof survival.progressStages]}
                />
              ))}
            </ul>
          </div>
        </motion.section>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {isError && (
        <motion.section
          {...fadeItem(0)}
          aria-label={survival.statusLabels.error}
          role="alert"
        >
          <div className={cn('rounded-xl p-6 ring-1 ring-danger/40 bg-[rgb(239_68_68_/_0.08)]')}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-danger mb-1">{survival.statusLabels.error}</p>
                <p className="text-sm text-n-700 dark:text-n-400">
                  {state.status === 'error' ? state.error : ''}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleReset}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
                  'bg-n-100 dark:bg-n-800 text-n-800 dark:text-n-200',
                  'hover:bg-n-200 dark:hover:bg-n-700 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-n-500',
                )}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {survival.actions.runAgain}
              </button>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Synthesis header (running: skeleton, done: full) ───────────────── */}
      {(isRunning || isDone) && (
        <motion.div {...fadeItem(1)}>
          <SynthesisHeaderCard
            data={report?.synthesis}
            loading={isRunning}
            t={survival.synthesis}
            language={language}
          />
        </motion.div>
      )}

      {/* ── 5-card grid ───────────────────────────────────────────────────── */}
      {(isRunning || isDone) && (
        <motion.section
          {...fadeItem(2)}
          aria-label={language === 'es' ? 'Análisis de supervivencia fiscal' : 'Fiscal survival analysis'}
          className="grid grid-cols-1 md:grid-cols-2 gap-5"
        >
          {/* 1. TET */}
          <TetCard
            data={report?.tet}
            loading={cardLoading('tet')}
            error={
              isRunning && stageStatus('tet', progressEvents) === 'failed'
                ? (language === 'es' ? 'Error al calcular TET.' : 'Error calculating TET.')
                : undefined
            }
            t={survival.cards.tet}
            language={language}
          />

          {/* 2. Retention Shield */}
          <RetentionShieldCard
            data={report?.retentionShield}
            loading={cardLoading('retention')}
            error={
              isRunning && stageStatus('retention', progressEvents) === 'failed'
                ? (language === 'es' ? 'Error al calcular escudo de retenciones.' : 'Error calculating retention shield.')
                : undefined
            }
            t={survival.cards.retention}
            language={language}
          />

          {/* 3. Anti-DIAN */}
          <AntiDianCard
            data={report?.antiDian}
            loading={cardLoading('antiDian')}
            error={
              isRunning && stageStatus('antiDian', progressEvents) === 'failed'
                ? (language === 'es' ? 'Error en auditoría preventiva.' : 'Error in preventive audit.')
                : undefined
            }
            t={survival.cards.antiDian}
            language={language}
          />

          {/* 4. Contingency Reserve */}
          <ContingencyReserveCard
            data={report?.contingencyReserve}
            loading={cardLoading('reserve')}
            error={
              isRunning && stageStatus('reserve', progressEvents) === 'failed'
                ? (language === 'es' ? 'Error al calcular reserva.' : 'Error calculating reserve.')
                : undefined
            }
            t={survival.cards.reserve}
            language={language}
          />

          {/* 5. Dividend Optimizer — full width on its own row */}
          <div className="md:col-span-2">
            <DividendOptimizerCard
              data={report?.dividendOptimizer}
              loading={cardLoading('dividend')}
              error={
                isRunning && stageStatus('dividend', progressEvents) === 'failed'
                  ? (language === 'es' ? 'Error al optimizar dividendos.' : 'Error optimizing dividends.')
                  : undefined
              }
              t={survival.cards.dividend}
              language={language}
            />
          </div>
        </motion.section>
      )}

      {/* ── Done: reset CTA ───────────────────────────────────────────────── */}
      {isDone && (
        <motion.div {...fadeItem(3)} className="flex justify-end">
          <button
            type="button"
            onClick={handleReset}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
              'text-n-600 hover:text-area-escudo',
              'bg-transparent hover:bg-[rgb(168_56_56_/_0.08)]',
              'border border-n-300/40 hover:border-[rgb(168_56_56_/_0.4)]',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo',
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {survival.actions.runAgain}
          </button>
        </motion.div>
      )}
    </div>
  );
}
