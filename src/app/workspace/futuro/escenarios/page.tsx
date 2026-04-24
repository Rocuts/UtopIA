'use client';

/**
 * /workspace/futuro/escenarios — Modelado de Escenarios.
 *
 * - Hero + descripción (Monte Carlo-style, base/optimista/pesimista,
 *   sensibilidad multivariada).
 * - Simulador visual: 3 escenarios side-by-side (Pesimista / Base / Optimista)
 *   con variables ajustables globalmente (crecimiento ingresos, costos
 *   variables, inflación, TRM). Output por escenario:
 *     Ingresos Año 3, Margen EBITDA, Caja Final, Probabilidad de éxito.
 * - Gráfico combinado SVG: 3 líneas proyectadas de ingresos 5 años bajo cada
 *   escenario (wine / neutral / gold).
 * - CTA: "Simular escenario personalizado" → chat + cálculos.
 *
 * Todos los cálculos son locales y puros. Sparklines, bars y line chart SVG
 * inline — ninguna lib externa.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  TrendingUp,
  Minus as MinusIcon,
  Zap,
  Target,
  Wallet,
  Percent,
  Sliders,
  Sparkles,
  MessageSquare,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

// ─── Modelo de escenarios ────────────────────────────────────────────────────

type ScenarioKey = 'pesimista' | 'base' | 'optimista';

interface ScenarioModifier {
  key: ScenarioKey;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  /** Probabilidad base de este escenario (se recalcula con sliders). */
  baseProb: number;
  /** Factor multiplicativo sobre crecimiento (escenario vs base). */
  growthMod: number;
  /** Shift (pp) sobre costos variables. */
  costMod: number;
  /** Shift (pp) sobre margen EBITDA pre-ajuste. */
  ebitdaMod: number;
  /** Accent dot color. */
  dotColor: string;
  /** Line color para el chart. */
  lineColor: string;
  /** Label emoji-free para aria. */
  accent: 'wine' | 'neutral' | 'gold';
}

const SCENARIOS: ScenarioModifier[] = [
  {
    key: 'pesimista',
    label: 'Pesimista',
    labelEn: 'Pessimistic',
    description: 'Crecimiento débil, costos crecen, consumo se contrae.',
    descriptionEn: 'Weak growth, costs rise, consumption contracts.',
    baseProb: 0.2,
    growthMod: -0.35,
    costMod: +0.04,
    ebitdaMod: -0.04,
    dotColor: 'var(--color-wine-400)',
    lineColor: 'var(--color-wine-400)',
    accent: 'wine',
  },
  {
    key: 'base',
    label: 'Base',
    labelEn: 'Base',
    description: 'Outlook central. Variables según consenso BanRep.',
    descriptionEn: 'Central outlook. Variables per BanRep consensus.',
    baseProb: 0.5,
    growthMod: 0,
    costMod: 0,
    ebitdaMod: 0,
    dotColor: 'var(--n-500)',
    lineColor: '#D4D4D4',
    accent: 'neutral',
  },
  {
    key: 'optimista',
    label: 'Optimista',
    labelEn: 'Optimistic',
    description: 'Ciclo expansivo, costos controlados, demanda robusta.',
    descriptionEn: 'Expansion cycle, controlled costs, robust demand.',
    baseProb: 0.3,
    growthMod: +0.45,
    costMod: -0.03,
    ebitdaMod: +0.05,
    dotColor: 'var(--gold-400)',
    lineColor: 'var(--gold-400)',
    accent: 'gold',
  },
];

interface Controls {
  /** Crecimiento anual de ingresos en escenario base (0-1). */
  revenueGrowth: number;
  /** Costos variables como % de ingresos (0-1). */
  variableCostRate: number;
  /** Inflación esperada (0-1). */
  inflation: number;
  /** TRM COP/USD. */
  trm: number;
  /** Revenue base Año 0 (COP). */
  baseRevenue: number;
}

