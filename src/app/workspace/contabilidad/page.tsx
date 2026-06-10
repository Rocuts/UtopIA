'use client';

/**
 * /workspace/contabilidad — Hub de Contabilidad (Client Component).
 *
 * Muestra: cabecera del módulo + chip de período, acciones rápidas (6),
 * layout 1.7fr/1fr con tabla de asientos recientes (mock demo) y
 * árbol del Plan de Cuentas PUC.
 *
 * Datos de demo mientras los endpoints `/api/accounting/*` no devuelvan
 * información real en este workspace.
 */

import Link from 'next/link';
import {
  ArrowLeftRight,
  BookOpen,
  Calendar,
  CalendarRange,
  List,
  PenLine,
  Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';

// ─── Demo data ────────────────────────────────────────────────────────────────

const RECENT_ENTRIES = [
  {
    date: '09 jun',
    concept: 'Factura #F-2024-1892 Proveedor ABC',
    debit: '$4.200.000',
    credit: '$4.200.000',
    status: 'posted' as const,
    label: 'Contabilizado',
  },
  {
    date: '09 jun',
    concept: 'Nómina quincenal equipo comercial',
    debit: '$18.500.000',
    credit: '$18.500.000',
    status: 'posted' as const,
    label: 'Contabilizado',
  },
  {
    date: '08 jun',
    concept: 'Depreciación equipos computación',
    debit: '$620.000',
    credit: '$620.000',
    status: 'posted' as const,
    label: 'Contabilizado',
  },
  {
    date: '07 jun',
    concept: 'Provisión impuesto de renta',
    debit: '$8.400.000',
    credit: '$8.400.000',
    status: 'draft' as const,
    label: 'Por revisar',
  },
  {
    date: '07 jun',
    concept: 'Ajuste diferencia en cambio',
    debit: '$1.240.000',
    credit: '$1.240.000',
    status: 'posted' as const,
    label: 'Contabilizado',
  },
  {
    date: '06 jun',
    concept: 'Gasto publicidad digital jun',
    debit: '$2.800.000',
    credit: '$2.800.000',
    status: 'posted' as const,
    label: 'Contabilizado',
  },
] satisfies Array<{
  date: string;
  concept: string;
  debit: string;
  credit: string;
  status: 'posted' | 'draft';
  label: string;
}>;

type PucLevel = 'lvl1' | 'lvl2' | 'lvl3';

const PUC_TREE: Array<{ code: string; name: string; amount: string; level: PucLevel }> = [
  { code: '1', name: 'ACTIVO', amount: '$84.200.000', level: 'lvl1' },
  { code: '11', name: 'Efectivo y equivalentes', amount: '$12.400.000', level: 'lvl2' },
  { code: '1105', name: 'Caja general', amount: '$2.400.000', level: 'lvl3' },
  { code: '13', name: 'Deudores', amount: '$38.200.000', level: 'lvl2' },
  { code: '2', name: 'PASIVO', amount: '$52.800.000', level: 'lvl1' },
  { code: '21', name: 'Obligaciones financieras', amount: '$28.400.000', level: 'lvl2' },
  { code: '3', name: 'PATRIMONIO', amount: '$31.400.000', level: 'lvl1' },
];

// ─── Quick actions config ──────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Nuevo asiento', Icon: PenLine, href: '/workspace/contabilidad/asientos/nuevo' },
  { label: 'Cargar apertura', Icon: Upload, href: '/workspace/contabilidad/apertura' },
  { label: 'Conciliación', Icon: ArrowLeftRight, href: '/workspace/contabilidad/conciliacion' },
  { label: 'Plan de cuentas', Icon: List, href: '/workspace/contabilidad/cuentas' },
  { label: 'Libro mayor', Icon: BookOpen, href: '/workspace/contabilidad/mayor' },
  { label: 'Períodos', Icon: CalendarRange, href: '/workspace/contabilidad/periodos' },
] as const;

// ─── Status badge styles ───────────────────────────────────────────────────────

const STATUS_STYLES: Record<'posted' | 'draft', string> = {
  posted: 'bg-[rgb(79_122_76_/_0.14)] text-[--success,#4caf50]',
  draft: 'bg-[rgb(196_138_46_/_0.16)] text-[--warning,#c68a2e]',
};

// ─── PUC indent & weight ───────────────────────────────────────────────────────

