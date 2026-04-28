'use client';

/**
 * MonthlyReport — genera y muestra el reporte mensual de un libro Pyme.
 *
 * Flujo: usuario elige mes/anio → POST a `/api/pyme/reports/monthly` →
 * recibe `MonthlyReportPayload` (KPIs, top categorias, alertas, narrative
 * markdown) → renderiza dashboard.
 *
 * Render:
 *  - 4 KPI cards (ingresos, egresos, margen, margen %).
 *  - Top categorias como bars proporcionales (sin instalar libreria).
 *  - Alertas con severity chips (info azul, warning ambar, critical
 *    vino/area-escudo).
 *  - Narrative renderizado con `react-markdown` (ya esta en el bundle —
 *    se usa en ReportFollowUpChat, ReportDiff, etc.).
 *
 * "Exportar Excel" queda disabled con tooltip "Proximamente".
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  LineChart,
  Receipt,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type {
  MonthlyAlert,
  MonthlyCategoryBreakdown,
  MonthlyReportPayload,
} from './types';

interface MonthlyReportProps {
  bookId: string;
  /** ISO 4217 — para formatear los KPI con la moneda correcta. */
  currency?: string;
}

interface ReportResponse {
  ok: boolean;
  report?: { id: string; data: MonthlyReportPayload };
  error?: string;
}

export function MonthlyReport({ bookId, currency = 'COP' }: MonthlyReportProps) {
  const { t, language } = useLanguage();
  const tt = t.pyme.report;

  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [generating, setGenerating] = useState(false);
  const [payload, setPayload] = useState<MonthlyReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(language === 'es' ? 'es-CO' : 'en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      return new Intl.NumberFormat(language === 'es' ? 'es-CO' : 'en-US', {
        maximumFractionDigits: 0,
      });
    }
  }, [language, currency]);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/pyme/reports/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, year, month, language }),
      });
      const json = (await res.json()) as ReportResponse;
      if (!res.ok || !json.ok || !json.report) {
        throw new Error(json.error ?? 'generate_failed');
      }
      setPayload(json.report.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate_failed');
      setPayload(null);
    } finally {
      setGenerating(false);
    }
  }, [generating, bookId, year, month, language]);

  // Year options: last 5 years
  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    const current = now.getFullYear();
    for (let y = current - 4; y <= current + 1; y++) arr.push(y);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2024, i, 1);
      return {
        value: i + 1,
        label: d.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
          month: 'long',
        }),
      };
    });
  }, [language]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-serif-elite text-xl font-medium tracking-tight text-n-1000">
          {tt.title}
        </h3>
        <p className="text-sm text-n-600 mt-1">{tt.subtitle}</p>
      </div>

      {/* Selectors + CTA */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
            {tt.select_month}
          </span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            disabled={generating}
            className="px-3 py-2 rounded-md bg-n-0 text-n-1000 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
            {tt.select_year}
          </span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={generating}
            className="px-3 py-2 rounded-md bg-n-0 text-n-1000 border border-n-300 focus-visible:border-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/30"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2 rounded-md',
            'bg-area-escudo text-n-0 font-medium text-sm',
            'hover:opacity-90 transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span>{generating ? tt.generating : tt.generate}</span>
        </button>

        <button
          type="button"
          disabled
          aria-disabled="true"
          title={tt.export_soon}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-n-500 bg-n-100 cursor-not-allowed opacity-60"
        >
          <Receipt className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          <span>{tt.export_excel}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-n-200 bg-n-100 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-area-escudo shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-sm text-n-1000">{error}</p>
        </div>
      )}

      {!payload && !generating && !error && (
        <div className="rounded-xl glass-elite p-10 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-n-100 text-area-escudo mb-4">
            <LineChart className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="text-base text-n-800">{tt.empty}</p>
        </div>
      )}

      {payload && (
        <ReportView payload={payload} fmt={fmt} tt={tt} reviewT={t.pyme.review} />
      )}
    </div>
  );
}

// ─── Report view ─────────────────────────────────────────────────────────────

interface ReportViewProps {
  payload: MonthlyReportPayload;
  fmt: Intl.NumberFormat;
  tt: ReturnType<typeof useLanguage>['t']['pyme']['report'];
  reviewT: ReturnType<typeof useLanguage>['t']['pyme']['review'];
}

