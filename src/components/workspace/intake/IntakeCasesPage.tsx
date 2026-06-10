'use client';

/**
 * IntakeCasesPage — /workspace/intake ("Intake · Nuevo caso").
 *
 * Implementa el handoff "Intake.html": punto único para abrir un caso.
 * Tres etapas:
 *   1. SELECT  — grid de 11 tipos de caso, cada tarjeta tintada con el color
 *                de su área (Escudo / Valor / Verdad / Futuro)
 *   2. FORM    — wizard tintado con el acento del área del caso, campos
 *                según el tipo (texto, select, dinero, fecha, archivo, área)
 *   3. SUCCESS — número de caso + enrutamiento al módulo real del área
 *
 * El formulario es declarativo (mock, como el prototipo): genera el número
 * de caso y enlaza "Ir al caso" a la ruta real del módulo correspondiente.
 * El wiring a un backend de casos llega en una ola posterior.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  Check,
  ClipboardCheck,
  FileSearch,
  FolderPlus,
  Gem,
  GitCompare,
  LineChart,
  Route,
  Shield,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkspaceFX } from '@/components/workspace/WorkspaceFX';

// ─── Áreas ───────────────────────────────────────────────────────────────────

type AreaId = 'escudo' | 'valor' | 'verdad' | 'futuro';

interface AreaDef {
  name: string;
  color: string;
  deep: string;
  href: string;
}

const AREAS: Record<AreaId, AreaDef> = {
  escudo: { name: 'El Escudo', color: '#A83838', deep: '#8A2E2E', href: '/workspace/escudo' },
  valor: { name: 'El Valor', color: '#B8934A', deep: '#9A7A38', href: '/workspace/valor' },
  verdad: { name: 'La Verdad', color: '#3D6B7E', deep: '#315869', href: '/workspace/verdad' },
  futuro: { name: 'El Futuro', color: '#5A7F7A', deep: '#476661', href: '/workspace/futuro' },
};

// ─── Campos declarativos (port del prototipo) ────────────────────────────────

type Field =
  | { k: 'text'; label: string; ph?: string; half?: boolean }
  | { k: 'select'; label: string; opts: string[]; half?: boolean }
  | { k: 'money'; label: string; half?: boolean }
  | { k: 'date'; label: string; half?: boolean }
  | { k: 'file'; label: string; hint?: string }
  | { k: 'textarea'; label: string; ph?: string };

interface CaseDef {
  id: string;
  title: string;
  icon: LucideIcon;
  area: AreaId;
  desc: string;
  /** Ruta real del módulo al que se enruta el caso creado. */
  href: string;
  fields: Field[];
}

