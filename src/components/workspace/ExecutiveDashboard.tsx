'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { getDashboardKpis, type DashboardKPIs, type LiveKpiValue } from '@/lib/kpis/live';
import { getAlerts, summarizeAlerts } from '@/lib/alerts/feed';
import type { Alert, ErpConnectionLite } from '@/lib/alerts/types';
import { AreaCard, type AreaKey, type AreaKpi } from './AreaCard';
import { ShimmerLoader } from '@/components/ui/ShimmerLoader';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Compass,
  Scale,
  Shield,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * ExecutiveDashboard — Home of `/workspace` when no case is active.
 *
 *  - 4 AreaCards backed by the live KPI layer (`@/lib/kpis/live`).
 *    When no ERP is linked and no pipeline report is cached, cards fall back
 *    to deterministic mocks and surface a "Demo" provenance badge.
 *  - Compact alerts strip rolls up: tax deadlines, audit findings from the
 *    last persisted report, and ERP sync failures.
 *  - First render shows a skeleton layout; real data arrives in one batch
 *    via `Promise.all` so the cards light up together (no flicker).
 */

// ─── Area config ─────────────────────────────────────────────────────────────

interface AreaDef {
  key: AreaKey;
  href: string;
  icon: LucideIcon;
  eyebrowEs: string;
  eyebrowEn: string;
}

const AREAS: readonly AreaDef[] = [
  {
    key: 'escudo',
    href: '/workspace/escudo',
    icon: Shield,
    eyebrowEs: 'I. Resiliencia',
    eyebrowEn: 'I. Resilience',
  },
  {
    key: 'valor',
    href: '/workspace/valor',
    icon: TrendingUp,
    eyebrowEs: 'II. Valor',
    eyebrowEn: 'II. Value',
  },
  {
    key: 'verdad',
    href: '/workspace/verdad',
    icon: Scale,
    eyebrowEs: 'III. Integridad',
    eyebrowEn: 'III. Integrity',
  },
  {
    key: 'futuro',
    href: '/workspace/futuro',
    icon: Compass,
    eyebrowEs: 'IV. Futuro',
    eyebrowEn: 'IV. Future',
  },
] as const;

const KPI_LABELS_ES: Record<AreaKey, string> = {
  escudo: 'Eficiencia Fiscal',
  valor: 'Valor de Salida',
  verdad: 'Salud Normativa',
  futuro: 'ROI Probabilístico',
};

const KPI_LABELS_EN: Record<AreaKey, string> = {
  escudo: 'Tax Efficiency',
  valor: 'Exit Value',
  verdad: 'Regulatory Health',
  futuro: 'Probabilistic ROI',
};

// ─── ERP connection loader (client-only, same encoding as ChatWorkspace) ────

function readStoredConnections(): ErpConnectionLite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('utopia_erp_connections');
    if (!raw) return [];
    const decoded = JSON.parse(decodeURIComponent(atob(raw))) as Array<{
      provider: string;
      status?: ErpConnectionLite['status'];
      lastSync?: string;
      companyName?: string;
    }>;
    if (!Array.isArray(decoded)) return [];
    return decoded.map((c) => ({
      provider: c.provider,
      status: c.status ?? 'connected',
      lastSync: c.lastSync,
      companyName: c.companyName,
    }));
  } catch {
    return [];
  }
}

// ─── Projection helpers ─────────────────────────────────────────────────────

function toAreaKpi(value: LiveKpiValue, label: string): AreaKpi {
  const kpi: AreaKpi = {
    value: value.value,
    formatted: value.formatted,
    label,
    severity: value.severity,
  };
  if (value.trend !== 'flat' || value.trendPercent !== 0) {
    kpi.trend = { direction: value.trend, delta: value.trendPercent };
  }
  return kpi;
}

// ─── Alerts strip ───────────────────────────────────────────────────────────

const SEVERITY_CHIP: Record<Alert['severity'], string> = {
  critical: 'border-danger/30 bg-danger/10 text-danger',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-n-200 bg-n-50 text-n-700',
};

const SEVERITY_DOT: Record<Alert['severity'], string> = {
  critical: 'bg-danger',
  warn: 'bg-warning',
  info: 'bg-n-500',
};

