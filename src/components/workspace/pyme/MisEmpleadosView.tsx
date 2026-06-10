'use client';

/**
 * MisEmpleadosView — /workspace/pyme/empleados ("Mis Empleados").
 *
 * Implementa el handoff "Pyme - Mis Empleados.html":
 * - Hero verde con métricas (Personas / Nómina al mes / Carga prestacional)
 * - Banner PILA (próximo pago de seguridad social) con CTA Pagar
 * - "Su equipo": tarjetas expandibles por empleado (salario, EPS, AFP, ARL
 *   y costo total mensual con prestaciones)
 * - Alerta roja de trabajador sin afiliar + CTA Formalizar
 * - "Usted como dueño": tarjeta abierta con el desglose del aporte como
 *   independiente (base 40%)
 * - Botón punteado "Agregar empleado"
 *
 * Datos MOCK (dataset del prototipo) — wiring real en una ola posterior.
 */

import { useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  Plus,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';

// ─── Mock data (dataset del prototipo) ───────────────────────────────────────

interface DetailChip {
  label: string;
  value: string;
  total?: boolean;
}

interface Empleado {
  initials: string;
  name: string;
  role: string;
  detail: DetailChip[];
}

const EMPLEADOS: Empleado[] = [
  {
    initials: 'MG',
    name: 'María Gómez',
    role: 'Vendedora · contrato a término fijo',
    detail: [
      { label: 'Salario', value: '$1.750.905' },
      { label: 'EPS', value: 'Sura' },
      { label: 'AFP (pensión)', value: 'Porvenir' },
      { label: 'ARL', value: 'Positiva · riesgo I' },
      { label: 'Lo que le cuesta al mes (con prestaciones)', value: '$2.640.000', total: true },
    ],
  },
  {
    initials: 'JR',
    name: 'Jorge Ruiz',
    role: 'Bodega · contrato a término indefinido',
    detail: [
      { label: 'Salario', value: '$1.750.905' },
      { label: 'EPS', value: 'Nueva EPS' },
      { label: 'AFP (pensión)', value: 'Colfondos' },
      { label: 'ARL', value: 'Positiva · riesgo II' },
      { label: 'Lo que le cuesta al mes (con prestaciones)', value: '$2.640.000', total: true },
    ],
  },
];

const DUENO_DETAIL: DetailChip[] = [
  { label: 'Ingreso mensual estimado', value: '$1.860.000' },
  { label: 'Base de cotización (40%)', value: '$744.000' },
  { label: 'Salud', value: '$94.000' },
  { label: 'Pensión', value: '$120.000' },
  { label: 'Su aporte mensual total', value: '$298.000', total: true },
];

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function DetailGrid({ chips }: { chips: DetailChip[] }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2">
      {chips.map((c) => (
        <div
          key={c.label}
          className={cn(
            'rounded-md border px-3.5 py-3',
            c.total
              ? 'border-area-pyme/35 bg-area-pyme/[0.09] min-[460px]:col-span-2'
              : 'border-n-200 bg-n-50',
          )}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-n-500">
            {c.label}
          </div>
          <div
            className={cn(
              'mt-1 text-sm font-semibold',
              c.total
                ? 'font-mono text-[17px] tabular-nums text-[#2A5E1F] dark:text-area-pyme'
                : 'text-n-900',
            )}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmpleadoCard({ emp }: { emp: Empleado }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'mb-3 rounded-xl border bg-n-0 px-4 py-4 transition-colors',
        open ? 'border-area-pyme/40' : 'border-n-200',
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-area-pyme to-[#2A5E1F] font-bold text-white">
          {emp.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-n-1000">{emp.name}</div>
          <div className="mt-0.5 text-xs text-n-600">{emp.role}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-area-pyme/15 px-3.5 py-2 text-sm font-semibold text-[#2A5E1F] transition-colors hover:bg-area-pyme/25 dark:text-area-pyme focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
        >
          Ver detalle
          <ChevronDown
            className={cn('h-[15px] w-[15px] transition-transform duration-200', open && 'rotate-180')}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>
      {open && (
        <div className="animate-elite-fade mt-4 border-t border-n-100 pt-4">
          <DetailGrid chips={emp.detail} />
        </div>
      )}
    </div>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export function MisEmpleadosView() {
  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mis Empleados"
        subtitle="Lo que le cuesta cada persona y cuándo pagar su salud y pensión."
        metrics={[
          { value: '3', label: 'Personas' },
          { value: '$5.4M', label: 'Nómina al mes' },
          { value: '52%', label: 'Carga prestacional', tone: 'green' },
        ]}
      />

      {/* Banner PILA */}
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-[#E6B66A]/45 bg-[#E6B66A]/15 px-5 py-4">
        <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-md bg-[#C48A2E] text-white">
          <CalendarClock className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-n-1000">
            Próximo pago de seguridad social (PILA)
          </div>
          <div className="mt-0.5 text-sm text-n-700">
            Vence el 17 de junio · en 9 días ·{' '}
            <span className="font-mono font-semibold tabular-nums">$1.180.000</span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-gold-500 px-5 text-sm font-semibold text-n-0 transition-all hover:-translate-y-px hover:bg-gold-600 hover:shadow-glow-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0"
        >
          Pagar
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Su equipo */}
      <h2 className="mb-3.5 font-serif-elite text-2xl font-medium text-n-1000">Su equipo</h2>
      {EMPLEADOS.map((emp) => (
        <EmpleadoCard key={emp.name} emp={emp} />
      ))}

      {/* Alerta informal */}
      <div className="mb-3 flex items-start gap-3.5 rounded-xl border border-danger/30 bg-danger/[0.06] px-5 py-4">
        <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md bg-danger/15 text-danger">
          <ShieldAlert className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-danger">
            Pedro tiene un ayudante sin afiliar
          </div>
          <div className="mt-1 text-sm leading-snug text-n-700">
            Trabajar sin EPS, pensión ni ARL es un riesgo legal y económico grave para
            usted. Si se accidenta, le toca responder de su bolsillo. Le ayudamos a
            formalizarlo paso a paso.
          </div>
          <button
            type="button"
            className="mt-3.5 inline-flex h-[38px] items-center gap-2 rounded-md bg-danger px-4 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-n-0"
          >
            <UserCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Formalizar ahora
          </button>
        </div>
      </div>

      {/* Usted como dueño */}
      <h2 className="mb-3.5 mt-6 font-serif-elite text-2xl font-medium text-n-1000">
        Usted como dueño
      </h2>
      <div className="mb-3 rounded-xl border border-area-pyme/40 bg-n-0 px-4 py-4">
        <div className="flex items-center gap-3.5">
          <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-area-pyme to-[#2A5E1F] font-bold text-white">
            DC
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-n-1000">Don Carlos · dueño</div>
            <div className="mt-0.5 text-xs text-n-600">
              Cotiza como independiente · base del 40% de su ingreso
            </div>
          </div>
          <span className="shrink-0 font-mono font-semibold tabular-nums text-[#2A5E1F] dark:text-area-pyme">
            $298.000
          </span>
        </div>
        <div className="mt-4 border-t border-n-100 pt-4">
          <DetailGrid chips={DUENO_DETAIL} />
        </div>
      </div>

      {/* Agregar empleado */}
      <button
        type="button"
        className="mt-1.5 flex h-[50px] w-full items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-area-pyme/40 bg-area-pyme/[0.09] text-[15px] font-semibold text-[#2A5E1F] transition-colors hover:bg-area-pyme/[0.14] dark:text-area-pyme focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        Agregar empleado
      </button>
    </PymeSubpageShell>
  );
}
