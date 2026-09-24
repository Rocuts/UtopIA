'use client';

/**
 * ValorArea — Ventana II: El Valor (Ingeniería Financiera y Valoración).
 *
 * Layout matches handoff `El Valor.html` + `assets/module.css`:
 *  - 2-column hero: left (eyebrow + h1 + lede) · right (gold gradient KPI card)
 *  - KPI card: valor de salida (patrimonio) + métodos por separado
 *  - Section headers with gold left-bar accent (border-left: 3px solid #B8934A)
 *  - 3 submodule cards (.subcard style — gold-tinted bg, hover left-bar)
 *  - DataSourceLadder + CapabilityZones
 *
 * Auditoría ratios-kpis-01 / valoracion-01: el héroe mostraba cifras fijas del
 * mockup ($4.820M, EBITDA $1.180M, WACC 13,2 %, 5,4×, "↑ 12 %", sparkline y
 * drivers "+$640M"…) y rotulaba "VALOR DE SALIDA · DCF" un promedio de
 * EV/EBIT × 6 (valor empresa) con el patrimonio contable, sin DCF ni deuda
 * neta. Ahora sólo pinta campos de AncoraView; lo que falta es N/D con motivo.
 *  - Gold particles handled by AreaFX via AreaShell (rising dots + cross-sparks)
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  TrendingUp,
  FileSearch,
  Activity,
  Diamond,
  ArrowRight,
} from 'lucide-react';
import { useMemo } from 'react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { calculateExitValue, formatCop } from '@/lib/kpis/exit-value';
import type { KpiResult } from '@/types/kpis';
import { useAncoraView } from '@/hooks/useAncoraView';
import { DataSourceLadder } from './shared/DataSourceLadder';
import { CapabilityZones } from './shared/CapabilityZones';
import { getSourceLabels } from './shared/source-labels';
import { getValorSources, getValorZones } from './data/valor-capabilities';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  value: number;
}

export interface ValorAreaProps {
  kpi?: KpiResult;
  trend?: TrendPoint[];
  compact?: boolean;
  className?: string;
}

// ─── Submódulos ──────────────────────────────────────────────────────────────

type SubmoduleKey = 'valoracion' | 'dueDiligence' | 'inteligenciaFinanciera';

interface SubmoduleDef {
  key: SubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** true = la subpágina aún no está conectada a datos de la empresa. */
  inPreparation: boolean;
}

// Sin estados inventados ("52% completado", "Modelo al día"…): las tres
// subpáginas todavía no leen datos de la empresa (V7a-extra-01).
const SUBMODULES: SubmoduleDef[] = [
  { key: 'dueDiligence', href: '/workspace/valor/due-diligence', icon: FileSearch, inPreparation: true },
  { key: 'inteligenciaFinanciera', href: '/workspace/valor/inteligencia-financiera', icon: Activity, inPreparation: true },
  { key: 'valoracion', href: '/workspace/valor/valoracion', icon: Diamond, inPreparation: true },
];

// ─── Component principal ─────────────────────────────────────────────────────