const DEFAULT_CONTROLS: Controls = {
  revenueGrowth: 0.12,
  variableCostRate: 0.58,
  inflation: 0.042,
  trm: 4120,
  baseRevenue: 5_000_000_000,
};

// ─── Cálculos ────────────────────────────────────────────────────────────────

interface ScenarioOutput {
  scenario: ScenarioModifier;
  revenueByYear: number[]; // años 1..5
  ebitdaMargin: number; // final
  year3Revenue: number;
  finalCash: number; // al año 5 (aprox)
  successProb: number; // 0..1
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function computeScenario(ctrl: Controls, s: ScenarioModifier): ScenarioOutput {
  // Growth efectivo: base growth * (1 + growthMod) ajustado por inflación
  const effectiveGrowth = Math.max(-0.3, ctrl.revenueGrowth * (1 + s.growthMod));
  // Costos variables finales
  const costRate = Math.min(0.95, Math.max(0.1, ctrl.variableCostRate + s.costMod));
  // EBITDA margin base derivado: 1 - costRate - 0.12 (overhead) + modifier
  const ebitdaMargin = Math.max(0.02, Math.min(0.55, 1 - costRate - 0.12 + s.ebitdaMod));

  // Ingresos por año (compound growth)
  const revenueByYear: number[] = [];
  let rev = ctrl.baseRevenue;
  for (let y = 1; y <= 5; y++) {
    rev = rev * (1 + effectiveGrowth);
    revenueByYear.push(rev);
  }

  const year3Revenue = revenueByYear[2] ?? 0;

  // Caja final: suma simplificada de EBITDA acumulado menos capex 8%/año.
  const capexRate = 0.08;
  let cash = 0;
  for (const r of revenueByYear) {
    const ebitda = r * ebitdaMargin;
    const capex = r * capexRate;
    cash += ebitda - capex;
  }

  // Prob éxito: penalizamos con inflación alta y TRM alta (riesgo CO).
  const infPenalty = Math.max(0, ctrl.inflation - 0.03) * 4; // cada punto sobre 3% pega
  const trmPenalty = Math.max(0, (ctrl.trm - 4000) / 4000) * 0.6;
  let rawProb = s.baseProb - infPenalty * 0.1 - trmPenalty * 0.08;
  // Boost por ebitdaMargin
  rawProb += Math.max(0, ebitdaMargin - 0.2) * 0.4;
  const successProb = clamp01(rawProb);

  return {
    scenario: s,
    revenueByYear,
    ebitdaMargin,
    year3Revenue,
    finalCash: cash,
    successProb,
  };
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatCopShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('es-CO')}`;
}

function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(decimals)}%`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EscenariosPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { setActiveCaseType, setActiveMode, startNewConsultation } = useWorkspace();
  const futuro = t.elite.areas.futuro;
  const isEs = language === 'es';

  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  const outputs = useMemo<ScenarioOutput[]>(
    () => SCENARIOS.map((s) => computeScenario(controls, s)),
    [controls],
  );

