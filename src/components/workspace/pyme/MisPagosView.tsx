'use client';

/**
 * MisPagosView — /workspace/pyme/pagos ("Mis Pagos").
 *
 * Diseño del handoff "Pyme - Mis Pagos.html" en versión HONESTA:
 * - Hero rojo: días hasta el próximo vencimiento DIAN real (no hay registro
 *   de deudas/pagos todavía, así que NO se inventa un monto "debe hoy")
 * - Estado de pagos: próximos vencimientos del calendario oficial verificado
 *   (GET /api/calendar/verified) con rango por dígito de NIT
 * - Balanza "¿Estoy pagando el impuesto correcto?": slider que recalcula
 *   RST vs Ordinario en vivo (useTaxCalculator; tarifas de referencia)
 * - Formularios 300/350/260: marcados "Próximamente" — aún no se generan
 *   borradores con datos reales
 */

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  FileText,
  PiggyBank,
  Save,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaxCalculator } from '@/hooks/useTaxCalculator';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { usePymeDeadlines } from '@/components/workspace/pyme/usePymeData';

// ─── Formato ─────────────────────────────────────────────────────────────────

const pesos = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;
const fmtM = (v: number) => `$${(v / 1e6).toFixed(2).replace('.', ',')}M`;

// ─── Helpers de vencimientos reales ──────────────────────────────────────────

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long' }).format(d);
}

function severityColor(daysUntil: number): string {
  if (daysUntil <= 15) return '#A83838';
  if (daysUntil <= 45) return '#C48A2E';
  return '#357A28';
}

function severityIcon(daysUntil: number): LucideIcon {
  if (daysUntil <= 15) return AlertCircle;
  if (daysUntil <= 45) return Clock;
  return CheckCircle;
}

// Formularios DIAN frecuentes — se generarán con datos reales en una ola
// posterior; mientras tanto se declaran como "Próximamente".
const BORRADORES = [
  { title: 'Formulario 300 — IVA', desc: 'Se llenará automático con sus datos del bimestre.' },
  { title: 'Formulario 350 — Retención en la fuente', desc: 'Se llenará automático con sus datos del mes.' },
  { title: 'Formulario 260 — Régimen Simple', desc: 'Se llenará automático con sus datos del año.' },
];

const SEM_FILL: Record<'verde' | 'amarillo' | 'rojo', string> = {
  verde: 'linear-gradient(90deg, #357A28, #7BC95B)',
  amarillo: '#C48A2E',
  rojo: '#A83838',
};

// ─── Balanza (calculadora RST vs Ordinario) ──────────────────────────────────