export function ValorArea({ compact = false, className }: ValorAreaProps) {
  const { t, language } = useLanguage();
  const valor = t.elite.areas.valor;
  const ds = t.elite.dataStatus;
  const reduced = useReducedMotion();

  const { view } = useAncoraView();
  const v = view.derived.valoracion;

  const sources = useMemo(() => getValorSources(language), [language]);
  const zones = useMemo(() => getValorZones(language), [language]);
  const sourceLabels = useMemo(() => getSourceLabels(language), [language]);

  // Sólo campos de AncoraView; null ⇒ N/D (nunca una cifra del mockup).
  const nd = ds.notAvailable;
  const fmt = (n: number | null | undefined) =>
    view.hasData && n != null ? formatCop(n) : nd;
  const heroValue = fmt(v.ponderado);
  const heroReason = view.hasData && v.ponderado == null ? ds.valor.exitValueReason : null;
  const subKpis: Array<{ label: string; value: string; reason?: string | null }> = [
    { label: ds.valor.ebitLabel, value: fmt(view.niif.ebitOperacional) },
    {
      label: ds.valor.evEbitLabel,
      value: fmt(v.evEbit),
      reason: view.hasData && v.evEbit == null ? ds.valor.evEbitReason : null,
    },
    { label: ds.valor.equityBookLabel, value: fmt(v.liquidacion) },
    { label: ds.valor.waccLabel, value: nd, reason: view.hasData ? ds.valor.waccReason : null },
  ];

  const fadeItem = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay: 0.06 + index * 0.07,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        };

  return (
    <div
      data-modulo="valor"
      className={cn('relative w-full', compact ? '' : 'min-h-full', className)}
    >
      {!compact && (
        <>
          {/* ── Hero: 2-column grid ── */}
          <motion.section
            {...fadeItem(0)}
            className="mb-10 pb-9"
            style={{ borderBottom: '1px solid color-mix(in srgb, #B8934A 20%, transparent)' }}
          >
            <div
              className="grid gap-10 items-center"
              style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)' }}
            >
              {/* Left: eyebrow + h1 + lede */}
              <div>
                <div className="flex items-center gap-[10px] mb-[14px]" style={{ fontWeight: 700 }}>
                  <span
                    className="inline-grid place-items-center rounded-lg text-white shrink-0"
                    style={{
                      width: 36,
                      height: 36,
                      background: 'linear-gradient(140deg, #B8934A, #9A7A38)',
                      boxShadow: '0 8px 20px -8px rgba(184,147,74,.55)',
                    }}
                  >
                    <TrendingUp className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <span
                    className="text-xs uppercase tracking-eyebrow font-bold"
                    style={{ color: '#9A7A38' }}
                  >
                    {language === 'es' ? 'II · Valor' : 'II · Value'}
                  </span>
                </div>

                <h1
                  className="font-serif-elite font-medium text-n-1000 tracking-tight"
                  style={{ fontSize: 'clamp(2.4rem, 4.6vw, 3.6rem)', lineHeight: 1.04 }}
                >
                  {language === 'es' ? 'El Valor' : 'The Value'}
                </h1>

                <p
                  className="text-n-600 mt-[14px] leading-relaxed"
                  style={{ fontSize: '1.0625rem', maxWidth: '46ch' }}
                >
                  {language === 'es'
                    ? 'Ingeniería financiera y valoración de empresa. Revelamos cuánto vale su compañía hoy — y qué palancas mueven ese número antes de invertir, fusionar o vender.'
                    : 'Financial engineering and business valuation. We reveal what your company is worth today — and which levers move that number before you invest, merge, or sell.'}
                </p>
              </div>

              {/* Right: gold gradient KPI card */}
              <div
                className="relative overflow-hidden rounded-2xl"
                style={{
                  background: 'linear-gradient(155deg, #B8934A, #9A7A38)',
                  padding: 30,
                  boxShadow:
                    '0 34px 60px -28px rgba(184,147,74,.5), 0 0 0 1px rgba(184,147,74,.45)',
                }}
              >
                {/* Decorative circle */}
                <div
                  aria-hidden
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    right: -50,
                    top: -50,
                    width: 200,
                    height: 200,
                    background: 'rgba(255,255,255,.10)',
                  }}
                />
                <div className="relative" style={{ zIndex: 1 }}>
                  <p
                    className="uppercase font-semibold"
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.12em',
                      color: 'rgba(255,255,255,.82)',
                    }}
                  >
                    {ds.valor.exitValueLabel}
                  </p>

                  <div
                    className="font-serif-elite font-medium num"
                    style={{
                      fontSize: 'clamp(2.6rem, 5vw, 3.8rem)',
                      color: '#fff',
                      lineHeight: 1,
                      margin: '10px 0 6px',
                    }}
                  >
                    {heroValue}
                  </div>

                  {heroReason && (
                    <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,.86)', maxWidth: '42ch' }}>
                      {ds.reason}: {heroReason}
                    </p>
                  )}

                  {/* Métodos por separado (supuestos visibles) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                      gap: 10,
                      marginTop: 20,
                      paddingTop: 16,
                      borderTop: '1px solid rgba(255,255,255,.25)',
                    }}
                  >
                    {subKpis.map(({ label, value, reason }) => (
                      <div key={label}>
                        <div
                          className="num"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            fontSize: '1.05rem',
                            color: '#fff',
                          }}
                        >
                          {value}
                        </div>
                        <div
                          style={{
                            fontSize: '0.625rem',
                            textTransform: 'uppercase',
                            letterSpacing: '.08em',
                            color: 'rgba(255,255,255,.8)',
                            marginTop: 2,
                          }}
                        >
                          {label}
                        </div>
                        {reason && (
                          <div style={{ fontSize: '0.625rem', color: 'rgba(255,255,255,.8)', marginTop: 2 }}>
                            {reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {view.hasData && (
                    <p style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,.8)', marginTop: 14 }}>
                      {ds.valor.assumptionsNote}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          {!view.hasData && (
            <p
              role="status"
              className="mb-10 rounded-xl border border-n-300 bg-n-100 px-4 py-3 text-sm text-n-800"
            >
              {ds.noCompanyData}
            </p>
          )}

          {/* ── Submódulos ── */}
          <motion.section {...fadeItem(1)} className="mb-10">
            <div className="flex items-center justify-between gap-4 mb-[18px]">
              <h2
                className="font-serif-elite font-medium text-n-1000"
                style={{
                  fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                  paddingLeft: 14,
                  borderLeft: '3px solid #B8934A',
                }}
              >
                {language === 'es' ? 'Submódulos' : 'Submodules'}
              </h2>
              <span className="text-sm text-n-500">
                {language === 'es'
                  ? '3 frentes · pipeline de valoración'
                  : '3 tracks · valuation pipeline'}
              </span>
            </div>

            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' }}
            >
              {SUBMODULES.map((sub) => (
                <SubmoduleCard
                  key={sub.key}
                  sub={sub}
                  title={valor.submodules[sub.key].title}
                  description={valor.submodules[sub.key].description}
                  statusLabel={sub.inPreparation ? ds.moduleInPreparation : ds.openModule}
                />
              ))}
            </div>
          </motion.section>

        </>
      )}

      {/* ── Calidad de fuentes ── */}
      <motion.section {...fadeItem(compact ? 0 : 3)} className="mb-10">
        <DataSourceLadder
          title={
            language === 'es'
              ? 'Fuentes conectadas — cada nivel activa más capacidades'
              : 'Connected sources — each level unlocks more capabilities'
          }
          sources={sources}
        />
      </motion.section>

      {/* ── Capacidades de valoración ── */}
      <motion.div {...fadeItem(compact ? 1 : 4)}>
        <CapabilityZones
          legendTitle={
            language === 'es'
              ? 'Capacidades de valoración · estado según fuente'
              : 'Valuation capabilities · status by source'
          }
          zones={zones}
          sourceLabels={sourceLabels}
        />
      </motion.div>
    </div>
  );
}

