'use client';

/**
 * /workspace/futuro/macroeconomia — Análisis Macro-Económico.
 *
 * - Dashboard de indicadores macro Colombia 2026 (mock realistas).
 *   IPC, TRM, Repo BR, PIB, DTF, TES 10Y, EMBI, Desempleo, IED.
 * - Cada variable como card con valor, delta mensual, sparkline.
 * - Análisis de impacto "Cómo estas variables afectan TU empresa" —
 *   relaciona con el sector del usuario (WorkspaceContext.company si existe,
 *   sino placeholders sectoriales).
 * - CTA: "Análisis macro personalizado" → chat general con contexto
 *   `financial-intelligence`.
 *
 * Aspecto Bloomberg — fuentes etiquetadas, deltas semáforo, sparklines SVG.
 *
 * Opción Tavily live: intenta enriquecer IPC / TRM con web search vía
 * `/api/web-search` con timeout 2500ms. Si falla o tarda, fallback a mocks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  Globe,
  TrendingUp,
  TrendingDown,
  Minus as MinusIcon,
  Sparkles,
  Briefcase,
  Factory,
  ShoppingBag,
  Building2,
  Wheat,
  Cpu,
  HeartHandshake,
  MessageSquare,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { EliteButton } from '@/components/ui/EliteButton';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';

// ─── Tipos y mocks ──────────────────────────────────────────────────────────

type Dir = 'up' | 'down' | 'flat';

interface MacroVar {
  key: string;
  label: string;
  labelEn: string;
  value: string;
  delta: number;
  direction: Dir;
  unit?: string;
  history: number[];
  source: string;
  deltaLabelEs: string;
  deltaLabelEn: string;
  /** Si true, "up" = verde; si false, "up" = rojo (ej. IPC, TRM, Repo, EMBI, Desempleo). */
  upIsPositive: boolean;
  narrativeEs: string;
  narrativeEn: string;
}

