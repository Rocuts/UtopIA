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
  Gavel,
  Banknote,
  Route,
  ArrowLeftRight,
  HeartPulse,
  Bot,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  FileText,
} from 'lucide-react';
import { useMemo } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useAncoraView } from '@/hooks/useAncoraView';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
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
 * Re-exportada desde la fuente canónica (`@/lib/sentinel/alert-view`) para
 * que el hook (`useAncoraView`) y el panel (`FiscalAlertsPanel`) compartan UN
 * solo tipo sin ciclo de imports componente↔hook.
 */
import type { AlertView } from '@/lib/sentinel/alert-view';
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
  statusLabel: { es: string; en: string };
  statusColor: string;
}

const SUBMODULES: SubmoduleDef[] = [
  {
    key: 'agenteFiscal',
    href: '/workspace/escudo/agente-fiscal',
    icon: Bot,
    statusLabel: { es: 'Activo', en: 'Active' },
    statusColor: '#22C55E',
  },
  {
    key: 'defensaDian',
    href: '/workspace/escudo/defensa-dian',
    icon: Gavel,
    statusLabel: { es: '2 en curso', en: '2 active' },
    statusColor: '#E8B42C',
  },
  {
    key: 'devoluciones',
    href: '/workspace/escudo/devoluciones',
    icon: Banknote,
    statusLabel: { es: '1 radicada', en: '1 filed' },
    statusColor: '#22C55E',
  },
  {
    key: 'planeacionTributaria',
    href: '/workspace/escudo/planeacion-tributaria',
    icon: Route,
    statusLabel: { es: 'Al día', en: 'Up to date' },
    statusColor: '#22C55E',
  },
  {
    key: 'preciosTransferencia',
    href: '/workspace/escudo/precios-transferencia',
    icon: ArrowLeftRight,
    statusLabel: { es: 'Revisión', en: 'Review' },
    statusColor: '#E8B42C',
  },
  {
    key: 'supervivencia',
    href: '/workspace/escudo/supervivencia',
    icon: HeartPulse,
    statusLabel: { es: 'Monitor', en: 'Monitor' },
    statusColor: '#A83838',
  },
];

// ─── Mock KPI (fallback si no llega kpi prop) ────────────────────────────────