const PUC_LEVEL_STYLES: Record<PucLevel, string> = {
  lvl1: 'font-semibold text-n-1000',
  lvl2: 'pl-[18px] text-n-800',
  lvl3: 'pl-[36px] text-n-600',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContabilidadPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-5 flex-wrap mb-8 pb-5 border-b border-n-200">
        <div>
          <h1 className="font-display font-medium text-[clamp(2rem,3.6vw,2.6rem)] tracking-tight text-n-1000 leading-none">
            Contabilidad
          </h1>
          <p className="mt-1.5 text-sm text-n-600">
            Motor contable NIIF · Colombia
          </p>
        </div>

        {/* Period chip */}
        <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-gold-500/30 bg-n-0 text-sm font-semibold text-n-800">
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full bg-[#4caf50] shrink-0"
          />
          Período abierto · Junio 2026
        </span>
      </div>

      {/* ── Quick actions (6 cells) ─────────────────────────────────────────── */}
      <section aria-label="Acciones rápidas" className="mb-8">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[.1em] text-n-500">
          Acciones rápidas
        </div>
        <div className="grid grid-cols-6 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {QUICK_ACTIONS.map(({ label, Icon, href }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'group flex flex-col items-center gap-3 rounded-xl border border-n-200 bg-n-0 px-4 py-4 text-center',
                'cursor-pointer transition-all duration-200',
                'hover:-translate-y-[3px] hover:border-gold-500/60 hover:shadow-[0_14px_28px_-18px_rgb(184_147_74_/_0.55)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg',
                  'bg-gold-500/10 text-gold-600',
                  'transition-colors group-hover:bg-gold-500/20',
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span className="text-xs font-semibold text-n-900 leading-tight">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Two-column section ──────────────────────────────────────────────── */}
      <section aria-label="Asientos y plan de cuentas">
        <div
          className={cn(
            'grid gap-5 items-start',
            '[grid-template-columns:1.7fr_1fr]',
            'max-[900px]:[grid-template-columns:1fr]',
          )}
        >

          {/* LEFT — Asientos recientes */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-n-500">
                Asientos recientes
              </span>
              <Link
                href="/workspace/contabilidad/asientos"
                className="text-xs font-semibold text-gold-600 hover:text-gold-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
              >
                Ver todos →
              </Link>
            </div>

            <div className="rounded-xl border border-n-200 bg-n-0 overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Fecha', 'Concepto', 'Débito', 'Crédito', 'Estado'].map(
                      (col, i) => (
                        <th
                          key={col}
                          className={cn(
                            'px-3.5 pb-3 pt-3 text-[10px] font-bold uppercase tracking-[.1em] text-n-500',
                            i >= 2 && i <= 3 ? 'text-right' : 'text-left',
                          )}
                        >
                          {col}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {RECENT_ENTRIES.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-n-100 hover:bg-gold-500/[0.04] transition-colors"
                    >
                      <td className="px-3.5 py-3 font-mono text-sm tabular-nums text-n-800">
                        {row.date}
                      </td>
                      <td className="px-3.5 py-3 text-sm font-semibold text-n-1000 max-w-[220px] truncate">
                        {row.concept}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono text-sm tabular-nums text-n-800">
                        {row.debit}
                      </td>
                      <td className="px-3.5 py-3 text-right font-mono text-sm tabular-nums text-n-800">
                        {row.credit}
                      </td>
                      <td className="px-3.5 py-3">
                        <span
                          className={cn(
                            'inline-block text-[10px] font-bold uppercase tracking-[.06em] px-2 py-0.5 rounded-full',
                            STATUS_STYLES[row.status],
                          )}
                        >
                          {row.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT — Plan de cuentas PUC */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[.1em] text-n-500">
                Plan de cuentas
              </span>
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-[.06em] px-2 py-0.5 rounded-full',
                  'bg-gold-500/10 text-gold-700',
                )}
              >
                PUC
              </span>
            </div>

            <div className="rounded-xl border border-n-200 bg-n-0 px-4 py-2">
              {PUC_TREE.map((node, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'flex items-center gap-2.5 py-2.5 border-t border-n-100 first:border-t-0',
                    'font-mono text-sm',
                    PUC_LEVEL_STYLES[node.level],
                  )}
                >
                  <span className="font-semibold text-gold-600 shrink-0 tabular-nums">
                    {node.code}
                  </span>
                  <span className="flex-1 font-sans truncate">{node.name}</span>
                  <span className="tabular-nums text-n-600 shrink-0">
                    {node.amount}
                  </span>
                </div>
              ))}
            </div>

            {/* CTA — plan completo */}
            <Link
              href="/workspace/contabilidad/cuentas"
              className={cn(
                'mt-3 flex items-center justify-center gap-2 rounded-lg border border-gold-500/25',
                'bg-gold-500/5 px-4 py-2.5 text-xs font-semibold text-gold-700',
                'hover:bg-gold-500/10 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
              )}
            >
              <List className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Ver plan de cuentas completo
            </Link>
          </div>

        </div>
      </section>

      {/* ── Period + Calendar footer hint ─────────────────────────────────── */}
      <div className="mt-8 flex items-center gap-3 text-xs text-n-500">
        <Calendar className="h-3.5 w-3.5 shrink-0 text-gold-500" aria-hidden="true" />
        <span>
          Período contable activo:{' '}
          <strong className="text-n-700 font-semibold">Junio 2026</strong>
          {' '}· Cierre estimado: 30 jun 2026
        </span>
        <Link
          href="/workspace/contabilidad/periodos"
          className="ml-auto text-gold-600 hover:text-gold-500 transition-colors font-semibold whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
        >
          Gestionar períodos →
        </Link>
      </div>

    </div>
  );
}