  const handleLaunchChat = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('financial-intelligence');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const handleReset = useCallback(() => {
    setControls(DEFAULT_CONTROLS);
  }, []);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.05 + i * 0.06,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-n-1000 text-n-100',
      )}
    >
      {/* Ambient orbs (gold + wine mix) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[560px] h-[560px] rounded-full blur-[120px] opacity-28"
          style={{
            background:
              'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.38) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
          }}
        />
        <div
          className="absolute bottom-[5%] -left-[10%] w-[500px] h-[500px] rounded-full blur-[130px] opacity-22"
          style={{
            background:
              'radial-gradient(circle, rgba(114,47,55,0.35) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        {/* Back */}
        <motion.div {...fade(0)} className="mb-6">
          <Link
            href="/workspace/futuro"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs text-n-500 hover:text-gold-600 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{isEs ? 'Volver a El Futuro' : 'Back to The Future'}</span>
          </Link>
        </motion.div>

        {/* Hero */}
        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={isEs ? 'Modelado de Escenarios' : 'Scenario Modeling'}
            title={futuro.submodules.escenarios.title}
            subtitle={
              isEs
                ? 'Simulaciones tipo Monte Carlo · Base / Optimista / Pesimista · Sensibilidad multivariada'
                : 'Monte Carlo-style simulations · Base / Optimistic / Pessimistic · Multivariate sensitivity'
            }
            align="left"
            accent="gold"
            divider
          />
        </motion.div>

        {/* Narrative */}
        <motion.p
          {...fade(2)}
          className={cn(
            'font-serif-elite font-normal',
            'text-xl sm:text-xl md:text-2xl leading-[1.55]',
            'text-n-300 max-w-3xl mb-10',
          )}
        >
          {isEs
            ? 'El futuro no es una línea; es un abanico de posibilidades. Aquí puede mover cuatro variables — crecimiento, costos, inflación, TRM — y ver cómo los tres escenarios reaccionan en tiempo real.'
            : 'The future is not a line; it is a fan of possibilities. Here you can move four variables — growth, costs, inflation, FX — and watch three scenarios react in real time.'}
        </motion.p>

        {/* Controls */}
        <motion.div {...fade(3)} className="mb-8">
          <EliteCard variant="glass" padding="lg">
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <Sliders className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <span className="uppercase tracking-eyebrow text-xs font-medium text-gold-500">
                    {isEs ? 'Variables globales' : 'Global variables'}
                  </span>
                  <h2 className="font-serif-elite text-xl leading-tight text-n-100">
                    {isEs
                      ? 'Ajuste los drivers del modelo'
                      : 'Adjust the model drivers'}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-xs font-medium',
                  'bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.25)] text-n-300',
                  'hover:border-gold-500 hover:text-n-100 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
                )}
              >
                <MinusIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {isEs ? 'Restablecer' : 'Reset'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <SliderControl
                label={isEs ? 'Crecimiento ingresos' : 'Revenue growth'}
                value={controls.revenueGrowth}
                min={-0.1}
                max={0.4}
                step={0.005}
                formatter={(v) => formatPct(v)}
                icon={TrendingUp}
                onChange={(v) => setControls((c) => ({ ...c, revenueGrowth: v }))}
              />
              <SliderControl
                label={isEs ? 'Costos variables' : 'Variable costs'}
                value={controls.variableCostRate}
                min={0.2}
                max={0.85}
                step={0.01}
                formatter={(v) => formatPct(v)}
                icon={Percent}
                onChange={(v) => setControls((c) => ({ ...c, variableCostRate: v }))}
              />
              <SliderControl
                label={isEs ? 'Inflación esperada' : 'Expected inflation'}
                value={controls.inflation}
                min={0.02}
                max={0.12}
                step={0.002}
                formatter={(v) => formatPct(v, 2)}
                icon={Zap}
                onChange={(v) => setControls((c) => ({ ...c, inflation: v }))}
              />
              <SliderControl
                label={isEs ? 'TRM (COP/USD)' : 'USD/COP FX'}
                value={controls.trm}
                min={3600}
                max={5000}
                step={10}
                formatter={(v) => `$${Math.round(v).toLocaleString('es-CO')}`}
                icon={Target}
                onChange={(v) => setControls((c) => ({ ...c, trm: v }))}
              />
            </div>

            <div className="mt-5 pt-5 border-t border-[rgb(var(--color-gold-500-rgb)_/_0.16)] flex items-center justify-between gap-3 text-xs text-n-500">
              <span>
                {isEs ? 'Ingresos base (Año 0):' : 'Base revenue (Year 0):'}{' '}
                <span className="text-n-300 tabular-nums">
                  {formatCopShort(controls.baseRevenue)} COP
                </span>
              </span>
              <span className="text-n-600">
                {isEs
                  ? 'Horizonte 5 años · Capex 8% ingresos · Overhead 12%'
                  : '5-year horizon · Capex 8% of revenue · Overhead 12%'}
              </span>
            </div>
          </EliteCard>
        </motion.div>

        {/* 3 escenarios side-by-side */}
        <motion.div
          {...fade(4)}
          className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-10"
        >
          {outputs.map((out) => (
            <ScenarioColumn key={out.scenario.key} output={out} isEs={isEs} />
          ))}
        </motion.div>

        {/* Gráfico combinado */}
        <motion.div {...fade(5)} className="mb-12">
          <EliteCard variant="glass" padding="lg">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div>
                <span className="uppercase tracking-eyebrow text-xs font-medium text-gold-500">
                  {isEs ? 'Proyección combinada' : 'Combined projection'}
                </span>
                <h3 className="font-serif-elite text-xl leading-tight text-n-100 mt-0.5">
                  {isEs ? 'Ingresos 5 años bajo cada escenario' : '5-year revenue under each scenario'}
                </h3>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {SCENARIOS.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 text-n-300">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.dotColor }}
                    />
                    {isEs ? s.label : s.labelEn}
                  </span>
                ))}
              </div>
            </div>
            <CombinedChart outputs={outputs} isEs={isEs} />
          </EliteCard>
        </motion.div>

        {/* CTA */}
        <motion.div {...fade(6)}>
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-40"
              style={{
                background:
                  'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.35) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
              }}
            />
            <div className="relative z-[1] flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
              <div className="flex items-start gap-3 md:max-w-md">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-500 mb-1 inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {isEs ? 'Simulación personalizada' : 'Custom simulation'}
                  </div>
                  <h3 className="font-serif-elite text-xl leading-tight text-n-100 mb-1.5">
                    {isEs
                      ? 'Simular escenario personalizado'
                      : 'Simulate a custom scenario'}
                  </h3>
                  <p className="text-sm leading-relaxed text-n-500">
                    {isEs
                      ? 'Describa un evento específico (ej. entrada de un competidor, cambio regulatorio, nueva línea) y simulamos su impacto en las tres sendas.'
                      : 'Describe a specific event (e.g. new competitor entry, regulatory change, new line) and we simulate its impact on the three paths.'}
                  </p>
                </div>
              </div>

              <EliteButton
                type="button"
                variant="primary"
                size="lg"
                onClick={handleLaunchChat}
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                glow
                className="md:ml-auto shrink-0"
              >
                {isEs ? 'Diseñar escenario en chat' : 'Design scenario in chat'}
              </EliteButton>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Slider control ──────────────────────────────────────────────────────────

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter: (v: number) => string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  onChange: (v: number) => void;
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  formatter,
  icon: Icon,
  onChange,
}: SliderControlProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="uppercase tracking-[0.14em] text-2xs font-medium text-n-500 inline-flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-gold-600" strokeWidth={2} aria-hidden="true" />
          {label}
        </span>
        <span className="text-xs font-medium text-n-100 tabular-nums">
          {formatter(value)}
        </span>
      </div>
      <div className="relative h-6 flex items-center">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 h-1.5 rounded-full bg-[rgb(var(--color-gold-500-rgb)_/_0.14)]"
        />
        <div
          aria-hidden="true"
          className="absolute left-0 h-1.5 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: 'linear-gradient(90deg, var(--gold-500) 0%, var(--gold-400) 100%)',
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className={cn(
            'relative w-full h-6 appearance-none bg-transparent cursor-pointer',
            'focus-visible:outline-none',
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4',
            '[&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:bg-gold-300',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gold-500',
            '[&::-webkit-slider-thumb]:shadow-[0_0_12px_rgb(var(--color-gold-500-rgb) / 0.5)]',
            '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4',
            '[&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:bg-gold-300',
            '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-gold-500',
          )}
        />
      </div>
    </div>
  );
}

