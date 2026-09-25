'use client';

/**
 * VerdadArea — Ventana III: La Verdad (Aseguramiento y Dictamen).
 *
 * Layout matches handoff `La Verdad.html` + `assets/module.css`:
 *  - 2-column hero: left (eyebrow + h1 + lede) · right (teal gradient KPI card)
 *  - KPI card: score real (calidad NIIF del Âncora o cumplimiento de una
 *    auditoría completa) o N/D con motivo
 *  - Section headers with teal left-bar accent (border-left: 3px solid #3D6B7E)
 *  - 3 submodule cards (.subcard style — teal-tinted bg, hover left-bar)
 *  - Dictámenes: estado vacío (no hay fuente de dictámenes emitidos)
 *  - DataSourceLadder + CapabilityZones
 *  - Constellation particles handled by AreaFX via AreaShell (dots connected by lines)
 *
 * Auditoría ratios-kpis-01 / ratios-kpis-12: el héroe pintaba 94/100 del
 * mockup (o 95/100 de mockCompliance), "Grado A · +6 pts", "4 dictámenes
 * vigentes", "2 hallazgos menores", opinión "Limpia" y un panel de dictámenes
 * 98/94/79/91 (SAGRLAFT incluido) aunque existiera un informe real.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import {
  Scale,
  ShieldCheck,
  GitCompare,
  Award,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useAncoraView } from '@/hooks/useAncoraView';
import { getRegulatoryHealth, type LiveKpiValue } from '@/lib/kpis/live';
import { cn } from '@/lib/utils';
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
  compact?: boolean;
  className?: string;
}

// ─── Submódulos ──────────────────────────────────────────────────────────────

type VerdadSubmoduleKey = 'revisoriaFiscal' | 'conciliacionFiscal' | 'dictamenes';

interface VerdadSubmoduleDef {
  key: VerdadSubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** true = la subpágina aún no está conectada a datos de la empresa. */
  inPreparation: boolean;
}

// Sin estados inventados ("Conciliado", "4 vigentes"): V7a-extra-01.
const SUBMODULES: VerdadSubmoduleDef[] = [
  { key: 'conciliacionFiscal', href: '/workspace/verdad/conciliacion-fiscal', icon: GitCompare, inPreparation: true },
  { key: 'dictamenes', href: '/workspace/verdad/dictamenes', icon: Award, inPreparation: true },
  { key: 'revisoriaFiscal', href: '/workspace/verdad/revisoria-fiscal', icon: ShieldCheck, inPreparation: true },
];

// ─── Component principal ──────────────────────────────────────────────────────

export function VerdadArea({
  compact = false,
  className,
}: VerdadAreaProps) {
  const { t, language } = useLanguage();
  const verdad = t.elite.areas.verdad;
  const ds = t.elite.dataStatus;
  const reduced = useReducedMotion();
  const { view } = useAncoraView();

  const sources = useMemo(() => getVerdadSources(language), [language]);
  const zones = useMemo(() => getVerdadZones(language), [language]);
  const sourceLabels = useMemo(() => getSourceLabels(language), [language]);

  // Sin Âncora, sólo una auditoría COMPLETA persistida puede dar un score
  // (getRegulatoryHealth devuelve N/D si falta cualquier eje, hallazgo o
  // dictamen). Nunca un valor de demostración.
  const [regulatory, setRegulatory] = useState<LiveKpiValue | null>(null);
  useEffect(() => {
    if (view.hasData) return;
    let cancelled = false;
    getRegulatoryHealth()
      .then((r) => {
        if (!cancelled) setRegulatory(r);
      })
      .catch(() => {
        if (!cancelled) setRegulatory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [view.hasData]);

  const scoreNiif = view.hasData ? view.derived.scoreNiif : null;
  const heroScore =
    scoreNiif != null
      ? Math.round(scoreNiif)
      : regulatory?.value != null
        ? Math.round(regulatory.value)
        : null;
  const heroLabel =
    scoreNiif != null
      ? ds.verdad.scoreNiifLabel
      : regulatory?.value != null
        ? ds.verdad.complianceLabel
        : ds.verdad.scoreNiifLabel;

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
                    {heroLabel}
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
                    {heroScore != null ? (
                      <>
                        {heroScore}
                        <span
                          style={{
                            fontSize: '.42em',
                            color: 'rgba(255,255,255,.7)',
                            marginLeft: 3,
                          }}
                        >
                          /100
                        </span>
                      </>
                    ) : (
                      ds.notAvailable
                    )}
                  </div>

                  {heroScore == null && (
                    <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,.86)', maxWidth: '42ch' }}>
                      {ds.reason}: {ds.verdad.scoreReason}
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
                  statusLabel={sub.inPreparation ? ds.moduleInPreparation : ds.openModule}
                />
              ))}
            </div>
          </motion.section>

          {/* ── Dictámenes ── */}
          <motion.section {...fadeItem(2)} className="mb-10">
            <h2
              className="font-serif-elite font-medium text-n-1000 mb-[18px]"
              style={{
                fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
                paddingLeft: 14,
                borderLeft: '3px solid #3D6B7E',
              }}
            >
              {ds.verdad.opinionsTitle}
            </h2>
            <p
              role="status"
              className="rounded-xl border border-n-300 bg-n-100 px-5 py-4 text-sm leading-relaxed text-n-800"
            >
              {ds.verdad.opinionsEmpty}
            </p>
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
        <span className="inline-flex items-center gap-[6px] text-xs font-semibold text-n-600">
          <span aria-hidden className="inline-block h-[6px] w-[6px] rounded-full bg-current" />
          {statusLabel}
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
