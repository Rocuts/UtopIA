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
import { useRouter } from 'next/navigation';
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
  Zap,
  FileText,
} from 'lucide-react';
import { useMemo } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useAncoraView } from '@/hooks/useAncoraView';
import { cn } from '@/lib/utils';
import { EliteCard } from '@/components/ui/EliteCard';
import { EliteButton } from '@/components/ui/EliteButton';
import { PremiumKpiCard } from '@/components/ui/PremiumKpiCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { calculateTef } from '@/lib/kpis/tax-efficiency';
import type { KpiResult } from '@/types/kpis';
import type { FiscalAnchorBlock } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/types';
import type { FiscalRiskScore } from '@/lib/agents/financial/types';
import { FiscalAlertsPanel } from '@/components/workspace/escudo/FiscalAlertsPanel';
import { DataSourceLadder } from './shared/DataSourceLadder';
import { CapabilityZones } from './shared/CapabilityZones';
import { getSourceLabels } from './shared/source-labels';
import { getEscudoSources, getEscudoZones } from './data/escudo-capabilities';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type DeadlineSeverity = 'low' | 'medium' | 'high';

export interface EscudoDeadline {
  label: string;
  date: string;
  severity: DeadlineSeverity;
}

/**
 * Vista-modelo de alerta fiscal — consumida por el UI (cruza por HTTP/JSON).
 * Re-exportada desde la fuente canónica (`alert-mapping`, contrato §4.3) para
 * que el hook (`useAncoraView`) y el panel (`FiscalAlertsPanel`) compartan UN
 * solo tipo sin ciclo de imports componente↔hook.
 */
import type { AlertView } from '@/lib/agents/financial/escudo-survival/fiscal-anchor/alert-mapping';
export type { AlertView };

export interface EscudoAreaProps {
  kpi?: KpiResult;
  upcomingDeadlines?: EscudoDeadline[];
  /** Bloque Âncora Fiscal — Capa 1. Cuando presente, sustituye mocks. */
  fiscalAnchor?: FiscalAnchorBlock;
  /** Score de Riesgo DIAN — Capa 5. Cuando presente, muestra el KPI de riesgo. */
  riskScore?: FiscalRiskScore;
  /** Alertas fiscales accionables — Capa 5. Cuando presentes, muestra el panel. */
  alertas?: AlertView[];
  /** Si true, renderiza una versión compacta (sin hero ni narrativa larga). */
  compact?: boolean;
  className?: string;
}

// ─── Submódulos de El Escudo ─────────────────────────────────────────────────