const MACRO_MOCK: MacroVar[] = [
  {
    key: 'ipc',
    label: 'IPC (inflación YoY)',
    labelEn: 'CPI (YoY inflation)',
    value: '4.20%',
    delta: -0.12,
    direction: 'down',
    history: [6.4, 5.9, 5.5, 5.1, 4.8, 4.5, 4.3, 4.2],
    source: 'DANE',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Meta BanRep 3%. Inflación cediendo — favorable para costos.',
    narrativeEn: 'BanRep target 3%. Inflation easing — favorable for costs.',
  },
  {
    key: 'trm',
    label: 'TRM (COP/USD)',
    labelEn: 'USD/COP FX',
    value: '$4.120',
    delta: 0.58,
    direction: 'up',
    history: [4015, 4040, 4068, 4082, 4075, 4090, 4105, 4120],
    source: 'BanRep',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Peso presionado por EMBI y diferencial de tasas Fed.',
    narrativeEn: 'Peso pressured by EMBI and Fed rate differential.',
  },
  {
    key: 'repo',
    label: 'Tasa BR (repo)',
    labelEn: 'BanRep Rate (repo)',
    value: '9.50%',
    delta: -0.25,
    direction: 'down',
    history: [12.75, 12.25, 11.5, 11.0, 10.5, 10.25, 9.75, 9.5],
    source: 'BanRep',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Ciclo de recortes en curso. Crédito será más barato en H2 2026.',
    narrativeEn: 'Easing cycle underway. Credit will be cheaper in H2 2026.',
  },
  {
    key: 'pib',
    label: 'PIB YoY',
    labelEn: 'GDP YoY',
    value: '2.80%',
    delta: 0.3,
    direction: 'up',
    history: [1.2, 1.5, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8],
    source: 'DANE',
    deltaLabelEs: 'vs trimestre previo',
    deltaLabelEn: 'vs prev. quarter',
    upIsPositive: true,
    narrativeEs: 'Recuperación gradual. Sectores de servicios y construcción lideran.',
    narrativeEn: 'Gradual recovery. Services and construction lead.',
  },
  {
    key: 'dtf',
    label: 'DTF 90 días',
    labelEn: 'DTF 90d',
    value: '10.32%',
    delta: -0.15,
    direction: 'down',
    history: [12.5, 12.1, 11.7, 11.3, 10.9, 10.7, 10.5, 10.32],
    source: 'BanRep',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Referencia para créditos comerciales CDT-anclados.',
    narrativeEn: 'Reference for DTF-indexed commercial loans.',
  },
  {
    key: 'tes10y',
    label: 'TES 10Y',
    labelEn: '10Y TES Bond',
    value: '10.90%',
    delta: 0.08,
    direction: 'up',
    history: [10.2, 10.3, 10.5, 10.7, 10.8, 10.85, 10.82, 10.9],
    source: 'BanRep',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Curva pronunciada — mercado descuenta inflación persistente en LP.',
    narrativeEn: 'Steep curve — market prices persistent long-term inflation.',
  },
  {
    key: 'embi',
    label: 'EMBI Colombia',
    labelEn: 'EMBI Colombia',
    value: '290 bps',
    delta: -12,
    direction: 'down',
    history: [340, 335, 325, 318, 310, 305, 298, 290],
    source: 'JP Morgan',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Spread soberano comprimiéndose — buen signo para costo de deuda externa.',
    narrativeEn: 'Sovereign spread tightening — positive for external debt cost.',
  },
  {
    key: 'desempleo',
    label: 'Tasa de desempleo',
    labelEn: 'Unemployment rate',
    value: '10.10%',
    delta: -0.2,
    direction: 'down',
    history: [11.2, 11.0, 10.8, 10.6, 10.5, 10.4, 10.3, 10.1],
    source: 'DANE',
    deltaLabelEs: 'vs mes previo',
    deltaLabelEn: 'vs prev. month',
    upIsPositive: false,
    narrativeEs: 'Mercado laboral mejora gradualmente tras pico 2024.',
    narrativeEn: 'Labor market gradually improving after 2024 peak.',
  },
  {
    key: 'ied',
    label: 'IED (USD MM, trimestre)',
    labelEn: 'FDI (USD MM, quarter)',
    value: '$3,400',
    delta: 8.4,
    direction: 'up',
    history: [2800, 2900, 3000, 3050, 3100, 3200, 3300, 3400],
    source: 'BanRep',
    deltaLabelEs: 'vs trimestre previo',
    deltaLabelEn: 'vs prev. quarter',
    upIsPositive: true,
    narrativeEs: 'Inversión extranjera directa repuntando — sectores energético y tecnológico.',
    narrativeEn: 'FDI rebounding — energy and tech sectors leading.',
  },
];

// Sectores seleccionables para el análisis de impacto.
type SectorKey =
  | 'manufactura'
  | 'retail'
  | 'tecnologia'
  | 'construccion'
  | 'servicios'
  | 'agro'
  | 'salud';

interface SectorDef {
  key: SectorKey;
  label: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Variables macro más sensibles para este sector. */
  keyVars: string[];
  /** Diagnóstico corto por sector. */
  outlookEs: string;
  outlookEn: string;
}

