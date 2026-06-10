'use client';

/**
 * FiscalAgentPanel — Capa 4 (Agente Fiscal) UI.
 *
 * Orquesta las 7 cards de módulos + panel de Supervivencia (Módulo 8).
 * Consume /api/escudo/fiscal via useFiscalAgentSSE.
 *
 * Estados:
 *   idle        → Formulario de carga (FileUploadZone + campos + selección de modo)
 *   submitting  → Skeleton de transición
 *   streaming   → Grid parcial con shimmer + barra de progreso SSE
 *   done        → Grid completo con todos los módulos
 *   error       → Banner de error + CTA "Intentar de nuevo"
 *
 * LENIS: NO se agrega overflow-y-auto interno — la página hereda
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
import { useFiscalAgentSSE } from '@/hooks/useFiscalAgentSSE';
import { FileUploadZone } from '@/design-system/components/FileUploadZone';
import { CcvFiscalCard } from './cards/CcvFiscalCard';
import { RiskScoreCard } from './cards/RiskScoreCard';
import { ConciliacionCard } from './cards/ConciliacionCard';
import { PlaneacionCard } from './cards/PlaneacionCard';
import { DefensaDianCard } from './cards/DefensaDianCard';
import { DevolucionesCard } from './cards/DevolucionesCard';
import { SurvivalModeSection } from './survival/SurvivalModeSection';
import type { FiscalAgentMode } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

// ---------------------------------------------------------------------------
// Progress stage order
// ---------------------------------------------------------------------------

const STAGE_ORDER = [
  'preprocessing',
  'ccv',
  'risk_score',
  'conciliacion',
  'planeacion',
  'defensa_dian',
  'devoluciones',
  'supervivencia',
  'synthesis',
  'validation',
] as const;

type StageKey = typeof STAGE_ORDER[number];

function progressPercent(
  progress: Array<{ stage: string; status: string }>,
): number {
  const completed = progress.filter((s) => s.status === 'completed').length;
  return Math.round((completed / STAGE_ORDER.length) * 100);
}

function stageStatus(
  stage: string,
  progress: Array<{ stage: string; status: string }>,
): 'pending' | 'started' | 'completed' | 'failed' {
  const events = progress.filter((e) => e.stage === stage);
  if (events.some((e) => e.status === 'completed')) return 'completed';
  if (events.some((e) => e.status === 'failed')) return 'failed';
  if (events.some((e) => e.status === 'started')) return 'started';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Stage indicator
// ---------------------------------------------------------------------------

function StageIndicator({ status, label }: { status: 'pending' | 'started' | 'completed' | 'failed'; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 rounded-full shrink-0 transition-colors',
          status === 'completed' && 'bg-success',
          status === 'started' && 'bg-warning animate-pulse',
          status === 'failed' && 'bg-danger',
          status === 'pending' && 'bg-n-300/40 dark:bg-n-700/40',
        )}
      />
      <span
        className={cn(
          'transition-colors',
          status === 'completed' && 'text-n-700 dark:text-n-600',
          status === 'started' && 'text-n-800 dark:text-n-700 font-medium',
          status === 'pending' && 'text-n-600',
          status === 'failed' && 'text-danger',
        )}
      >
        {label}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Mode button
// ---------------------------------------------------------------------------

interface ModeButtonProps {
  mode: FiscalAgentMode;
  selectedMode: FiscalAgentMode;
  label: string;
  onClick: (mode: FiscalAgentMode) => void;
}

function ModeButton({ mode, selectedMode, label, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      aria-pressed={selectedMode === mode}
      className={cn(
        'px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-escudo focus-visible:ring-offset-2',
        selectedMode === mode
          ? 'bg-area-escudo text-n-0 ring-1 ring-[rgb(168_56_56_/_0.5)]'
          : 'bg-n-100/60 dark:bg-n-800/60 text-n-800 dark:text-n-700 hover:bg-n-200/60 dark:hover:bg-n-700/60',
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FiscalAgentPanel() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { state, start, abort, reset } = useFiscalAgentSSE();

  // Form state
  const [rawData, setRawData] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyNit, setCompanyNit] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dianText, setDianText] = useState('');
  const [selectedMode, setSelectedMode] = useState<FiscalAgentMode>('full');

  const fiscal = t.elite.areas.escudo.fiscalAgent;

  const handleFileUpload = useCallback(async (file: File) => {
    const text = await file.text();
    setRawData(text);
  }, []);

  const handleRun = useCallback(() => {
    if (!rawData.trim()) return;
    start({
      rawData,
      mode: selectedMode,
      company: {
        name: companyName.trim() || undefined,
        nit: companyNit.trim() || undefined,
      },
      language,
      instructions: instructions.trim() || undefined,
      dianRequirementText: dianText.trim() || undefined,
    });
  }, [rawData, selectedMode, companyName, companyNit, language, instructions, dianText, start]);

  const handleReset = useCallback(() => {
    reset();
    setRawData('');
    setInstructions('');
    setDianText('');
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

  const isIdle = state.status === 'idle';
  const isSubmitting = state.status === 'submitting';
  const isStreaming = state.status === 'streaming';
  const isDone = state.status === 'done';
  const isError = state.status === 'error';
  const isActive = isSubmitting || isStreaming;

  const progressEvents = (state.status === 'streaming' || state.status === 'done' || state.status === 'error') ? state.progress : [];
  const report = isDone ? state.report : undefined;

  // Card-level loading: true if stage not yet completed
  function cardLoading(stage: string): boolean {
    if (!isStreaming) return false;
    return stageStatus(stage, progressEvents) !== 'completed';
  }

  function cardError(stage: string): string | undefined {
    if (!isStreaming) return undefined;
    if (stageStatus(stage, progressEvents) === 'failed') {
      return language === 'es' ? `Error en módulo: ${stage}` : `Module error: ${stage}`;
    }
    return undefined;
  }

  const showSurvival = isDone
    ? Boolean(report?.supervivencia?.data.activo)
    : selectedMode === 'supervivencia' && (isStreaming || isDone);

  return (
    <div className="relative w-full flex flex-col gap-10">
      {/* ── Idle: form ─────────────────────────────────────────────────────── */}
      {isIdle && (
        <motion.section {...fadeItem(0)} aria-label={fiscal.uploadLabel}>
          <div className="rounded-xl p-6 md:p-8 glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]">
            <p className="text-base text-n-700 dark:text-n-600 mb-6 leading-relaxed max-w-2xl">
              {fiscal.intro}
            </p>

            {/* Mode selector */}
            <div className="mb-6">
              <p className="text-xs uppercase tracking-eyebrow text-n-500 font-medium mb-2">
                {fiscal.selectMode}
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { mode: 'quick', label: fiscal.modes.quick },
                    { mode: 'full', label: fiscal.modes.full },
                    { mode: 'defensa_dian', label: fiscal.modes.defensa_dian },
                    { mode: 'devolucion', label: fiscal.modes.devolucion },
                    { mode: 'supervivencia', label: fiscal.modes.supervivencia },
                  ] as Array<{ mode: FiscalAgentMode; label: string }>
                ).map(({ mode, label }) => (
                  <ModeButton
                    key={mode}
                    mode={mode}
                    selectedMode={selectedMode}
                    label={label}
                    onClick={setSelectedMode}
                  />
                ))}
              </div>
            </div>

            {/* File drop zone */}
            <FileUploadZone
              accept=".csv,.xlsx,.xls,.pdf,.docx,.txt"
              onUpload={handleFileUpload}
              label={fiscal.uploadLabel}
              sublabel={language === 'es' ? 'CSV, Excel o PDF — máx. 100 MB' : 'CSV, Excel or PDF — max 100 MB'}
              className="mb-5"
            />

            {/* Company + instructions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fiscal-company-name" className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  {language === 'es' ? 'Nombre de la empresa (opcional)' : 'Company name (optional)'}
                </label>
                <input
                  id="fiscal-company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={language === 'es' ? 'Ej. Inversiones XYZ S.A.S.' : 'E.g. XYZ Investments S.A.S.'}
                  className={cn(
                    'h-10 px-3 rounded-md text-sm',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                    'border border-n-300/60 dark:border-n-700/60',
                    'text-n-800 dark:text-n-700 placeholder:text-n-400',
                    'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo transition-[border-color,box-shadow]',
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fiscal-company-nit" className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  NIT (opcional)
                </label>
                <input
                  id="fiscal-company-nit"
                  type="text"
                  value={companyNit}
                  onChange={(e) => setCompanyNit(e.target.value)}
                  placeholder="900.123.456-7"
                  className={cn(
                    'h-10 px-3 rounded-md text-sm',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                    'border border-n-300/60 dark:border-n-700/60',
                    'text-n-800 dark:text-n-700 placeholder:text-n-400',
                    'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo transition-[border-color,box-shadow]',
                  )}
                />
              </div>
            </div>

            {/* Instrucciones libres */}
            <div className="flex flex-col gap-1.5 mb-4">
              <label htmlFor="fiscal-instructions" className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                {language === 'es' ? 'Instrucciones adicionales (opcional)' : 'Additional instructions (optional)'}
              </label>
              <textarea
                id="fiscal-instructions"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={language === 'es' ? 'Ej. Énfasis en deducción de intereses, revisar gastos de nómina...' : 'E.g. Focus on interest deductions, review payroll expenses...'}
                className={cn(
                  'px-3 py-2 rounded-md text-sm resize-none',
                  'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                  'border border-n-300/60 dark:border-n-700/60',
                  'text-n-800 dark:text-n-700 placeholder:text-n-400',
                  'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo transition-[border-color,box-shadow]',
                )}
              />
            </div>

            {/* DIAN text — visible solo en modo defensa_dian */}
            {selectedMode === 'defensa_dian' && (
              <div className="flex flex-col gap-1.5 mb-4">
                <label htmlFor="fiscal-dian-text" className="text-xs uppercase tracking-eyebrow text-n-500 font-medium">
                  {language === 'es' ? 'Texto del requerimiento DIAN' : 'DIAN requirement text'}
                </label>
                <textarea
                  id="fiscal-dian-text"
                  rows={4}
                  value={dianText}
                  onChange={(e) => setDianText(e.target.value)}
                  placeholder={language === 'es' ? 'Pegue aquí el texto del requerimiento DIAN...' : 'Paste the DIAN notice text here...'}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm resize-y',
                    'bg-n-50 dark:bg-[rgba(10,10,10,0.5)]',
                    'border border-n-300/60 dark:border-n-700/60',
                    'text-n-800 dark:text-n-700 placeholder:text-n-400',
                    'focus:outline-none focus:border-area-escudo focus:ring-1 focus:ring-area-escudo transition-[border-color,box-shadow]',
                  )}
                />
              </div>
            )}

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
              {fiscal.runButton}
              <ChevronRight className="h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </motion.section>
      )}

      {/* ── Streaming: progress bar ──────────────────────────────────────── */}
      {(isActive) && (
        <motion.section
          {...fadeItem(0)}
          aria-label={fiscal.analyzing}
          aria-live="polite"
          aria-atomic="false"
        >
          <div className="rounded-xl p-6 glass-elite-elevated ring-1 ring-[rgb(168_56_56_/_0.3)]">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full bg-area-escudo animate-pulse"
                />
                <span className="text-sm font-medium text-n-800 dark:text-n-700">
                  {fiscal.analyzing}
                </span>
              </div>
              <button
                type="button"
                onClick={abort}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                  'text-n-600 hover:text-n-800 dark:hover:text-n-700',
                  'bg-n-100/50 dark:bg-n-800/50 hover:bg-n-200/60 dark:hover:bg-n-700/60',
                  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-n-500',
                )}
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {fiscal.cancel}
              </button>
            </div>

            {/* Progress bar */}
            <div
              role="progressbar"
              aria-valuenow={progressPercent(progressEvents)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={fiscal.analyzing}
              className="h-1.5 w-full rounded-full bg-n-200/40 dark:bg-n-800/40 overflow-hidden mb-4"
            >
              <motion.div
                className="h-full rounded-full bg-area-escudo"
                animate={{ width: `${progressPercent(progressEvents)}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
            </div>

            {/* Stage list */}
            <ul role="list" className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2">
              {STAGE_ORDER.map((stage) => (
                <StageIndicator
                  key={stage}
                  status={stageStatus(stage, progressEvents)}
                  label={fiscal.stages[stage as StageKey] ?? stage}
                />
              ))}
            </ul>
          </div>
        </motion.section>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {isError && (
        <motion.section
          {...fadeItem(0)}
          role="alert"
          aria-label={fiscal.errorTitle}
        >
          <div className="rounded-xl p-6 ring-1 ring-danger/40 bg-[rgb(239_68_68_/_0.08)]">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-danger mb-1">{fiscal.errorTitle}</p>
                <p className="text-sm text-n-700 dark:text-n-600">
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
                {fiscal.runAgain}
              </button>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── Module cards ─────────────────────────────────────────────────── */}
      {(isStreaming || isDone) && (
        <>
          {/* Módulo 1 + 3 — always shown (quick/full/any mode) */}
          <motion.section
            {...fadeItem(1)}
            aria-label={language === 'es' ? 'Módulos principales' : 'Main modules'}
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
          >
            {/* Módulo 1 — CCV */}
            <CcvFiscalCard
              data={report?.ccv}
              loading={cardLoading('ccv')}
              error={cardError('ccv')}
              t={fiscal.cards.ccv}
              language={language}
            />

            {/* Módulo 3 — Risk Score */}
            <RiskScoreCard
              data={report?.riskScore}
              loading={cardLoading('risk_score')}
              error={cardError('risk_score')}
              t={fiscal.cards.riskScore}
              language={language}
            />
          </motion.section>

          {/* Módulo 2 — Conciliación (full mode) */}
          {(isDone ? Boolean(report?.conciliacion) : stageStatus('conciliacion', progressEvents) !== 'pending') && (
            <motion.div {...fadeItem(2)}>
              <ConciliacionCard
                data={report?.conciliacion ?? undefined}
                loading={cardLoading('conciliacion')}
                error={cardError('conciliacion')}
                t={fiscal.cards.conciliacion}
                language={language}
              />
            </motion.div>
          )}

          {/* Módulo 4 — Planeación (full mode) */}
          {(isDone ? Boolean(report?.planeacion) : stageStatus('planeacion', progressEvents) !== 'pending') && (
            <motion.div {...fadeItem(3)}>
              <PlaneacionCard
                data={report?.planeacion ?? undefined}
                loading={cardLoading('planeacion')}
                error={cardError('planeacion')}
                t={fiscal.cards.planeacion}
                language={language}
              />
            </motion.div>
          )}

          {/* Módulo 5 — Defensa DIAN */}
          {(isDone ? Boolean(report?.defensaDian) : stageStatus('defensa_dian', progressEvents) !== 'pending') && (
            <motion.div {...fadeItem(4)}>
              <DefensaDianCard
                data={report?.defensaDian ?? undefined}
                loading={cardLoading('defensa_dian')}
                error={cardError('defensa_dian')}
                t={fiscal.cards.defensaDian}
                language={language}
              />
            </motion.div>
          )}

          {/* Módulo 6 — Devoluciones */}
          {(isDone ? Boolean(report?.devoluciones) : stageStatus('devoluciones', progressEvents) !== 'pending') && (
            <motion.div {...fadeItem(5)}>
              <DevolucionesCard
                data={report?.devoluciones ?? undefined}
                loading={cardLoading('devoluciones')}
                error={cardError('devoluciones')}
                t={fiscal.cards.devoluciones}
                language={language}
              />
            </motion.div>
          )}

          {/* Módulo 8 — Supervivencia */}
          {showSurvival && (
            <motion.div {...fadeItem(6)}>
              <SurvivalModeSection
                data={report?.supervivencia ?? undefined}
                loading={cardLoading('supervivencia')}
                language={language}
                t={fiscal.survival}
              />
            </motion.div>
          )}
        </>
      )}

      {/* ── Done: reset CTA ─────────────────────────────────────────────── */}
      {isDone && (
        <motion.div {...fadeItem(7)} className="flex justify-end">
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
            {fiscal.runAgain}
          </button>
        </motion.div>
      )}
    </div>
  );
}