function BalanzaCard({
  title,
  value,
  win,
}: {
  title: string;
  value: string;
  win: boolean;
}) {
  return (
    <div
      className={cn(
        'relative rounded-xl border px-5 py-4',
        win ? 'border-area-pyme bg-area-pyme/[0.09]' : 'border-n-200 bg-n-0',
      )}
    >
      {win && (
        <span className="absolute right-3.5 top-3.5 inline-flex items-center gap-1 rounded-full bg-area-pyme px-2.5 py-0.5 text-[10px] font-bold text-white">
          <Check className="h-[11px] w-[11px]" strokeWidth={3} aria-hidden="true" />
          Le conviene
        </span>
      )}
      <div className="text-sm font-bold text-n-1000">{title}</div>
      <div className="mb-1 mt-2 font-mono text-2xl font-semibold tabular-nums text-n-1000">
        {value}
      </div>
      <div className="text-xs text-n-600">Impuesto estimado en el año</div>
    </div>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export function MisPagosView() {
  const [open, setOpen] = useState(false);
  const [monthly, setMonthly] = useState(8_166_000);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const annual = monthly * 12;
  const { rst, ordinario, recommended, comparable, savings, semaforo } = useTaxCalculator(
    annual,
    { group: 'tiendas' },
  );
  // `recommended` es null cuando falta un insumo territorial verificado —la
  // tarifa de ICA la fija cada concejo municipal (Ley 14 de 1983, arts. 32-33)—.
  // Optar por el SIMPLE es IRREVOCABLE durante el año gravable (Art. 909 E.T.),
  // así que en ese caso la pantalla NO señala ganador ni promete ahorro.
  const rstWin = recommended === 'RST';
  const savingsRounded = Math.round(savings / 1000) * 1000;

  // Precarga el último cálculo guardado del workspace (Ola 8 — historial en
  // pyme_tax_calculations). Si nunca guardó, el slider queda en el default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pyme/tax-calculations');
        const json = (await res.json()) as {
          ok: boolean;
          latest?: { annualSalesCop: string; createdAt: string } | null;
        };
        if (cancelled || !json.ok || !json.latest) return;
        const annualSaved = Number(json.latest.annualSalesCop);
        if (Number.isFinite(annualSaved) && annualSaved > 0) {
          setMonthly(Math.min(20_000_000, Math.max(1_000_000, Math.round(annualSaved / 12 / 1000) * 1000)));
          setSavedAt(json.latest.createdAt);
          setOpen(true);
        }
      } catch {
        /* sin historial — estado por defecto */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveCalculation = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/pyme/tax-calculations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annualSalesCop: annual,
          rstGroup: 'tiendas',
          rstCop: rst,
          ordinarioCop: ordinario,
          recommended,
          savingsCop: savings,
          semaforoLevel: semaforo.level,
        }),
      });
      const json = (await res.json()) as { ok: boolean; saved?: { createdAt: string } };
      if (res.ok && json.ok && json.saved) setSavedAt(json.saved.createdAt);
    } finally {
      setSaving(false);
    }
  };

  const year = new Date().getFullYear();
  const { upcoming, loading: deadlinesLoading } = usePymeDeadlines(year);
  const next = upcoming[0] ?? null;
  const visibles = upcoming.slice(0, 3);

  return (
    <PymeSubpageShell>
      {/* Hero rojo — próximo vencimiento real (sin montos inventados:
          no existe registro de deudas/pagos del negocio todavía) */}
      <section className="relative mb-6 overflow-hidden rounded-2xl p-7 text-white shadow-[0_24px_48px_-28px_rgb(74_20_20_/_0.7)] [background:linear-gradient(160deg,#4a1414,#2c0c0c)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px] rounded-full bg-white/[0.06]"
        />
        <div className="relative z-[1]">
          <div className="text-xs font-bold uppercase tracking-eyebrow text-white/75">
            Su próximo vencimiento DIAN
          </div>
          <div className="mb-2 mt-2.5 font-mono text-[clamp(2.6rem,6vw,3.4rem)] font-semibold leading-none tabular-nums">
            {deadlinesLoading ? '…' : next ? `${Math.max(next.daysUntil, 0)} días` : '—'}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {next ? (
              <span className="rounded-full bg-[#FCA5A5]/20 px-3 py-1 text-xs font-semibold text-[#FCA5A5]">
                {next.obligation} · {fmtDay(next.dueDateMin)}
              </span>
            ) : (
              !deadlinesLoading && (
                <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold">
                  Calendario no disponible
                </span>
              )
            )}
            <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold">
              Calendario oficial DIAN
            </span>
          </div>
        </div>
      </section>

      {/* Próximos vencimientos */}
      <h2 className="mb-3.5 font-serif-elite text-2xl font-medium text-n-1000">
        Próximos vencimientos
      </h2>
      {deadlinesLoading ? (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl border border-n-200 bg-n-50" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-area-pyme/30 bg-n-0 px-6 py-8 text-center text-sm text-n-600">
          No pudimos cargar el calendario de vencimientos. Intente de nuevo.
        </div>
      ) : (
        visibles.map((o) => {
          const color = severityColor(o.daysUntil);
          const Icon = severityIcon(o.daysUntil);
          return (
            <div
              key={`${o.obligation}-${o.period}`}
              className="mb-2.5 flex items-center gap-3.5 rounded-xl border border-n-200 bg-n-0 px-4 py-4"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
              >
                <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-n-1000">{o.obligation}</div>
                <div className="mt-0.5 text-xs text-n-600">
                  {o.period} · vence el {fmtDay(o.dueDateMin)}
                  {o.dueDateMax !== o.dueDateMin ? ' (según su NIT)' : ''}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-n-700">
                {o.daysUntil <= 0 ? 'hoy' : `en ${o.daysUntil} días`}
              </span>
            </div>
          );
        })
      )}

      {/* Balanza toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="balanza-panel"
        className="my-4 mt-5 flex w-full items-center gap-3 rounded-xl border border-area-pyme/35 bg-area-pyme/[0.09] px-4 py-4 text-left transition-colors hover:bg-area-pyme/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
      >
        <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-area-pyme text-white">
          <Scale className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="flex-1 text-[15px] font-semibold text-n-1000">
          ¿Estoy pagando el impuesto correcto?
        </span>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-[#2A5E1F] transition-transform duration-200 dark:text-area-pyme',
            open && 'rotate-180',
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id="balanza-panel" className="animate-elite-fade">
          {/* Calculadora */}
          <div className="mb-3.5 rounded-xl border border-area-pyme/35 bg-n-0 px-5 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-n-800">
              <span>Sus ventas al mes</span>
              <span className="font-mono text-[15px] tabular-nums text-[#2A5E1F] dark:text-area-pyme">
                {pesos(monthly)}
              </span>
            </div>
            <input
              type="range"
              min={1_000_000}
              max={20_000_000}
              step={1000}
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
              aria-label="Sus ventas al mes"
              className="mb-1.5 mt-3.5 h-[5px] w-full accent-area-pyme"
            />
            <div className="text-xs text-n-500">
              Al año: <span className="font-mono tabular-nums">{pesos(annual)}</span>
            </div>

            {/* Semáforo */}
            <div className="mt-4">
              <div className="h-2.5 overflow-hidden rounded-full bg-n-100">
                <div
                  className="h-full rounded-full transition-[width,background] duration-200"
                  style={{
                    width: `${Math.min(100, semaforo.pct * 100).toFixed(1)}%`,
                    background: SEM_FILL[semaforo.level],
                  }}
                />
              </div>
              <div className="mt-2 text-sm font-medium text-n-700">{semaforo.message}</div>
              <div className="mt-0.5 text-xs text-n-500">
                Sus ventas: {pesos(annual)} · Tope: {pesos(semaforo.tope)}
              </div>
            </div>
          </div>

          {/* Balanza RST vs Ordinario */}
          <div className="grid grid-cols-1 gap-3.5 min-[521px]:grid-cols-2">
            <BalanzaCard
              title="Régimen Simple (RST)"
              value={fmtM(rst)}
              win={comparable && rstWin}
            />
            <BalanzaCard
              title="Régimen Ordinario"
              value={fmtM(ordinario)}
              win={comparable && !rstWin}
            />
          </div>

          {/* Banner de resultado */}
          {comparable ? (
            <div className="mt-3.5 flex items-center gap-3.5 rounded-xl border border-area-pyme/35 bg-area-pyme/10 px-5 py-4">
              <PiggyBank className="h-6 w-6 shrink-0 text-[#2A5E1F] dark:text-area-pyme" strokeWidth={1.75} aria-hidden="true" />
              <div>
                <div className="text-[17px] font-bold text-[#2A5E1F] dark:text-area-pyme">
                  Usted se ahorra {pesos(savingsRounded)} al año
                </div>
                <div className="mt-0.5 text-sm text-n-700">
                  Quedándose en el Régimen {rstWin ? 'Simple' : 'Ordinario'}. Nosotros le
                  avisamos si eso cambia.
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3.5 flex items-center gap-3.5 rounded-xl border border-n-300 bg-n-100 px-5 py-4">
              <PiggyBank className="h-6 w-6 shrink-0 text-n-600" strokeWidth={1.75} aria-hidden="true" />
              <div>
                <div className="text-[17px] font-bold text-n-1000">
                  Comparación de referencia, no una recomendación
                </div>
                <div className="mt-0.5 text-sm text-n-700">
                  Falta su tarifa de ICA municipal, que fija cada concejo (Ley 14 de 1983,
                  arts. 32-33). Como optar por el Régimen Simple es irrevocable durante todo
                  el año gravable (Art. 909 E.T.), no le señalamos un ganador sin ese dato.
                  Consúltelo con su contador.
                </div>
              </div>
            </div>
          )}

          {/* Guardar en el historial */}
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={saveCalculation}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-area-pyme/40 px-4 text-sm font-semibold text-[#2A5E1F] transition-colors hover:bg-area-pyme/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-area-pyme focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
            >
              <Save className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {saving ? 'Guardando…' : 'Guardar cálculo'}
            </button>
            {savedAt && (
              <span className="text-xs text-n-500">
                Último guardado:{' '}
                {new Intl.DateTimeFormat('es-CO', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(savedAt))}
              </span>
            )}
          </div>

          <p className="mt-3 text-center text-sm italic text-n-500">
            Cálculo estimado con tarifas de referencia — no sustituye la
            liquidación oficial DIAN. Ajuste sus ventas con el deslizador.
          </p>
        </div>
      )}

      {/* Borradores listos */}
      <h2 className="mb-1 mt-7 font-serif-elite text-2xl font-medium text-n-1000">
        Sus formularios
      </h2>
      <p className="mb-3.5 text-sm text-n-600">
        Los llenaremos automáticamente con sus datos — en construcción.
      </p>
      {BORRADORES.map((b) => (
        <div
          key={b.title}
          className="mb-2.5 flex items-center gap-3 rounded-xl border border-n-200 bg-n-0 px-4 py-3.5"
        >
          <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md bg-area-pyme/15 text-[#2A5E1F] dark:text-area-pyme">
            <FileText className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-n-1000">{b.title}</div>
            <div className="mt-0.5 text-xs text-n-600">{b.desc}</div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-area-pyme/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#2A5E1F] dark:text-area-pyme">
            Próximamente
          </span>
        </div>
      ))}
    </PymeSubpageShell>
  );
}