// ─── Scenario column (3 columnas lado a lado) ────────────────────────────────

function ScenarioColumn({ output, isEs }: { output: ScenarioOutput; isEs: boolean }) {
  const s = output.scenario;
  const label = isEs ? s.label : s.labelEn;
  const description = isEs ? s.description : s.descriptionEn;

  // Gradient border distinto por accent
  const gradient =
    s.accent === 'wine'
      ? 'linear-gradient(135deg, rgba(114,47,55,0.6), rgba(196,106,118,0.35) 60%, rgba(114,47,55,0.25))'
      : s.accent === 'gold'
        ? 'linear-gradient(135deg, rgb(var(--color-gold-500-rgb) / 0.6), rgba(232,180,44,0.4) 60%, rgb(var(--color-gold-500-rgb) / 0.25))'
        : 'linear-gradient(135deg, rgba(168,168,168,0.5), rgba(212,212,212,0.3) 60%, rgba(168,168,168,0.2))';

  const successColor =
    output.successProb >= 0.55
      ? 'text-success-light'
      : output.successProb >= 0.3
        ? 'text-gold-600'
        : 'text-danger-light';

  return (
    <div
      className={cn(
        'relative rounded-xl p-5 flex flex-col gap-4',
        'bg-[rgba(10,10,10,0.55)]',
      )}
    >
      {/* Gradient border overlay (por accent) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl"
        style={{
          padding: '1px',
          background: gradient,
          WebkitMask:
            'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 relative">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: s.dotColor }}
          />
          <span className="uppercase tracking-eyebrow text-2xs font-medium text-n-500">
            {label}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium tabular-nums',
            successColor,
            'bg-[rgba(10,10,10,0.6)] border border-[rgb(var(--color-gold-500-rgb)_/_0.2)]',
          )}
        >
          P={(output.successProb * 100).toFixed(0)}%
        </span>
      </div>

      <h3 className="font-serif-elite text-3xl leading-[1.05] text-n-100 relative">
        {label}
      </h3>
      <p className="text-xs leading-snug text-n-500 relative">{description}</p>

      {/* Metrics */}
      <div className="flex flex-col gap-2.5 relative pt-2 border-t border-[rgb(var(--color-gold-500-rgb)_/_0.14)]">
        <ScenarioMetric
          icon={Target}
          label={isEs ? 'Ingresos Año 3' : 'Year 3 revenue'}
          value={`${formatCopShort(output.year3Revenue)} COP`}
          color="text-n-100"
        />
        <ScenarioMetric
          icon={Percent}
          label={isEs ? 'Margen EBITDA' : 'EBITDA margin'}
          value={formatPct(output.ebitdaMargin, 1)}
          color={
            output.ebitdaMargin >= 0.2
              ? 'text-success-light'
              : output.ebitdaMargin >= 0.12
                ? 'text-gold-600'
                : 'text-danger-light'
          }
        />
        <ScenarioMetric
          icon={Wallet}
          label={isEs ? 'Caja final 5Y' : 'Final cash 5Y'}
          value={`${formatCopShort(output.finalCash)} COP`}
          color={
            output.finalCash > 0 ? 'text-success-light' : 'text-danger-light'
          }
        />
      </div>

      {/* Mini revenue bars */}
      <div className="relative pt-2 border-t border-[rgb(var(--color-gold-500-rgb)_/_0.14)]">
        <div className="text-2xs uppercase tracking-[0.14em] text-n-500 mb-2">
          {isEs ? 'Ingresos por año' : 'Revenue by year'}
        </div>
        <RevenueBars points={output.revenueByYear} color={s.lineColor} />
      </div>
    </div>
  );
}

