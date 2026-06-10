'use client';

/**
 * MiLibroView — /workspace/pyme/libro ("Mi Libro").
 *
 * Implementa el handoff "Pyme - Mi Libro.html":
 * - Hero verde con 3 métricas (Vendí / Gasté / Me quedó) + CTA de foto
 * - Filtros Todos / Ingresos / Gastos
 * - Lista de transacciones (badge "Factura leída" cuando vino de OCR)
 * - Banner de balance con exportación a Excel
 *
 * Datos MOCK (mismo dataset del prototipo) — el wiring real a
 * /api/pyme/entries llega en una ola posterior, igual que PymeHub.
 * El CTA de foto navega al flujo real de OCR (/workspace/pyme/subir).
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  Camera,
  Download,
  Droplet,
  Home,
  Receipt,
  ShoppingCart,
  Truck,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PymeSubpageShell } from '@/components/workspace/pyme/PymeSubpageShell';
import { PymeGreenHero } from '@/components/workspace/pyme/PymeGreenHero';

// ─── Mock data (dataset del prototipo) ───────────────────────────────────────

type TxType = 'in' | 'out';

interface Tx {
  icon: LucideIcon;
  title: string;
  meta: string;
  type: TxType;
  amount: string;
  /** true → la anotó el OCR de foto de factura. */
  read: boolean;
}

const TRANSACTIONS: Tx[] = [
  { icon: ShoppingCart, title: 'Venta de mostrador', meta: 'Hoy 2:14 p.m. · efectivo', type: 'in', amount: '340.000', read: false },
  { icon: Receipt, title: 'Compra a Bavaria', meta: 'Hoy 9:30 a.m.', type: 'out', amount: '180.000', read: true },
  { icon: ShoppingCart, title: 'Venta del día', meta: 'Ayer · datáfono', type: 'in', amount: '520.000', read: false },
  { icon: Zap, title: 'Pago de luz', meta: 'Ayer · servicios', type: 'out', amount: '95.000', read: false },
  { icon: Truck, title: 'Compra a Postobón', meta: '2 días', type: 'out', amount: '210.000', read: true },
  { icon: ShoppingCart, title: 'Venta de mostrador', meta: '3 días · efectivo', type: 'in', amount: '280.000', read: false },
  { icon: Home, title: 'Pago arriendo del local', meta: '5 días · gasto fijo', type: 'out', amount: '800.000', read: false },
  { icon: ShoppingCart, title: 'Ventas del fin de semana', meta: '6 días', type: 'in', amount: '610.000', read: false },
  { icon: Truck, title: 'Compra a Colombina', meta: '1 semana', type: 'out', amount: '140.000', read: true },
  { icon: Droplet, title: 'Pago de agua', meta: '1 semana · servicios', type: 'out', amount: '62.000', read: false },
];

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'in', label: 'Ingresos' },
  { id: 'out', label: 'Gastos' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

// ─── View ────────────────────────────────────────────────────────────────────

export function MiLibroView() {
  const [filter, setFilter] = useState<FilterId>('all');

  const visible = TRANSACTIONS.filter((t) => filter === 'all' || t.type === filter);

  return (
    <PymeSubpageShell>
      <PymeGreenHero
        title="Mi Libro"
        subtitle="Todo lo que entró y salió este mes, ordenado por día."
        metrics={[
          { value: '$1.240.000', label: 'Vendí' },
          { value: '$805.000', label: 'Gasté' },
          { value: '$435.000', label: 'Me quedó', tone: 'green' },
        ]}
      >
        <Link
          href="/workspace/pyme/subir"
          className="mt-5 inline-flex h-12 items-center gap-2.5 rounded-md bg-[#7BC95B] px-5 text-[15px] font-bold text-[#0a1f06] shadow-[0_10px_24px_-10px_rgb(123_201_91_/_0.6)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Camera className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          Agregar foto de factura
        </Link>
      </PymeGreenHero>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar movimientos">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme',
              filter === f.id
                ? 'border-area-pyme bg-area-pyme text-white'
                : 'border-n-200 bg-n-0 text-n-700 hover:border-area-pyme/40',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transacciones */}
      <div className="flex flex-col gap-2.5">
        {visible.map((tx, i) => {
          const Icon = tx.icon;
          return (
            <div
              key={`${tx.title}-${i}`}
              className="flex items-center gap-3.5 rounded-xl border border-n-200 bg-n-0 px-4 py-3.5"
            >
              <span className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-md bg-area-pyme/10 text-[#2A5E1F] dark:text-area-pyme">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-n-1000">
                  {tx.title}
                  {tx.read && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-area-pyme/15 px-2 py-0.5 text-[10px] font-bold text-[#2A5E1F] dark:text-area-pyme">
                      <Camera className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden="true" />
                      Factura leída
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-n-600">{tx.meta}</div>
              </div>
              <span
                className={cn(
                  'shrink-0 font-mono text-[15px] font-semibold tabular-nums',
                  tx.type === 'in' ? 'text-[#2A5E1F] dark:text-area-pyme' : 'text-danger',
                )}
              >
                {tx.type === 'in' ? '+' : '−'}{tx.amount}
              </span>
            </div>
          );
        })}
      </div>

      {/* Balance */}
      <div className="mt-5 flex flex-wrap items-center gap-3.5 rounded-xl border border-area-pyme/30 bg-area-pyme/10 px-5 py-4">
        <Wallet className="h-[22px] w-[22px] shrink-0 text-[#2A5E1F] dark:text-area-pyme" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-[#2A5E1F] dark:text-area-pyme">Le quedó $435.000</div>
          <div className="mt-0.5 text-sm text-n-700">
            Cuatrocientos treinta y cinco mil pesos. Le fue mejor que el mes pasado.
          </div>
        </div>
        <Link
          href="/workspace/pyme/libros"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-gold-500/40 px-4 text-sm font-medium text-gold-600 transition-colors hover:bg-gold-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Bajar a Excel
        </Link>
      </div>
    </PymeSubpageShell>
  );
}
