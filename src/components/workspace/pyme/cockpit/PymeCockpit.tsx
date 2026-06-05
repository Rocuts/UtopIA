'use client';

/**
 * PymeCockpit — panel ejecutivo del propietario para `/workspace/pyme`.
 *
 * Superficie de escritorio nativa del "Centro de Comando": mismo lenguaje
 * visual que las áreas y `ContabilidadLanding` — contenedor centrado, header
 * `SectionHeader` (Fraunces), KPIs `PremiumKpiCard`, cards glass-elite, íconos
 * lucide, tokens `--n-*` (dark-mode aware), acento gold. Datos MOCK por ahora.
 *
 * Responsive vía CONTAINER QUERIES (`@container`): los grids responden al ancho
 * real de la columna de contenido, no del viewport — robusto frente al sidebar
 * del shell que ocupa 56/320px según su estado (a viewport 1024px el sidebar
 * está expandido y el contenido es ~640px). Las cifras COP grandes se muestran
 * compactas ("$92,5 M") para no desbordar tarjetas estrechas.
 *
 * Reemplazó al cockpit de 390px estilo teléfono. Lo consume `PymeLanding` →
 * `/workspace/pyme/page.tsx`. El listado de libros real vive en
 * `/workspace/pyme/libros` (enlazado desde la tarjeta "Mis libros").
 */
import {
  Coins,
  Lightbulb,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Users2,
  Wallet,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { formatPesosInteger } from '@/lib/format/cop';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PremiumKpiCard, type KpiTrend } from '@/components/ui/PremiumKpiCard';
import { RegimeProvider, useRegime } from './context/RegimeContext';
import { useGreeting } from './hooks/useGreeting';
import { useOfflineStatus } from './hooks/useOfflineStatus';
import { PymeAccessTile } from './components/PymeAccessTile';
import { PymeDeadlinesCard } from './components/PymeDeadlinesCard';
import {
  mockUser,
  mockMetrics,
  mockAlerts,
  mockModules,
  mockTip,
} from './mockData';

/** "$435.000" — símbolo adyacente, convención peso de la app (sin NBSP). */
const cop = (n: number) => `$${formatPesosInteger(n)}`;

