'use client';

/**
 * MisEmpleadosView — /workspace/pyme/empleados ("Mis Empleados").
 *
 * Diseño del handoff "Pyme - Mis Empleados.html" sobre datos REALES (Ola 8):
 * - GET/POST /api/pyme/empleados — nómina del workspace con desglose de
 *   costo calculado en runtime (src/lib/payroll, factores legales citados)
 * - Hero: personas activas, nómina mensual y carga prestacional reales
 * - Banner PILA: total mensual real de seguridad social + parafiscales
 * - Tarjetas expandibles por persona (salario, EPS/AFP/ARL, costo total)
 * - Sección "Usted como dueño" (independiente, base 40%) cuando existe
 * - Alta de personas con formulario inline; retiro lógico (DELETE)
 *
 * Art. 114-1 E.T. (auditoría 2026-09, contab-nomina-19): la exoneración de
 * salud/SENA/ICBF depende de la condición del EMPLEADOR, que se declara aquí
 * (GET/PUT /api/pyme/empleador). Sin declararla se liquida sin exoneración y
 * se muestra el ahorro potencial; la etiqueta «exonerado 114-1» sólo aparece
 * con estado 'aplicada'. El salario integral (≥ 13 SMMLV) se marca al crear o
 * en el detalle de la persona.
 *
 * Honestidad: los valores son ESTIMACIONES (sin auxilio de transporte,
 * horas extra ni retención) y la UI lo declara. Sin personas registradas
 * se muestra el estado vacío con el formulario, nunca gente inventada.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { formatPesosInteger } from '@/lib/format/cop';
import {
  SALARIO_INTEGRAL_MIN_COP,
  employerSelectValue,
  estado114Text,
  parseEmployerSelect,
  salarioIntegralInvalido,
} from '@/components/workspace/pyme/empleados-display';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';
import type {
  AporteIndependienteBreakdown,
  CostoEmpleadoBreakdown,
} from '@/lib/payroll/prestaciones';

// ─── Tipos del wire (shape de /api/pyme/empleados) ───────────────────────────

interface EmpleadoWire {
  empleado: {
    id: string;
    nombre: string;
    tipo: 'empleado' | 'dueno';
    cargo: string | null;
    tipoContrato: string | null;
    salarioCop: number;
    salarioIntegral?: boolean | null;
    eps: string | null;
    afp: string | null;
    arl: string | null;
    arlClase: number | null;
  };
  costo:
    | { kind: 'empleado'; data: CostoEmpleadoBreakdown }
    | { kind: 'dueno'; data: AporteIndependienteBreakdown };
}

const cop = (n: number) => `$${formatPesosInteger(Math.round(n))}`;

const copM = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`
    : cop(n);

const CONTRATO_LABEL: Record<string, string> = {
  fijo: 'contrato a término fijo',
  indefinido: 'contrato a término indefinido',
  obra_labor: 'contrato por obra o labor',
};

function initials(nombre: string): string {
  return nombre
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ─── Detail grid (desglose del costo) ────────────────────────────────────────

function Chip({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-md border px-3.5 py-3',
        total
          ? 'border-area-pyme/35 bg-area-pyme/[0.09] min-[460px]:col-span-2'
          : 'border-n-200 bg-n-50',
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-n-500">{label}</div>
      <div
        className={cn(
          'mt-1 text-sm font-semibold',
          total
            ? 'font-mono text-[17px] tabular-nums text-[#2A5E1F] dark:text-area-pyme'
            : 'text-n-900',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmpleadoDetail({ item, onChanged }: { item: EmpleadoWire; onChanged: () => void }) {
  const { t } = useLanguage();
  const et = t.pyme.empleados;
  const e = item.empleado;
  const [integralSaving, setIntegralSaving] = useState(false);
  const [integralError, setIntegralError] = useState<string | null>(null);

  if (item.costo.kind === 'dueno') {
    const d = item.costo.data;
    return (
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2">
          <Chip label="Ingreso mensual estimado" value={cop(d.ingresoMensualCop)} />
          <Chip label="Base de cotización (40%, piso 1 SMMLV)" value={cop(d.baseCotizacionCop)} />
          <Chip label="Salud (12,5%)" value={cop(d.saludCop)} />
          <Chip label="Pensión (16%)" value={cop(d.pensionCop)} />
          <Chip
            label={et.fspLabel}
            value={d.fondoSolidaridadCop == null ? et.notAvailable : cop(d.fondoSolidaridadCop)}
          />
          <Chip label="Su aporte mensual total" value={cop(d.totalMensualCop)} total />
        </div>
        {d.totalIncompleto && (
          <p className="text-xs font-semibold text-n-800">{et.totalIncompleto}</p>
        )}
        {d.notas.length > 0 && (
          <div className="rounded-md border border-n-200 bg-n-50 px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-n-600">
              {et.notasTitle}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-n-700">
              {d.notas.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  const d = item.costo.data;

  const toggleIntegral = async (checked: boolean) => {
    if (salarioIntegralInvalido('empleado', e.salarioCop, checked)) {
      setIntegralError(et.salarioIntegralMin.replace('{min}', cop(SALARIO_INTEGRAL_MIN_COP)));
      return;
    }
    setIntegralSaving(true);
    setIntegralError(null);
    try {
      const res = await fetch(`/api/pyme/empleados/${e.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salarioIntegral: checked }),
      });
      if (!res.ok) throw new Error('patch_failed');
      onChanged();
    } catch {
      setIntegralError(et.salarioIntegralSaveError);
    } finally {
      setIntegralSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
    <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2">
      <Chip label="Salario" value={cop(d.salarioCop)} />
      <Chip label="EPS" value={e.eps ?? '—'} />
      <Chip label="AFP (pensión)" value={e.afp ?? '—'} />
      <Chip
        label="ARL"
        value={`${e.arl ?? '—'} · riesgo ${['I', 'II', 'III', 'IV', 'V'][(e.arlClase ?? 1) - 1]}`}
      />
      <Chip label="Aporte PILA mensual (SS + parafiscales)" value={cop(d.pensionCop + d.saludCop + d.arlCop + d.cajaCop + d.senaCop + d.icbfCop)} />
      <Chip label="Prestaciones provisionadas / mes" value={cop(d.primaCop + d.cesantiasCop + d.interesesCesantiasCop + d.vacacionesCop)} />
      <Chip
        label={`Lo que le cuesta al mes (estimado${
          d.exoneracion114_1Estado === 'aplicada' ? ` · ${et.exoneradoTag}` : ''
        })`}
        value={cop(d.totalMensualCop)}
        total
      />
    </div>
      <p className="text-xs leading-snug text-n-700">
        {estado114Text(d.exoneracion114_1Estado, d.ahorroPotencial114_1Cop, et, cop)}
      </p>
      <label className="flex items-start gap-2 text-xs text-n-800">
        <input
          type="checkbox"
          checked={e.salarioIntegral === true}
          disabled={integralSaving}
          onChange={(ev) => void toggleIntegral(ev.target.checked)}
          className="mt-0.5 h-4 w-4 accent-area-pyme"
        />
        <span>
          <span className="font-semibold">{et.salarioIntegral}</span>
          <span className="block text-n-600">{et.salarioIntegralHelp}</span>
        </span>
      </label>
      {integralError && <p className="text-xs text-danger">{integralError}</p>}
    </div>
  );
}

// ─── Formulario de alta ──────────────────────────────────────────────────────

interface FormState {
  nombre: string;
  tipo: 'empleado' | 'dueno';
  cargo: string;
  tipoContrato: 'fijo' | 'indefinido' | 'obra_labor';
  salarioCop: string;
  salarioIntegral: boolean;
  eps: string;
  afp: string;
  arl: string;
  arlClase: number;
}

const EMPTY_FORM: FormState = {
  nombre: '',
  tipo: 'empleado',
  cargo: '',
  tipoContrato: 'fijo',
  salarioCop: '',
  salarioIntegral: false,
  eps: '',
  afp: '',
  arl: '',
  arlClase: 1,
};

const INPUT_CLS =
  'h-11 w-full rounded-md border border-n-200 bg-n-0 px-3.5 text-sm text-n-900 placeholder:text-n-400 focus:outline-none focus:border-area-pyme focus:ring-2 focus:ring-area-pyme/15';
const LABEL_CLS =
  'mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-n-600';

function AddForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const et = t.pyme.empleados;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const salario = Number(form.salarioCop.replace(/[^\d]/g, ''));
    if (!salario || salario <= 0) {
      setError('Escriba el salario o ingreso mensual en pesos.');
      return;
    }
    if (salarioIntegralInvalido(form.tipo, salario, form.tipo === 'empleado' && form.salarioIntegral)) {
      setError(et.salarioIntegralMin.replace('{min}', cop(SALARIO_INTEGRAL_MIN_COP)));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/pyme/empleados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          tipo: form.tipo,
          cargo: form.cargo.trim() || undefined,
          tipoContrato: form.tipo === 'empleado' ? form.tipoContrato : undefined,
          salarioCop: salario,
          salarioIntegral: form.tipo === 'empleado' ? form.salarioIntegral : false,
          eps: form.eps.trim() || undefined,
          afp: form.afp.trim() || undefined,
          arl: form.tipo === 'empleado' ? form.arl.trim() || undefined : undefined,
          arlClase: form.tipo === 'empleado' ? form.arlClase : undefined,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'request_failed');
      setForm(EMPTY_FORM);
      onCreated();
    } catch {
      setError('No se pudo guardar. Revise los datos e intente de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mb-3 rounded-xl border border-area-pyme/35 bg-area-pyme/[0.05] px-5 py-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-n-1000">Agregar persona</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          className="rounded-md p-1.5 text-n-500 transition-colors hover:bg-n-100 hover:text-n-1000"
        >
          <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 min-[521px]:grid-cols-2">
        <div>
          <label className={LABEL_CLS} htmlFor="emp-nombre">Nombre completo</label>
          <input
            id="emp-nombre"
            required
            value={form.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            placeholder="María Gómez"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="emp-tipo">Tipo</label>
          <select
            id="emp-tipo"
            value={form.tipo}
            onChange={(e) => set('tipo', e.target.value as FormState['tipo'])}
            className={INPUT_CLS}
          >
            <option value="empleado">Empleado (contrato laboral)</option>
            <option value="dueno">Dueño (independiente, base 40%)</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="emp-salario">
            {form.tipo === 'dueno' ? 'Ingreso mensual estimado (COP)' : 'Salario mensual (COP)'}
          </label>
          <input
            id="emp-salario"
            required
            inputMode="numeric"
            value={form.salarioCop}
            onChange={(e) => set('salarioCop', e.target.value)}
            placeholder="1.750.905"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS} htmlFor="emp-cargo">Cargo (opcional)</label>
          <input
            id="emp-cargo"
            value={form.cargo}
            onChange={(e) => set('cargo', e.target.value)}
            placeholder="Vendedora"
            className={INPUT_CLS}
          />
        </div>

        {form.tipo === 'empleado' && (
          <>
            <div>
              <label className={LABEL_CLS} htmlFor="emp-contrato">Tipo de contrato</label>
              <select
                id="emp-contrato"
                value={form.tipoContrato}
                onChange={(e) => set('tipoContrato', e.target.value as FormState['tipoContrato'])}
                className={INPUT_CLS}
              >
                <option value="fijo">Término fijo</option>
                <option value="indefinido">Término indefinido</option>
                <option value="obra_labor">Obra o labor</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="emp-arlclase">Clase de riesgo ARL</label>
              <select
                id="emp-arlclase"
                value={form.arlClase}
                onChange={(e) => set('arlClase', Number(e.target.value))}
                className={INPUT_CLS}
              >
                <option value={1}>I — oficinas y comercio (0,522%)</option>
                <option value={2}>II — manufactura liviana (1,044%)</option>
                <option value={3}>III — manufactura media (2,436%)</option>
                <option value={4}>IV — transporte y afines (4,350%)</option>
                <option value={5}>V — alto riesgo (6,960%)</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="emp-eps">EPS (opcional)</label>
              <input id="emp-eps" value={form.eps} onChange={(e) => set('eps', e.target.value)} placeholder="Sura" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="emp-afp">AFP (opcional)</label>
              <input id="emp-afp" value={form.afp} onChange={(e) => set('afp', e.target.value)} placeholder="Porvenir" className={INPUT_CLS} />
            </div>
            <div className="min-[521px]:col-span-2">
              <label className="flex items-start gap-2 text-sm text-n-800" htmlFor="emp-integral">
                <input
                  id="emp-integral"
                  type="checkbox"
                  checked={form.salarioIntegral}
                  onChange={(e) => set('salarioIntegral', e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-area-pyme"
                />
                <span>
                  <span className="font-semibold">{et.salarioIntegral}</span>
                  <span className="block text-xs text-n-600">{et.salarioIntegralHelp}</span>
                </span>
              </label>
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="emp-arl">ARL (opcional)</label>
              <input id="emp-arl" value={form.arl} onChange={(e) => set('arl', e.target.value)} placeholder="Positiva" className={INPUT_CLS} />
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-area-pyme px-5 text-[15px] font-semibold text-white transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}

// ─── Tarjeta de persona ──────────────────────────────────────────────────────

function PersonaCard({
  item,
  onRemoved,
}: {
  item: EmpleadoWire;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(item.empleado.tipo === 'dueno');
  const [removing, setRemoving] = useState(false);
  const e = item.empleado;

  const total =
    item.costo.kind === 'dueno'
      ? item.costo.data.totalMensualCop
      : item.costo.data.totalMensualCop;

  const remove = async () => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/pyme/empleados/${e.id}`, { method: 'DELETE' });
      if (res.ok) onRemoved();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className={cn(
        'mb-3 rounded-xl border bg-n-0 px-4 py-4 transition-colors',
        open ? 'border-area-pyme/40' : 'border-n-200',
      )}
    >
      <div className="flex items-center gap-3.5">
        <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-area-pyme to-[#2A5E1F] font-bold text-white">
          {initials(e.nombre)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-n-1000">
            {e.nombre}
            {e.tipo === 'dueno' && ' · dueño'}
          </div>
          <div className="mt-0.5 text-xs text-n-600">
            {e.tipo === 'dueno'
              ? 'Cotiza como independiente · base del 40% de su ingreso'
              : [e.cargo, e.tipoContrato ? CONTRATO_LABEL[e.tipoContrato] : null]
                  .filter(Boolean)
                  .join(' · ') || 'Empleado'}
          </div>
        </div>
        <span className="hidden shrink-0 font-mono text-sm font-semibold tabular-nums text-[#2A5E1F] dark:text-area-pyme min-[460px]:inline">
          {cop(total)}
        </span>
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
          <EmpleadoDetail item={item} onChanged={onRemoved} />
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="mt-3.5 inline-flex items-center gap-1.5 rounded-md border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/[0.06] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {removing ? 'Retirando…' : 'Retirar del registro'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export function MisEmpleadosView() {
  const { t } = useLanguage();
  const et = t.pyme.empleados;
  const [items, setItems] = useState<EmpleadoWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [empleador114_1, setEmpleador114_1] = useState<boolean | null>(null);
  const [empleadorSaving, setEmpleadorSaving] = useState(false);
  const [empleadorError, setEmpleadorError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pyme/empleados');
      const json = (await res.json()) as {
        ok: boolean;
        empleados?: EmpleadoWire[];
        empleador114_1?: boolean | null;
      };
      setItems(json.ok && json.empleados ? json.empleados : []);
      if (json.ok) setEmpleador114_1(json.empleador114_1 ?? null);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveEmpleador = async (value: boolean | null) => {
    setEmpleadorSaving(true);
    setEmpleadorError(null);
    try {
      const res = await fetch('/api/pyme/empleador', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiario114_1: value }),
      });
      const json = (await res.json()) as { ok: boolean; beneficiario114_1?: boolean | null };
      if (!res.ok || !json.ok) throw new Error('empleador_failed');
      setEmpleador114_1(json.beneficiario114_1 ?? null);
      await load();
    } catch {
      setEmpleadorError(et.employerError);
    } finally {
      setEmpleadorSaving(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const empleados = items.filter((i) => i.empleado.tipo === 'empleado');
  const duenos = items.filter((i) => i.empleado.tipo === 'dueno');

  const nominaMensual = empleados.reduce((s, i) => s + i.empleado.salarioCop, 0);
  const cargaPromedio =
    empleados.length > 0
      ? empleados.reduce(
          (s, i) => s + (i.costo.kind === 'empleado' ? i.costo.data.cargaPct : 0),
          0,
        ) / empleados.length
      : null;
  const pilaTotal = empleados.reduce(
    (s, i) =>
      s +
      (i.costo.kind === 'empleado'
        ? i.costo.data.pensionCop +
          i.costo.data.saludCop +
          i.costo.data.arlCop +
          i.costo.data.cajaCop +
          i.costo.data.senaCop +
          i.costo.data.icbfCop
        : 0),
    0,
  );

  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mis Empleados"
        subtitle="Lo que le cuesta cada persona y cuándo pagar su salud y pensión."
        metrics={[
          { value: loading ? '…' : String(empleados.length), label: 'Personas' },
          {
            value: loading ? '…' : nominaMensual > 0 ? copM(nominaMensual) : '—',
            label: 'Nómina al mes',
          },
          {
            value:
              loading || cargaPromedio === null
                ? '—'
                : `${Math.round(cargaPromedio * 100)}%`,
            label: 'Carga prestacional (est.)',
            tone: 'green',
          },
        ]}
      />

      {/* Banner PILA — total real del registro */}
      {!loading && empleados.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-[#E6B66A]/45 bg-[#E6B66A]/15 px-5 py-4">
          <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-md bg-[#C48A2E] text-white">
            <Users className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-n-1000">
              Seguridad social + parafiscales del mes (PILA)
            </div>
            <div className="mt-0.5 text-sm text-n-700">
              Total estimado:{' '}
              <span className="font-mono font-semibold tabular-nums">{cop(pilaTotal)}</span>
              {' '}· la fecha exacta depende de los últimos dígitos de su NIT — véala en Mis Fechas.
            </div>
          </div>
        </div>
      )}

      {/* Condición del empleador — Art. 114-1 E.T. */}
      <section className="mb-6 rounded-xl border border-n-200 bg-n-0 px-5 py-4">
        <h2 className="text-[15px] font-bold text-n-1000">{et.employerTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-n-700">{et.employerHelp}</p>
        <label className="mt-3 flex flex-col gap-1.5 text-xs font-semibold text-n-700" htmlFor="emp-114-1">
          {et.employerLabel}
          <select
            id="emp-114-1"
            value={employerSelectValue(empleador114_1)}
            disabled={empleadorSaving || loading}
            onChange={(e) => void saveEmpleador(parseEmployerSelect(e.target.value))}
            className={INPUT_CLS}
          >
            <option value="unset">{et.employerUnset}</option>
            <option value="yes">{et.employerYes}</option>
            <option value="no">{et.employerNo}</option>
          </select>
        </label>
        {empleadorSaving && <p className="mt-1.5 text-xs text-n-600">{et.employerSaving}</p>}
        {empleadorError && <p className="mt-1.5 text-xs text-danger">{empleadorError}</p>}
      </section>

      {/* Su equipo */}
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="font-serif-elite text-2xl font-medium text-n-1000">Su equipo</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-area-pyme px-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Agregar
          </button>
        )}
      </div>

      {showForm && (
        <AddForm
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-[78px] animate-pulse rounded-xl border border-n-200 bg-n-50" />
          ))}
        </div>
      ) : empleados.length === 0 && !showForm ? (
        <div className="rounded-2xl border border-area-pyme/25 bg-n-0 px-8 py-10 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-area-pyme/12 text-area-pyme">
            <Users className="h-7 w-7" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h3 className="font-serif-elite text-xl font-medium text-n-1000">
            Aún no ha registrado empleados
          </h3>
          <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-n-600">
            Registre a su gente y le mostramos cuánto cuesta cada persona
            (salario + salud, pensión, ARL y prestaciones) y cuánto separar
            cada mes para la PILA.
          </p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-area-pyme px-5 text-[15px] font-semibold text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            Agregar mi primera persona
          </button>
        </div>
      ) : (
        empleados.map((item) => (
          <PersonaCard key={item.empleado.id} item={item} onRemoved={() => void load()} />
        ))
      )}

      {/* Usted como dueño */}
      {duenos.length > 0 && (
        <>
          <h2 className="mb-3.5 mt-6 font-serif-elite text-2xl font-medium text-n-1000">
            Usted como dueño
          </h2>
          {duenos.map((item) => (
            <PersonaCard key={item.empleado.id} item={item} onRemoved={() => void load()} />
          ))}
        </>
      )}
      {!loading && duenos.length === 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-n-200 bg-n-0 px-5 py-4">
          <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-n-500" strokeWidth={1.75} aria-hidden="true" />
          <p className="text-sm leading-relaxed text-n-600">
            ¿Usted también cotiza? Agréguese con el tipo{' '}
            <b>&ldquo;Dueño (independiente)&rdquo;</b> y le calculamos su aporte
            mensual de salud y pensión sobre la base del 40% de su ingreso.
          </p>
        </div>
      )}

      {/* Disclaimer de estimación */}
      <p className="mt-5 text-center text-xs italic text-n-500">
        Valores estimados con los factores legales 2026 (Ley 100/1993, CST,
        Decreto 1772/1994, Art. 114-1 E.T.) — no incluyen auxilio de
        transporte, horas extra ni retenciones. No sustituyen la liquidación
        de su operador PILA.
      </p>
    </PymeSubpageShell>
  );
}
