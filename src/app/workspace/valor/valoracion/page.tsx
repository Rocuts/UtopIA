'use client';

/**
 * /workspace/valor/valoracion — Submódulo Valoración Empresarial.
 *
 * Contiene:
 *  - Hero + marco normativo (NIIF 13, NIC 36, Art. 90 ET, WACC CO)
 *  - Calculadora interactiva inline (EBITDA + Industria + Growth + WACC + Deuda)
 *    → usa `calculateExitValue` en vivo y renderiza resultados formateados
 *  - Gráfico de sensibilidad EV vs Growth (SVG inline)
 *  - CTA "Generar informe profesional completo" → abre IntakeModal
 *    (`business_valuation`) que dispara `/api/business-valuation`
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  LineChart,
  TrendingUp,
  DollarSign,
  ArrowRight,
  Calculator,
  Zap,
  ChevronLeft,
  Info,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EliteCard } from '@/components/ui/EliteCard';
import {
  calculateExitValue,
  formatCop,
  INDUSTRY_MULTIPLES,
} from '@/lib/kpis/exit-value';
import type { ExitValueIndustry, KpiResult } from '@/types/kpis';

// ─── Industry options ────────────────────────────────────────────────────────

const INDUSTRY_OPTIONS: Array<{
  key: ExitValueIndustry;
  labelEs: string;
  labelEn: string;
}> = [
  { key: 'tech', labelEs: 'Tecnología / SaaS', labelEn: 'Tech / SaaS' },
  { key: 'retail', labelEs: 'Retail / Comercio', labelEn: 'Retail / Commerce' },
  { key: 'manufacturing', labelEs: 'Manufactura', labelEn: 'Manufacturing' },
  { key: 'services', labelEs: 'Servicios profesionales', labelEn: 'Professional services' },
  { key: 'financial', labelEs: 'Financiero / Fintech', labelEn: 'Financial / Fintech' },
  { key: 'other', labelEs: 'Otro', labelEn: 'Other' },
];

// ─── Default calculator input ────────────────────────────────────────────────

interface CalcState {
  ebitda: number;
  industry: ExitValueIndustry;
  growthRate: number; // 0-1
  wacc: number; // 0-1
  netDebt: number;
}

const DEFAULT_STATE: CalcState = {
  ebitda: 650_000_000,
  industry: 'services',
  growthRate: 0.18,
  wacc: 0.135,
  netDebt: 380_000_000,
};

// ─── Sensitivity chart ───────────────────────────────────────────────────────

interface SensitivityChartProps {
  base: CalcState;
  language: 'es' | 'en';
}

function SensitivityChart({ base, language }: SensitivityChartProps) {
  const w = 640;
  const h = 220;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 36;

  // Generate EV for growth ∈ [-10%, +40%] in 11 steps
  const steps = 11;
  const points = Array.from({ length: steps }, (_, i) => {
    const g = -0.1 + (i / (steps - 1)) * 0.5;
    const res = calculateExitValue({
      ebitda: base.ebitda,
      industry: base.industry,
      growthRate: g,
      wacc: base.wacc,
      netDebt: base.netDebt,
    });
    return { g, value: res.value };
  });

  // Current point
  const current = calculateExitValue({
    ebitda: base.ebitda,
    industry: base.industry,
    growthRate: base.growthRate,
    wacc: base.wacc,
    netDebt: base.netDebt,
  });

  const minV = Math.min(...points.map((p) => p.value), current.value);
  const maxV = Math.max(...points.map((p) => p.value), current.value);
  const span = maxV - minV || 1;

  const xStep = (w - padL - padR) / (steps - 1);
  const toX = (i: number) => padL + i * xStep;
  const toY = (v: number) => padT + (h - padT - padB) * (1 - (v - minV) / span);

  // Current X is interpolated from base.growthRate.
  const gMin = -0.1;
  const gMax = 0.4;
  const currentFrac = Math.min(1, Math.max(0, (base.growthRate - gMin) / (gMax - gMin)));
  const currentX = padL + currentFrac * (w - padL - padR);
  const currentY = toY(current.value);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(2)} ${toY(p.value).toFixed(2)}`)
    .join(' ');
  const areaPath =
    `M${toX(0).toFixed(2)} ${h - padB}` +
    ' L' +
    points.map((p, i) => `${toX(i).toFixed(2)} ${toY(p.value).toFixed(2)}`).join(' L') +
    ` L${toX(steps - 1).toFixed(2)} ${h - padB} Z`;

  // Y-axis tick labels (3 ticks)
  const yTicks = [0, 0.5, 1].map((r) => ({
    y: padT + (h - padT - padB) * (1 - r),
    value: minV + span * r,
  }));

  // X-axis tick labels (5 ticks)
  const xTickIndexes = [0, 2, 5, 8, 10];

  return (
    <div className="relative">
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="uppercase tracking-[0.18em] text-[10px] font-medium text-[#A8A8A8]">
            {language === 'es'
              ? 'Sensibilidad: EV vs Tasa de Crecimiento'
              : 'Sensitivity: EV vs Growth Rate'}
          </p>
          <p className="text-[11px] text-[#6B6B6B] mt-0.5">
            {language === 'es'
              ? 'Curva del valor mientras el crecimiento varía'
              : 'Value curve as growth varies'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-[#A8A8A8]">
            {language === 'es' ? 'Punto actual' : 'Current point'}
          </p>
          <p className="font-serif-elite text-[18px] text-[#E8B42C] tabular-nums">
            {current.formatted}
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMinYMid meet"
        className="w-full h-[220px]"
        role="img"
        aria-label={
          language === 'es'
            ? 'Gráfico de sensibilidad del Enterprise Value respecto a la tasa de crecimiento.'
            : 'Enterprise Value sensitivity chart against growth rate.'
        }
      >
        <defs>
          <linearGradient id="sens-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4A017" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#D4A017" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sens-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#D4A017" />
            <stop offset="100%" stopColor="#F5C63F" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={t.y}
              y2={t.y}
              stroke="rgba(212, 160, 23, 0.08)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#A8A8A8"
              fontFamily="system-ui, sans-serif"
            >
              {formatCop(t.value)}
            </text>
          </g>
        ))}

        {/* Area + line */}
        <path d={areaPath} fill="url(#sens-area)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#sens-line)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current marker */}
        <line
          x1={currentX}
          x2={currentX}
          y1={padT}
          y2={h - padB}
          stroke="rgba(232,180,44,0.45)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <circle cx={currentX} cy={currentY} r={6} fill="#E8B42C" />
        <circle cx={currentX} cy={currentY} r={11} fill="#E8B42C" opacity="0.2" />

        {/* X-axis tick labels */}
        {xTickIndexes.map((i) => {
          const p = points[i];
          return (
            <text
              key={i}
              x={toX(i)}
              y={h - padB + 18}
              textAnchor="middle"
              fontSize="10"
              fill="#A8A8A8"
              fontFamily="system-ui, sans-serif"
            >
              {(p.g * 100).toFixed(0)}%
            </text>
          );
        })}
        <text
          x={padL + (w - padL - padR) / 2}
          y={h - 4}
          textAnchor="middle"
          fontSize="10"
          fill="#6B6B6B"
          fontFamily="system-ui, sans-serif"
        >
          {language === 'es' ? 'Tasa de crecimiento' : 'Growth rate'}
        </text>
      </svg>
    </div>
  );
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function ValoracionPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { openIntakeForType } = useWorkspace();
  const valor = t.elite.areas.valor;

  const [state, setState] = useState<CalcState>(DEFAULT_STATE);

  const result: KpiResult = useMemo(() => calculateExitValue(state), [state]);

  const handleStartReport = useCallback(() => {
    openIntakeForType('business_valuation');
  }, [openIntakeForType]);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay: 0.06 + i * 0.07, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div
      data-theme="elite"
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-[#030303] text-[#F5F5F5]',
      )}
    >
      {/* Ambient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[15%] -right-[10%] w-[520px] h-[520px] rounded-full blur-[130px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.45) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        {/* Breadcrumb / back */}
        <motion.nav
          {...fade(0)}
          aria-label="breadcrumb"
          className="mb-6"
        >
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-[#A8A8A8] hover:text-[#E8B42C] transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            {language === 'es' ? 'Volver a El Valor' : 'Back to The Value'}
          </Link>
        </motion.nav>

        {/* Hero */}
        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={language === 'es' ? 'II. Valor — Valoración Empresarial' : 'II. Value — Business Valuation'}
            title={valor.submodules.valoracion.title}
            subtitle={language === 'es'
              ? 'WACC, múltiplos EBITDA, DCF y valoración de activos — NIIF 13, NIC 36, Art. 90 E.T.'
              : 'WACC, EBITDA multiples, DCF and asset valuation — IFRS 13, IAS 36, Art. 90 Tax Statute.'}
            align="left"
            accent="gold"
            divider
          />
        </motion.div>

        {/* Marco normativo */}
        <motion.div {...fade(2)} className="mb-10 max-w-3xl">
          <p className={cn(
            'font-serif-elite font-normal',
            'text-[20px] sm:text-[22px] leading-[1.6]',
            'text-[#D4D4D4]',
          )}>
            {language === 'es'
              ? 'Valoramos su empresa combinando métodos intrínsecos (DCF) y de mercado (múltiplos comparables) bajo estándares colombianos. El resultado es defendible ante DIAN, SuperSociedades, inversionistas y bancos.'
              : 'We value your company by combining intrinsic (DCF) and market-based (comparable multiples) methods under Colombian standards. The result is defensible before DIAN, SuperSociedades, investors and banks.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['NIIF 13', 'NIC 36', 'Art. 90 E.T.', 'WACC CO 2026', 'TES / EMBI', 'SuperSociedades'].map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-medium bg-[rgba(212,160,23,0.1)] border border-[rgba(212,160,23,0.28)] text-[#E8B42C] tracking-wide"
              >
                {tag}
              </span>
            ))}
          </div>
        </motion.div>

        {/* ── CALCULADORA ─────────────────────────────────────────────────── */}
        <motion.section {...fade(3)} className="mb-10" aria-label={language === 'es' ? 'Calculadora de valoración' : 'Valuation calculator'}>
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
                >
                  <Calculator className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div>
                  <div className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017] mb-1">
                    {language === 'es' ? 'Calculadora rápida' : 'Quick calculator'}
                  </div>
                  <h2 className="font-serif-elite text-[24px] md:text-[28px] leading-tight text-[#F5F5F5]">
                    {language === 'es' ? 'Valore su empresa en tiempo real' : 'Value your company in real time'}
                  </h2>
                  <p className="text-[13px] text-[#A8A8A8] mt-1 max-w-xl">
                    {language === 'es'
                      ? 'Ajuste los parámetros y vea la estimación del valor de mercado actualizarse en vivo. Para el informe profesional completo, genere el estudio con IA.'
                      : 'Adjust parameters and watch the market value estimate update live. For a full professional report, generate the AI-powered study.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              {/* ── Inputs ──────────────────────────────────────────────── */}
              <div className="flex flex-col gap-5">
                {/* EBITDA */}
                <div>
                  <label htmlFor="calc-ebitda" className="flex items-center justify-between text-[12px] font-medium text-[#D4D4D4] mb-1.5">
                    <span>{language === 'es' ? 'EBITDA anual (COP)' : 'Annual EBITDA (COP)'}</span>
                    <span className="text-[#E8B42C] tabular-nums">{formatCop(state.ebitda)}</span>
                  </label>
                  <input
                    id="calc-ebitda"
                    type="range"
                    min={50_000_000}
                    max={5_000_000_000}
                    step={10_000_000}
                    value={state.ebitda}
                    onChange={(e) =>
                      setState((s) => ({ ...s, ebitda: Number(e.target.value) }))
                    }
                    className="w-full accent-[#D4A017]"
                    aria-valuemin={50_000_000}
                    aria-valuemax={5_000_000_000}
                    aria-valuenow={state.ebitda}
                  />
                </div>

                {/* Industry */}
                <div>
                  <label htmlFor="calc-industry" className="block text-[12px] font-medium text-[#D4D4D4] mb-1.5">
                    {language === 'es' ? 'Industria' : 'Industry'}
                  </label>
                  <select
                    id="calc-industry"
                    value={state.industry}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        industry: e.target.value as ExitValueIndustry,
                      }))
                    }
                    className={cn(
                      'w-full h-11 px-3 rounded-[10px]',
                      'bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.25)]',
                      'text-[14px] text-[#F5F5F5]',
                      'focus:outline-none focus:border-[#D4A017] focus:ring-2 focus:ring-[#D4A017] focus:ring-offset-2 focus:ring-offset-[#030303]',
                    )}
                  >
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key} className="bg-[#0a0a0a]">
                        {language === 'es' ? opt.labelEs : opt.labelEn} — {INDUSTRY_MULTIPLES[opt.key]}x
                      </option>
                    ))}
                  </select>
                </div>

                {/* Growth rate */}
                <div>
                  <label htmlFor="calc-growth" className="flex items-center justify-between text-[12px] font-medium text-[#D4D4D4] mb-1.5">
                    <span>{language === 'es' ? 'Tasa de crecimiento esperada' : 'Expected growth rate'}</span>
                    <span className="text-[#E8B42C] tabular-nums">{pct(state.growthRate)}</span>
                  </label>
                  <input
                    id="calc-growth"
                    type="range"
                    min={-0.1}
                    max={0.5}
                    step={0.005}
                    value={state.growthRate}
                    onChange={(e) =>
                      setState((s) => ({ ...s, growthRate: Number(e.target.value) }))
                    }
                    className="w-full accent-[#D4A017]"
                  />
                </div>

                {/* WACC */}
                <div>
                  <label htmlFor="calc-wacc" className="flex items-center justify-between text-[12px] font-medium text-[#D4D4D4] mb-1.5">
                    <span>{language === 'es' ? 'WACC' : 'WACC'}</span>
                    <span className="text-[#E8B42C] tabular-nums">{pct(state.wacc)}</span>
                  </label>
                  <input
                    id="calc-wacc"
                    type="range"
                    min={0.08}
                    max={0.2}
                    step={0.001}
                    value={state.wacc}
                    onChange={(e) =>
                      setState((s) => ({ ...s, wacc: Number(e.target.value) }))
                    }
                    className="w-full accent-[#D4A017]"
                  />
                </div>

                {/* Net debt */}
                <div>
                  <label htmlFor="calc-debt" className="flex items-center justify-between text-[12px] font-medium text-[#D4D4D4] mb-1.5">
                    <span>{language === 'es' ? 'Deuda neta (COP)' : 'Net debt (COP)'}</span>
                    <span className="text-[#E8B42C] tabular-nums">{formatCop(state.netDebt)}</span>
                  </label>
                  <input
                    id="calc-debt"
                    type="range"
                    min={0}
                    max={3_000_000_000}
                    step={10_000_000}
                    value={state.netDebt}
                    onChange={(e) =>
                      setState((s) => ({ ...s, netDebt: Number(e.target.value) }))
                    }
                    className="w-full accent-[#D4A017]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setState(DEFAULT_STATE)}
                  className="self-start mt-1 inline-flex items-center gap-1.5 text-[11px] text-[#A8A8A8] hover:text-[#E8B42C] transition-colors"
                >
                  <Zap className="h-3 w-3" strokeWidth={2} />
                  {language === 'es' ? 'Restablecer valores ejemplo' : 'Reset example values'}
                </button>
              </div>

              {/* ── Output ──────────────────────────────────────────────── */}
              <div className="flex flex-col gap-5">
                {/* Equity Value grande */}
                <div className="relative overflow-hidden rounded-[14px] glass-elite border border-[rgba(212,160,23,0.3)] p-6 glow-gold-soft">
                  <div
                    aria-hidden="true"
                    className="absolute -top-14 -right-14 w-[200px] h-[200px] rounded-full blur-[70px] opacity-40"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(232,180,44,0.45) 0%, rgba(232,180,44,0) 70%)',
                    }}
                  />
                  <div className="relative z-[1]">
                    <p className="uppercase tracking-[0.18em] text-[10px] font-medium text-[#A8A8A8] mb-2">
                      {language === 'es' ? 'Equity Value estimado' : 'Estimated equity value'}
                    </p>
                    <p className={cn(
                      'font-serif-elite leading-[0.98] tabular-nums',
                      'text-[44px] sm:text-[54px] md:text-[62px]',
                      'bg-clip-text text-transparent',
                      '[background-image:linear-gradient(135deg,#F5F5F5_0%,#E8B42C_50%,#D4A017_100%)]',
                    )}>
                      {result.formatted}
                    </p>
                    <p className="text-[12px] text-[#A8A8A8] mt-2">
                      {language === 'es'
                        ? `Confianza ${result.confidence ?? 'medium'} — ${result.assumptions?.[0] ?? ''}`
                        : `Confidence ${result.confidence ?? 'medium'} — ${result.assumptions?.[0] ?? ''}`}
                    </p>
                  </div>
                </div>

                {/* Breakdown compact */}
                <div className="rounded-[12px] bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.16)] p-4">
                  <p className="uppercase tracking-[0.18em] text-[10px] font-medium text-[#A8A8A8] mb-3">
                    {language === 'es' ? 'Descomposición' : 'Breakdown'}
                  </p>
                  <dl className="grid grid-cols-1 gap-2">
                    {(result.breakdown ?? []).map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-3 text-[13px]"
                      >
                        <dt className="text-[#A8A8A8]">{item.label}</dt>
                        <dd className="text-[#F5F5F5] font-medium tabular-nums">
                          {item.formatted ?? item.value.toLocaleString('es-CO')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* Info callout */}
                <div className="flex items-start gap-2.5 text-[12px] text-[#A8A8A8] p-3 rounded-[10px] bg-[rgba(212,160,23,0.06)] border border-[rgba(212,160,23,0.15)]">
                  <Info className="h-4 w-4 shrink-0 text-[#D4A017] mt-0.5" strokeWidth={1.75} />
                  <p className="leading-relaxed">
                    {language === 'es'
                      ? 'Esta es una estimación rápida basada en múltiplos de industria CO 2024-2026. El informe profesional añade DCF detallado, comparables públicos y privados, sensibilidades y narrativa de inversión.'
                      : 'This is a quick estimate based on CO 2024-2026 industry multiples. The professional report adds detailed DCF, public/private comparables, sensitivities and investment narrative.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* ── Gráfico de sensibilidad ─────────────────────────────────────── */}
        <motion.section {...fade(4)} className="mb-10" aria-label={language === 'es' ? 'Análisis de sensibilidad' : 'Sensitivity analysis'}>
          <EliteCard variant="glass" padding="lg" className="rounded-[16px]">
            <SensitivityChart base={state} language={language} />
          </EliteCard>
        </motion.section>

        {/* ── CTA profesional ─────────────────────────────────────────────── */}
        <motion.section {...fade(5)} className="mb-4" aria-label={language === 'es' ? 'Informe profesional' : 'Professional report'}>
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-16 -right-16 w-[220px] h-[220px] rounded-full blur-[80px] opacity-45"
              style={{
                background:
                  'radial-gradient(circle, rgba(212,160,23,0.45) 0%, rgba(212,160,23,0) 70%)',
              }}
            />
            <div className="relative z-[1] flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <LineChart className="h-4 w-4 text-[#D4A017]" strokeWidth={2} />
                  <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                    {language === 'es' ? 'Informe profesional' : 'Professional report'}
                  </span>
                </div>
                <h3 className="font-serif-elite text-[24px] md:text-[28px] leading-tight text-[#F5F5F5] mb-2">
                  {language === 'es'
                    ? 'Genere la valoración NIIF 13 completa con IA'
                    : 'Generate the full IFRS 13 AI valuation'}
                </h3>
                <p className="text-[13px] leading-relaxed text-[#A8A8A8] max-w-2xl">
                  {language === 'es'
                    ? 'Tres agentes corren en pipeline: Modelador DCF + Comparables de Mercado (paralelo) → Sintetizador de Valoración. Incluye WACC calculado para Colombia, tabla de sensibilidad completa, dictamen bajo NIIF 13 y narrativa apta para inversionistas.'
                    : 'Three agents run the pipeline: DCF Modeler + Market Comparables (parallel) → Valuation Synthesizer. Includes Colombian WACC, full sensitivity table, IFRS 13 opinion and investor-ready narrative.'}
                </p>
              </div>
              <div className="shrink-0 flex flex-col gap-2">
                <EliteButton
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={handleStartReport}
                  rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                  glow
                >
                  {language === 'es' ? 'Generar informe completo' : 'Generate full report'}
                </EliteButton>
                <p className="text-[11px] text-[#6B6B6B] text-right">
                  {language === 'es'
                    ? '~90 segundos • Excel + PDF'
                    : '~90 seconds • Excel + PDF'}
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Footer info bar */}
        <motion.div
          {...fade(6)}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-[#6B6B6B] mt-8"
        >
          <span className="inline-flex items-center gap-1.5">
            <DollarSign className="h-3 w-3" strokeWidth={2} />
            {language === 'es' ? 'Cifras en COP corrientes' : 'Figures in current COP'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" strokeWidth={2} />
            {language === 'es' ? 'Múltiplos actualizados CO 2026' : 'Updated CO 2026 multiples'}
          </span>
        </motion.div>
      </div>
    </div>
  );
}