/** Cifras grandes (≥ 1 millón) en forma compacta "$92,5 M" para tarjetas estrechas. */
const copCompact = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`
    : cop(n);

function trend(pct: number): KpiTrend {
  return {
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
    delta: pct,
  };
}

function PymeCockpitInner() {
  const { t } = useLanguage();
  const c = t.pyme.cockpit;
  const slot = useGreeting();
  const isOnline = useOfflineStatus();
  const { isRST } = useRegime();
  const reduce = useReducedMotion();

  const greeting = c[`greeting_${slot}`];

  const fade = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + i * 0.07,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          },
        };

  return (
    <div className="@container relative isolate mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8 md:py-10">
      {/* Lavado verde ambiental — "cuarto verde": glow superior dark-safe (token
          area-pyme con alpha sobre la superficie n-*), señaliza pertenencia del
          tendero al entrar. Decorativo, detrás del contenido vía -z-10 (isolate). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b from-area-pyme/[0.09] via-area-pyme/[0.045] to-transparent"
      />
      {/* Header. Las píldoras de estado van en su propia fila que SÍ envuelve
          en pantallas angostas — la fila `actions` de SectionHeader es
          shrink-0 y no envuelve, y no la tocamos (es compartida app-wide). */}
      <motion.div {...fade(0)}>
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-end">
          {/* Texto neutro n-700 (no gold): cumple AA en claro y oscuro sin
              depender del valor del token gold por modo; el acento gold queda
              en el borde + fondo tenue. */}
          <span className="inline-flex items-center rounded-full border border-area-pyme/25 bg-area-pyme/5 px-2.5 py-1 font-mono text-xs-mono uppercase tracking-eyebrow font-medium text-n-700">
            {isRST ? c.regime_rst : c.regime_ordinario}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs-mono uppercase tracking-eyebrow font-medium text-n-700">
            <span
              aria-hidden="true"
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                isOnline ? 'bg-success' : 'bg-warning',
              )}
            />
            {isOnline ? c.online : c.offline}
          </span>
        </div>
        <SectionHeader
          eyebrow={`${c.module_label} · ${mockUser.businessName}`}
          title={c.summary_title.replace('{month}', mockUser.month)}
          subtitle={`${greeting}, ${mockUser.displayName} · ${mockUser.city}`}
          accent="pyme"
          titleAs="h1"
          divider
        />
      </motion.div>

      {/* KPI row 1 — north-star (ganancia) + ventas acumuladas vs tope IVA */}
      <motion.div
        {...fade(1)}
        className="mt-8 grid grid-cols-1 @2xl:grid-cols-3 gap-5"
      >
        <PremiumKpiCard
          className="@2xl:col-span-2"
          variant="hero"
          accent="pyme"
          severity="good"
          glow
          icon={Wallet}
          label={c.kpi_profit}
          value={cop(mockMetrics.monthlyProfit)}
          subvalue={mockMetrics.monthlyProfitText}
          trend={{ ...trend(mockMetrics.profitTrendPct), label: c.trend_vs_prev }}
        />
        <PremiumKpiCard
          accent="pyme"
          icon={Coins}
          label={c.kpi_iva}
          value={copCompact(mockMetrics.accumulatedSales)}
          subvalue={c.kpi_iva_sub.replace('{threshold}', copCompact(mockMetrics.ivaThreshold))}
        />
      </motion.div>

      {/* KPI row 2 — ventas / compras / margen / PILA */}
      <motion.div
        {...fade(2)}
        className="mt-5 grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-4 gap-4"
      >
        <PremiumKpiCard
          accent="pyme"
          icon={TrendingUp}
          label={c.kpi_sales}
          value={cop(mockMetrics.sold)}
          trend={trend(mockMetrics.salesTrendPct)}
        />
        <PremiumKpiCard
          accent="pyme"
          icon={ShoppingCart}
          label={c.kpi_purchases}
          value={cop(mockMetrics.bought)}
          trend={trend(mockMetrics.purchasesTrendPct)}
        />
        <PremiumKpiCard
          accent="pyme"
          icon={Receipt}
          label={c.kpi_margin}
          value={`${mockMetrics.marginPct}%`}
        />
        <PremiumKpiCard
          accent="pyme"
          icon={Users2}
          label={c.kpi_pila}
          value={`${mockMetrics.pilaProgress}%`}
          subvalue={c.kpi_pila_sub.replace('{pct}', String(mockMetrics.pilaProgress))}
        />
      </motion.div>

      {/* Vencimientos */}
      <motion.div {...fade(3)} className="mt-8">
        <PymeDeadlinesCard alerts={mockAlerts} />
      </motion.div>

      {/* Accesos */}
      <motion.section {...fade(4)} className="mt-8">
        <h2 className="mb-4 font-mono text-xs-mono uppercase tracking-eyebrow font-medium text-n-600">
          {c.accesos_title}
        </h2>
        <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-3 gap-4">
          {mockModules.map((m) => (
            <PymeAccessTile key={m.id} module={m} />
          ))}
        </div>
      </motion.section>

      {/* Consejo — h2 (sección hermana de Accesos/Vencimientos) */}
      <motion.div
        {...fade(5)}
        className="mt-8 flex items-start gap-3 rounded-xl border border-area-pyme/20 bg-area-pyme/5 p-5"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-area-pyme/10 text-area-pyme"
        >
          <Lightbulb className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="font-serif-elite text-base font-normal text-n-1000">
            {c.tip_title}
          </h2>
          <p className="mt-0.5 text-sm text-n-700">{mockTip}</p>
        </div>
      </motion.div>
    </div>
  );
}

export function PymeCockpit() {
  return (
    <RegimeProvider>
      <PymeCockpitInner />
    </RegimeProvider>
  );
}