function buildChipLabel(
  summary: { critical: number; warn: number; info: number; total: number },
  isEs: boolean,
): { text: string; severity: Alert['severity'] } {
  if (summary.critical > 0) {
    const word = isEs ? (summary.critical === 1 ? 'crítica' : 'críticas') : (summary.critical === 1 ? 'critical' : 'criticals');
    return { text: `${summary.critical} ${word}`, severity: 'critical' };
  }
  if (summary.warn > 0) {
    const word = isEs ? (summary.warn === 1 ? 'advertencia' : 'advertencias') : `warning${summary.warn === 1 ? '' : 's'}`;
    return { text: `${summary.warn} ${word}`, severity: 'warn' };
  }
  const word = isEs ? (summary.info === 1 ? 'aviso' : 'avisos') : `notice${summary.info === 1 ? '' : 's'}`;
  return { text: `${summary.info} ${word}`, severity: 'info' };
}

function AlertsStrip({
  alerts,
  loading,
  isEs,
}: {
  alerts: Alert[];
  loading: boolean;
  isEs: boolean;
}) {
  const summary = useMemo(() => summarizeAlerts(alerts), [alerts]);

  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <ShimmerLoader width={120} height={28} radius="9999px" />
        <ShimmerLoader width={220} height={20} radius="4px" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full self-start border border-n-200 bg-n-50 text-sm text-n-600">
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
        {isEs ? 'Sin alertas activas' : 'No active alerts'}
      </div>
    );
  }

  const chip = buildChipLabel(summary, isEs);
  const top = alerts.slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border',
            'font-mono text-xs-mono uppercase tracking-eyebrow font-medium',
            SEVERITY_CHIP[chip.severity],
          ].join(' ')}
        >
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          {chip.text}
        </span>
        <span className="text-xs text-n-500 font-mono tabular-nums">
          {isEs ? 'de' : 'of'} {summary.total}
        </span>
      </div>
      <ul
        aria-label={isEs ? 'Alertas recientes' : 'Recent alerts'}
        className="flex flex-col gap-1.5"
      >
        {top.map((alert) => (
          <li
            key={alert.id}
            className={['flex items-start gap-2.5 px-3 py-2 rounded-md border', SEVERITY_CHIP[alert.severity]].join(' ')}
          >
            <span aria-hidden="true" className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[alert.severity]}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-n-900 truncate">{alert.title}</div>
              {alert.description && (
                <div className="text-xs text-n-600 truncate font-light">{alert.description}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Card skeleton ──────────────────────────────────────────────────────────

function AreaCardSkeleton() {
  return (
    <div className="min-h-[240px] rounded-xl bg-n-50 border border-n-200 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <ShimmerLoader width={100} height={12} radius="4px" />
        <ShimmerLoader width={36} height={36} radius="8px" />
      </div>
      <ShimmerLoader width="70%" height={24} radius="4px" />
      <ShimmerLoader width="50%" height={14} radius="4px" />
      <div className="mt-auto flex items-center justify-between">
        <ShimmerLoader width={120} height={32} radius="4px" />
        <ShimmerLoader width={60} height={20} radius="4px" />
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ExecutiveDashboard() {
  const { t, language } = useLanguage();
  const elite = t.elite;
  const isEs = language === 'es';

  const ctaPrefix = isEs ? 'Entrar a' : 'Enter';
  const heroEyebrow = elite.tagline;
  const statusLabel = isEs ? 'Operativo' : 'Live';

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ErpConnectionLite[]>([]);

  useEffect(() => {
    setConnections(readStoredConnections());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [kpisResult, alertsResult] = await Promise.allSettled([
          getDashboardKpis(connections),
          getAlerts({ erpConnections: connections }),
        ]);
        if (cancelled) return;
        if (kpisResult.status === 'fulfilled') setKpis(kpisResult.value);
        if (alertsResult.status === 'fulfilled') setAlerts(alertsResult.value);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [connections]);

  return (
    <div className="h-full w-full overflow-y-auto styled-scrollbar">
      <div
        className={[
          'max-w-7xl mx-auto',
          'px-6 md:px-10 lg:px-12',
          'pt-6 md:pt-8 lg:pt-10 pb-12',
          'flex flex-col gap-8 md:gap-10',
        ].join(' ')}
      >
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium">
              {heroEyebrow}
            </span>
            <h1 className="text-2xl md:text-3xl font-serif-elite font-normal leading-tight tracking-tight text-n-900">
              {isEs ? 'Centro de Comando' : 'Command Center'}
            </h1>
            <p className="text-sm text-n-600 font-light max-w-[60ch]">
              {isEs
                ? '4 pilares. Telemetría en vivo. Una sola verdad.'
                : '4 pillars. Live telemetry. One source of truth.'}
            </p>
          </div>

          <span
            className={[
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
              'border border-success/30 bg-success/10',
              'font-mono text-xs-mono uppercase tracking-eyebrow text-success font-medium',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-success"
            />
            {statusLabel}
          </span>
        </header>

        <AlertsStrip alerts={alerts} loading={loading} isEs={isEs} />

        <section
          aria-label={isEs ? 'Pilares ejecutivos' : 'Executive pillars'}
          className={[
            'grid gap-4 lg:gap-5',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4',
          ].join(' ')}
        >
          {loading || !kpis
            ? AREAS.map((area) => <AreaCardSkeleton key={area.key} />)
            : AREAS.map((area, idx) => {
                const areaDict = elite.areas[area.key];
                const label = isEs ? KPI_LABELS_ES[area.key] : KPI_LABELS_EN[area.key];
                const live = kpis[area.key];
                const kpi = toAreaKpi(live, label);
                const conceptLabel = areaDict.concept;
                const ctaLabel = `${ctaPrefix} ${conceptLabel}`;
                const alertsCount = alerts.filter(
                  (a) => a.area === area.key,
                ).length;

                return (
                  <AreaCard
                    key={area.key}
                    area={area.key}
                    eyebrow={isEs ? area.eyebrowEs : area.eyebrowEn}
                    concept={conceptLabel}
                    subtitle={areaDict.subtitle}
                    tagline={areaDict.tagline}
                    kpi={kpi}
                    ctaLabel={ctaLabel}
                    href={area.href}
                    icon={area.icon}
                    alertsCount={alertsCount}
                    sparkline={live.sparkline}
                    source={live.source}
                    updatedAt={live.updatedAt}
                    delay={0.05 + idx * 0.08}
                  />
                );
              })}
        </section>

        <section
          aria-label={isEs ? 'Módulos auxiliares' : 'Auxiliary modules'}
          className="flex flex-col gap-3"
        >
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium">
            {isEs ? 'Módulos' : 'Modules'}
          </span>
          <Link
            href="/workspace/contabilidad"
            className={[
              'group relative flex items-center gap-4 rounded-xl border border-n-200 bg-n-50',
              'p-5 transition-colors hover:border-gold-500/40 hover:bg-n-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gold-500/10 text-gold-600"
            >
              <BookOpen className="h-6 w-6" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-serif-elite font-normal text-n-1000 truncate">
                  {isEs ? 'Contabilidad' : 'Accounting'}
                </h3>
                <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium">
                  {isEs ? 'Nuevo' : 'New'}
                </span>
              </div>
              <p className="text-sm text-n-700 font-light truncate">
                {isEs
                  ? 'Núcleo contable de doble partida: asientos, PUC y saldos iniciales.'
                  : 'Double-entry accounting core: entries, chart of accounts, opening balances.'}
              </p>
            </div>
            <ArrowRight
              className="h-5 w-5 shrink-0 text-n-500 transition-transform group-hover:translate-x-1 group-hover:text-gold-500"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </Link>
          <Link
            href="/workspace/pyme"
            className={[
              'group relative flex items-center gap-4 rounded-xl border border-n-200 bg-n-50',
              'p-5 transition-colors hover:border-area-escudo/40 hover:bg-n-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-area-escudo/10 text-area-escudo"
            >
              <BookOpen className="h-6 w-6" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-serif-elite font-normal text-n-1000 truncate">
                  {isEs ? 'Contabilidad Pyme' : 'Small Business Bookkeeping'}
                </h3>
                <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-area-escudo font-medium">
                  {isEs ? 'Nuevo' : 'New'}
                </span>
              </div>
              <p className="text-sm text-n-700 font-light truncate">
                {isEs
                  ? 'Sube fotos de tu cuaderno y conviértelas en reportes mensuales.'
                  : 'Upload notebook photos and turn them into monthly reports.'}
              </p>
            </div>
            <ArrowRight
              className="h-5 w-5 shrink-0 text-n-500 transition-transform group-hover:translate-x-1 group-hover:text-area-escudo"
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </Link>
        </section>
      </div>
    </div>
  );
}