type SubmoduleKey =
  | 'defensaDian'
  | 'planeacionTributaria'
  | 'preciosTransferencia'
  | 'devoluciones'
  | 'supervivencia'
  | 'agenteFiscal';

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
  {
    key: 'supervivencia',
    href: '/workspace/escudo/supervivencia',
    icon: Zap,
    status: 'listo',
  },
  {
    key: 'agenteFiscal',
    href: '/workspace/escudo/agente-fiscal',
    icon: Shield,
    status: 'listo',
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

// ─── Helpers para derivar datos reales del fiscalAnchor ──────────────────────

function severityFromDias(dias: number): DeadlineSeverity {
  if (dias <= 15) return 'high';
  if (dias <= 45) return 'medium';
  return 'low';
}

function formatDeadlineDateShort(iso: string, language: 'es' | 'en'): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function deadlinesFromAnchor(
  anchor: FiscalAnchorBlock,
  language: 'es' | 'en',
): EscudoDeadline[] {
  return anchor.calendarioDian.vencimientos.map((v) => ({
    label: v.obligacion,
    date: formatDeadlineDateShort(v.proximoVencimiento, language),
    severity: severityFromDias(v.diasRestantes),
  }));
}

export function EscudoArea({
  kpi,
  upcomingDeadlines,
  fiscalAnchor: propFiscalAnchor,
  riskScore: propRiskScore,
  alertas: propAlertas,
  compact = false,
  className,
}: EscudoAreaProps) {
  const { t, language } = useLanguage();
  const escudo = t.elite.areas.escudo;
  const reduced = useReducedMotion();
  const router = useRouter();
  const { setActiveCaseType, setActiveMode } = useWorkspace();

  // Fuente por defecto: el hook (NIIF→Escudo auto-cableado). Las props son
  // OVERRIDES opcionales (preview/embebido). Honestidad Elite: si no hay datos
  // reales, El Escudo cae a su demo coherente — nunca inventa cifras.
  const {
    view,
    fiscalAnchor: hookAnchor,
    riskScore: hookRisk,
    alertas: hookAlertas,
    loading,
  } = useAncoraView();

  const fiscalAnchor = propFiscalAnchor ?? hookAnchor;
  const riskScore = propRiskScore ?? hookRisk;
  const alertas: AlertView[] =
    propAlertas && propAlertas.length ? propAlertas : hookAlertas;

  const hasRealData = Boolean(fiscalAnchor);

  // Estado vacío elegante: sin datos NIIF ni anchor (y no estamos cargando).
  const showEmptyState = !compact && !view.hasData && !fiscalAnchor && !loading;

  const handleGenerarNiif = () => {
    setActiveCaseType('niif_report');
    setActiveMode('pipeline');
    router.push('/workspace');
  };

  const sources = useMemo(() => getEscudoSources(language), [language]);
  const zones = useMemo(() => getEscudoZones(language), [language]);
  const sourceLabels = useMemo(() => getSourceLabels(language), [language]);

  const kpiData = useMemo<KpiResult>(() => {
    if (kpi) return kpi;
    // F10 real — preferimos el del anchor; si solo hay AncoraView, usamos view.fiscal.f10.
    const f10 =
      fiscalAnchor?.f10 ??
      (view.hasData && view.fiscal.f10 != null ? view.fiscal.f10 : null);
    if (f10 != null) {
      const mock = buildMockTef();
      return {
        ...mock,
        value: Number(f10.toFixed(2)),
        formatted: `${f10.toFixed(1)}%`,
      };
    }
    return buildMockTef();
  }, [kpi, fiscalAnchor, view]);

  const deadlines = useMemo<EscudoDeadline[]>(() => {
    if (upcomingDeadlines) return upcomingDeadlines;
    if (fiscalAnchor) return deadlinesFromAnchor(fiscalAnchor, language);
    return language === 'es' ? MOCK_DEADLINES_ES : MOCK_DEADLINES_EN;
  }, [upcomingDeadlines, fiscalAnchor, language]);

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
      data-modulo="escudo"
      className={cn(
        'relative w-full',
        compact ? '' : 'min-h-full',
        className,
      )}
    >
      {/* Estado vacío: sin reporte NIIF previo (banner superior, no reemplaza el dashboard demo) */}
      {showEmptyState && (
        <motion.div
          {...(reduced
            ? {}
            : {
                initial: { opacity: 0, y: 8 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.4 },
              })}
          className="mb-10 flex flex-col items-start gap-4 p-6 rounded-xl glass-elite-elevated border border-[rgb(168_56_56_/_0.3)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[rgb(168_56_56_/_0.16)] text-area-escudo"
            >
              <FileText className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="font-serif-elite text-xl leading-tight text-n-1000 mb-1">
                {language === 'es'
                  ? 'Sin datos fiscales aún'
                  : 'No fiscal data yet'}
              </p>
              <p className="text-sm text-n-700 leading-relaxed max-w-md">
                {language === 'es'
                  ? 'Genera un Informe NIIF para que El Escudo se pueble automáticamente con las cifras fiscales reales de tu empresa.'
                  : 'Generate an IFRS Report so The Shield auto-populates with your company\'s real tax figures.'}
              </p>
            </div>
          </div>
          <EliteButton
            variant="primary"
            size="md"
            rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
            onClick={handleGenerarNiif}
          >
            {language === 'es' ? 'Generar Informe NIIF' : 'Generate IFRS Report'}
          </EliteButton>
        </motion.div>
      )}

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
          'flex flex-col gap-3',
          compact ? 'mb-8' : 'mb-14',
        )}
      >
        {/* NIT eyebrow */}
        <p
          aria-label={
            hasRealData
              ? escudo.fiscalAnchor.eyebrow.replace('{nit}', fiscalAnchor!.calendarioDian.nit)
              : escudo.fiscalAnchor.eyebrowDemo
          }
          className="text-xs uppercase tracking-eyebrow text-n-500 font-medium"
        >
          {hasRealData
            ? escudo.fiscalAnchor.eyebrow.replace('{nit}', fiscalAnchor!.calendarioDian.nit)
            : escudo.fiscalAnchor.eyebrowDemo}
        </p>

        <div
          className={cn(
            'grid gap-5',
            'grid-cols-1 md:grid-cols-5',
          )}
        >
        {/* Primary KPI — TEF */}
        <div className="md:col-span-3">
          <PremiumKpiCard
            label={
              hasRealData
                ? (language === 'es'
                  ? 'Cobertura de Retenciones · Art. 240 E.T.'
                  : 'Withholding Coverage · Art. 240 E.T.')
                : escudo.kpiPrimary
            }
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
        </div>
      </motion.div>

      {/* Capa 5 — Score DIAN (gauge + factores) + Alertas accionables */}
      {(riskScore || (alertas && alertas.length > 0)) && (
        <motion.div {...fadeItem(3)} className="mb-10 flex flex-col gap-5">
          {riskScore && (
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-stretch">
              <GaugeDIAN score={riskScore.score} language={language} />
              <RiskScoreKpiRow riskScore={riskScore} language={language} />
            </div>
          )}
          {alertas && alertas.length > 0 && (
            <FiscalAlertsPanel alertas={alertas} language={language} />
          )}
        </motion.div>
      )}

      {/* Fuentes de datos conectadas — escalera de capacidades */}
      <motion.div {...fadeItem(riskScore || (alertas && alertas.length > 0) ? 4 : 3)} className="mb-10">
        <DataSourceLadder
          title={
            language === 'es'
              ? 'Fuentes de datos conectadas — cada nivel activa más capacidades'
              : 'Connected data sources — each level unlocks more capabilities'
          }
          sources={sources}
        />
      </motion.div>

      {/* Grid submódulos */}
      <motion.div {...fadeItem(riskScore || (alertas && alertas.length > 0) ? 5 : 4)} className="grid gap-5 grid-cols-1 md:grid-cols-2 mb-10">
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

      {/* Zonas de capacidades · estado según fuente conectada */}
      <motion.div {...fadeItem(riskScore || (alertas && alertas.length > 0) ? 6 : 5)}>
        <CapabilityZones
          legendTitle={
            language === 'es'
              ? '31 capacidades · estado según fuente conectada'
              : '31 capabilities · status by connected source'
          }
          zones={zones}
          sourceLabels={sourceLabels}
        />
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

