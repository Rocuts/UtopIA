'use client';

/**
 * /workspace/valor/inteligencia-financiera — Submódulo Inteligencia Financiera.
 *
 * Incluye:
 *  - Hero + descripción (flujo de caja predictivo, breakeven, early warnings)
 *  - Breakeven chart SVG inline (costos fijos, variables, ingresos, punto de
 *    equilibrio marcado)
 *  - Mini-dashboard de 6 meses de flujo de caja proyectado (barras SVG inline)
 *  - Tarjetas de margen de contribución y días de capital de trabajo
 *  - CTAs: "Conectar ERP" → /workspace/settings, "Simular escenarios" → chat
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  Brain,
  ChevronLeft,
  Plug,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  Wallet,
  Zap,
  AlertTriangle,
  Calendar,
  Target,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EliteCard } from '@/components/ui/EliteCard';
import { formatCop } from '@/lib/kpis/exit-value';

// ─── Default breakeven scenario (mock) ───────────────────────────────────────

interface BreakevenScenario {
  fixedCosts: number;
  variableCostPerUnit: number;
  pricePerUnit: number;
  maxUnits: number;
}

const DEFAULT_BE: BreakevenScenario = {
  fixedCosts: 180_000_000,
  variableCostPerUnit: 45_000,
  pricePerUnit: 120_000,
  maxUnits: 4000,
};

// ─── Breakeven chart ────────────────────────────────────────────────────────

interface BreakevenChartProps {
  scenario: BreakevenScenario;
  language: 'es' | 'en';
  reduced: boolean | null;
}

function BreakevenChart({ scenario, language, reduced }: BreakevenChartProps) {
  const w = 720;
  const h = 280;
  const padL = 72;
  const padR = 16;
  const padT = 20;
  const padB = 48;

  const { fixedCosts, variableCostPerUnit, pricePerUnit, maxUnits } = scenario;

  // Breakeven unit count: Q* = fixedCosts / (price - variableCost)
  const contributionMargin = pricePerUnit - variableCostPerUnit;
  const beUnits =
    contributionMargin > 0 ? fixedCosts / contributionMargin : maxUnits * 2;
  const beRevenue = beUnits * pricePerUnit;

  const maxY = Math.max(
    pricePerUnit * maxUnits,
    fixedCosts + variableCostPerUnit * maxUnits,
  );

  const toX = (u: number) => padL + (u / maxUnits) * (w - padL - padR);
  const toY = (v: number) => padT + (h - padT - padB) * (1 - v / maxY);

  // Revenue line: 0 → price * maxUnits
  const revenuePath = `M${toX(0)} ${toY(0)} L${toX(maxUnits)} ${toY(
    pricePerUnit * maxUnits,
  )}`;

  // Total cost line: fixed → fixed + variable*maxUnits
  const totalCostStart = toY(fixedCosts);
  const totalCostEnd = toY(fixedCosts + variableCostPerUnit * maxUnits);
  const totalCostPath = `M${toX(0)} ${totalCostStart} L${toX(maxUnits)} ${totalCostEnd}`;

  // Fixed line: horizontal at fixedCosts
  const fixedPath = `M${toX(0)} ${toY(fixedCosts)} L${toX(maxUnits)} ${toY(fixedCosts)}`;

  const showBE = beUnits > 0 && beUnits < maxUnits;
  const beX = showBE ? toX(beUnits) : null;
  const beY = showBE ? toY(beRevenue) : null;

  // Y ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    y: padT + (h - padT - padB) * (1 - r),
    value: maxY * r,
  }));

  // X ticks
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    x: padL + r * (w - padL - padR),
    units: maxUnits * r,
  }));

  return (
    <div>
      <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
        <div>
          <p className="uppercase tracking-eyebrow text-2xs font-medium text-n-500">
            {language === 'es'
              ? 'Análisis de Punto de Equilibrio'
              : 'Breakeven Analysis'}
          </p>
          <p className="text-xs text-n-600 mt-0.5">
            {language === 'es'
              ? 'Costos, ingresos y punto de equilibrio'
              : 'Costs, revenue and breakeven point'}
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <LegendDot color="var(--gold-400)" label={language === 'es' ? 'Ingresos' : 'Revenue'} />
          <LegendDot color="var(--color-wine-400)" label={language === 'es' ? 'Costo total' : 'Total cost'} />
          <LegendDot
            color="var(--n-600)"
            label={language === 'es' ? 'Costo fijo' : 'Fixed cost'}
            dashed
          />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMinYMid meet"
        className="w-full h-[280px]"
        role="img"
        aria-label={
          language === 'es'
            ? 'Gráfico de punto de equilibrio'
            : 'Breakeven analysis chart'
        }
      >
        <defs>
          <linearGradient id="be-profit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--success)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="be-loss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-wine-700)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-wine-700)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Profit/Loss fill polygons — only if breakeven is on chart */}
        {showBE && beX != null && beY != null && (
          <>
            {/* Loss zone: 0 → BE, between revenue and total cost */}
            <polygon
              points={`${toX(0)},${toY(0)} ${toX(0)},${totalCostStart} ${beX},${beY}`}
              fill="url(#be-loss)"
            />
            {/* Profit zone: BE → max, between revenue and total cost */}
            <polygon
              points={`${beX},${beY} ${toX(maxUnits)},${toY(pricePerUnit * maxUnits)} ${toX(maxUnits)},${totalCostEnd}`}
              fill="url(#be-profit)"
            />
          </>
        )}

        {/* Grid */}
        {yTicks.map((t, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padL}
              x2={w - padR}
              y1={t.y}
              y2={t.y}
              stroke="rgb(var(--color-gold-500-rgb) / 0.08)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--n-500)"
              fontFamily="system-ui, sans-serif"
            >
              {formatCop(t.value)}
            </text>
          </g>
        ))}

        {/* Fixed cost horizontal */}
        <motion.path
          d={fixedPath}
          fill="none"
          stroke="var(--n-600)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          initial={reduced ? false : { pathLength: 0 }}
          animate={reduced ? {} : { pathLength: 1 }}
          transition={reduced ? undefined : { duration: 0.9, ease: 'easeOut' }}
        />

        {/* Total cost line */}
        <motion.path
          d={totalCostPath}
          fill="none"
          stroke="var(--color-wine-400)"
          strokeWidth={2.2}
          strokeLinecap="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={reduced ? {} : { pathLength: 1 }}
          transition={reduced ? undefined : { duration: 1, delay: 0.1, ease: 'easeOut' }}
        />

        {/* Revenue line */}
        <motion.path
          d={revenuePath}
          fill="none"
          stroke="var(--gold-400)"
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={reduced ? {} : { pathLength: 1 }}
          transition={reduced ? undefined : { duration: 1.1, delay: 0.2, ease: 'easeOut' }}
        />

        {/* Breakeven marker */}
        {showBE && beX != null && beY != null && (
          <>
            <line
              x1={beX}
              x2={beX}
              y1={padT}
              y2={h - padB}
              stroke="rgba(232,180,44,0.55)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={beX} cy={beY} r={7} fill="var(--gold-400)" />
            <circle cx={beX} cy={beY} r={12} fill="var(--gold-400)" opacity="0.24" />
            <g>
              <rect
                x={beX - 64}
                y={beY - 40}
                width={128}
                height={28}
                rx={6}
                fill="rgba(10,10,10,0.9)"
                stroke="rgba(232,180,44,0.5)"
              />
              <text
                x={beX}
                y={beY - 22}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="var(--gold-400)"
                fontFamily="system-ui, sans-serif"
              >
                {language === 'es' ? 'Punto de equilibrio' : 'Breakeven'}
              </text>
            </g>
          </>
        )}

        {/* X-axis ticks */}
        {xTicks.map((t, i) => (
          <text
            key={`x-${i}`}
            x={t.x}
            y={h - padB + 18}
            textAnchor="middle"
            fontSize="10"
            fill="var(--n-500)"
            fontFamily="system-ui, sans-serif"
          >
            {Math.round(t.units).toLocaleString('es-CO')}
          </text>
        ))}
        <text
          x={padL + (w - padL - padR) / 2}
          y={h - 6}
          textAnchor="middle"
          fontSize="10"
          fill="var(--n-600)"
          fontFamily="system-ui, sans-serif"
        >
          {language === 'es' ? 'Unidades vendidas' : 'Units sold'}
        </text>
      </svg>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <BeStat
          label={language === 'es' ? 'Punto de equilibrio' : 'Breakeven units'}
          value={`${Math.round(beUnits).toLocaleString('es-CO')} u`}
          icon={Target}
        />
        <BeStat
          label={language === 'es' ? 'Ingresos en BE' : 'BE revenue'}
          value={formatCop(beRevenue)}
          icon={TrendingUp}
        />
        <BeStat
          label={language === 'es' ? 'Margen de contribución' : 'Contribution margin'}
          value={`${((contributionMargin / pricePerUnit) * 100).toFixed(1)}%`}
          icon={Zap}
        />
        <BeStat
          label={language === 'es' ? 'Margen por unidad' : 'Margin per unit'}
          value={formatCop(contributionMargin)}
          icon={Wallet}
        />
      </div>
    </div>
  );
}