const CASES: CaseDef[] = [
  {
    id: 'defensa',
    title: 'Defensa ante la DIAN',
    icon: Shield,
    area: 'escudo',
    desc: 'Requerimientos, pliegos de cargos y liquidaciones oficiales.',
    href: '/workspace/escudo/defensa-dian',
    fields: [
      { k: 'text', label: 'Razón social', ph: 'Grupo 2tres S.A.S.', half: true },
      { k: 'text', label: 'NIT', ph: '901.234.567-7', half: true },
      { k: 'select', label: 'Tipo de acto', opts: ['Requerimiento ordinario', 'Requerimiento especial', 'Pliego de cargos', 'Liquidación oficial', 'Emplazamiento'], half: true },
      { k: 'select', label: 'Impuesto', opts: ['Renta', 'IVA', 'Retención en la fuente', 'Facturación electrónica'], half: true },
      { k: 'date', label: 'Fecha de notificación', half: true },
      { k: 'money', label: 'Valor en discusión', half: true },
      { k: 'file', label: 'Documento del requerimiento', hint: 'PDF de la actuación de la DIAN' },
    ],
  },
  {
    id: 'devolucion',
    title: 'Devolución de saldos',
    icon: Banknote,
    area: 'escudo',
    desc: 'Recupere saldos a favor en renta o IVA.',
    href: '/workspace/escudo/devoluciones',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'text', label: 'NIT', half: true },
      { k: 'select', label: 'Concepto', opts: ['Saldo a favor en renta', 'Saldo a favor en IVA', 'Retenciones en exceso'], half: true },
      { k: 'text', label: 'Periodo', ph: 'AG 2024', half: true },
      { k: 'money', label: 'Monto del saldo a favor' },
      { k: 'file', label: 'Soportes', hint: 'Declaración y soportes contables' },
    ],
  },
  {
    id: 'due',
    title: 'Due diligence',
    icon: FileSearch,
    area: 'valor',
    desc: 'Auditoría preventiva para inversión, fusión o venta.',
    href: '/workspace/valor/due-diligence',
    fields: [
      { k: 'text', label: 'Empresa objetivo', half: true },
      { k: 'select', label: 'Objetivo', opts: ['Inversión', 'Fusión / adquisición', 'Venta'], half: true },
      { k: 'text', label: 'Sector', half: true },
      { k: 'select', label: 'Alcance', opts: ['Financiero', 'Legal', 'Tributario', 'Integral'], half: true },
      { k: 'file', label: 'Información disponible', hint: 'Estados financieros, contratos, actas' },
    ],
  },
  {
    id: 'inteligencia',
    title: 'Inteligencia financiera',
    icon: LineChart,
    area: 'valor',
    desc: 'Rentabilidad, costos, flujo de caja y escenarios.',
    href: '/workspace/valor/inteligencia-financiera',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'text', label: 'Periodo', ph: '2025', half: true },
      { k: 'select', label: 'Foco del análisis', opts: ['Rentabilidad', 'Estructura de costos', 'Flujo de caja', 'Escenarios de crecimiento'] },
      { k: 'file', label: 'Estados financieros', hint: 'Balance y estado de resultados' },
    ],
  },
  {
    id: 'niif',
    title: 'Reporte NIIF Elite',
    icon: Sparkles,
    area: 'valor',
    desc: 'Estados financieros bajo NIIF generados por IA.',
    href: '/workspace',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'select', label: 'Marco', opts: ['NIIF plenas', 'NIIF para Pymes'], half: true },
      { k: 'select', label: 'Periodo', opts: ['Año gravable 2025', 'Año gravable 2024'], half: true },
      { k: 'file', label: 'Balance', hint: 'Balance de prueba (XLSX)' },
      { k: 'file', label: 'Información exógena', hint: 'Exógena (CSV)' },
    ],
  },
  {
    id: 'planeacion',
    title: 'Planeación tributaria',
    icon: Route,
    area: 'escudo',
    desc: 'Optimización lícita de su carga fiscal.',
    href: '/workspace/escudo/planeacion-tributaria',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'text', label: 'Año objetivo', ph: '2026', half: true },
      { k: 'text', label: 'TEF actual (%)', ph: '28,4', half: true },
      { k: 'text', label: 'Meta de optimización (%)', ph: '24,0', half: true },
      { k: 'text', label: 'Sector' },
    ],
  },
  {
    id: 'precios',
    title: 'Precios de transferencia',
    icon: ArrowLeftRight,
    area: 'escudo',
    desc: 'Operaciones con vinculados del exterior.',
    href: '/workspace/escudo/precios-transferencia',
    fields: [
      { k: 'text', label: 'Vinculado', ph: 'Matriz · México', half: true },
      { k: 'text', label: 'País', half: true },
      { k: 'select', label: 'Tipo de operación', opts: ['Compra de inventario', 'Servicios intragrupo', 'Regalías', 'Préstamos'], half: true },
      { k: 'money', label: 'Monto anual', half: true },
      { k: 'file', label: 'Documentación', hint: 'Contratos y soportes' },
    ],
  },
  {
    id: 'valoracion',
    title: 'Valoración de empresa',
    icon: Gem,
    area: 'valor',
    desc: 'DCF y múltiplos de mercado.',
    href: '/workspace/valor/valoracion',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'select', label: 'Método', opts: ['DCF', 'Múltiplos', 'Mixto'], half: true },
      { k: 'money', label: 'EBITDA anual', half: true },
      { k: 'text', label: 'Horizonte (años)', ph: '5', half: true },
      { k: 'textarea', label: 'Propósito', ph: 'Inversión, venta, sucesión…' },
    ],
  },
  {
    id: 'auditoria',
    title: 'Auditoría fiscal',
    icon: ShieldCheck,
    area: 'verdad',
    desc: 'Diagnóstico tributario integral.',
    href: '/workspace/verdad/revisoria-fiscal',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'select', label: 'Periodo', opts: ['2025', '2024', '2023'], half: true },
      { k: 'select', label: 'Alcance', opts: ['Integral', 'Solo renta', 'Solo IVA', 'Retenciones'], half: true },
      { k: 'select', label: 'Riesgo percibido', opts: ['Bajo', 'Medio', 'Alto'], half: true },
    ],
  },
  {
    id: 'conciliacion',
    title: 'Conciliación fiscal',
    icon: GitCompare,
    area: 'verdad',
    desc: 'Cruce entre contabilidad y declaraciones.',
    href: '/workspace/verdad/conciliacion-fiscal',
    fields: [
      { k: 'text', label: 'Razón social', half: true },
      { k: 'text', label: 'Periodo', ph: '2025', half: true },
      { k: 'text', label: 'Nº de partidas (aprox.)', ph: '1.200', half: true },
      { k: 'file', label: 'Contabilidad', hint: 'Balance y auxiliares' },
    ],
  },
  {
    id: 'factibilidad',
    title: 'Estudio de factibilidad',
    icon: ClipboardCheck,
    area: 'futuro',
    desc: 'Viabilidad de un nuevo proyecto o inversión.',
    href: '/workspace/futuro/factibilidad',
    fields: [
      { k: 'text', label: 'Nombre del proyecto', ph: 'Nueva línea de producción', half: true },
      { k: 'money', label: 'Inversión estimada', half: true },
      { k: 'text', label: 'Horizonte (años)', ph: '7', half: true },
      { k: 'text', label: 'Sector', half: true },
      { k: 'textarea', label: 'Descripción del proyecto' },
    ],
  },
];