// ─── Submódulo card — matches handoff .subcard style ─────────────────────────

interface SubmoduleCardProps {
  sub: SubmoduleDef;
  title: string;
  description: string;
  statusLabel: string;
}

function SubmoduleCard({ sub, title, description, statusLabel }: SubmoduleCardProps) {
  const { icon: Icon, href } = sub;

  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative block overflow-hidden rounded-xl transition-[transform,box-shadow] hover:-translate-y-1"
      style={{
        background: 'color-mix(in srgb, #B8934A 4%, var(--color-n-0, #FCFBF8))',
        border: '1px solid color-mix(in srgb, #B8934A 20%, transparent)',
        padding: 20,
      }}
    >
      {/* Left accent bar — scale-y-0 → scale-y-100 on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-200 rounded-tl-xl rounded-bl-xl"
        style={{ background: 'linear-gradient(180deg, #B8934A, #9A7A38)' }}
      />

      {/* Icon box (42×42) */}
      <div
        aria-hidden
        className="inline-grid place-items-center rounded-lg mb-4 group-hover:scale-105 group-hover:-rotate-3 transition-transform duration-200"
        style={{
          width: 42,
          height: 42,
          background: 'color-mix(in srgb, #B8934A 18%, transparent)',
          color: '#9A7A38',
        }}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>

      {/* Name */}
      <p className="text-base font-semibold text-n-1000">{title}</p>

      {/* Description */}
      <p className="text-sm text-n-600 leading-snug mt-[5px]">{description}</p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4">
        <span className="inline-flex items-center gap-[6px] text-xs font-semibold text-n-600">
          <span aria-hidden className="inline-block h-[6px] w-[6px] rounded-full bg-current" />
          {statusLabel}
        </span>
        <span className="inline-flex" style={{ color: '#B8934A' }}>
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}

// Re-export helpers for consumer convenience
export { calculateExitValue, formatCop };
export default ValorArea;