function LegendDot({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-n-500">
      <span
        aria-hidden="true"
        className={cn('inline-block w-4 h-0.5 rounded-full', dashed && 'border-t border-dashed')}
        style={{
          backgroundColor: dashed ? 'transparent' : color,
          borderColor: dashed ? color : undefined,
        }}
      />
      {label}
    </span>
  );
}

function BeStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <div className="p-3 rounded-md bg-[rgba(10,10,10,0.55)] border border-[rgb(var(--color-gold-500-rgb)_/_0.16)]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-gold-500" strokeWidth={2} />
        <span className="text-2xs uppercase tracking-eyebrow text-n-500">
          {label}
        </span>
      </div>
      <p className="font-serif-elite text-lg text-n-100 tabular-nums leading-tight">
        {value}
      </p>
    </div>
  );
}

// ─── Cash flow 6-month projection (bar chart) ────────────────────────────────

interface CashflowProjectionProps {
  language: 'es' | 'en';
  reduced: boolean | null;
}

const CASHFLOW_DATA_ES = [
  { month: 'May', inflow: 560_000_000, outflow: 420_000_000 },
  { month: 'Jun', inflow: 590_000_000, outflow: 440_000_000 },
  { month: 'Jul', inflow: 620_000_000, outflow: 460_000_000 },
  { month: 'Ago', inflow: 675_000_000, outflow: 480_000_000 },
  { month: 'Sep', inflow: 705_000_000, outflow: 495_000_000 },
  { month: 'Oct', inflow: 740_000_000, outflow: 515_000_000 },
];

