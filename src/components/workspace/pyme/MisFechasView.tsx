'use client';

/**
 * MisFechasView — /workspace/pyme/fechas ("Mis Fechas").
 *
 * Diseño del handoff "Pyme - Mis Fechas.html" cableado a datos REALES:
 * vencimientos nacionales verificados (Resolución DIAN) desde
 * GET /api/calendar/verified, agrupados por obligación+período.
 *
 * Honestidad sobre el prototipo:
 * - El calendario publica una fecha por dígito de NIT; sin NIT configurado
 *   se muestra el rango ("entre el 10 y el 21 de feb, según su NIT").
 * - No hay registro de pagos todavía → la tercera métrica es "Pasadas"
 *   (vencimientos ya ocurridos del año), no "Cumplidas".
 * - Sin botones "Pagar ahora": no existe pasarela de pago conectada.
 */

import { AlertTriangle, CalendarClock, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';
import {
  usePymeDeadlines,
  type PymeDeadlineItem,
} from '@/components/workspace/pyme/usePymeData';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long' }).format(d);
}

function rangeLabel(d: PymeDeadlineItem): string {
  return d.dueDateMin === d.dueDateMax
    ? `Vence el ${fmtDay(d.dueDateMin)}`
    : `Vence entre el ${fmtDay(d.dueDateMin)} y el ${fmtDay(d.dueDateMax)}, según su NIT`;
}

function severityColor(daysUntil: number): string {
  if (daysUntil <= 15) return '#A83838';
  if (daysUntil <= 45) return '#C48A2E';
  return '#357A28';
}

function plazoLabel(daysUntil: number): { text: string; tone: 'danger' | 'warning' | 'ok' } {
  if (daysUntil <= 0) return { text: 'vence hoy', tone: 'danger' };
  if (daysUntil <= 15) return { text: `en ${daysUntil} días`, tone: 'danger' };
  if (daysUntil <= 45) return { text: `en ${daysUntil} días`, tone: 'warning' };
  return { text: `en ${daysUntil} días`, tone: 'ok' };
}

// ─── View ────────────────────────────────────────────────────────────────────

const VISIBLE_COUNT = 6;

export function MisFechasView() {
  const year = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed
  const { upcoming, pastCount, loading } = usePymeDeadlines(year);

  const urgentes = upcoming.filter((d) => d.daysUntil <= 15).length;
  const proximas = upcoming.filter((d) => d.daysUntil > 15 && d.daysUntil <= 45).length;
  const visible = upcoming.slice(0, VISIBLE_COUNT);

  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mis Fechas"
        subtitle="Cuándo le toca pagar y avisarle al estado, según el calendario oficial DIAN."
        metrics={[
          { value: loading ? '…' : String(urgentes), label: 'Urgentes (≤15 días)', tone: 'red' },
          { value: loading ? '…' : String(proximas), label: 'Próximas (≤45 días)', tone: 'amber' },
          { value: loading ? '…' : String(pastCount), label: 'Pasadas este año', tone: 'green' },
        ]}
      >
        {/* Barra de 12 meses — posición en el año */}
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {MESES.map((m, i) => (
            <div
              key={`${m}-${i}`}
              className="grid h-10 flex-1 place-items-center rounded-sm text-[11px] font-bold"
              style={
                i < currentMonth
                  ? { background: 'rgb(255 255 255 / 0.25)', color: 'rgb(255 255 255 / 0.75)' }
                  : i === currentMonth
                    ? { background: '#E6B66A', color: '#3a2a08' }
                    : { background: 'rgb(255 255 255 / 0.12)', color: 'rgb(255 255 255 / 0.5)' }
              }
            >
              {m}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex gap-4 text-xs text-white/70">
          <span><b className="text-[13px] text-white/75">●</b> Pasado</span>
          <span><b className="text-[13px] text-[#E6B66A]">●</b> Este mes</span>
          <span><b className="text-[13px] text-white/40">●</b> Por venir</span>
        </div>
      </PymeGreenHero>

      {/* Obligaciones */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-elite text-2xl font-medium text-n-1000">Lo que se viene</h2>
        <span className="text-sm text-n-500">
          {loading ? '…' : `${upcoming.length} obligaciones del año`}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[96px] animate-pulse rounded-xl border border-n-200 bg-n-50" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-area-pyme/30 bg-n-0 px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-n-1000">
            Sin calendario disponible
          </p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-n-600">
            No pudimos cargar los vencimientos verificados de la DIAN. Intente
            de nuevo en unos minutos.
          </p>
        </div>
      ) : (
        visible.map((o) => {
          const color = severityColor(o.daysUntil);
          const plazo = plazoLabel(o.daysUntil);
          return (
            <div
              key={`${o.obligation}-${o.period}`}
              className="mb-3 rounded-xl border border-n-200 bg-n-0 px-5 py-4"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md"
                  style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                >
                  {/(pagar|pila|seguridad)/i.test(o.obligation) ? (
                    <CalendarClock className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <Landmark className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-n-1000">{o.obligation}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-n-600">
                    <span>{rangeLabel(o)}</span>
                    <span>·</span>
                    <span
                      className={cn(
                        'font-semibold',
                        plazo.tone === 'danger'
                          ? 'text-danger'
                          : plazo.tone === 'warning'
                            ? 'text-warning'
                            : 'text-[#2A5E1F] dark:text-area-pyme',
                      )}
                    >
                      {plazo.text}
                    </span>
                    <span className="rounded-full bg-area-pyme/15 px-2 py-0.5 text-[10px] font-bold text-[#2A5E1F] dark:text-area-pyme">
                      {o.period}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-n-500">{o.legalBasis}</div>
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* Consejo multas */}
      <div className="mt-4 rounded-xl border border-area-pyme/35 bg-area-pyme/[0.09] px-5 py-4">
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-eyebrow text-[#2A5E1F] dark:text-area-pyme">
          <AlertTriangle className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
          Para no perder plata
        </div>
        <p className="text-[15px] leading-relaxed text-n-700">
          Si paga tarde, le cobran un <b>5% de más por cada mes</b> de retraso,
          más intereses (Art. 641 E.T.). Por eso le mostramos las fechas
          oficiales con anticipación — sepárelo apenas venda.
        </p>
      </div>
    </PymeSubpageShell>
  );
}