function buildMockTef(): KpiResult {
  return {
    kind: 'tef',
    value: 28.4,
    formatted: '28,4%',
    unit: '%',
    label: 'Tasa Efectiva de Tributación',
    severity: 'good',
    trend: { direction: 'down', delta: -3.1, periodLabel: 'vs. trimestre anterior' },
    calculatedAt: new Date().toISOString(),
    confidence: 'medium',
  };
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
      {!compact && (
        <motion.section
          {...fadeItem(0)}
          className="mb-10 pb-9"
          style={{ borderBottom: '1px solid color-mix(in srgb, #A83838 20%, transparent)' }}
        >
          {/* 2-column hero — text + gradient KPI card */}
          <div
            className="grid gap-10 items-center"
            style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)' }}
          >
            {/* ── Left: eyebrow + title + lede ── */}
            <div>
              <div className="flex items-center gap-[10px] mb-[14px]" style={{ fontWeight: 700 }}>
                <span
                  aria-hidden="true"
                  className="inline-grid place-items-center rounded-lg text-white"
                  style={{
                    width: 36, height: 36,
                    background: 'linear-gradient(140deg, #A83838, #8A2E2E)',
                    boxShadow: '0 8px 20px -8px rgba(168,56,56,.55)',
                  }}
                >
                  <Shield className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </span>
                <span className="text-xs uppercase tracking-eyebrow font-bold text-area-escudo">
                  {language === 'es' ? 'I · Resiliencia' : 'I · Resilience'}
                </span>
              </div>

              <h1
                className="font-serif-elite font-medium text-n-1000 tracking-tight"
                style={{ fontSize: 'clamp(2.4rem, 4.6vw, 3.6rem)', lineHeight: 1.04 }}
              >
                {language === 'es' ? 'El Escudo' : 'The Shield'}
              </h1>

              <p className="text-n-600 mt-[14px] leading-relaxed" style={{ fontSize: '1.0625rem', maxWidth: '46ch' }}>
                {language === 'es'
                  ? 'Estrategia tributaria y defensa legal. Blindamos su carga fiscal frente a la DIAN — requerimientos, devoluciones y planeación, con doctrina y jurisprudencia al día.'
                  : 'Tax strategy and legal defense. We shield your tax burden from the DIAN — audits, refunds, and planning, backed by up-to-date doctrine and case law.'}
              </p>
            </div>

            {/* ── Right: gradient KPI card ── */}
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                background: 'linear-gradient(155deg, #A83838, #8A2E2E)',
                padding: 30,
              }}
            >
              {/* Decorative circle */}
              <div
                aria-hidden="true"
                className="absolute rounded-full pointer-events-none"
                style={{ right: -50, top: -50, width: 200, height: 200, background: 'rgba(255,255,255,.10)' }}
              />

              <div className="relative" style={{ zIndex: 1 }}>
                <p
                  className="uppercase font-semibold"
                  style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'rgba(255,255,255,.82)' }}
                >
                  {language === 'es' ? 'Tasa Efectiva de Tributación' : 'Effective Tax Rate'}
                </p>

                <div
                  className="font-serif-elite font-medium num"
                  style={{ fontSize: 'clamp(2.6rem, 5vw, 3.8rem)', color: '#fff', lineHeight: 1, margin: '10px 0 6px' }}
                >
                  {kpiData.formatted}
                </div>

                <div
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}
                >
                  {kpiData.trend?.direction === 'up'
                    ? <ArrowUp className="h-[15px] w-[15px]" strokeWidth={2} />
                    : <ArrowDown className="h-[15px] w-[15px]" strokeWidth={2} />}
                  {kpiData.trend
                    ? `${Math.abs(kpiData.trend.delta).toFixed(1).replace('.', language === 'es' ? ',' : '.')} pts.`
                    : '3,1 pts.'}
                  {' '}
                  {kpiData.trend?.periodLabel ?? (language === 'es' ? 'vs. trimestre anterior' : 'vs. prior quarter')}
                </div>

                {/* Sparkline */}
                <div style={{ marginTop: 20, height: 70 }}>
                  <TefSparkline />
                </div>

                {/* Sub-KPIs */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: '1px solid rgba(255,255,255,.18)',
                  }}
                >
                  <div>
                    <div className="font-serif-elite num" style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 500 }}>$1.240M</div>
                    <div style={{ color: 'rgba(255,255,255,.70)', fontSize: '0.68rem', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      {language === 'es' ? 'Saldos a favor' : 'Tax credits'}
                    </div>
                  </div>
                  <div>
                    <div className="font-serif-elite num" style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 500 }}>
                      {hasRealData ? deadlines.length : 7}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,.70)', fontSize: '0.68rem', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      {language === 'es' ? 'Casos abiertos' : 'Open cases'}
                    </div>
                  </div>
                  <div>
                    <div className="font-serif-elite num" style={{ color: '#E8B42C', fontSize: '1.1rem', fontWeight: 500 }}>
                      {language === 'es' ? 'Medio' : 'Medium'}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,.70)', fontSize: '0.68rem', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      {language === 'es' ? 'Riesgo DIAN' : 'DIAN Risk'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      )}

      {/* Aviso: sin datos NIIF reales — aparece debajo del hero para no bloquear la vista */}
      {showEmptyState && (
        <motion.div
          {...(reduced ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 } })}
          className="mb-8 flex items-center gap-4 p-4 rounded-xl border border-[rgb(168_56_56_/_0.28)] bg-[rgb(168_56_56_/_0.04)]"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md bg-[rgb(168_56_56_/_0.12)] text-area-escudo">
            <FileText className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-n-900">
              {language === 'es' ? 'Datos demo — genera un Informe NIIF para cifras reales.' : 'Demo data — generate an IFRS Report for real figures.'}
            </p>
          </div>
          <EliteButton variant="primary" size="sm" rightIcon={<ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />} onClick={handleGenerarNiif}>
            {language === 'es' ? 'Generar Informe' : 'Generate Report'}
          </EliteButton>
        </motion.div>
      )}

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

      {/* Submódulos section — matches handoff order: directly after hero */}
      <motion.section {...fadeItem(riskScore || (alertas && alertas.length > 0) ? 4 : 3)} className="mb-10">
        <div className="flex items-baseline justify-between mb-5">
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{ fontSize: 'clamp(1.25rem, 2vw, 1.5rem)', paddingLeft: 14, borderLeft: '3px solid #A83838' }}
          >
            {language === 'es' ? 'Submódulos' : 'Submodules'}
          </h2>
          <span className="text-sm text-n-500">
            {language === 'es' ? '6 frentes de defensa · actualizado hoy' : '6 defense areas · updated today'}
          </span>
        </div>

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' }}
        >
          {SUBMODULES.map((sub, i) => (
            <SubmoduleCard
              key={sub.key}
              submodule={sub}
              title={escudo.submodules[sub.key].title}
              description={escudo.submodules[sub.key].description}
              language={language}
              delay={i}
              reduced={reduced}
            />
          ))}
        </div>
      </motion.section>

      {/* Calidad de fuentes */}
      <motion.section {...fadeItem(riskScore || (alertas && alertas.length > 0) ? 5 : 4)} className="mb-10">
        <div className="flex items-baseline gap-3 mb-5">
          <h2
            className="font-serif-elite font-medium text-n-1000"
            style={{ fontSize: 'clamp(1.25rem, 2vw, 1.5rem)', paddingLeft: 14, borderLeft: '3px solid #A83838' }}
          >
            {language === 'es' ? 'Calidad de fuentes' : 'Source quality'}
          </h2>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border border-[rgba(168,56,56,.35)] text-area-escudo bg-[rgba(168,56,56,.08)]">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-area-escudo animate-pulse" />
            DataSourceLadder
          </span>
        </div>
        <DataSourceLadder title="" sources={sources} />
      </motion.section>

      {/* Zonas de capacidades */}
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

