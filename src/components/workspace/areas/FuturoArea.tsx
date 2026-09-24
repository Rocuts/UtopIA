'use client';

/**
 * FuturoArea — Ventana IV: El Futuro (Proyección Económica y Factibilidad).
 *
 * Layout matches handoff `El Futuro.html` + `assets/module.css`:
 *  - 2-column hero: left (eyebrow + h1 + lede) · right (teal gradient KPI card)
 *  - KPI card: runway N/D con motivo + enlace al Centro de Mando (donde se
 *    proyecta desde el libro mayor)
 *  - Section headers with teal left-bar accent (border-left: 3px solid #5A7F7A)
 *  - 3 submodule cards (.subcard style) — Escenarios, Factibilidad, Macroeconomía
 *  - Monte Carlo: estado vacío (la simulación real vive en el Centro de Mando)
 *  - DataSourceLadder + CapabilityZones
 *  - Comet-trail sine-wave particles handled by AreaFX via AreaShell
 *
 * Auditoría ratios-kpis-01: el héroe pintaba "28 meses", "Monte Carlo 10.000
 * corridas", optimista 34m / pesimista 19m, ROI esperado 22 %, un abanico de
 * escenarios y un histograma fijos, sin rótulo de demostración. Esta vista no
 * tiene una proyección de la empresa: todo eso es N/D o estado vacío.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  Compass,
  Layers,
  ClipboardCheck,
  Globe,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { KpiResult } from '@/types/kpis';
import { DataSourceLadder } from './shared/DataSourceLadder';
import { CapabilityZones } from './shared/CapabilityZones';
import { getSourceLabels } from './shared/source-labels';
import { getFuturoSources, getFuturoZones } from './data/futuro-capabilities';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type MacroDirection = 'up' | 'down' | 'flat';

export interface MacroIndicator {
  key: string;
  label: string;
  labelEn?: string;
  value: string;
  delta: number;
  direction: MacroDirection;
  deltaLabel?: string;
  deltaLabelEn?: string;
  history?: number[];
  source?: string;
  upIsPositive?: boolean;
}

export interface FuturoProject {
  name: string;
  nameEn?: string;
  score: number;
  investment: number;
  expectedReturn?: number;
  status?: 'evaluating' | 'green' | 'hold';
}

export interface FuturoAreaProps {
  kpi?: KpiResult;
  macroSnapshot?: MacroIndicator[];
  activeProjects?: FuturoProject[];
  compact?: boolean;
  className?: string;
}

// ─── Submódulos ──────────────────────────────────────────────────────────────

type FuturoSubmoduleKey = 'escenarios' | 'factibilidad' | 'macroeconomia';

interface FuturoSubmoduleDef {
  key: FuturoSubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

// Sin estados inventados ("Al día", "En análisis"): las tres subpáginas son
// herramientas que el usuario abre (simulador, factibilidad y macro con fuente).
const SUBMODULES: FuturoSubmoduleDef[] = [
  { key: 'escenarios', href: '/workspace/futuro/escenarios', icon: Layers },
  { key: 'factibilidad', href: '/workspace/futuro/factibilidad', icon: ClipboardCheck },
  { key: 'macroeconomia', href: '/workspace/futuro/macroeconomia', icon: Globe },
];

// ─── Component principal ──────────────────────────────────────────────────────

export function FuturoArea({
  compact = false,
  className,
}: FuturoAreaProps) {
  const { t, language } = useLanguage();
  const futuro = t.elite.areas.futuro;
  const ds = t.elite.dataStatus;
  const reduced = useReducedMotion();

  const sources = useMemo(() => getFuturoSources(language), [language]);
  const zones = useMemo(() => getFuturoZones(language), [language]);
  const sourceLabels = useMemo(() => getSourceLabels(language), [language]);

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
      data-modulo="futuro"
      className={cn('relative w-full', compact ? '' : 'min-h-full', className)}
    >
      {!compact && (
        <>
          {/* ── Hero: 2-column grid ── */}
          <motion.section
            {...fadeItem(0)}
            className="mb-10 pb-9"
            style={{ borderBottom: '1px solid color-mix(in srgb, #5A7F7A 20%, transparent)' }}
          >
            <div
              className="grid gap-10 items-center"
              style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)' }}
            >
              {/* Left: eyebrow + h1 + lede */}
              <div>
                <div className="flex items-center gap-[10px] mb-[14px]">
                  <span
                    className="inline-grid place-items-center rounded-lg text-white shrink-0"
                    style={{
                      width: 36,
                      height: 36,
                      background: 'linear-gradient(140deg, #5A7F7A, #4A6F6A)',
                      boxShadow: '0 8px 20px -8px rgba(90,127,122,.55)',
                    }}
                  >
                    <Compass className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <span
                    className="text-xs uppercase tracking-eyebrow font-bold"
                    style={{ color: '#4A6F6A' }}
                  >
                    {language === 'es' ? 'IV · Prospectiva' : 'IV · Prospective'}
                  </span>
                </div>

                <h1
                  className="font-serif-elite font-medium text-n-1000 tracking-tight"
                  style={{ fontSize: 'clamp(2.4rem, 4.6vw, 3.6rem)', lineHeight: 1.04 }}
                >
                  {language === 'es' ? 'El Futuro' : 'The Future'}
                </h1>

                <p
                  className="text-n-600 mt-[14px] leading-relaxed"
                  style={{ fontSize: '1.0625rem', maxWidth: '46ch' }}
                >
                  {language === 'es'
                    ? 'Planeación y modelado de escenarios. El futuro no es una línea, es un abanico — mueva crecimiento, costos, inflación y TRM y vea cómo reaccionan tres escenarios en tiempo real.'
                    : 'Planning and scenario modeling. The future is not a line, it’s a fan — move growth, costs, inflation and FX to see how three scenarios react in real time.'}
                </p>
              </div>

              {/* Right: teal gradient KPI card */}
              <div
                className="relative overflow-hidden rounded-2xl"
                style={{
                  background: 'linear-gradient(155deg, #5A7F7A, #4A6F6A)',
                  padding: 30,
                  boxShadow:
                    '0 34px 60px -28px rgba(90,127,122,.5), 0 0 0 1px rgba(90,127,122,.45)',
                }}
              >
                <div
                  aria-hidden
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    right: -50, top: -50,
                    width: 200, height: 200,
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
                    {ds.futuro.runwayLabel}
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
                    {ds.notAvailable}
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,.86)', maxWidth: '42ch' }}>
                    {ds.reason}: {ds.futuro.runwayReason}
                  </p>

                  <Link
                    href="/workspace/comando"
                    prefetch={false}
                    className="inline-flex items-center gap-1 mt-4 text-xs font-semibold uppercase tracking-eyebrow text-white hover:underline"
                  >
                    {ds.goToCommandCenter}
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Link>
                </div>
              </div>
            </div>
          </motion.section>

          {/* ── Submódulos ── */}
          <motion.section {...fadeItem(1)} className="mb-10">
            <div className="flex items-center justify-between gap-4 mb-[18px]">
              <h2
                className="font-serif-elite font-medium text-n-1000"
                style={{
                  fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                  paddingLeft: 14,
                  borderLeft: '3px solid #5A7F7A',
                }}
              >
                {language === 'es' ? 'Submódulos' : 'Submodules'}
              </h2>
              <span className="text-sm text-n-500">
                {language === 'es' ? '3 frentes · prospectiva' : '3 tracks · prospective'}
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
                  title={futuro.submodules[sub.key].title}
                  description={futuro.submodules[sub.key].description}
                  statusLabel={ds.openModule}
                />
              ))}
            </div>
          </motion.section>

          {/* ── Monte Carlo: estado vacío (sin simulación sobre datos de la empresa) ── */}
          <motion.section {...fadeItem(2)} className="mb-10">
            <h2
              className="font-serif-elite font-medium text-n-1000 mb-[18px]"
              style={{
                fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                paddingLeft: 14,
                borderLeft: '3px solid #5A7F7A',
              }}
            >
              {ds.futuro.monteCarloTitle}
            </h2>
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-n-300 bg-n-100 px-5 py-4"
            >
              <p className="text-sm leading-relaxed text-n-800 max-w-[60ch]">
                {ds.futuro.monteCarloEmpty}
              </p>
              <Link
                href="/workspace/comando"
                prefetch={false}
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-eyebrow text-n-800 hover:text-n-1000"
              >
                {ds.goToCommandCenter}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </Link>
            </div>
          </motion.section>
        </>
      )}

      {/* ── Fuentes conectadas ── */}
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

      {/* ── Capacidades predictivas ── */}
      <motion.div {...fadeItem(compact ? 1 : 4)}>
        <CapabilityZones
          legendTitle={
            language === 'es'
              ? 'Capacidades predictivas · estado según fuente'
              : 'Predictive capabilities · status by source'
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
  sub: FuturoSubmoduleDef;
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
        background: 'color-mix(in srgb, #5A7F7A 4%, var(--color-n-0, #FCFBF8))',
        border: '1px solid color-mix(in srgb, #5A7F7A 20%, transparent)',
        padding: 20,
      }}
    >
      {/* Left accent bar */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-200 rounded-tl-xl rounded-bl-xl"
        style={{ background: 'linear-gradient(180deg, #5A7F7A, #4A6F6A)' }}
      />

      {/* Icon box */}
      <div
        aria-hidden
        className="inline-grid place-items-center rounded-lg mb-4 group-hover:scale-105 group-hover:-rotate-3 transition-transform duration-200"
        style={{
          width: 42,
          height: 42,
          background: 'color-mix(in srgb, #5A7F7A 18%, transparent)',
          color: '#4A6F6A',
        }}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>

      <p className="text-base font-semibold text-n-1000">{title}</p>
      <p className="text-sm text-n-600 leading-snug mt-[5px]">{description}</p>

      <div className="flex items-center justify-between mt-4">
        <span className="inline-flex items-center gap-[6px] text-xs font-semibold text-n-600">
          <span aria-hidden className="inline-block h-[6px] w-[6px] rounded-full bg-current" />
          {statusLabel}
        </span>
        <span className="inline-flex" style={{ color: '#5A7F7A' }}>
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

export default FuturoArea;
