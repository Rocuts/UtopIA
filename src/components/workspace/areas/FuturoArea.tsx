'use client';

/**
 * FuturoArea — Ventana IV: El Futuro (Proyección Económica y Factibilidad).
 *
 * Layout matches handoff `El Futuro.html` + `assets/module.css`:
 *  - 2-column hero: left (eyebrow + h1 + lede) · right (teal gradient KPI card)
 *  - KPI card: "28 meses" Runway, Activity icon, scenario fan chart (3 lines),
 *    sub-KPIs (Optimista/Pesimista/ROI esperado)
 *  - Section headers with teal left-bar accent (border-left: 3px solid #5A7F7A)
 *  - 3 submodule cards (.subcard style) — Escenarios, Factibilidad, Macroeconomía
 *  - Histograma Monte Carlo · ROI (bell distribution)
 *  - DataSourceLadder + CapabilityZones
 *  - Comet-trail sine-wave particles handled by AreaFX via AreaShell
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  Compass,
  Activity,
  Layers,
  ClipboardCheck,
  Globe,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useAncoraView } from '@/hooks/useAncoraView';
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
  statusLabel: { es: string; en: string };
  statusColor: string;
}

// Order matches handoff SUBS array: Escenarios → Factibilidad → Macroeconomía
const SUBMODULES: FuturoSubmoduleDef[] = [
  {
    key: 'escenarios',
    href: '/workspace/futuro/escenarios',
    icon: Layers,
    statusLabel: { es: 'Activo', en: 'Active' },
    statusColor: '#22C55E',
  },
  {
    key: 'factibilidad',
    href: '/workspace/futuro/factibilidad',
    icon: ClipboardCheck,
    statusLabel: { es: 'En análisis', en: 'In analysis' },
    statusColor: '#E8B42C',
  },
  {
    key: 'macroeconomia',
    href: '/workspace/futuro/macroeconomia',
    icon: Globe,
    statusLabel: { es: 'Al día', en: 'Up to date' },
    statusColor: '#22C55E',
  },
];

// ─── Scenario fan chart (3 lines: base, optimista, pesimista) ────────────────
// Data from handoff: scenarios('vFut', base, optimista, pesimista, '#fff', 'rgba(255,255,255,.5)')

const SCENARIO_BASE =     [30, 38, 46, 55, 64, 72, 80];
const SCENARIO_OPTIMISTA = [34, 46, 58, 70, 82, 92, 98];
const SCENARIO_PESIMISTA = [26, 30, 34, 38, 42, 45, 48];

function ScenarioChart() {
  const W = 100, H = 60;
  const allPts = [...SCENARIO_BASE, ...SCENARIO_OPTIMISTA, ...SCENARIO_PESIMISTA];
  const minV = Math.min(...allPts), maxV = Math.max(...allPts);
  const span = maxV - minV || 1;
  const n = SCENARIO_BASE.length;

  const toX = (i: number) => (i / (n - 1)) * W;
  const toY = (v: number) => H - 2 - ((v - minV) / span) * (H - 4);

  const makePath = (pts: readonly number[]) =>
    pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');

  // Filled area between optimista and pesimista
  const areaPath = [
    ...SCENARIO_OPTIMISTA.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`),
    ...[...SCENARIO_PESIMISTA].reverse().map((v, i, arr) =>
      `L${toX(arr.length - 1 - i).toFixed(1)} ${toY(v).toFixed(1)}`
    ),
    'Z',
  ].join(' ');

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Shaded band between scenarios */}
      <path d={areaPath} fill="rgba(255,255,255,.12)" />
      {/* Pesimista line */}
      <path d={makePath(SCENARIO_PESIMISTA)} fill="none" stroke="rgba(255,255,255,.42)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2" />
      {/* Base line */}
      <path d={makePath(SCENARIO_BASE)} fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Optimista line */}
      <path d={makePath(SCENARIO_OPTIMISTA)} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* End-point dot on base */}
      <circle
        cx={toX(n - 1)}
        cy={toY(SCENARIO_BASE[n - 1])}
        r="2"
        fill="rgba(255,255,255,.85)"
      />
    </svg>
  );
}

// ─── Monte Carlo Histogram ────────────────────────────────────────────────────
// Data from handoff: vals=[3,6,11,19,30,46,66,84,96,100,94,80,62,44,29,18,10,5,2], p50=9

const HIST_VALS = [3, 6, 11, 19, 30, 46, 66, 84, 96, 100, 94, 80, 62, 44, 29, 18, 10, 5, 2] as const;
const HIST_P50 = 9;