function CashflowProjection({ language, reduced }: CashflowProjectionProps) {
  const w = 640;
  const h = 220;
  const padL = 64;
  const padR = 16;
  const padT = 20;
  const padB = 36;

  const maxV = Math.max(...CASHFLOW_DATA_ES.flatMap((d) => [d.inflow, d.outflow]));
  const barWidth = (w - padL - padR) / CASHFLOW_DATA_ES.length / 2.8;

  const totalInflow = CASHFLOW_DATA_ES.reduce((a, d) => a + d.inflow, 0);
  const totalOutflow = CASHFLOW_DATA_ES.reduce((a, d) => a + d.outflow, 0);
  const netFlow = totalInflow - totalOutflow;

  return (
    <div>
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="uppercase tracking-eyebrow text-2xs font-medium text-n-500">
            {language === 'es' ? 'Flujo de caja proyectado 6M' : 'Projected cash flow 6M'}
          </p>
          <p className="text-xs text-n-600 mt-0.5">
            {language === 'es' ? 'Entradas vs salidas mensuales' : 'Monthly inflows vs outflows'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-n-500">
            {language === 'es' ? 'Flujo neto 6M' : 'Net flow 6M'}
          </p>
          <p className="font-serif-elite text-xl text-success-light tabular-nums">
            {formatCop(netFlow)}
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
            ? 'Gráfico de proyección de flujo de caja 6 meses'
            : '6-month cash flow projection chart'
        }
      >
        {/* Grid */}
        {[0.25, 0.5, 0.75].map((r) => (
          <line
            key={r}
            x1={padL}
            x2={w - padR}
            y1={padT + (h - padT - padB) * (1 - r)}
            y2={padT + (h - padT - padB) * (1 - r)}
            stroke="rgb(var(--color-gold-500-rgb) / 0.08)"
            strokeWidth={1}
          />
        ))}

        {/* Y-labels */}
        {[0, 0.5, 1].map((r) => (
          <text
            key={r}
            x={padL - 6}
            y={padT + (h - padT - padB) * (1 - r) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--n-500)"
            fontFamily="system-ui, sans-serif"
          >
            {formatCop(maxV * r)}
          </text>
        ))}

        {CASHFLOW_DATA_ES.map((d, i) => {
          const segment = (w - padL - padR) / CASHFLOW_DATA_ES.length;
          const centerX = padL + segment * (i + 0.5);
          const inflowH = (d.inflow / maxV) * (h - padT - padB);
          const outflowH = (d.outflow / maxV) * (h - padT - padB);

          const inflowY = h - padB - inflowH;
          const outflowY = h - padB - outflowH;

          return (
            <g key={d.month}>
              {/* Inflow bar (gold) */}
              <motion.rect
                x={centerX - barWidth - 1}
                y={inflowY}
                width={barWidth}
                height={inflowH}
                fill="url(#cf-inflow)"
                rx={3}
                initial={reduced ? false : { height: 0, y: h - padB }}
                animate={reduced ? {} : { height: inflowH, y: inflowY }}
                transition={
                  reduced
                    ? undefined
                    : { duration: 0.7, delay: 0.05 * i, ease: 'easeOut' }
                }
              />
              {/* Outflow bar (wine) */}
              <motion.rect
                x={centerX + 1}
                y={outflowY}
                width={barWidth}
                height={outflowH}
                fill="url(#cf-outflow)"
                rx={3}
                initial={reduced ? false : { height: 0, y: h - padB }}
                animate={reduced ? {} : { height: outflowH, y: outflowY }}
                transition={
                  reduced
                    ? undefined
                    : { duration: 0.7, delay: 0.05 * i + 0.05, ease: 'easeOut' }
                }
              />

              {/* Month label */}
              <text
                x={centerX}
                y={h - padB + 18}
                textAnchor="middle"
                fontSize="10"
                fill="var(--n-500)"
                fontFamily="system-ui, sans-serif"
              >
                {d.month}
              </text>
            </g>
          );
        })}

        <defs>
          <linearGradient id="cf-inflow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold-300)" />
            <stop offset="100%" stopColor="var(--gold-500)" />
          </linearGradient>
          <linearGradient id="cf-outflow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-wine-400)" />
            <stop offset="100%" stopColor="var(--color-wine-700)" />
          </linearGradient>
        </defs>
      </svg>

      <div className="mt-3 flex items-center gap-5 text-xs">
        <LegendDot
          color="var(--gold-400)"
          label={language === 'es' ? 'Entradas' : 'Inflows'}
        />
        <LegendDot
          color="var(--color-wine-400)"
          label={language === 'es' ? 'Salidas' : 'Outflows'}
        />
      </div>
    </div>
  );
}

