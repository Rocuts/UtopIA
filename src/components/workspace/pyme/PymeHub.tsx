'use client';

/**
 * PymeHub — hub page for /workspace/pyme (Contabilidad Pyme).
 *
 * Implements the "1+1 · Contabilidad Pyme" handoff design:
 * - Hero with green gradient, dynamic greeting, KPI north-star
 * - Quick-access grid (6 cards; "Foto de factura" is primary/green)
 * - Semáforo de impuestos (progress toward IVA threshold)
 * - Two-column: upcoming payments (3 items) + "Consejo del día" tip card
 *
 * Language: plain Spanish ("en plata blanca, sin enredos").
 * Design accent: #357A28 (area-pyme). Tailwind v4 token classes.
 */

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Camera,
  Check,
  CreditCard,
  FileText,
  Landmark,
  Lightbulb,
  Store,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { formatPesosInteger } from '@/lib/format/cop';
import { AreaFX } from '@/components/workspace/AreaFX';

// ---------------------------------------------------------------------------
// Greeting hook (hydration-safe — SSR snapshot = 'morning')
// ---------------------------------------------------------------------------

type Slot = 'morning' | 'afternoon' | 'evening';

function slot(): Slot {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 19) return 'afternoon';
  return 'evening';
}

function subscribeMinute(cb: () => void) {
  const id = setInterval(cb, 60_000);
  return () => clearInterval(id);
}

function useGreetingSlot(): Slot {
  return useSyncExternalStore(subscribeMinute, slot, () => 'morning');
}