function MonteCarloHistogram() {
  const W = 900, H = 150;
  const n = HIST_VALS.length, gap = 4;
  const bw = (W - (n - 1) * gap) / n;
  const max = 100;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {HIST_VALS.map((v, i) => {
        const h = (v / max) * (H - 8);
        const x = i * (bw + gap);
        const y = H - h;
        const fill = i === HIST_P50
          ? '#5A7F7A'
          : 'color-mix(in srgb, #5A7F7A 38%, var(--color-n-100, #F0EDE8))';
        return (
          <rect
            key={i}
            x={x} y={y} width={bw} height={h}
            rx="2"
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export function FuturoArea({
  compact = false,
  className,
}: FuturoAreaProps) {
  const { t, language } = useLanguage();
  const futuro = t.elite.areas.futuro;
  const reduced = useReducedMotion();
  const { view } = useAncoraView();

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

  // Supress unused view warning — real runway would come from view.derived
  void view;

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
                    {language === 'es' ? 'RUNWAY · ESCENARIO BASE' : 'RUNWAY · BASE SCENARIO'}
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
                    28
                    <span
                      style={{
                        fontSize: '.34em',
                        color: 'rgba(255,255,255,.5)',
                        marginLeft: 4,
                      }}
                    >
                      {language === 'es' ? 'meses' : 'months'}
                    </span>
                  </div>

                  <div
                    className="inline-flex items-center gap-[6px]"
                    style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,.75)' }}
                  >
                    <Activity className="h-[15px] w-[15px]" strokeWidth={1.75} aria-hidden />
                    <span>
                      {language === 'es'
                        ? 'Simulación Monte Carlo · 10.000 corridas'
                        : 'Monte Carlo simulation · 10,000 runs'}
                    </span>
                  </div>

                  {/* Scenario fan chart */}
                  <div style={{ marginTop: 18, height: 60 }}>
                    <ScenarioChart />
                  </div>

                  {/* Sub-KPIs */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 24,
                      marginTop: 20,
                      paddingTop: 18,
                      borderTop: '1px solid rgba(255,255,255,.25)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div
                        className="num"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: '1.25rem',
                          color: '#22C55E',
                        }}
                      >
                        34m
                      </div>
                      <div
                        style={{
                          fontSize: '0.625rem',
                          textTransform: 'uppercase',
                          letterSpacing: '.08em',
                          color: 'rgba(255,255,255,.72)',
                          marginTop: 2,
                        }}
                      >
                        {language === 'es' ? 'Optimista' : 'Optimistic'}
                      </div>
                    </div>
                    <div>
                      <div
                        className="num"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: '1.25rem',
                          color: '#F87171',
                        }}
                      >
                        19m
                      </div>
                      <div
                        style={{
                          fontSize: '0.625rem',
                          textTransform: 'uppercase',
                          letterSpacing: '.08em',
                          color: 'rgba(255,255,255,.72)',
                          marginTop: 2,
                        }}
                      >
                        {language === 'es' ? 'Pesimista' : 'Pessimistic'}
                      </div>
                    </div>
                    <div>
                      <div
                        className="num"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: '1.25rem',
                          color: '#fff',
                        }}
                      >
                        22%
                      </div>
                      <div
                        style={{
                          fontSize: '0.625rem',
                          textTransform: 'uppercase',
                          letterSpacing: '.08em',
                          color: 'rgba(255,255,255,.72)',
                          marginTop: 2,
                        }}
                      >
                        {language === 'es' ? 'ROI esperado' : 'Expected ROI'}
                      </div>
                    </div>
                  </div>
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
                  language={language}
                />
              ))}
            </div>
          </motion.section>

          {/* ── Histograma Monte Carlo · ROI ── */}
          <motion.section {...fadeItem(2)} className="mb-10">
            <div className="flex items-center justify-between gap-4 mb-[18px]">
              <h2
                className="font-serif-elite font-medium text-n-1000"
                style={{
                  fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                  paddingLeft: 14,
                  borderLeft: '3px solid #5A7F7A',
                }}
              >
                {language === 'es' ? 'Histograma Monte Carlo · ROI' : 'Monte Carlo Histogram · ROI'}
              </h2>
              <span
                className="inline-flex items-center gap-[6px] rounded-full font-bold uppercase"
                style={{
                  height: 22,
                  padding: '0 10px',
                  fontSize: '0.625rem',
                  letterSpacing: '.1em',
                  background: 'color-mix(in srgb, #5A7F7A 18%, transparent)',
                  color: '#4A6F6A',
                }}
              >
                <span className="h-[6px] w-[6px] rounded-full bg-current animate-pulse" aria-hidden />
                {language === 'es' ? 'Distribución de resultados' : 'Results distribution'}
              </span>
            </div>

            <div
              className="p-6 rounded-xl"
              style={{
                border: '1px solid color-mix(in srgb, #5A7F7A 20%, transparent)',
                background: 'color-mix(in srgb, #5A7F7A 4%, var(--color-n-0, #FCFBF8))',
              }}
            >
              <div style={{ height: 150 }}>
                <MonteCarloHistogram />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  fontSize: 'var(--text-xs, 0.75rem)',
                  color: 'var(--color-n-500, #6B6762)',
                  textTransform: 'uppercase',
                  letterSpacing: '.1em',
                }}
              >
                <span>−8% ROI</span>
                <span>P50 · 22%</span>
                <span>+48% ROI</span>
              </div>
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
  language: 'es' | 'en';
}

function SubmoduleCard({ sub, title, description, language }: SubmoduleCardProps) {
  const { icon: Icon, href, statusLabel, statusColor } = sub;

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
        <span
          className="inline-flex items-center gap-[6px] text-xs font-semibold"
          style={{ color: statusColor }}
        >
          <span aria-hidden className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: statusColor }} />
          {statusLabel[language]}
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