// ─── Campos ──────────────────────────────────────────────────────────────────

const FIELD_LABEL =
  'mb-1.5 block text-xs font-semibold uppercase tracking-[0.06em] text-n-700';
const FIELD_INPUT =
  'w-full min-h-[46px] rounded-md border border-n-200 bg-n-0 px-3.5 py-2.5 text-[15px] text-n-900 placeholder:text-n-400 focus:outline-none';

function FieldControl({ field, accent }: { field: Field; accent: AreaDef }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const focusStyle = {
    '--tw-ring-color': `color-mix(in srgb, ${accent.color} 18%, transparent)`,
  } as React.CSSProperties;

  switch (field.k) {
    case 'select':
      return (
        <select className={cn(FIELD_INPUT, 'focus:ring-[3px]')} style={focusStyle}>
          {field.opts.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'money':
      return (
        <input
          inputMode="numeric"
          placeholder="$ 0"
          className={cn(FIELD_INPUT, 'focus:ring-[3px]')}
          style={focusStyle}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className={cn(FIELD_INPUT, 'focus:ring-[3px]')}
          style={focusStyle}
        />
      );
    case 'textarea':
      return (
        <textarea
          placeholder={field.ph ?? ''}
          className={cn(FIELD_INPUT, 'min-h-[84px] resize-y focus:ring-[3px]')}
          style={focusStyle}
        />
      );
    case 'file':
      return (
        <label
          className="block cursor-pointer rounded-md border-[1.5px] border-dashed px-4 py-4 text-center text-sm text-n-600 transition-colors"
          style={{
            borderColor: `color-mix(in srgb, ${accent.color} 34%, var(--color-n-200))`,
            background: `color-mix(in srgb, ${accent.color} 8%, var(--color-n-0))`,
          }}
        >
          <input
            type="file"
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
          <UploadCloud
            className="mx-auto mb-1.5 h-[22px] w-[22px]"
            style={{ color: accent.deep }}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <div>{fileName ?? 'Arrastre o haga clic para subir'}</div>
          {field.hint && (
            <div className="mt-1 text-[11px] text-n-500">{field.hint}</div>
          )}
        </label>
      );
    default:
      return (
        <input
          placeholder={field.ph ?? ''}
          className={cn(FIELD_INPUT, 'focus:ring-[3px]')}
          style={focusStyle}
        />
      );
  }
}

// ─── Página ──────────────────────────────────────────────────────────────────

type Stage = 'select' | 'form' | 'success';

export function IntakeCasesPage() {
  const [stage, setStage] = useState<Stage>('select');
  const [current, setCurrent] = useState<CaseDef | null>(null);
  const [caseNo, setCaseNo] = useState('');

  const openCase = (c: CaseDef) => {
    setCurrent(c);
    setStage('form');
    window.scrollTo?.(0, 0);
  };

  const submitCase = () => {
    setCaseNo(`CASO-2026-${Math.floor(Math.random() * 9000) + 1000}`);
    setStage('success');
  };

  const backToSelect = () => {
    setCurrent(null);
    setStage('select');
  };

  const area = current ? AREAS[current.area] : null;

  return (
    <div className="relative min-h-full w-full">
      <WorkspaceFX />

      <div className="relative z-[2] mx-auto w-full max-w-5xl px-4 pt-5 pb-16 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/workspace"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-n-600 transition-colors hover:text-n-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Volver al Comando
        </Link>

        {/* Page head */}
        <div className="py-5">
          <div className="mb-3 inline-flex items-center gap-2.5 font-bold text-gold-600">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-sm bg-gradient-to-br from-gold-500 to-gold-600 text-white">
              <FolderPlus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="text-xs uppercase tracking-eyebrow">Intake · Nuevo caso</span>
          </div>
          <h1 className="font-serif-elite text-[clamp(2rem,3.6vw,2.6rem)] font-medium leading-tight tracking-tight text-n-1000">
            ¿Qué caso necesita abrir?
          </h1>
          <p className="mt-2 max-w-[62ch] text-[15px] text-n-600">
            Elija el tipo de caso. Cada uno tiene su propio formulario y se enruta al
            área correspondiente.
          </p>
        </div>

        {/* ───────────────────────── SELECT ───────────────────────── */}
        {stage === 'select' && (
          <div className="animate-elite-fade grid grid-cols-1 gap-3.5 min-[560px]:grid-cols-2 min-[860px]:grid-cols-3">
            {CASES.map((c) => {
              const a = AREAS[c.area];
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCase(c)}
                  className="group relative overflow-hidden rounded-xl border border-n-200 bg-n-0 p-5 text-left transition-all duration-200 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2"
                  style={
                    {
                      '--cc': a.color,
                      borderColor: undefined,
                    } as React.CSSProperties
                  }
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = a.color;
                    e.currentTarget.style.boxShadow = `0 20px 38px -22px color-mix(in srgb, ${a.color} 55%, transparent)`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                >
                  {/* Barra de acento izquierda (hover) */}
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 top-0 w-1 origin-top scale-y-0 transition-transform duration-200 group-hover:scale-y-100"
                    style={{ background: a.color }}
                  />
                  <span
                    className="mb-3.5 inline-flex h-[42px] w-[42px] items-center justify-center rounded-md"
                    style={{
                      background: `color-mix(in srgb, ${a.color} 14%, transparent)`,
                      color: a.color,
                    }}
                  >
                    <Icon className="h-[21px] w-[21px]" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div className="text-[15px] font-semibold text-n-1000">{c.title}</div>
                  <div className="mt-1 text-sm leading-snug text-n-600">{c.desc}</div>
                  <div
                    className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: a.color }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: a.color }}
                    />
                    {a.name}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ───────────────────────── FORM ───────────────────────── */}
        {stage === 'form' && current && area && (
          <div className="animate-elite-fade max-w-[640px]">
            <div className="mb-6 flex items-center gap-3.5">
              <span
                className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-md text-white"
                style={{ background: `linear-gradient(140deg, ${area.color}, ${area.deep})` }}
              >
                <current.icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-serif-elite text-2xl font-medium text-n-1000">
                  {current.title}
                </h2>
                <div className="text-sm text-n-600">Se enruta a {area.name}</div>
              </div>
            </div>

            <div
              className="rounded-2xl border bg-n-0 p-6 sm:p-7"
              style={{ borderColor: `color-mix(in srgb, ${area.color} 34%, var(--color-n-200))` }}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCase();
                }}
              >
                <div className="grid grid-cols-1 gap-x-3.5 min-[521px]:grid-cols-2">
                  {current.fields.map((f) => (
                    <div
                      key={f.label}
                      className={cn(
                        'mb-4',
                        !('half' in f && f.half) && 'min-[521px]:col-span-2',
                      )}
                    >
                      <label className={FIELD_LABEL}>{f.label}</label>
                      <FieldControl field={f} accent={area} />
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={backToSelect}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-gold-500/40 px-5 text-[15px] font-medium text-gold-600 transition-colors hover:bg-gold-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
                  >
                    Atrás
                  </button>
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center gap-2 rounded-md px-5 text-[15px] font-semibold text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2"
                    style={{ background: area.color }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = area.deep;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = area.color;
                    }}
                  >
                    <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    Crear caso
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ───────────────────────── SUCCESS ───────────────────────── */}
        {stage === 'success' && current && area && (
          <div
            className="animate-elite-fade mx-auto max-w-[560px] rounded-2xl border bg-n-0 px-8 py-10 text-center"
            style={{ borderColor: `color-mix(in srgb, ${area.color} 34%, var(--color-n-200))` }}
          >
            <span
              className="mx-auto mb-5 flex h-[68px] w-[68px] items-center justify-center rounded-full"
              style={{
                background: `color-mix(in srgb, ${area.color} 16%, transparent)`,
                color: area.deep,
              }}
            >
              <Check className="h-8 w-8" strokeWidth={2} aria-hidden="true" />
            </span>
            <span
              className="mb-5 inline-block rounded-full px-3.5 py-1 font-mono text-sm"
              style={{
                background: `color-mix(in srgb, ${area.color} 16%, transparent)`,
                color: area.deep,
              }}
            >
              {caseNo}
            </span>
            <h2 className="font-serif-elite text-2xl font-medium text-n-1000">
              Caso creado: {current.title}
            </h2>
            <p className="mx-auto mb-6 mt-2.5 max-w-[42ch] text-[15px] leading-relaxed text-n-600">
              Su caso fue enrutado a {area.name}. Un agente 1+1 ya está trabajando en él
              y le avisaremos cada avance.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href={current.href}
                className="inline-flex h-10 items-center gap-2 rounded-md px-5 text-[15px] font-semibold text-white transition-all hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2"
                style={{ background: area.color }}
              >
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Ir al caso
              </Link>
              <button
                type="button"
                onClick={backToSelect}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gold-500/40 px-5 text-[15px] font-medium text-gold-600 transition-colors hover:bg-gold-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              >
                Crear otro
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