// ─── Sparkline for TEF trend ─────────────────────────────────────────────────

function TefSparkline() {
  const pts = [78, 74, 70, 66, 62, 58, 55, 52];
  const W = 100, H = 70;
  const min = Math.min(...pts), max = Math.max(...pts);
  const rng = max - min || 1;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * W);
  const ys = pts.map(v => H - ((v - min) / rng) * H * 0.78 - H * 0.11);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');

  return (
    <svg width="100%" height="70" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="rgba(255,255,255,.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="2.5" fill="rgba(255,255,255,.8)" />
    </svg>
  );
}

// ─── Submódulo card — matches handoff .subcard style ─────────────────────────

interface SubmoduleCardProps {
  submodule: SubmoduleDef;
  title: string;
  description: string;
  language: 'es' | 'en';
  delay: number;
  reduced: boolean | null;
}

function SubmoduleCard({ submodule, title, description, language, delay, reduced }: SubmoduleCardProps) {
  const { icon: Icon, href, statusLabel, statusColor } = submodule;

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, delay: 0.18 + delay * 0.07, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <motion.div {...motionProps}>
      <Link
        href={href}
        prefetch={false}
        className="group relative block overflow-hidden rounded-xl transition-[transform,box-shadow] hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A83838] focus-visible:ring-offset-2"
        style={{
          background: 'color-mix(in srgb, #A83838 4%, var(--color-n-0, #FCFBF8))',
          border: '1px solid color-mix(in srgb, #A83838 20%, transparent)',
          padding: 20,
        }}
        aria-label={`${title}. ${description}`}
      >
        {/* Left accent bar — appears on hover via group-hover */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-200 rounded-tl-xl rounded-bl-xl"
          style={{ background: 'linear-gradient(180deg, #A83838, #8A2E2E)' }}
        />

        {/* Icon box */}
        <div
          aria-hidden="true"
          className="inline-grid place-items-center rounded-lg mb-4 transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-3"
          style={{
            width: 42, height: 42,
            background: 'color-mix(in srgb, #A83838 12%, transparent)',
            color: '#8A2E2E',
          }}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>

        {/* Name */}
        <div className="text-base font-semibold text-n-1000 leading-snug">{title}</div>

        {/* Description */}
        <div className="text-sm text-n-600 mt-1 leading-snug">{description}</div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: statusColor }}>
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
            {statusLabel[language]}
          </span>
          <span aria-hidden="true" style={{ color: '#A83838' }}>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
          </span>
        </div>
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
