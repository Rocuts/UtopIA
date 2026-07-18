'use client';

/**
 * /workspace/alertas — Sentinel · Centro de Alertas (WS6.1).
 *
 * Full client component implementing the Alertas design:
 * - Page header with bell-ring eyebrow, h1, subtitle
 * - Filter chips bar (Todas, Escudo, Valor, Verdad, Futuro)
 * - Two-column layout: alert inbox (left) + subscriptions panel (right)
 * - Alert cards with left accent border per area color
 * - Toggle switches for subscription management
 */

import { useState } from 'react';
import {
  BellRing,
  AlertTriangle,
  TrendingDown,
  FileWarning,
  Scale,
  Compass,
  Shield,
  TrendingUp,
  Info,
  CheckCircle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type AreaKey = 'escudo' | 'valor' | 'verdad' | 'futuro';
type FilterKey = 'todas' | AreaKey;

interface AlertItem {
  id: string;
  icon: React.ReactNode;
  color: string;
  tag: string;
  area: AreaKey;
  title: string;
  description: string;
  timestamp: string;
}

interface SubItem {
  id: string;
  name: string;
  description: string;
  on: boolean;
}

// ─── Data ────────────────────────────────────────────────────────────────────

const AREA_COLORS: Record<AreaKey, string> = {
  escudo: '#A83838',
  valor: '#B8934A',
  verdad: '#3D6B7E',
  futuro: '#5A7F7A',
};

const ALERTS: AlertItem[] = [
  {
    id: 'a1',
    icon: <AlertTriangle size={18} />,
    color: '#A83838',
    tag: 'Crítica',
    area: 'escudo',
    title: 'Renta Grandes Contribuyentes — Cuota 3',
    description:
      'NIT dígito 7 · vence en 6 días. Base: Art. 591 E.T., Decreto 2229 de 2023.',
    timestamp: 'Hace 2 h',
  },
  {
    id: 'a2',
    icon: <AlertTriangle size={18} />,
    color: '#A83838',
    tag: 'Crítica',
    area: 'escudo',
    title: 'Retención en la Fuente — Mayo 2026',
    description:
      'NIT dígito 7 · vence en 6 días. Plazo entre el 7º y 16º día hábil.',
    timestamp: 'Hace 2 h',
  },
  {
    id: 'a3',
    icon: <TrendingDown size={18} />,
    color: '#A83838',
    tag: 'Riesgo',
    area: 'escudo',
    title: 'TEF por encima del sector',
    description:
      'Su tasa efectiva (28,4%) supera la mediana del sector en 3,1 pts.',
    timestamp: 'Hoy',
  },
  {
    id: 'a4',
    icon: <FileWarning size={18} />,
    color: '#B8934A',
    tag: 'Oportunidad',
    area: 'valor',
    title: 'Saldo a favor IVA sin radicar',
    description: 'Tiene $1.240M en saldos a favor listos para devolución.',
    timestamp: 'Ayer',
  },
  {
    id: 'a5',
    icon: <Scale size={18} />,
    color: '#3D6B7E',
    tag: 'Aviso',
    area: 'verdad',
    title: 'Dictamen de control interno',
    description:
      '2 hallazgos menores pendientes de subsanar antes del cierre.',
    timestamp: 'Ayer',
  },
  {
    id: 'a6',
    icon: <Compass size={18} />,
    color: '#5A7F7A',
    tag: 'Insight',
    area: 'futuro',
    title: 'Runway sensible a la TRM',
    description:
      'Un alza de TRM a $4.300 reduce el runway base de 28 a 24 meses.',
    timestamp: '2 días',
  },
];

const INITIAL_SUBS: SubItem[] = [
  {
    id: 's1',
    name: 'Vencimientos tributarios',
    description: 'Renta, IVA, retenciones, PILA',
    on: true,
  },
  {
    id: 's2',
    name: 'Cambios normativos DIAN',
    description: 'Nueva doctrina y decretos',
    on: true,
  },
  {
    id: 's3',
    name: 'Hallazgos de auditoría',
    description: 'Dictámenes y control interno',
    on: true,
  },
  {
    id: 's4',
    name: 'Alertas de valor',
    description: 'Cambios en EBITDA, WACC, DCF',
    on: false,
  },
  {
    id: 's5',
    name: 'Escenarios y macro',
    description: 'TRM, inflación, runway',
    on: true,
  },
  {
    id: 's6',
    name: 'Resumen semanal',
    description: 'Digest cada lunes 7 a.m.',
    on: false,
  },
];

const FILTER_LABELS: { key: FilterKey; label: string; dot?: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'escudo', label: 'Escudo', dot: '#A83838' },
  { key: 'valor', label: 'Valor', dot: '#B8934A' },
  { key: 'verdad', label: 'Verdad', dot: '#3D6B7E' },
  { key: 'futuro', label: 'Futuro', dot: '#5A7F7A' },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function ToggleSwitch({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="relative flex-shrink-0 cursor-pointer rounded-full border-none outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-n-700"
      style={{
        width: 42,
        height: 24,
        background: on ? '#B8934A' : 'var(--color-n-300, #d4d4d4)',
        transition: 'background 150ms ease',
      }}
    >
      <span
        className="absolute top-0.5 rounded-full bg-white shadow"
        style={{
          width: 20,
          height: 20,
          left: on ? 20 : 2,
          transition: 'left 150ms cubic-bezier(0.34,1.56,0.64,1)',
        }}
      />
    </button>
  );
}

function AlertCard({ alert }: { alert: AlertItem }) {
  return (
    <div
      className="flex gap-3.5 rounded-lg border border-n-200 bg-n-0 px-4 py-4 cursor-pointer transition-all duration-150 hover:shadow-md"
      style={{ borderLeft: `3px solid ${alert.color}` }}
    >
      {/* Icon container */}
      <div
        className="flex-shrink-0 flex items-center justify-center rounded-md"
        style={{
          width: 38,
          height: 38,
          background: `color-mix(in srgb, ${alert.color} 14%, transparent)`,
          color: alert.color,
        }}
      >
        {alert.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-n-1000 leading-snug">
          {alert.title}
        </p>
        <p className="text-xs text-n-600 mt-0.5 leading-snug">
          {alert.description}
        </p>
        <div className="flex items-center gap-2.5 mt-2">
          {/* Tag chip */}
          <span
            className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
            style={{
              background: `color-mix(in srgb, ${alert.color} 12%, transparent)`,
              color: alert.color,
            }}
          >
            {alert.tag}
          </span>
          <span className="text-xs text-n-500">{alert.timestamp}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AlertasPage() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('todas');
  const [subs, setSubs] = useState<SubItem[]>(INITIAL_SUBS);

  const filteredAlerts =
    activeFilter === 'todas'
      ? ALERTS
      : ALERTS.filter((a) => a.area === activeFilter);

  const criticalCount = ALERTS.filter((a) => a.tag === 'Crítica').length;

  function toggleSub(id: string) {
    setSubs((prev) =>
      prev.map((s) => (s.id === id ? { ...s, on: !s.on } : s))
    );
  }

  return (
    <main className="min-h-screen bg-n-0 px-6 py-10 md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        {/* ── Page Header ─────────────────────────────────────────────── */}
        <div className="pb-6">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 mb-3">
            <span
              className="flex items-center justify-center rounded-md"
              style={{
                width: 30,
                height: 30,
                background: 'linear-gradient(140deg, #B8934A, #8C6830)',
                color: '#fff',
              }}
            >
              <BellRing size={16} />
            </span>
            <span className="text-sm font-bold" style={{ color: '#8C6830' }}>
              Sentinel · Inteligencia de alertas
            </span>
          </div>

          <h1 className="font-serif-elite font-medium tracking-tight text-n-1000"
            style={{ fontSize: 'clamp(2.2rem, 4vw, 3rem)', lineHeight: 1.15 }}>
            Centro de Alertas
          </h1>

          <p className="text-base text-n-600 mt-2 max-w-2xl">
            Vencimientos, hallazgos e insights detectados por la IA —
            filtrados por área y severidad.
          </p>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2 mt-5">
            {FILTER_LABELS.map(({ key, label, dot }) => {
              const isOn = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(key)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-150"
                  style={
                    isOn
                      ? {
                          background: 'var(--color-n-900, #1a1a1a)',
                          color: 'var(--color-n-0, #fff)',
                          borderColor: 'var(--color-n-900, #1a1a1a)',
                        }
                      : {
                          background: 'var(--color-n-0, #fff)',
                          color: 'var(--color-n-700, #404040)',
                          borderColor: 'var(--color-n-200, #e5e5e5)',
                        }
                  }
                >
                  {dot && (
                    <span
                      className="rounded-full flex-shrink-0"
                      style={{ width: 7, height: 7, background: dot }}
                    />
                  )}
                  {label}
                  {key === 'todas' && (
                    <span
                      className="ml-0.5"
                      style={{ color: isOn ? 'rgba(255,255,255,0.55)' : 'var(--color-n-400, #a3a3a3)' }}
                    >
                      {ALERTS.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Two-column layout ───────────────────────────────────────── */}
        <div
          className="grid gap-5 items-start pt-2"
          style={{ gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)' }}
        >
          {/* LEFT — Alert inbox */}
          <section>
            {/* Section header */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-n-900">
                Bandeja de insights
              </span>
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{
                  background: 'color-mix(in srgb, #B8934A 14%, transparent)',
                  color: '#8C6830',
                }}
              >
                {/* live dot */}
                <span
                  className="rounded-full animate-pulse"
                  style={{
                    width: 6,
                    height: 6,
                    background: '#A83838',
                    display: 'inline-block',
                  }}
                />
                {criticalCount} críticas
              </span>
            </div>

            <div className="space-y-2.5">
              {filteredAlerts.length === 0 ? (
                <p className="text-sm text-n-500 py-8 text-center">
                  No hay alertas en esta categoría.
                </p>
              ) : (
                filteredAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))
              )}
            </div>
          </section>

          {/* RIGHT — Subscriptions panel */}
          <aside
            className="rounded-xl border bg-n-0 px-5 py-5"
            style={{
              borderColor: 'color-mix(in srgb, #B8934A 25%, transparent)',
              position: 'sticky',
              top: 84,
            }}
          >
            <h3 className="font-serif-elite font-medium text-xl text-n-1000 mb-1">
              Suscripciones
            </h3>
            <p className="text-sm text-n-600 mb-4">
              Elija qué le avisa Sentinel y por qué canal.
            </p>

            <div>
              {subs.map((sub, idx) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between gap-3 py-3"
                  style={
                    idx > 0
                      ? { borderTop: '1px solid var(--color-n-100, #f5f5f5)' }
                      : undefined
                  }
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-n-900 leading-snug">
                      {sub.name}
                    </p>
                    <p className="text-xs text-n-500 mt-0.5">{sub.description}</p>
                  </div>
                  <ToggleSwitch
                    on={sub.on}
                    onToggle={() => toggleSub(sub.id)}
                  />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