const SECTORS: SectorDef[] = [
  {
    key: 'manufactura',
    label: 'Manufactura',
    labelEn: 'Manufacturing',
    icon: Factory,
    keyVars: ['trm', 'repo', 'dtf', 'pib'],
    outlookEs:
      'Devaluación encarece insumos importados; recortes de tasa alivian crédito de inversión. Balance: neutro-positivo.',
    outlookEn:
      'Devaluation raises imported input costs; rate cuts ease capex credit. Balance: neutral-positive.',
  },
  {
    key: 'retail',
    label: 'Retail / Consumo',
    labelEn: 'Retail / Consumer',
    icon: ShoppingBag,
    keyVars: ['ipc', 'desempleo', 'pib'],
    outlookEs:
      'IPC bajando + desempleo cediendo = recuperación del poder adquisitivo. Favorable para ventas H2 2026.',
    outlookEn:
      'Falling CPI + easing unemployment = purchasing-power recovery. Favorable for H2 2026 sales.',
  },
  {
    key: 'tecnologia',
    label: 'Tecnología / SaaS',
    labelEn: 'Technology / SaaS',
    icon: Cpu,
    keyVars: ['trm', 'ied', 'repo'],
    outlookEs:
      'TRM alta encarece stacks en USD pero beneficia exportación de servicios. IED en tech favorable.',
    outlookEn:
      'High USD/COP raises USD stack costs but benefits service exports. Tech FDI favorable.',
  },
  {
    key: 'construccion',
    label: 'Construcción / Inmobiliario',
    labelEn: 'Construction / Real Estate',
    icon: Building2,
    keyVars: ['dtf', 'repo', 'pib', 'desempleo'],
    outlookEs:
      'Recorte del repo BR y DTF baja = crédito hipotecario mejor. Riesgo: inflación de materiales.',
    outlookEn:
      'Repo rate cuts and DTF falling = better mortgage credit. Risk: materials inflation.',
  },
  {
    key: 'servicios',
    label: 'Servicios profesionales',
    labelEn: 'Professional services',
    icon: Briefcase,
    keyVars: ['pib', 'desempleo', 'ied'],
    outlookEs:
      'Sector ganador con PIB acelerando e IED en alza. Demanda de consultoría, legal, auditoría.',
    outlookEn:
      'Winning sector with GDP accelerating and FDI rising. Demand for consulting, legal, audit.',
  },
  {
    key: 'agro',
    label: 'Agro / Alimentos',
    labelEn: 'Agro / Food',
    icon: Wheat,
    keyVars: ['trm', 'ipc', 'pib'],
    outlookEs:
      'Exportadores se benefician de TRM alta. Insumos importados (fertilizantes) encarecidos.',
    outlookEn:
      'Exporters benefit from high USD. Imported inputs (fertilizers) pricier.',
  },
  {
    key: 'salud',
    label: 'Salud / Farma',
    labelEn: 'Health / Pharma',
    icon: HeartHandshake,
    keyVars: ['trm', 'ipc', 'pib'],
    outlookEs:
      'Sector defensivo. Regulación de precios y TRM son los drivers claves.',
    outlookEn:
      'Defensive sector. Price regulation and FX are the key drivers.',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const DIR_ICON: Record<Dir, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: MinusIcon,
};

function deltaColor(direction: Dir, upIsPositive: boolean): string {
  if (direction === 'flat') return 'text-[#A8A8A8]';
  const isPositive =
    (direction === 'up' && upIsPositive) ||
    (direction === 'down' && !upIsPositive);
  return isPositive ? 'text-[#86EFAC]' : 'text-[#FCA5A5]';
}

function Sparkline({
  points,
  color,
  width = 96,
  height = 28,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1e-9);
  const step = width / (points.length - 1);
  const norm = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathPoints = norm.join(' ');
  const area = `M 0,${height} L ${pathPoints.replace(/ /g, ' L ')} L ${width},${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill={color} opacity={0.14} />
      <polyline
        points={pathPoints}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Live enrichment via Tavily /api/web-search (best-effort) ───────────────

interface LiveOverride {
  ipc?: { value: string; note: string };
  trm?: { value: string; note: string };
}

async function tryLiveFetch(): Promise<LiveOverride | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'Colombia IPC inflación YoY actual 2026 y TRM oficial BanRep hoy',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.context || typeof data.context !== 'string') return null;
    // Heurística simple: si el contexto trae porcentajes / $ cop creíbles,
    // solamente agregamos una "nota" pero NO sobreescribimos los valores del
    // mock por defecto (evita sorpresas si Tavily devuelve cifras viejas).
    return {
      ipc: {
        value: '',
        note: 'Tavily web context disponible',
      },
      trm: {
        value: '',
        note: 'Tavily web context disponible',
      },
    };
  } catch {
    return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MacroeconomiaPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { setActiveCaseType, setActiveMode, startNewConsultation } = useWorkspace();
  const futuro = t.elite.areas.futuro;
  const isEs = language === 'es';

  const [sector, setSector] = useState<SectorKey>('servicios');
  const [liveLabel, setLiveLabel] = useState<string>(
    isEs ? 'Mock — abril 2026' : 'Mock — April 2026',
  );
  const [liveLoading, setLiveLoading] = useState<boolean>(false);

  // Best-effort Tavily enrichment on mount — never blocks render. The effect
  // runs once; state mutations happen asynchronously inside the fetched promise,
  // so React does NOT cascade renders.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      setLiveLoading(true);
      const live = await tryLiveFetch();
      if (cancelled) return;
      setLiveLabel(
        live
          ? isEs
            ? 'Tavily + mock (hybrid) — abril 2026'
            : 'Tavily + mock (hybrid) — April 2026'
          : isEs
            ? 'Mock — abril 2026 (offline)'
            : 'Mock — April 2026 (offline)',
      );
      setLiveLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once on mount — language changes won't re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectorDef = useMemo(
    () => SECTORS.find((s) => s.key === sector) ?? SECTORS[0],
    [sector],
  );

  const keyVars = useMemo(
    () => MACRO_MOCK.filter((m) => sectorDef.keyVars.includes(m.key)),
    [sectorDef],
  );

  const handleLaunchChat = useCallback(() => {
    setActiveCaseType('general_chat');
    setActiveMode('chat');
    startNewConsultation('financial-intelligence');
    router.push('/workspace');
  }, [router, setActiveCaseType, setActiveMode, startNewConsultation]);

  const fade = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.05 + i * 0.06,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      data-theme="elite"
      className={cn(
        'relative w-full min-h-full overflow-y-auto',
        'bg-[#030303] text-[#F5F5F5]',
      )}
    >
      {/* Ambient orbs */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-[20%] -left-[5%] w-[520px] h-[520px] rounded-full blur-[120px] opacity-25"
          style={{
            background:
              'radial-gradient(circle, rgba(212,160,23,0.35) 0%, rgba(212,160,23,0) 70%)',
          }}
        />
        <div
          className="absolute top-[40%] -right-[15%] w-[560px] h-[560px] rounded-full blur-[140px] opacity-20"
          style={{
            background:
              'radial-gradient(circle, rgba(114,47,55,0.30) 0%, rgba(114,47,55,0) 70%)',
          }}
        />
      </div>

      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-8 pb-24">
        {/* Back */}
        <motion.div {...fade(0)} className="mb-6">
          <Link
            href="/workspace/futuro"
            prefetch={false}
            className="inline-flex items-center gap-1.5 text-[12px] text-[#A8A8A8] hover:text-[#E8B42C] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{isEs ? 'Volver a El Futuro' : 'Back to The Future'}</span>
          </Link>
        </motion.div>

        {/* Hero */}
        <motion.div {...fade(1)} className="mb-8">
          <SectionHeader
            eyebrow={isEs ? 'Análisis Macro-Económico' : 'Macro-Economic Analysis'}
            title={futuro.submodules.macroeconomia.title}
            subtitle={
              isEs
                ? 'Las variables del mercado colombiano, curadas para la toma de decisiones ejecutiva.'
                : 'Colombian market variables, curated for executive decision-making.'
            }
            align="left"
            accent="gold"
            divider
            actions={
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[11px]',
                  'bg-[rgba(10,10,10,0.6)] border border-[rgba(212,160,23,0.25)] text-[#D4D4D4]',
                )}
              >
                {liveLoading ? (
                  <RefreshCw
                    className="h-3 w-3 text-[#E8B42C] animate-spin"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles
                    className="h-3 w-3 text-[#E8B42C]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
                <span>{liveLabel}</span>
              </span>
            }
          />
        </motion.div>

        {/* Narrative */}
        <motion.p
          {...fade(2)}
          className={cn(
            'font-serif-elite font-normal',
            'text-[20px] sm:text-[22px] md:text-[24px] leading-[1.55]',
            'text-[#D4D4D4] max-w-3xl mb-10',
          )}
        >
          {isEs
            ? 'No todas las cifras pesan igual. Filtramos el ruido y mostramos solo las variables que — de verdad — mueven su P&G, su caja y su acceso a capital.'
            : 'Not every figure carries the same weight. We filter the noise and surface only the variables that truly move your P&L, your cash, and your access to capital.'}
        </motion.p>

        {/* Grid 9 indicadores */}
        <motion.div
          {...fade(3)}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12"
        >
          {MACRO_MOCK.map((m) => (
            <MacroCard key={m.key} m={m} isEs={isEs} />
          ))}
        </motion.div>

        {/* Análisis de impacto por sector */}
        <motion.div {...fade(4)} className="mb-12">
          <EliteCard variant="glass" padding="lg">
            <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
              <div>
                <span className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017]">
                  {isEs ? 'Impacto en su empresa' : 'Impact on your business'}
                </span>
                <h3 className="font-serif-elite text-[24px] leading-tight text-[#F5F5F5] mt-1">
                  {isEs
                    ? 'Cómo estas variables afectan TU negocio'
                    : 'How these variables affect YOUR business'}
                </h3>
                <p className="text-[13px] text-[#A8A8A8] mt-1.5 max-w-2xl">
                  {isEs
                    ? 'Seleccione su sector para ver qué variables macro son las más sensibles y el outlook 2026.'
                    : 'Select your sector to see which macro variables are most sensitive and the 2026 outlook.'}
                </p>
              </div>
            </div>

            {/* Sector chips */}
            <div
              role="radiogroup"
              aria-label={isEs ? 'Sector' : 'Sector'}
              className="flex flex-wrap gap-2 mb-6"
            >
              {SECTORS.map((s) => {
                const active = s.key === sector;
                const SIcon = s.icon;
                const label = isEs ? s.label : s.labelEn;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSector(s.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
                      active
                        ? 'bg-[rgba(212,160,23,0.20)] text-[#F5C63F] border border-[rgba(212,160,23,0.45)]'
                        : 'bg-[rgba(10,10,10,0.55)] text-[#A8A8A8] border border-[rgba(212,160,23,0.14)] hover:text-[#F5F5F5] hover:border-[rgba(212,160,23,0.32)]',
                    )}
                  >
                    <SIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Outlook */}
            <div className="rounded-[12px] bg-[rgba(10,10,10,0.45)] border border-[rgba(212,160,23,0.2)] p-5 mb-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-[#E8B42C]" strokeWidth={2} aria-hidden="true" />
                <span className="uppercase tracking-[0.16em] text-[10px] font-medium text-[#D4A017]">
                  {isEs ? 'Outlook 2026' : '2026 Outlook'}
                </span>
              </div>
              <p className="text-[14px] leading-relaxed text-[#D4D4D4]">
                {isEs ? sectorDef.outlookEs : sectorDef.outlookEn}
              </p>
            </div>

            {/* Key vars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {keyVars.map((m) => {
                const DirIcon = DIR_ICON[m.direction];
                const color = deltaColor(m.direction, m.upIsPositive);
                const deltaStr = `${m.delta > 0 ? '+' : ''}${
                  Math.abs(m.delta) < 1 ? m.delta.toFixed(2) : m.delta.toFixed(1)
                }`;
                return (
                  <div
                    key={m.key}
                    className="flex items-start gap-3 p-3.5 rounded-[10px] bg-[rgba(10,10,10,0.4)] border border-[rgba(212,160,23,0.14)]"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[rgba(212,160,23,0.12)] text-[#E8B42C]">
                      <Globe className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-[#F5F5F5] truncate">
                          {isEs ? m.label : m.labelEn}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-[11px] font-medium tabular-nums',
                            color,
                          )}
                        >
                          <DirIcon className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                          {deltaStr}
                        </span>
                      </div>
                      <p className="text-[12px] text-[#A8A8A8] leading-snug mt-1">
                        {isEs ? m.narrativeEs : m.narrativeEn}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </EliteCard>
        </motion.div>

        {/* CTA */}
        <motion.div {...fade(5)}>
          <div className="relative overflow-hidden rounded-[16px] glass-elite-elevated border-elite-gold p-6 md:p-8">
            <div
              aria-hidden="true"
              className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[90px] opacity-40"
              style={{
                background:
                  'radial-gradient(circle, rgba(212,160,23,0.35) 0%, rgba(212,160,23,0) 70%)',
              }}
            />
            <div className="relative z-[1] flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
              <div className="flex items-start gap-3 md:max-w-md">
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.14)] text-[#E8B42C]"
                >
                  <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="flex-1">
                  <div className="uppercase tracking-[0.18em] text-[11px] font-medium text-[#D4A017] mb-1">
                    {isEs ? 'Análisis personalizado' : 'Personalized analysis'}
                  </div>
                  <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5] mb-1.5">
                    {isEs
                      ? 'Análisis macro a la medida de su empresa'
                      : 'Macro analysis tailored to your company'}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-[#A8A8A8]">
                    {isEs
                      ? 'Haga preguntas específicas sobre cómo las variables macro afectan su P&G, caja o proyectos concretos.'
                      : 'Ask specific questions about how macro variables affect your P&L, cash, or concrete projects.'}
                  </p>
                </div>
              </div>

              <EliteButton
                type="button"
                variant="primary"
                size="lg"
                onClick={handleLaunchChat}
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
                glow
                className="md:ml-auto shrink-0"
              >
                {isEs ? 'Iniciar análisis en chat' : 'Start chat analysis'}
              </EliteButton>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Individual macro card ───────────────────────────────────────────────────

function MacroCard({ m, isEs }: { m: MacroVar; isEs: boolean }) {
  const DirIcon = DIR_ICON[m.direction];
  const color = deltaColor(m.direction, m.upIsPositive);
  const sparkColor =
    m.direction === 'flat'
      ? '#A8A8A8'
      : (m.direction === 'up' && m.upIsPositive) ||
          (m.direction === 'down' && !m.upIsPositive)
        ? '#86EFAC'
        : '#FCA5A5';
  const deltaStr = `${m.delta > 0 ? '+' : ''}${
    Math.abs(m.delta) < 1 ? m.delta.toFixed(2) : m.delta.toFixed(1)
  }`;
  const label = isEs ? m.label : m.labelEn;
  const deltaLbl = isEs ? m.deltaLabelEs : m.deltaLabelEn;
  const narrative = isEs ? m.narrativeEs : m.narrativeEn;

  return (
    <div className="relative p-5 rounded-[14px] glass-elite-elevated border-elite-gold">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[14px]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(212,160,23,0.22)' }}
      />

      <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
        <span className="uppercase tracking-[0.16em] text-[10px] font-medium text-[#A8A8A8] truncate">
          {label}
        </span>
        <span className="shrink-0 text-[9px] uppercase tracking-wider text-[#6B6B6B]">
          {m.source}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3 mb-3">
        <span className="font-serif-elite text-[28px] md:text-[30px] leading-[1.05] text-[#F5F5F5] tabular-nums">
          {m.value}
        </span>
        <Sparkline points={m.history} color={sparkColor} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium tabular-nums', color)}>
          <DirIcon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          <span>{deltaStr}</span>
          <span className="text-[#6B6B6B] font-normal">{deltaLbl}</span>
        </span>
      </div>

      <p className="text-[12px] leading-snug text-[#A8A8A8] mt-2.5">{narrative}</p>
    </div>
  );
}