// ─── Capa 5 — Score de Riesgo DIAN (KPI row) ─────────────────────────────────

type RiskNivel = FiscalRiskScore['nivel'];

const NIVEL_COLOR: Record<RiskNivel, string> = {
  bajo: 'text-success',
  medio: 'text-warning',
  alto: 'text-orange-500',
  muy_alto: 'text-danger',
  critico: 'text-danger',
};

const NIVEL_BG: Record<RiskNivel, string> = {
  bajo: 'bg-[rgb(34_197_94_/_0.12)] border-[rgb(34_197_94_/_0.3)]',
  medio: 'bg-[rgb(234_179_8_/_0.12)] border-[rgb(234_179_8_/_0.3)]',
  alto: 'bg-[rgb(249_115_22_/_0.12)] border-[rgb(249_115_22_/_0.3)]',
  muy_alto: 'bg-[rgb(239_68_68_/_0.12)] border-[rgb(239_68_68_/_0.3)]',
  critico: 'bg-[rgb(220_38_38_/_0.14)] border-[rgb(220_38_38_/_0.4)]',
};

const NIVEL_LABEL: Record<RiskNivel, { es: string; en: string }> = {
  bajo: { es: 'BAJO', en: 'LOW' },
  medio: { es: 'MEDIO', en: 'MEDIUM' },
  alto: { es: 'ALTO', en: 'HIGH' },
  muy_alto: { es: 'ALTO', en: 'HIGH' },
  critico: { es: 'ALTO', en: 'HIGH' },
};

interface RiskScoreKpiRowProps {
  riskScore: FiscalRiskScore;
  language: 'es' | 'en';
}

