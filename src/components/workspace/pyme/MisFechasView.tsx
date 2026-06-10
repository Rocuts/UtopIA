'use client';

/**
 * MisFechasView — /workspace/pyme/fechas ("Mis Fechas").
 *
 * Implementa el handoff "Pyme - Mis Fechas.html":
 * - Hero verde con contadores (Urgente / Próximas / Cumplidas) y barra de
 *   12 meses (cumplido · este mes · por venir) con leyenda
 * - Lista "Lo que se viene": 3 obligaciones con borde de severidad,
 *   NIT chip y acciones (Pagar ahora / Ver borrador / Recordarme)
 * - Nota "Para no perder plata" (costo de pagar tarde)
 *
 * Datos MOCK (dataset del prototipo) — wiring real en una ola posterior.
 */

import {
  AlertTriangle,
  Bell,
  CreditCard,
  FileText,
  Landmark,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';

// ─── Mock data (dataset del prototipo) ───────────────────────────────────────

type Severity = 'danger' | 'warning' | 'ok';

const SEVERITY_COLOR: Record<Severity, string> = {
  danger: '#A83838',
  warning: '#C48A2E',
  ok: '#357A28',
};

interface Obligacion {
  icon: LucideIcon;
  severity: Severity;
  title: string;
  vence: string;
  plazo: string;
  plazoTone: 'danger' | 'warning';
  nit: string;
  amount: string;
  primaryAction: { label: string; icon: LucideIcon };
}

const OBLIGACIONES: Obligacion[] = [
  {
    icon: Users,
    severity: 'danger',
    title: 'Pagarle a sus empleados (salud y pensión)',
    vence: 'Vence el 17 de junio',
    plazo: 'en 9 días',
    plazoTone: 'danger',
    nit: 'NIT …7',
    amount: '$1.180.000',
    primaryAction: { label: 'Pagar ahora', icon: CreditCard },
  },
  {
    icon: Landmark,
    severity: 'warning',
    title: 'Avisarle al estado lo que vendió',
    vence: 'Vence el 19 de julio',
    plazo: 'en 24 días',
    plazoTone: 'warning',
    nit: 'NIT …7',
    amount: '$0',
    primaryAction: { label: 'Ver borrador', icon: FileText },
  },
  {
    icon: User,
    severity: 'ok',
    title: 'Su pago como dueño (base 40%)',
    vence: 'Vence el 17 de junio',
    plazo: 'en 9 días',
    plazoTone: 'danger',
    nit: 'NIT …7',
    amount: '$298.000',
    primaryAction: { label: 'Pagar ahora', icon: CreditCard },
  },
];

// Barra de 12 meses: 0-4 cumplidos · 5 (junio) activo · resto por venir.
const MESES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MES_ACTIVO = 5;

// ─── View ────────────────────────────────────────────────────────────────────

export function MisFechasView() {
  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mis Fechas"
        subtitle="Cuándo le toca pagar y avisarle al estado. Le avisamos un día antes."
        metrics={[
          { value: '1', label: 'Urgente', tone: 'red' },
          { value: '3', label: 'Próximas', tone: 'amber' },
          { value: '8', label: 'Cumplidas', tone: 'green' },
        ]}
      >
        {/* Barra de 12 meses */}
        <div className="mt-5 flex gap-1" aria-hidden="true">
          {MESES.map((m, i) => (
            <div
              key={`${m}-${i}`}
              className="grid h-10 flex-1 place-items-center rounded-sm text-[11px] font-bold"
              style={
                i < MES_ACTIVO
                  ? { background: '#7BC95B', color: '#0a1f06' }
                  : i === MES_ACTIVO
                    ? { background: '#E6B66A', color: '#3a2a08' }
                    : { background: 'rgb(255 255 255 / 0.12)', color: 'rgb(255 255 255 / 0.5)' }
              }
            >
              {m}
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex gap-4 text-xs text-white/70">
          <span><b className="text-[13px] text-[#7BC95B]">●</b> Cumplido</span>
          <span><b className="text-[13px] text-[#E6B66A]">●</b> Este mes</span>
          <span><b className="text-[13px] text-white/40">●</b> Por venir</span>
        </div>
      </PymeGreenHero>

      {/* Obligaciones */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-elite text-2xl font-medium text-n-1000">Lo que se viene</h2>
        <span className="text-sm text-n-500">{OBLIGACIONES.length} obligaciones</span>
      </div>

      {OBLIGACIONES.map((o) => {
        const Icon = o.icon;
        const ActionIcon = o.primaryAction.icon;
        const color = SEVERITY_COLOR[o.severity];
        return (
          <div
            key={o.title}
            className="mb-3 rounded-xl border border-n-200 bg-n-0 px-5 py-4"
            style={{ borderLeft: `3px solid ${color}` }}
          >
            <div className="flex items-start gap-3.5">
              <span
                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-n-1000">{o.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-n-600">
                  <span>{o.vence}</span>
                  <span>·</span>
                  <span
                    className={cn(
                      'font-semibold',
                      o.plazoTone === 'danger' ? 'text-danger' : 'text-warning',
                    )}
                  >
                    {o.plazo}
                  </span>
                  <span className="rounded-full bg-area-pyme/15 px-2 py-0.5 text-[10px] font-bold text-[#2A5E1F] dark:text-area-pyme">
                    {o.nit}
                  </span>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[17px] font-semibold tabular-nums text-n-1000">
                {o.amount}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                className="inline-flex h-[38px] items-center gap-2 rounded-md bg-gold-500 px-4 text-sm font-semibold text-n-0 transition-all hover:-translate-y-px hover:bg-gold-600 hover:shadow-glow-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0"
              >
                <ActionIcon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {o.primaryAction.label}
              </button>
              <button
                type="button"
                className="inline-flex h-[38px] items-center gap-2 rounded-md border border-gold-500/40 px-4 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              >
                <Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Recordarme
              </button>
            </div>
          </div>
        );
      })}

      {/* Consejo multas */}
      <div className="mt-4 rounded-xl border border-area-pyme/35 bg-area-pyme/[0.09] px-5 py-4">
        <div className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-eyebrow text-[#2A5E1F] dark:text-area-pyme">
          <AlertTriangle className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden="true" />
          Para no perder plata
        </div>
        <p className="text-[15px] leading-relaxed text-n-700">
          Si paga tarde, le cobran un <b>5% de más por cada mes</b> de retraso, más
          intereses. Por ejemplo, $1.180.000 pagados un mes tarde le costarían unos
          $59.000 extra. Por eso le avisamos antes y le decimos cuánto separar.
        </p>
      </div>
    </PymeSubpageShell>
  );
}
