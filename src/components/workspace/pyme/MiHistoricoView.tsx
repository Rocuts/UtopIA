'use client';

/**
 * MiHistoricoView — /workspace/pyme/historico
 *
 * Comparativo mensual de ingresos vs egresos: últimos 6 meses.
 * Fuente: GET /api/pyme/summary?year=&month= para cada mes.
 * Sin datos inventados — barras vacías si el mes no tiene entradas.
 */

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, BarChart3, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPesosInteger } from '@/lib/format/cop';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { useLanguage } from '@/context/LanguageContext';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/** Textos de la vista (es/en), ICU-08. */
export type HistoricoLabels = Dictionary['pyme']['historico'];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthData {
  label: string;
  ingresos: number;
  egresos: number;
  margen: number;
  loading: boolean;
  error: boolean;
}

interface SummaryResponse {
  ok: boolean;
  summary?: {
    totals: { ingresos: number; egresos: number; margen: number; margenPct: number | null };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COP = (n: number) => `$${formatPesosInteger(n)}`;

function buildMonthSlots(count = 6, locale = 'es-CO'): Array<{ year: number; month: number; label: string }> {
  const result = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
    });
  }
  return result;
}

async function fetchMonthSummary(year: number, month: number): Promise<{ ingresos: number; egresos: number; margen: number } | null> {
  try {
    const res = await fetch(`/api/pyme/summary?year=${year}&month=${month}`);
    const json = (await res.json()) as SummaryResponse;
    if (!res.ok || !json.ok || !json.summary) return null;
    return {
      ingresos: json.summary.totals.ingresos,
      egresos: json.summary.totals.egresos,
      margen: json.summary.totals.margen,
    };
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MiHistoricoView() {
  const { t } = useLanguage();
  const labels = t.pyme.historico;
  const [months, setMonths] = useState<MonthData[]>(() =>
    buildMonthSlots(6, labels.locale).map((s) => ({
      label: s.label,
      ingresos: 0,
      egresos: 0,
      margen: 0,
      loading: true,
      error: false,
    })),
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const slots = buildMonthSlots(6, labels.locale);
    // Mark each slot loading asynchronously to avoid synchronous setState in effect
    const aborted = { current: false };
    slots.forEach(async (slot, idx) => {
      if (aborted.current) return;
      setMonths((prev) => {
        const next = [...prev];
        next[idx] = { label: slot.label, ingresos: 0, egresos: 0, margen: 0, loading: true, error: false };
        return next;
      });
      const data = await fetchMonthSummary(slot.year, slot.month);
      if (aborted.current) return;
      setMonths((prev) => {
        const next = [...prev];
        next[idx] = data
          ? { label: slot.label, ...data, loading: false, error: false }
          : { label: slot.label, ingresos: 0, egresos: 0, margen: 0, loading: false, error: true };
        return next;
      });
    });
    return () => { aborted.current = true; };
  }, [refreshKey, labels.locale]);

  const maxVal = Math.max(...months.map((m) => Math.max(m.ingresos, m.egresos)), 1);
  const totalIngresos = months.reduce((s, m) => s + m.ingresos, 0);
  const totalEgresos = months.reduce((s, m) => s + m.egresos, 0);
  const totalMargen = totalIngresos - totalEgresos;
  const allLoaded = months.every((m) => !m.loading);

  return (
    <PymeSubpageShell>
      <h1 className="font-serif-elite text-3xl font-medium tracking-tight text-n-1000 mb-5">
        {labels.title}
      </h1>
      {/* KPI band */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiChip label={labels.ingresos6m} value={COP(totalIngresos)} positive />
        <KpiChip label={labels.egresos6m} value={COP(totalEgresos)} positive={false} />
        <KpiChip label={labels.margenAcumulado} value={COP(totalMargen)} positive={totalMargen >= 0} />
      </div>

      {/* Bar chart */}
      <div
        className="rounded-2xl p-5 mb-5"
        style={{ background: 'var(--color-n-0)', border: '1px solid rgba(53,122,40,.15)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" style={{ color: '#357A28' }} strokeWidth={1.75} aria-hidden />
            <span className="font-semibold text-n-1000 text-sm">{labels.ultimos6}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={!allLoaded}
            className="inline-flex items-center gap-1 text-xs text-n-600 hover:text-n-1000 disabled:opacity-40 transition-colors"
            aria-label={labels.actualizar}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', !allLoaded && 'animate-spin')} strokeWidth={2} />
            {labels.actualizar}
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-4">
          <LegendDot color="#357A28" label={labels.ingresos} />
          <LegendDot color="#A83838" label={labels.egresos} />
        </div>

        {/* Bars */}
        <div className="flex items-end gap-2 h-36">
          {months.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="flex items-end gap-0.5 w-full h-28">
                <Bar
                  pct={maxVal > 0 ? m.ingresos / maxVal : 0}
                  color="#357A28"
                  loading={m.loading}
                  title={`${labels.ingresos} ${m.label}: ${COP(m.ingresos)}`}
                />
                <Bar
                  pct={maxVal > 0 ? m.egresos / maxVal : 0}
                  color="#A83838"
                  loading={m.loading}
                  title={`${labels.egresos} ${m.label}: ${COP(m.egresos)}`}
                />
              </div>
              <span className="text-[10px] text-n-500 font-medium uppercase">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Monthly detail list */}
      <div className="space-y-2">
        {months.map((m, i) => (
          <MonthRow key={i} data={m} labels={labels} />
        ))}
      </div>
    </PymeSubpageShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiChip({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-n-0)', border: '1px solid rgba(53,122,40,.12)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-n-500 mb-0.5">{label}</p>
      <p className={cn('font-semibold text-sm num', positive ? 'text-[#2A5E1F]' : 'text-[#A83838]')}>{value}</p>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="text-xs text-n-600">{label}</span>
    </div>
  );
}

function Bar({ pct, color, loading, title }: { pct: number; color: string; loading: boolean; title: string }) {
  return (
    <div
      className="flex-1 rounded-t-sm transition-all duration-500"
      title={title}
      style={{
        height: loading ? '30%' : `${Math.max(pct * 100, 2)}%`,
        background: loading ? 'var(--color-n-200)' : color,
        opacity: loading ? 0.4 : 1,
      }}
    />
  );
}

/**
 * Fila del mes. El estado («Cargando…», «Sin datos») es texto que el usuario
 * lee: text-n-600 (terciario legible), no text-n-400, que es nivel de
 * superficie y cae por debajo de 2:1 en modo claro (CLAUDE.md, ICU-08).
 */
export function MonthRow({ data, labels }: { data: MonthData; labels: HistoricoLabels }) {
  const positive = data.margen >= 0;
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-center justify-between"
      style={{ background: 'var(--color-n-0)', border: '1px solid var(--color-n-200)' }}
    >
      <div className="flex items-center gap-3">
        {positive
          ? <TrendingUp className="h-4 w-4 text-[#357A28]" strokeWidth={2} aria-hidden />
          : <TrendingDown className="h-4 w-4 text-[#A83838]" strokeWidth={2} aria-hidden />}
        <span className="text-sm font-semibold text-n-1000 uppercase">{data.label}</span>
      </div>
      {data.loading ? (
        <span className="text-xs text-n-600 animate-pulse">{labels.cargando}</span>
      ) : data.error ? (
        <span className="text-xs text-n-600">{labels.sinDatos}</span>
      ) : (
        <div className="flex gap-4 text-xs">
          <span className="text-[#357A28] font-medium num">{COP(data.ingresos)}</span>
          <span className="text-[#A83838] font-medium num">{COP(data.egresos)}</span>
          <span className={cn('font-semibold num', positive ? 'text-[#2A5E1F]' : 'text-[#A83838]')}>
            {COP(data.margen)}
          </span>
        </div>
      )}
    </div>
  );
}