// ─── Page component ─────────────────────────────────────────────────────────

export default function InteligenciaFinancieraPage() {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const router = useRouter();
  const { openIntakeForType, setActiveCaseType, setActiveMode, startNewConsultation } =
    useWorkspace();
  const valor = t.elite.areas.valor;

  const [beScenario] = useState<BreakevenScenario>(DEFAULT_BE);

  const handleConnectErp = useCallback(() => {
    router.push('/workspace/settings');
  }, [router]);

  const handleSimulate = useCallback(() => {
    openIntakeForType('financial_intel');
  }, [openIntakeForType]);

  const handleChatIntel = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('financial-intelligence');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + i * 0.06,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  // Derived mini KPIs (mock)
  const miniKpis = useMemo(() => {
    const margin = (beScenario.pricePerUnit - beScenario.variableCostPerUnit) / beScenario.pricePerUnit;
    return {
      contributionPct: `${(margin * 100).toFixed(1)}%`,
      workingCapitalDays: '42',
      runwayMonths: '9.8',
    };
  }, [beScenario]);

  return (
    <div
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-n-1000 text-n-100',
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[10%] -right-[10%] w-[520px] h-[520px] rounded-full blur-[130px] opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.4) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        <motion.nav {...fade(0)} aria-label="breadcrumb" className="mb-6">
          <Link
            href="/workspace/valor"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-gold-600 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            {language === 'es' ? 'Volver a El Valor' : 'Back to The Value'}
          </Link>
        </motion.nav>

        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={language === 'es' ? 'II. Valor — Inteligencia Financiera' : 'II. Value — Financial Intelligence'}
            title={valor.submodules.inteligenciaFinanciera.title}
            subtitle={language === 'es'
              ? 'Flujo de caja predictivo, breakeven y alertas tempranas — tome decisiones antes de que la realidad las imponga.'
              : 'Predictive cash flow, breakeven and early warnings — decide before reality forces your hand.'}
            align="left"
            accent="gold"
            divider
          />
        </motion.div>

        <motion.div {...fade(2)} className="mb-10 max-w-3xl">
          <p className={cn(
            'font-serif-elite font-normal',
            'text-xl sm:text-xl leading-[1.6]',
            'text-n-300',
          )}>
            {language === 'es'
              ? 'Convierta la contabilidad en inteligencia accionable. Predecimos su flujo de caja, calculamos el punto de equilibrio exacto por producto y disparamos alertas cuando un KPI sale de banda — antes de que duela.'
              : 'Turn accounting into actionable intelligence. We forecast your cash flow, calculate the exact breakeven per product and trigger alerts when a KPI drifts out of band — before it hurts.'}
          </p>
        </motion.div>

        {/* Mini dashboard — 3 KPIs */}
        <motion.section {...fade(3)} className="mb-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <EliteCard variant="glass" padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-3.5 w-3.5 text-gold-600" strokeWidth={2} />
                <span className="uppercase tracking-eyebrow text-2xs font-medium text-n-700">
                  {language === 'es' ? 'Margen de contribución' : 'Contribution margin'}
                </span>
              </div>
              <p className="font-serif-elite text-3xl text-n-1000 tabular-nums leading-none mb-1">
                {miniKpis.contributionPct}
              </p>
              <p className="text-xs text-success-light">
                {language === 'es' ? 'Saludable · meta 60%' : 'Healthy · target 60%'}
              </p>
            </EliteCard>

            <EliteCard variant="glass" padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-3.5 w-3.5 text-gold-600" strokeWidth={2} />
                <span className="uppercase tracking-eyebrow text-2xs font-medium text-n-700">
                  {language === 'es' ? 'Días de capital de trabajo' : 'Working capital days'}
                </span>
              </div>
              <p className="font-serif-elite text-3xl text-n-1000 tabular-nums leading-none mb-1">
                {miniKpis.workingCapitalDays}
                <span className="text-base text-n-700 ml-1">
                  {language === 'es' ? 'días' : 'days'}
                </span>
              </p>
              <p className="text-xs text-n-700">
                {language === 'es' ? 'DSO 48 · DPO 36 · DIO 30' : 'DSO 48 · DPO 36 · DIO 30'}
              </p>
            </EliteCard>

            <EliteCard variant="glass" padding="md">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="h-3.5 w-3.5 text-gold-600" strokeWidth={2} />
                <span className="uppercase tracking-eyebrow text-2xs font-medium text-n-700">
                  {language === 'es' ? 'Runway (meses)' : 'Runway (months)'}
                </span>
              </div>
              <p className="font-serif-elite text-3xl text-n-1000 tabular-nums leading-none mb-1">
                {miniKpis.runwayMonths}
              </p>
              <p className="text-xs text-gold-500 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                {language === 'es' ? 'Monitorear Q3' : 'Watch Q3'}
              </p>
            </EliteCard>
          </div>
        </motion.section>

        {/* Breakeven chart */}
        <motion.section {...fade(4)} className="mb-10" aria-label={language === 'es' ? 'Análisis de punto de equilibrio' : 'Breakeven analysis'}>
          <EliteCard variant="glass" padding="lg" className="rounded-[16px]">
            <BreakevenChart scenario={beScenario} language={language} reduced={reduced ?? null} />
          </EliteCard>
        </motion.section>

        {/* Cash flow projection */}
        <motion.section {...fade(5)} className="mb-10" aria-label={language === 'es' ? 'Proyección de flujo de caja' : 'Cash flow projection'}>
          <EliteCard variant="glass" padding="lg" className="rounded-[16px]">
            <CashflowProjection language={language} reduced={reduced ?? null} />
          </EliteCard>
        </motion.section>

        {/* CTAs */}
        <motion.section {...fade(6)} className="grid gap-5 md:grid-cols-2">
          {/* Conectar ERP */}
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6">
            <div
              aria-hidden="true"
              className="absolute -top-14 -right-14 w-[180px] h-[180px] rounded-full blur-[70px] opacity-40"
              style={{
                background:
                  'radial-gradient(circle, rgb(var(--color-gold-500-rgb) / 0.4) 0%, rgb(var(--color-gold-500-rgb) / 0) 70%)',
              }}
            />
            <div className="relative z-[1] flex flex-col gap-4 h-full">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <Plug className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-600 mb-1">
                    {language === 'es' ? 'Datos en vivo' : 'Live data'}
                  </div>
                  <h3 className="font-serif-elite text-xl text-n-1000 leading-tight">
                    {language === 'es' ? 'Conectar ERP' : 'Connect ERP'}
                  </h3>
                  <p className="text-sm text-n-700 mt-1.5 leading-relaxed">
                    {language === 'es'
                      ? 'Sincronice Siigo, World Office, Contífico, Helisa o QuickBooks. La proyección se recalcula con cada cierre diario.'
                      : 'Sync Siigo, World Office, Contífico, Helisa or QuickBooks. The forecast recalculates with each daily close.'}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex items-end justify-between gap-3">
                <p className="text-xs text-n-600">
                  {language === 'es' ? '5+ proveedores soportados' : '5+ providers supported'}
                </p>
                <EliteButton
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleConnectErp}
                  rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                  glow
                >
                  {language === 'es' ? 'Conectar ahora' : 'Connect now'}
                </EliteButton>
              </div>
            </div>
          </div>

          {/* Simular escenarios */}
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6">
            <div className="flex flex-col gap-4 h-full">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(var(--color-gold-500-rgb)_/_0.14)] text-gold-600"
                >
                  <Brain className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-eyebrow text-xs font-medium text-gold-600 mb-1">
                    {language === 'es' ? 'Modelado' : 'Modeling'}
                  </div>
                  <h3 className="font-serif-elite text-xl text-n-1000 leading-tight">
                    {language === 'es' ? 'Simular escenarios' : 'Simulate scenarios'}
                  </h3>
                  <p className="text-sm text-n-700 mt-1.5 leading-relaxed">
                    {language === 'es'
                      ? 'Optimista, base y pesimista con supuestos colombianos (IPC, UVT, salario mínimo). Reporte ejecutivo + plan de contingencia.'
                      : 'Optimistic, base and pessimistic scenarios with Colombian assumptions (CPI, UVT, minimum wage). Executive report + contingency plan.'}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex items-end justify-between gap-3">
                <p className="text-xs text-n-600">
                  {language === 'es' ? 'Análisis profundo con IA' : 'AI-powered deep analysis'}
                </p>
                <EliteButton
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={handleSimulate}
                  rightIcon={<Activity className="h-4 w-4" strokeWidth={2} />}
                >
                  {language === 'es' ? 'Iniciar análisis' : 'Start analysis'}
                </EliteButton>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Chat quick action */}
        <motion.div {...fade(7)} className="mt-6">
          <button
            type="button"
            onClick={handleChatIntel}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md',
              'bg-transparent border border-[rgb(var(--color-gold-500-rgb)_/_0.22)] text-n-500',
              'hover:border-[rgb(var(--color-gold-500-rgb)_/_0.5)] hover:text-gold-600 transition-colors',
              'text-sm font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-1000',
            )}
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            {language === 'es'
              ? 'Hablar con el asistente de Inteligencia Financiera'
              : 'Chat with the Financial Intelligence assistant'}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