function ScenarioMetric({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="inline-flex items-center gap-2 text-n-500">
        <Icon className="h-3.5 w-3.5 text-gold-600" strokeWidth={1.9} aria-hidden="true" />
        <span>{label}</span>
      </span>
      <span className={cn('tabular-nums font-medium', color ?? 'text-n-100')}>
        {value}
      </span>
    </div>
  );
}

// ─── Revenue bars ───────────────────────────────────────────────────────────

function RevenueBars({ points, color }: { points: number[]; color: string }) {
  const max = Math.max(...points, 1);
  return (
    <div className="flex items-end gap-1.5 h-[44px]">
      {points.map((p, i) => {
        const h = Math.max(4, (p / max) * 40);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              aria-hidden="true"
              className="w-full rounded-t-[3px] transition-all duration-300"
              style={{
                height: `${h}px`,
                background: `linear-gradient(180deg, ${color} 0%, ${color}44 100%)`,
              }}
            />
            <span className="text-2xs text-n-600 tabular-nums">Y{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Combined chart (SVG inline, 3 líneas) ──────────────────────────────────

function CombinedChart({ outputs, isEs }: { outputs: ScenarioOutput[]; isEs: boolean }) {
  const width = 720;
  const height = 260;
  const padX = 48;
  const padY = 28;

  // Eje Y: usa max global
  const allValues = outputs.flatMap((o) => o.revenueByYear);
  const maxV = Math.max(...allValues, 1);
  const minV = 0;
  const yearsCount = outputs[0]?.revenueByYear.length ?? 5;

  const xStep = (width - padX * 2) / (yearsCount - 1);

  const toX = (idx: number) => padX + idx * xStep;
  const toY = (v: number) =>
    padY + (height - padY * 2) * (1 - (v - minV) / (maxV - minV));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto min-w-[520px]"
        role="img"
        aria-label={
          isEs
            ? 'Proyección de ingresos a 5 años bajo tres escenarios'
            : '5-year revenue projection under three scenarios'
        }
      >
        {/* Grid Y horizontal */}
        {[0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padY + (height - padY * 2) * (1 - pct);
          const vLabel = minV + (maxV - minV) * pct;
          return (
            <g key={pct}>
              <line
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="rgb(var(--color-gold-500-rgb) / 0.12)"
                strokeWidth={1}
                strokeDasharray="3 5"
              />
              <text
                x={padX - 6}
                y={y + 3}
                textAnchor="end"
                fill="var(--n-600)"
                fontSize={9}
                fontFamily="ui-monospace, monospace"
              >
                {formatCopShort(vLabel)}
              </text>
            </g>
          );
        })}

        {/* Eje X ticks */}
        {Array.from({ length: yearsCount }, (_, i) => {
          const x = toX(i);
          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                x2={x}
                y1={height - padY}
                y2={height - padY + 4}
                stroke="rgb(var(--color-gold-500-rgb) / 0.3)"
                strokeWidth={1}
              />
              <text
                x={x}
                y={height - padY + 16}
                textAnchor="middle"
                fill="var(--n-600)"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {isEs ? `Año ${i + 1}` : `Y${i + 1}`}
              </text>
            </g>
          );
        })}

        {/* Bottom axis */}
        <line
          x1={padX}
          x2={width - padX}
          y1={height - padY}
          y2={height - padY}
          stroke="rgb(var(--color-gold-500-rgb) / 0.3)"
          strokeWidth={1}
        />

        {/* Lines */}
        {outputs.map((o) => {
          const pts = o.revenueByYear
            .map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
            .join(' ');
          // Area bajo cada línea (muy sutil)
          const areaPts = `${padX},${height - padY} ${pts} ${width - padX},${height - padY}`;
          return (
            <g key={o.scenario.key}>
              <polygon
                points={areaPts}
                fill={o.scenario.lineColor}
                opacity={0.08}
              />
              <polyline
                points={pts}
                fill="none"
                stroke={o.scenario.lineColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Puntos */}
              {o.revenueByYear.map((v, i) => (
                <circle
                  key={`pt-${o.scenario.key}-${i}`}
                  cx={toX(i)}
                  cy={toY(v)}
                  r={3}
                  fill={o.scenario.lineColor}
                  stroke="var(--n-1000)"
                  strokeWidth={1.5}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
