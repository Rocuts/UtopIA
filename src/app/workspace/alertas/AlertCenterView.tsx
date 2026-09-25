'use client';

/**
 * AlertCenterView — vista del Centro de Alertas (presentacional, sin fetch).
 *
 * Re-auditoría e2e-niif-15 (2026-09): la página mostraba 6 alertas fijas
 * «detectadas por la IA» con cifras presentadas como datos del cliente. Esta
 * vista sólo pinta las alertas reales que la página carga de
 * `/api/sentinel/alerts`; sin datos muestra un estado vacío o de error
 * rotulado. Las suscripciones no persistían: quedan rotuladas «Módulo en
 * preparación» (mismos textos de `t.elite.dataStatus` que ModuleInPreparation).
 */

import { AlertTriangle, BellRing, Construction, Info, Loader2 } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import type { InsightSeverity } from '@/lib/notifications/insight-types';
import type { PillarId } from '@/lib/pillars/types';

export type AlertCenterFilter = 'todas' | PillarId;

export interface AlertCenterItem {
  id: string;
  pillar: PillarId;
  severity: InsightSeverity;
  status: 'pending' | 'snoozed' | 'resolved' | 'escalated';
  subject: string;
  hallazgo?: string | null;
  createdAt: string;
}

export interface AlertCenterViewProps {
  status: 'loading' | 'ready' | 'error';
  alerts: AlertCenterItem[];
  filter: AlertCenterFilter;
  onFilter: (f: AlertCenterFilter) => void;
}

const AREA_COLORS: Record<PillarId, string> = {
  escudo: '#A83838',
  valor: '#B8934A',
  verdad: '#3D6B7E',
  futuro: '#5A7F7A',
};

const FILTERS: AlertCenterFilter[] = ['todas', 'escudo', 'valor', 'verdad', 'futuro'];

/** Claves i18n crudas (p. ej. «escudo.fiscal.alert.a5_sin_provision») no se muestran como texto. */
function esClaveI18n(s: string | null | undefined): boolean {
  return !!s && /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(s.trim());
}

function formatFecha(iso: string, language: 'es' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(language === 'es' ? 'es-CO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AlertCenterView({ status, alerts, filter, onFilter }: AlertCenterViewProps) {
  const { t, language } = useLanguage();
  const ac = t.elite.alertCenter;
  const ds = t.elite.dataStatus;

  const visibles = filter === 'todas' ? alerts : alerts.filter((a) => a.pillar === filter);
  const criticas = alerts.filter((a) => a.severity === 'critico').length;

  return (
    <main className="min-h-screen bg-n-0 px-6 py-10 md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="pb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <span
              className="flex items-center justify-center rounded-md"
              style={{ width: 30, height: 30, background: 'linear-gradient(140deg, #B8934A, #8C6830)', color: '#fff' }}
            >
              <BellRing size={16} aria-hidden="true" />
            </span>
            <span className="text-sm font-bold" style={{ color: '#8C6830' }}>
              {ac.eyebrow}
            </span>
          </div>
          <h1
            className="font-serif-elite font-medium tracking-tight text-n-1000"
            style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)', lineHeight: 1.15 }}
          >
            {ac.title}
          </h1>
          <p className="text-base text-n-700 mt-2 max-w-2xl">{ac.subtitle}</p>

          <div className="flex flex-wrap gap-2 mt-5" role="group" aria-label={ac.title}>
            {FILTERS.map((key) => {
              const isOn = filter === key;
              const count = key === 'todas' ? alerts.length : alerts.filter((a) => a.pillar === key).length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onFilter(key)}
                  aria-pressed={isOn}
                  className={
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors duration-150 ' +
                    (isOn
                      ? 'bg-n-900 text-n-0 border-n-900'
                      : 'bg-n-0 text-n-700 border-n-200 hover:text-n-1000')
                  }
                >
                  {key !== 'todas' && (
                    <span
                      className="rounded-full flex-shrink-0"
                      style={{ width: 7, height: 7, background: AREA_COLORS[key] }}
                      aria-hidden="true"
                    />
                  )}
                  {ac.filters[key]}
                  {status === 'ready' && <span className="ml-0.5 opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>
        </header>

        <div className="grid gap-5 items-start pt-2 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <section aria-live="polite">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-n-900">{ac.inboxTitle}</span>
              {status === 'ready' && criticas > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {ac.criticalCount.replace('{n}', String(criticas))}
                </span>
              )}
            </div>

            {status === 'loading' ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-n-700">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {ac.loading}
              </p>
            ) : status === 'error' ? (
              <p role="alert" className="rounded-lg border border-n-300 bg-n-100 px-4 py-4 text-sm text-n-1000">
                {ac.error}
              </p>
            ) : alerts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-n-300 px-5 py-8 text-center">
                <p className="text-sm font-semibold text-n-1000">{ac.empty}</p>
                <p className="mt-1 text-sm text-n-700">{ac.emptyBody}</p>
              </div>
            ) : visibles.length === 0 ? (
              <p className="text-sm text-n-700 py-8 text-center">{ac.emptyFilter}</p>
            ) : (
              <ul className="space-y-2.5">
                {visibles.map((a) => {
                  const color = AREA_COLORS[a.pillar];
                  return (
                    <li
                      key={a.id}
                      className="flex gap-3.5 rounded-lg border border-n-200 bg-n-0 px-4 py-4"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div
                        className="flex-shrink-0 flex items-center justify-center rounded-md"
                        style={{ width: 38, height: 38, background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                        aria-hidden="true"
                      >
                        {a.severity === 'critico' ? <AlertTriangle size={18} /> : <Info size={18} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-n-1000 leading-snug">{a.subject}</p>
                        {a.hallazgo && !esClaveI18n(a.hallazgo) && (
                          <p className="text-xs text-n-700 mt-0.5 leading-snug">{a.hallazgo}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2.5 mt-2 text-xs">
                          <span className="font-bold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ color }}>
                            {ac.severity[a.severity]}
                          </span>
                          <span className="text-n-600">{ac.filters[a.pillar]}</span>
                          <span className="text-n-600">{ac.status[a.status]}</span>
                          <time className="text-n-600" dateTime={a.createdAt}>
                            {formatFecha(a.createdAt, language)}
                          </time>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="rounded-xl border border-n-200 bg-n-0 px-5 py-5" data-module-status="in-preparation">
            <h2 className="font-serif-elite font-medium text-xl text-n-1000 mb-3">{ac.subscriptionsTitle}</h2>
            <div role="status" className="flex items-start gap-3 rounded-lg border border-n-300 bg-n-100 px-4 py-3">
              <Construction className="h-4 w-4 mt-0.5 shrink-0 text-n-700" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-n-1000">{ds.moduleInPreparationNotice}</p>
                <p className="text-sm leading-relaxed text-n-700">{ds.moduleInPreparationBody}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

export default AlertCenterView;