function RiskScoreKpiRow({ riskScore, language }: RiskScoreKpiRowProps) {
  const { score, nivel, factores } = riskScore;
  const levelLabel = NIVEL_LABEL[nivel][language];
  const colorClass = NIVEL_COLOR[nivel];
  const bgClass = NIVEL_BG[nivel];
  const topFactores = factores.slice(0, 3);

  return (
    <div
      role="region"
      aria-label={language === 'es' ? 'Score de Riesgo DIAN' : 'DIAN Risk Score'}
      className="relative flex flex-col gap-4 p-6 rounded-xl glass-elite-elevated"
      style={{ boxShadow: 'inset 0 0 0 1px rgb(168 56 56 / 0.4)' }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(168_56_56_/_0.16)] text-area-escudo"
          >
            <Shield className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div>
            <p className="uppercase tracking-eyebrow text-xs font-medium text-n-500">
              {language === 'es' ? 'Score de Riesgo DIAN' : 'DIAN Risk Score'}
            </p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span
                className={cn('font-serif-elite text-3xl font-normal leading-none num', colorClass)}
                aria-label={`${score} de 100`}
              >
                {score}
              </span>
              <span className="text-sm text-n-500">/100</span>
              <span
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-label border',
                  bgClass,
                  colorClass,
                )}
              >
                {levelLabel}
              </span>
            </div>
          </div>
        </div>

        {topFactores.length > 0 && (
          <ul
            role="list"
            aria-label={language === 'es' ? 'Factores principales' : 'Top factors'}
            className="flex flex-col gap-1.5 min-w-0"
          >
            {topFactores.map((f) => (
              <li key={f.factor} className="flex items-center gap-2 text-xs text-n-700">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-area-escudo"
                />
                <span className="truncate">{f.descripcion}</span>
                <span className="shrink-0 font-medium text-n-800">+{f.puntos}pts</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Gauge semicircular Score de Riesgo DIAN ─────────────────────────────────

interface GaugeDIANProps {
  score: number;
  language: 'es' | 'en';
}

function GaugeDIAN({ score, language }: GaugeDIANProps) {
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  // Color por nivel de riesgo (rol → token). currentColor pinta arco + número.
  const colorClass =
    safe > 60 ? 'text-danger' : safe > 40 ? 'text-warning' : 'text-success';
  const nivel =
    safe > 60
      ? language === 'es'
        ? 'Riesgo Alto'
        : 'High risk'
      : safe > 40
        ? language === 'es'
          ? 'Riesgo Medio'
          : 'Medium risk'
        : language === 'es'
          ? 'Riesgo Bajo'
          : 'Low risk';
  // Longitud del arco semicircular ≈ 176 (path M14 72 A56 56 0 0 1 126 72).
  const ARC = 176;
  const dashOffset = Math.round(ARC * (1 - safe / 100));

  return (
    <div
      role="img"
      aria-label={`${language === 'es' ? 'Score de Riesgo DIAN' : 'DIAN Risk Score'} ${safe} / 100 — ${nivel}`}
      className="relative flex flex-col items-center justify-center gap-1 p-6 rounded-xl glass-elite-elevated min-w-[200px]"
      style={{ boxShadow: 'inset 0 0 0 1px rgb(168 56 56 / 0.32)' }}
    >
      <span className="uppercase tracking-eyebrow text-xs font-medium text-n-500 text-center">
        {language === 'es' ? 'Score de Riesgo DIAN' : 'DIAN Risk Score'}
      </span>
      <svg viewBox="0 0 140 80" width="150" height="86" aria-hidden="true">
        <path
          d="M 14 72 A 56 56 0 0 1 126 72"
          fill="none"
          className="stroke-n-300"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 14 72 A 56 56 0 0 1 126 72"
          fill="none"
          stroke="currentColor"
          className={colorClass}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={ARC}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className={cn('font-serif-elite text-4xl font-normal leading-none num -mt-2', colorClass)}>
        {safe}
      </span>
      <span className={cn('text-sm font-medium', colorClass)}>{nivel}</span>
      <span className="text-xs text-n-500">/100</span>
    </div>
  );
}

export default EscudoArea;
