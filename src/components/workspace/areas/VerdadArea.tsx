'use client';

/**
 * VerdadArea — Ventana III: La Verdad (Aseguramiento y Dictamen).
 *
 * Layout matches handoff `La Verdad.html` + `assets/module.css`:
 *  - 2-column hero: left (eyebrow + h1 + lede) · right (teal gradient KPI card)
 *  - KPI card: 94/100, ↑ Grado A, sparkline, sub-KPIs (Dictámenes / Hallazgos / Opinión)
 *  - Section headers with teal left-bar accent (border-left: 3px solid #3D6B7E)
 *  - 3 submodule cards (.subcard style — teal-tinted bg, hover left-bar)
 *  - Dictámenes panel (progress-bar ladder)
 *  - DataSourceLadder + CapabilityZones
 *  - Constellation particles handled by AreaFX via AreaShell (dots connected by lines)
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  Scale,
  ShieldCheck,
  GitCompare,
  Award,
  ArrowRight,
  ArrowUp,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useAncoraView } from '@/hooks/useAncoraView';
import { cn } from '@/lib/utils';
import type { KpiResult, LastAuditOpinion } from '@/types/kpis';
import { DataSourceLadder } from './shared/DataSourceLadder';
import { CapabilityZones } from './shared/CapabilityZones';
import { getSourceLabels } from './shared/source-labels';
import { getVerdadSources, getVerdadZones } from './data/verdad-capabilities';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ActiveFinding {
  severity: FindingSeverity;
  description: string;
  norm?: string;
}

export interface VerdadAreaProps {
  kpi?: KpiResult;
  activeFindings?: ActiveFinding[];
  lastOpinion?: LastAuditOpinion;
  compact?: boolean;
  className?: string;
}

// ─── Submódulos ──────────────────────────────────────────────────────────────

type VerdadSubmoduleKey = 'revisoriaFiscal' | 'conciliacionFiscal' | 'dictamenes';

interface VerdadSubmoduleDef {
  key: VerdadSubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  statusLabel: { es: string; en: string };
  statusColor: string;
}

const SUBMODULES: VerdadSubmoduleDef[] = [
  {
    key: 'conciliacionFiscal',
    href: '/workspace/verdad/conciliacion-fiscal',
    icon: GitCompare,
    statusLabel: { es: 'Conciliado', en: 'Reconciled' },
    statusColor: '#22C55E',
  },
  {
    key: 'dictamenes',
    href: '/workspace/verdad/dictamenes',
    icon: Award,
    statusLabel: { es: '4 vigentes', en: '4 active' },
    statusColor: '#22C55E',
  },
  {
    key: 'revisoriaFiscal',
    href: '/workspace/verdad/revisoria-fiscal',
    icon: ShieldCheck,
    statusLabel: { es: 'Activo', en: 'Active' },
    statusColor: '#22C55E',
  },
];

// ─── Dictámenes panel (matching handoff DICTS array) ─────────────────────────

const DICTAMENES_ES = [
  { name: 'Estados financieros 2025',       color: '#4F7A4C', value: 98 },
  { name: 'Cumplimiento tributario',         color: '#4F7A4C', value: 94 },
  { name: 'Control interno',                 color: '#C48A2E', value: 79 },
  { name: 'Lavado de activos (SAGRLAFT)',    color: '#4F7A4C', value: 91 },
] as const;

const DICTAMENES_EN = [
  { name: 'Financial statements 2025',       color: '#4F7A4C', value: 98 },
  { name: 'Tax compliance',                  color: '#4F7A4C', value: 94 },
  { name: 'Internal control',               color: '#C48A2E', value: 79 },
  { name: 'AML (SAGRLAFT)',                  color: '#4F7A4C', value: 91 },
] as const;

// ─── Sparkline — ascending series matching handoff bars/vVer data ─────────────

function VerdadSparkline() {
  const pts = [78, 80, 83, 85, 88, 90, 92, 93, 94];
  const W = 100, H = 48;
  const minV = Math.min(...pts), maxV = Math.max(...pts);
  const span = maxV - minV || 1;
  const barW = W / pts.length;
  const gap = 1.2;

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {pts.map((v, i) => {
        const barH = 4 + ((v - minV) / span) * (H - 6);
        const x = i * barW + gap / 2;
        const w = barW - gap;
        const y = H - barH;
        const isLast = i === pts.length - 1;
        return (
          <rect
            key={i}
            x={x} y={y} width={w} height={barH}
            rx="1.5"
            fill={isLast ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.45)'}
          />
        );
      })}
    </svg>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export function VerdadArea({
  kpi,
  lastOpinion = 'favorable',
  compact = false,
  className,
}: VerdadAreaProps) {
  const { t, language } = useLanguage();
  const verdad = t.elite.areas.verdad;
  const reduced = useReducedMotion();
  const { view } = useAncoraView();

  const sources = useMemo(() => getVerdadSources(language), [language]);
  const zones = useMemo(() => getVerdadZones(language), [language]);
  const sourceLabels = useMemo(() => getSourceLabels(language), [language]);

  // Score: real scoreNiif when available, else prop value, else handoff mock (94)
  const scoreNiif = view.hasData ? view.derived.scoreNiif : null;
  const gaugeScore =
    scoreNiif != null
      ? Math.round(scoreNiif)
      : kpi?.value != null
        ? Math.round(kpi.value)
        : 94;

  const dicts = language === 'es' ? DICTAMENES_ES : DICTAMENES_EN;

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
      data-modulo="verdad"
      className={cn('relative w-full', compact ? '' : 'min-h-full', className)}
    >
      {!compact && (
        <>
          {/* ── Hero: 2-column grid ── */}
          <motion.section
            {...fadeItem(0)}
            className="mb-10 pb-9"
            style={{ borderBottom: '1px solid color-mix(in srgb, #3D6B7E 20%, transparent)' }}
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
                      background: 'linear-gradient(140deg, #3D6B7E, #315869)',
                      boxShadow: '0 8px 20px -8px rgba(61,107,126,.55)',
                    }}
                  >
                    <Scale className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <span
                    className="text-xs uppercase tracking-eyebrow font-bold"
                    style={{ color: '#315869' }}
                  >
                    {language === 'es' ? 'III · Rigor' : 'III · Rigor'}
                  </span>
                </div>

                <h1
                  className="font-serif-elite font-medium text-n-1000 tracking-tight"
                  style={{ fontSize: 'clamp(2.4rem, 4.6vw, 3.6rem)', lineHeight: 1.04 }}
                >
                  {language === 'es' ? 'La Verdad' : 'The Truth'}
                </h1>

                <p
                  className="text-n-600 mt-[14px] leading-relaxed"
                  style={{ fontSize: '1.0625rem', maxWidth: '46ch' }}
                >
                  {language === 'es'
                    ? 'Aseguramiento y opinión técnica. Damos fe de que sus cifras resisten cualquier escrutinio — revisoría fiscal, dictámenes y conciliación con criterio independiente.'
                    : 'Assurance and technical opinion. We certify that your figures withstand any scrutiny — statutory audit, opinions, and reconciliation with independent judgment.'}
                </p>
              </div>

              {/* Right: teal gradient KPI card */}
              <div
                className="relative overflow-hidden rounded-2xl"
                style={{
                  background: 'linear-gradient(155deg, #3D6B7E, #315869)',
                  padding: 30,
                  boxShadow:
                    '0 34px 60px -28px rgba(61,107,126,.5), 0 0 0 1px rgba(61,107,126,.45)',
                }}
              >
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
                    {language === 'es' ? 'SCORE DE CUMPLIMIENTO' : 'COMPLIANCE SCORE'}
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
                    {gaugeScore}
                    <span
                      style={{
                        fontSize: '.42em',
                        color: 'rgba(255,255,255,.5)',
                        marginLeft: 3,
                      }}
                    >
                      /100
                    </span>
                  </div>

                  <div
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}
                  >
                    <ArrowUp className="h-[15px] w-[15px]" strokeWidth={2} aria-hidden />
                    <span style={{ color: 'rgba(255,255,255,.82)' }}>
                      {language === 'es'
                        ? 'Grado A · +6 pts en el año'
                        : 'Grade A · +6 pts this year'}
                    </span>
                  </div>

                  <div style={{ marginTop: 20, height: 48 }}>
                    <VerdadSparkline />
                  </div>

                  {/* Sub-KPIs */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 24,
                      marginTop: 22,
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
                          fontWeight: 600,
                          fontSize: '1.25rem',
                          color: '#fff',
                        }}
                      >
                        4
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
                        {language === 'es' ? 'Dictámenes vigentes' : 'Active opinions'}
                      </div>
                    </div>
                    <div>
                      <div
                        className="num"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          fontSize: '1.25rem',
                          color: '#E8B42C',
                        }}
                      >
                        2
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
                        {language === 'es' ? 'Hallazgos menores' : 'Minor findings'}
                      </div>
                    </div>
                    <div>
                      <div
                        className="num"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          fontSize: '1.25rem',
                          color: '#22C55E',
                        }}
                      >
                        {language === 'es' ? 'Limpia' : 'Clean'}
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
                        {language === 'es' ? 'Opinión' : 'Opinion'}
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
                  borderLeft: '3px solid #3D6B7E',
                }}
              >
                {language === 'es' ? 'Submódulos' : 'Submodules'}
              </h2>
              <span className="text-sm text-n-500">
                {language === 'es' ? '3 frentes · aseguramiento' : '3 tracks · assurance'}
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
                  title={verdad.submodules[sub.key].title}
                  description={verdad.submodules[sub.key].description}
                  language={language}
                />
              ))}
            </div>
          </motion.section>

          {/* ── Dictámenes ── */}
          <motion.section {...fadeItem(2)} className="mb-10">
            <div className="flex items-center justify-between gap-4 mb-[18px]">
              <h2
                className="font-serif-elite font-medium text-n-1000"
                style={{
                  fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                  paddingLeft: 14,
                  borderLeft: '3px solid #3D6B7E',
                }}
              >
                {language === 'es' ? 'Dictámenes' : 'Opinions'}
              </h2>
              <span
                className="inline-flex items-center gap-[6px] rounded-full font-bold uppercase"
                style={{
                  height: 22,
                  padding: '0 10px',
                  fontSize: '0.625rem',
                  letterSpacing: '.1em',
                  background: 'color-mix(in srgb, #3D6B7E 18%, transparent)',
                  color: '#315869',
                }}
              >
                <span
                  className="h-[6px] w-[6px] rounded-full bg-current animate-pulse"
                  aria-hidden
                />
                {language === 'es' ? 'Panel de opinión' : 'Opinion panel'}
              </span>
            </div>

            <div
              className="flex flex-col gap-[10px] p-6 rounded-xl"
              style={{
                border: '1px solid color-mix(in srgb, #3D6B7E 20%, transparent)',
                background: 'color-mix(in srgb, #3D6B7E 4%, var(--color-n-0, #FCFBF8))',
              }}
            >
              {dicts.map(({ name, color, value }) => (
                <div
                  key={name}
                  className="flex items-center gap-[14px] px-4 py-[13px] rounded-lg"
                  style={{
                    background: 'var(--color-n-0, #FCFBF8)',
                    border: '1px solid var(--color-n-200, #E5E3DE)',
                  }}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="flex-1 text-sm font-medium text-n-800">{name}</span>
                  <span
                    className="h-[6px] rounded-full overflow-hidden shrink-0"
                    style={{
                      minWidth: 90,
                      flex: '0 0 110px',
                      background: 'var(--color-n-100, #F0EDE8)',
                    }}
                    role="progressbar"
                    aria-valuenow={value}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${value}%`, background: color }}
                    />
                  </span>
                  <span
                    className="num shrink-0 text-sm text-n-600"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {value}/100
                  </span>
                </div>
              ))}
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

      {/* ── Capacidades de aseguramiento ── */}
      <motion.div {...fadeItem(compact ? 1 : 4)}>
        <CapabilityZones
          legendTitle={
            language === 'es'
              ? 'Capacidades de aseguramiento · estado según fuente'
              : 'Assurance capabilities · status by source'
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
  sub: VerdadSubmoduleDef;
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
        background: 'color-mix(in srgb, #3D6B7E 4%, var(--color-n-0, #FCFBF8))',
        border: '1px solid color-mix(in srgb, #3D6B7E 20%, transparent)',
        padding: 20,
      }}
    >
      {/* Left accent bar — scale-y-0 → scale-y-100 on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 origin-top scale-y-0 group-hover:scale-y-100 transition-transform duration-200 rounded-tl-xl rounded-bl-xl"
        style={{ background: 'linear-gradient(180deg, #3D6B7E, #315869)' }}
      />

      {/* Icon box (42×42) */}
      <div
        aria-hidden
        className="inline-grid place-items-center rounded-lg mb-4 group-hover:scale-105 group-hover:-rotate-3 transition-transform duration-200"
        style={{
          width: 42,
          height: 42,
          background: 'color-mix(in srgb, #3D6B7E 18%, transparent)',
          color: '#315869',
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
        <span
          className="inline-flex items-center gap-[6px] text-xs font-semibold"
          style={{ color: statusColor }}
        >
          <span
            aria-hidden
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: statusColor }}
          />
          {statusLabel[language]}
        </span>
        <span className="inline-flex" style={{ color: '#3D6B7E' }}>
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
