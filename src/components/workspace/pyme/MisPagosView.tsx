'use client';

/**
 * MisPagosView — /workspace/pyme/pagos ("Mis Pagos").
 *
 * Implementa el handoff "Pyme - Mis Pagos.html":
 * - Hero rojo de deuda ("Lo que debe hoy") con chips de urgencia y régimen
 * - Estado de sus pagos: 3 obligaciones compactas con borde de severidad
 * - Balanza "¿Estoy pagando el impuesto correcto?": slider de ventas que
 *   recalcula RST vs Ordinario en vivo (useTaxCalculator), semáforo fiscal
 *   y banner de ahorro
 * - Borradores listos (formularios 300 / 350 / 260)
 *
 * Montos de obligaciones MOCK (dataset del prototipo); la balanza calcula
 * en vivo con src/lib/tax/taxCalculator (tarifas ilustrativas).
 */

import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronDown,
  Clock,
  Download,
  FileText,
  PiggyBank,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaxCalculator } from '@/hooks/useTaxCalculator';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';

// ─── Formato ─────────────────────────────────────────────────────────────────

const pesos = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;
const fmtM = (v: number) => `$${(v / 1e6).toFixed(2).replace('.', ',')}M`;

// ─── Mock data (dataset del prototipo) ───────────────────────────────────────

interface Obligacion {
  icon: LucideIcon;
  color: string;
  title: string;
  meta: string;
  amount: string;
  paid?: boolean;
}

const OBLIGACIONES: Obligacion[] = [
  {
    icon: AlertCircle,
    color: '#A83838',
    title: 'Pago de empleados (PILA)',
    meta: 'Urgente · vence el 17 de junio · en 9 días',
    amount: '$1.180.000',
  },
  {
    icon: Clock,
    color: '#C48A2E',
    title: 'Anticipo bimestral RST',
    meta: 'Próxima · vence el 19 de julio · en 24 días',
    amount: '$298.000',
  },
  {
    icon: CheckCircle,
    color: '#357A28',
    title: 'Industria y Comercio (ICA)',
    meta: 'Al día · pagado el mes pasado',
    amount: 'Pagado',
    paid: true,
  },
];

const BORRADORES = [
  { title: 'Formulario 300 — IVA', desc: 'Listo con sus datos del bimestre.' },
  { title: 'Formulario 350 — Retención en la fuente', desc: 'Listo con sus datos del mes.' },
  { title: 'Formulario 260 — Régimen Simple', desc: 'Listo con sus datos del año.' },
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

  const annual = monthly * 12;
  const { rst, ordinario, recommended, savings, semaforo } = useTaxCalculator(annual, {
    group: 'tiendas',
  });
  const rstWin = recommended === 'RST';
  const savingsRounded = Math.round(savings / 1000) * 1000;

  return (
    <PymeSubpageShell>
      {/* Hero rojo de deuda */}
      <section className="relative mb-6 overflow-hidden rounded-2xl p-7 text-white shadow-[0_24px_48px_-28px_rgb(74_20_20_/_0.7)] [background:linear-gradient(160deg,#4a1414,#2c0c0c)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px] rounded-full bg-white/[0.06]"
        />
        <div className="relative z-[1]">
          <div className="text-xs font-bold uppercase tracking-eyebrow text-white/75">
            Lo que debe hoy
          </div>
          <div className="mb-2 mt-2.5 font-mono text-[clamp(2.6rem,6vw,3.4rem)] font-semibold leading-none tabular-nums">
            $1.478.000
          </div>
          <div className="flex flex-wrap gap-2.5">
            <span className="rounded-full bg-[#FCA5A5]/20 px-3 py-1 text-xs font-semibold text-[#FCA5A5]">
              Más urgente en 9 días
            </span>
            <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold">
              Régimen Simple (RST)
            </span>
          </div>
        </div>
      </section>

      {/* Estado de sus pagos */}
      <h2 className="mb-3.5 font-serif-elite text-2xl font-medium text-n-1000">
        Estado de sus pagos
      </h2>
      {OBLIGACIONES.map((o) => {
        const Icon = o.icon;
        return (
          <div
            key={o.title}
            className="mb-2.5 flex items-center gap-3.5 rounded-xl border border-n-200 bg-n-0 px-4 py-4"
            style={{ borderLeft: `3px solid ${o.color}` }}
          >
            <span
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
              style={{ background: `color-mix(in srgb, ${o.color} 14%, transparent)`, color: o.color }}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-n-1000">{o.title}</div>
              <div className="mt-0.5 text-xs text-n-600">{o.meta}</div>
            </div>
            <span
              className={cn(
                'shrink-0 font-mono text-[15px] font-semibold tabular-nums',
                o.paid ? 'text-[#2A5E1F] dark:text-area-pyme' : 'text-n-1000',
              )}
            >
              {o.amount}
            </span>
          </div>
        );
      })}

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
            <BalanzaCard title="Régimen Simple (RST)" value={fmtM(rst)} win={rstWin} />
            <BalanzaCard title="Régimen Ordinario" value={fmtM(ordinario)} win={!rstWin} />
          </div>

          {/* Banner de ahorro */}
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

          <p className="mt-3 text-center text-sm italic text-n-500">
            Este cálculo usa sus ventas y pagos reales — se actualiza solo.
          </p>
        </div>
      )}

      {/* Borradores listos */}
      <h2 className="mb-1 mt-7 font-serif-elite text-2xl font-medium text-n-1000">
        Borradores listos
      </h2>
      <p className="mb-3.5 text-sm text-n-600">
        Ya los llenamos con sus datos — solo revíselos.
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
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-[#2A5E1F] transition-colors hover:text-area-pyme dark:text-area-pyme focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme rounded-sm"
          >
            Descargar
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
    </PymeSubpageShell>
  );
}