function ReportView({ payload, fmt, tt, reviewT }: ReportViewProps) {
  const { totals, topIngresoCategories, topEgresoCategories, previous } =
    payload.summary;

  const marginPctStr = `${(totals.margenPct * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <KpiCard
          label={tt.kpi_ingresos}
          value={fmt.format(totals.ingresos)}
          tone="success"
          previous={previous ? fmt.format(previous.ingresos) : null}
          previousLabel={tt.previous}
          icon={<TrendingUp className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
        />
        <KpiCard
          label={tt.kpi_egresos}
          value={fmt.format(totals.egresos)}
          tone="wine"
          previous={previous ? fmt.format(previous.egresos) : null}
          previousLabel={tt.previous}
          icon={<TrendingDown className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
        />
        <KpiCard
          label={tt.margin}
          value={fmt.format(totals.margen)}
          tone={totals.margen >= 0 ? 'success' : 'wine'}
          previous={previous ? fmt.format(previous.margen) : null}
          previousLabel={tt.previous}
        />
        <KpiCard
          label={tt.margin_pct}
          value={marginPctStr}
          tone={totals.margenPct >= 0 ? 'success' : 'wine'}
        />
      </div>

      {/* Top categories */}
      <div className="grid gap-4 md:grid-cols-2">
        <CategoryBars
          title={tt.top_ingresos}
          items={topIngresoCategories}
          tone="success"
          fmt={fmt}
          emptyLabel={reviewT.no_entries}
        />
        <CategoryBars
          title={tt.top_egresos}
          items={topEgresoCategories}
          tone="wine"
          fmt={fmt}
          emptyLabel={reviewT.no_entries}
        />
      </div>

      {/* Alerts */}
      {payload.alerts && payload.alerts.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-eyebrow text-n-600 mb-2">
            {tt.alerts}
          </h4>
          <ul role="list" className="space-y-2">
            {payload.alerts.map((a, idx) => (
              <AlertRow key={idx} alert={a} />
            ))}
          </ul>
        </div>
      )}

      {/* Narrative */}
      {payload.narrative && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-eyebrow text-n-600 mb-2">
            {tt.narrative}
          </h4>
          <article className="rounded-xl glass-elite p-5 prose prose-workspace max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {payload.narrative}
            </ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  tone,
  previous,
  previousLabel,
  icon,
}: {
  label: string;
  value: string;
  tone: 'success' | 'wine';
  previous?: string | null;
  previousLabel?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl glass-elite p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium uppercase tracking-eyebrow text-n-600">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md',
              tone === 'success' ? 'bg-n-100 text-success' : 'bg-n-100 text-area-escudo',
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          'font-serif-elite font-medium num text-2xl md:text-3xl leading-tight tracking-tight',
          'text-n-1000',
        )}
      >
        {value}
      </p>
      {previous && (
        <p className="text-xs text-n-500 mt-1.5">
          {previousLabel}: <span className="num text-n-700">{previous}</span>
        </p>
      )}
    </div>
  );
}

// ─── Category bars ───────────────────────────────────────────────────────────

function CategoryBars({
  title,
  items,
  tone,
  fmt,
  emptyLabel,
}: {
  title: string;
  items: MonthlyCategoryBreakdown[];
  tone: 'success' | 'wine';
  fmt: Intl.NumberFormat;
  emptyLabel: string;
}) {
  const max = items.reduce((m, it) => Math.max(m, it.amount), 0);

  return (
    <div className="rounded-xl glass-elite p-5">
      <h4 className="text-sm font-medium text-n-1000 mb-3">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-n-600">{emptyLabel}</p>
      ) : (
        <ul role="list" className="space-y-2.5">
          {items.map((it, idx) => {
            const pct = max > 0 ? Math.max(4, (it.amount / max) * 100) : 0;
            return (
              <li key={`${it.category}-${idx}`}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-sm text-n-1000 truncate">{it.category}</span>
                  <span
                    className={cn(
                      'text-sm font-medium num',
                      tone === 'success' ? 'text-success' : 'text-area-escudo',
                    )}
                  >
                    {fmt.format(it.amount)}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 rounded-full bg-n-200 overflow-hidden"
                >
                  <div
                    className={cn(
                      'h-full transition-all',
                      tone === 'success' ? 'bg-success' : 'bg-area-escudo',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Alert row ───────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: MonthlyAlert }) {
  const sevConfig: Record<
    MonthlyAlert['severity'],
    { Icon: typeof Info; iconClass: string; chip: string }
  > = {
    info: {
      Icon: Info,
      iconClass: 'text-info',
      chip: 'bg-n-100 text-info border border-n-200',
    },
    warning: {
      Icon: AlertTriangle,
      iconClass: 'text-warning',
      chip: 'bg-n-100 text-warning border border-n-200',
    },
    critical: {
      Icon: AlertCircle,
      iconClass: 'text-area-escudo',
      chip: 'bg-n-100 text-area-escudo border border-n-200',
    },
  };
  const cfg = sevConfig[alert.severity];
  return (
    <li className="flex items-start gap-3 rounded-md border border-n-200 bg-n-100 px-3 py-2.5">
      <cfg.Icon
        className={cn('h-4 w-4 shrink-0 mt-0.5', cfg.iconClass)}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-eyebrow mb-1', cfg.chip)}>
          {alert.severity}
        </span>
        <p className="text-sm text-n-1000">{alert.message}</p>
      </div>
    </li>
  );
}

// Convenience export of the success icon to keep imports small
export { CheckCircle2 };