const GREETING: Record<Slot, string> = {
  morning: 'Buenos días',
  afternoon: 'Buenas tardes',
  evening: 'Buenas noches',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cop = (n: number) => `$${formatPesosInteger(n)}`;

const copM = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })} M`
    : cop(n);

// ---------------------------------------------------------------------------
// Data (MOCK — replace with /api/pyme/summary when available)
// ---------------------------------------------------------------------------

const USER = {
  displayName: 'Don Carlos',
  businessName: 'Tienda La Esperanza',
  city: 'Soacha, Cundinamarca',
};

const METRICS = {
  profit: 435_000,
  profitText: 'Cuatrocientos treinta y cinco mil pesos',
  sold: 1_240_000,
  bought: 805_000,
  accumulatedSales: 98_000_000,
  ivaThreshold: 183_000_000,
};

/** Fraction of IVA threshold reached (0–1). */
const IVA_FRACTION = Math.min(METRICS.accumulatedSales / METRICS.ivaThreshold, 1);

// ---------------------------------------------------------------------------
// Quick-access cards
// ---------------------------------------------------------------------------

interface QuickCard {
  icon: LucideIcon;
  label: string;
  desc: string;
  href: string;
  primary?: boolean;
}

const QUICK_CARDS: QuickCard[] = [
  {
    icon: Camera,
    label: 'Foto de factura',
    desc: 'Tómele una foto y nosotros la anotamos por usted.',
    href: '/workspace/pyme/subir',
    primary: true,
  },
  {
    icon: BookOpen,
    label: 'Mi Libro',
    desc: 'Todo lo que vendió y gastó, ordenado por día.',
    href: '/workspace/pyme/libro',
  },
  {
    icon: CalendarClock,
    label: 'Mis Fechas',
    desc: 'Cuándo le toca pagarle al estado, sin sustos.',
    href: '/workspace/pyme/fechas',
  },
  {
    icon: CreditCard,
    label: 'Mis Pagos',
    desc: 'Lo que debe y lo que le conviene más pagar.',
    href: '/workspace/pyme/pagos',
  },
  {
    icon: Users,
    label: 'Mis Empleados',
    desc: 'Salud, pensión y lo que le cuesta cada uno.',
    href: '/workspace/pyme/empleados',
  },
  {
    icon: Lightbulb,
    label: 'Consejo del día',
    desc: 'Un tip sencillo para cuidar su plata.',
    href: '#consejo',
  },
];

// ---------------------------------------------------------------------------
// Upcoming payments
// ---------------------------------------------------------------------------

interface Payment {
  icon: LucideIcon;
  label: string;
  sub: string;
  nit?: string;
  amount: string;
  iconColor: string;
  iconBg: string;
}

const PAYMENTS: Payment[] = [
  {
    icon: Users,
    label: 'Pago de empleados (salud y pensión)',
    sub: 'Vence el 17 · en 9 días',
    nit: '…7',
    amount: '$1.180.000',
    iconColor: '#C48A2E',
    iconBg: 'rgb(196 138 46 / 0.14)',
  },
  {
    icon: Landmark,
    label: 'Avisarle al estado lo que vendió',
    sub: 'Bimestre · en 24 días',
    nit: '…7',
    amount: '$0',
    iconColor: '#357A28',
    iconBg: 'color-mix(in srgb, #357A28 14%, transparent)',
  },
  {
    icon: FileText,
    label: 'Su pago como dueño (base 40%)',
    sub: 'Vence el 17 · en 9 días',
    amount: '$298.000',
    iconColor: '#6B6354',
    iconBg: 'rgb(107 99 84 / 0.12)',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PymeHub() {
  const greetingSlot = useGreetingSlot();
  const greeting = GREETING[greetingSlot];

  return (
    <div className="@container relative isolate mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 py-8 md:py-10">
      {/* Rising green sparkle particles — área pyme */}
      <AreaFX area="pyme" />

      {/* Ambient green glow — area signal */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-area-pyme/[0.09] via-area-pyme/[0.04] to-transparent"
      />

      {/* Back link */}
      <Link
        href="/workspace"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        Volver al Comando
      </Link>

      {/* ---------------------------------------------------------------- */}
      {/* HERO                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-area-pyme via-[#2d6522] to-[#1e4317] p-6 sm:p-8 mb-8">
        {/* Subtle texture overlay */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 20%, rgb(255 255 255 / 0.12) 0%, transparent 60%)',
          }}
        />

        <div className="relative flex flex-col gap-6 @lg:flex-row @lg:items-start @lg:justify-between">
          {/* Left: identity */}
          <div className="min-w-0">
            {/* Eyebrow */}
            <div className="mb-3 inline-flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                <Store className="h-3.5 w-3.5 text-white" strokeWidth={1.75} />
              </span>
              <span className="text-xs font-medium uppercase tracking-widest text-white/75">
                {greeting}, {USER.displayName}
              </span>
            </div>

            {/* Business name */}
            <h1 className="font-serif-elite text-3xl font-medium leading-tight tracking-tight text-white @lg:text-4xl">
              {USER.businessName}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/75 max-w-sm">
              {USER.city}. Aquí ve lo que vendió, lo que le queda y lo que se viene — en plata blanca, sin enredos ni palabras raras.
            </p>
          </div>

          {/* Right: north-star KPI */}
          <div className="shrink-0 @lg:text-right">
            <div className="text-xs font-medium uppercase tracking-widest text-white/65 mb-1">
              Lo que le quedó este mes
            </div>
            <div className="font-mono text-4xl font-bold text-white tabular-nums @lg:text-5xl">
              {cop(METRICS.profit)}
            </div>
            <div className="mt-1 text-xs text-white/65 italic">
              {METRICS.profitText}
            </div>

            {/* Trend badge */}
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-xs font-medium text-white/85">
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
              Le fue mejor que el mes pasado
            </div>

            {/* Sub KPIs */}
            <div className="mt-4 flex gap-5 @lg:justify-end">
              {(
                [
                  { label: 'Vendió', value: METRICS.sold, highlight: false },
                  { label: 'Compró', value: METRICS.bought, highlight: false },
                  { label: 'Le quedó', value: METRICS.profit, highlight: true },
                ] satisfies { label: string; value: number; highlight: boolean }[]
              ).map((k) => (
                <div key={k.label} className="text-center @lg:text-right">
                  <div
                    className={cn(
                      'font-mono text-base font-semibold tabular-nums',
                      k.highlight ? 'text-white' : 'text-white/80',
                    )}
                  >
                    {cop(k.value)}
                  </div>
                  <div className="text-xs text-white/55">{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* QUICK ACCESS                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-widest font-medium text-n-600">
            Accesos rápidos
          </h2>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-area-pyme">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-area-pyme animate-pulse"
            />
            Sincronizado
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2 @lg:grid-cols-3">
          {QUICK_CARDS.map((card) => {
            const Icon = card.icon;
            if (card.primary) {
              return (
                <Link
                  key={card.label}
                  href={card.href}
                  className={cn(
                    'group relative flex flex-col rounded-xl p-5 min-h-[120px]',
                    'bg-area-pyme border border-area-pyme',
                    'transition-all duration-200 hover:shadow-[0_18px_36px_-18px_rgb(53_122_40_/_0.55)]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/18 text-white">
                      <Icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                  </div>
                  <div className="mt-4 flex-1">
                    <div className="font-serif-elite text-base font-normal text-white">
                      {card.label}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-white/80">
                      {card.desc}
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <ArrowRight
                      className="h-4 w-4 text-white/70 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              );
            }

            return (
              <Link
                key={card.label}
                href={card.href}
                className={cn(
                  'group relative flex flex-col rounded-xl border border-area-pyme/20 bg-n-0 p-5 min-h-[120px]',
                  'transition-all duration-200',
                  'hover:-translate-y-0.5 hover:border-area-pyme/50 hover:shadow-e3',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-area-pyme/10 text-area-pyme">
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                </div>
                <div className="mt-4 flex-1">
                  <div className="font-serif-elite text-base font-normal text-n-1000">
                    {card.label}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-n-600">
                    {card.desc}
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <ArrowRight
                    className="h-4 w-4 text-n-500 transition-transform group-hover:translate-x-0.5 group-hover:text-area-pyme"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* SEMÁFORO — impuesto / IVA threshold                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mb-8">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-widest font-medium text-n-600">
          ¿Cómo voy con los impuestos?
        </h2>
        <div className="rounded-xl border border-area-pyme/20 bg-area-pyme/[0.04] p-6">
          {/* Lamp + text */}
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-area-pyme shadow-[0_0_22px_-4px_rgb(53_122_40_/_0.55)]"
            >
              <Check className="h-6 w-6 text-white" strokeWidth={2.5} />
            </span>
            <div>
              <div className="text-lg font-semibold text-n-1000">
                Va bien — todo en verde
              </div>
              <div className="mt-1 text-sm text-n-600">
                Todavía no llega al tope donde le empiezan a cobrar más. Tranquilo, le avisamos antes.
              </div>
            </div>
          </div>

          {/* Progress track */}
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-n-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(IVA_FRACTION * 100)}%`,
                background: 'linear-gradient(90deg, #357A28, #7AA53B)',
              }}
            />
          </div>

          {/* Scale labels */}
          <div className="mt-2 flex justify-between text-xs text-n-500">
            <span>Sus ventas: {copM(METRICS.accumulatedSales)}</span>
            <span>Tope: {copM(METRICS.ivaThreshold)} (oblg. IVA)</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* TWO-COLUMN: payments + tip                                       */}
      {/* ---------------------------------------------------------------- */}
      <section className="grid grid-cols-1 gap-6 @xl:grid-cols-[1.6fr_1fr] items-start">
        {/* Upcoming payments */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-widest font-medium text-n-600">
              Lo que se viene
            </h2>
            <span className="text-xs text-n-500">{PAYMENTS.length} pagos próximos</span>
          </div>

          <div className="flex flex-col gap-3">
            {PAYMENTS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.label}
                  className="flex items-center gap-4 rounded-xl border border-n-200 bg-n-0 px-4 py-3.5"
                >
                  {/* Icon */}
                  <span
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: p.iconBg, color: p.iconColor }}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>

                  {/* Meta */}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-n-1000 leading-snug">
                      {p.label}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-n-600">
                      <span>{p.sub}</span>
                      {p.nit && (
                        <span className="rounded-full bg-area-pyme/8 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-area-pyme">
                          NIT {p.nit}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <span className="shrink-0 font-mono text-sm font-semibold text-n-1000 tabular-nums">
                    {p.amount}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tip card */}
        <div id="consejo">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest font-medium text-n-600">
            Consejo del día
          </h2>
          <div className="rounded-xl border border-area-pyme/25 bg-area-pyme/[0.06] p-5">
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-area-pyme">
              <Lightbulb className="h-3.5 w-3.5" strokeWidth={2} />
              Para no perder plata
            </div>
            <p className="text-sm leading-relaxed text-n-700">
              Si paga tarde lo de sus empleados, le cobran un 5% de más cada mes.
              Mejor sepárelo apenas venda — y nosotros le avisamos un día antes de la fecha.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
