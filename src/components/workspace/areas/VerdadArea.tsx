'use client';

/**
 * VerdadArea — Ventana III: La Verdad (Aseguramiento y Dictamen).
 *
 * Dashboard reutilizable. Encapsula:
 *  - Narrativa Instrument Serif ("La confianza es la moneda más cara...")
 *  - KPI Hero: Compliance Score en gauge arc SVG (0-100) con color dinámico
 *  - Breakdown NIIF / Tax / Audit / Legal (barras horizontales ponderadas)
 *  - Lista de hallazgos críticos activos (border-left por severidad)
 *  - Grid 3x1 de submódulos navegables (Revisoría / Conciliación / Dictámenes)
 *  - CTA estrella: "Generar Informe NIIF Elite" — reusa `NiifEliteButton` del Agente B
 *
 * Se consume desde `/workspace/verdad/page.tsx` y puede reusarse compact en
 * cualquier otro lugar (Executive Dashboard, etc.).
 *
 * El componente es "use client" porque consume useLanguage + useWorkspace y
 * el `NiifEliteButton` también lo requiere. Es un componente de presentación
 * — cualquier cálculo se pasa via props (`kpi`, `activeFindings`, `lastOpinion`).
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  BadgeCheck,
  Scale,
  FileCheck,
  ShieldCheck,
  AlertCircle,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { EliteCard } from '@/components/ui/EliteCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { NiifEliteButton } from '@/components/workspace/NiifEliteButton';
import { mockCompliance } from '@/lib/kpis/mocks';
import type { KpiResult, LastAuditOpinion } from '@/types/kpis';

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ActiveFinding {
  severity: FindingSeverity;
  description: string;
  /** Referencia normativa (e.g. "NIIF 9.5.5", "Art. 772-1 ET") */
  norm?: string;
}

export interface VerdadAreaProps {
  /** KPI compuesto (Compliance Score). Si se omite se usa `mockCompliance`. */
  kpi?: KpiResult;
  /** Hallazgos activos (opcional). Si se omite se muestra un set realista de ejemplo. */
  activeFindings?: ActiveFinding[];
  /** Última opinión del revisor fiscal (etiqueta textual). */
  lastOpinion?: LastAuditOpinion;
  /** Render compacto (sin hero largo) para previews. */
  compact?: boolean;
  className?: string;
}

// ─── Submódulos de La Verdad ─────────────────────────────────────────────────

type VerdadSubmoduleKey = 'revisoriaFiscal' | 'conciliacionFiscal' | 'dictamenes';

interface VerdadSubmoduleDef {
  key: VerdadSubmoduleKey;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const SUBMODULES: VerdadSubmoduleDef[] = [
  { key: 'revisoriaFiscal', href: '/workspace/verdad/revisoria-fiscal', icon: ShieldCheck },
  { key: 'conciliacionFiscal', href: '/workspace/verdad/conciliacion-fiscal', icon: Scale },
  { key: 'dictamenes', href: '/workspace/verdad/dictamenes', icon: FileCheck },
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FINDINGS_ES: ActiveFinding[] = [
  {
    severity: 'critical',
    description: 'Rec. cartera vencida > 180 días sin provisión',
    norm: 'NIIF 9.5.5',
  },
  {
    severity: 'high',
    description: 'Inventario sin ajuste a valor neto realizable',
    norm: 'NIIF 2.9',
  },
  {
    severity: 'medium',
    description: 'Partida conciliatoria Ret. Fuente no identificada',
    norm: 'Art. 772-1 ET',
  },
];

const DEFAULT_FINDINGS_EN: ActiveFinding[] = [
  {
    severity: 'critical',
    description: 'Accounts receivable > 180 days without allowance',
    norm: 'IFRS 9.5.5',
  },
  {
    severity: 'high',
    description: 'Inventory not adjusted to net realizable value',
    norm: 'IFRS 2.9',
  },
  {
    severity: 'medium',
    description: 'Unreconciled withholding tax item',
    norm: 'Art. 772-1 ET',
  },
];

// ─── Paleta por severidad ────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<FindingSeverity, { border: string; dot: string; label: string }> = {
  critical: {
    border: 'border-l-[#EF4444]',
    dot: '#EF4444',
    label: 'Crítico',
  },
  high: {
    border: 'border-l-[#C46A76]',
    dot: '#C46A76',
    label: 'Alto',
  },
  medium: {
    border: 'border-l-[#EAB308]',
    dot: '#EAB308',
    label: 'Medio',
  },
  low: {
    border: 'border-l-[#86EFAC]',
    dot: '#86EFAC',
    label: 'Bajo',
  },
};

// ─── Opinión del revisor ─────────────────────────────────────────────────────

const OPINION_LABEL_ES: Record<LastAuditOpinion, string> = {
  favorable: 'Favorable',
  con_salvedades: 'Con salvedades',
  desfavorable: 'Desfavorable',
  abstension: 'Abstención',
};

const OPINION_LABEL_EN: Record<LastAuditOpinion, string> = {
  favorable: 'Unqualified',
  con_salvedades: 'Qualified',
  desfavorable: 'Adverse',
  abstension: 'Disclaimer',
};

const OPINION_TONE: Record<LastAuditOpinion, { bg: string; text: string }> = {
  favorable: { bg: 'rgba(34,197,94,0.14)', text: '#86EFAC' },
  con_salvedades: { bg: 'rgba(234,179,8,0.14)', text: '#EAB308' },
  desfavorable: { bg: 'rgba(239,68,68,0.14)', text: '#FCA5A5' },
  abstension: { bg: 'rgba(114,47,55,0.18)', text: '#C46A76' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreAccent(score: number): { ring: string; text: string; glow: string } {
  if (score >= 90) {
    return {
      ring: '#22C55E',
      text: '#86EFAC',
      glow: '0 0 60px rgba(34,197,94,0.25)',
    };
  }
  if (score >= 75) {
    return {
      ring: '#D4A017',
      text: '#E8B42C',
      glow: '0 0 60px rgba(212,160,23,0.28)',
    };
  }
  if (score >= 60) {
    return {
      ring: '#EAB308',
      text: '#EAB308',
      glow: '0 0 60px rgba(234,179,8,0.28)',
    };
  }
  return {
    ring: '#722F37',
    text: '#C46A76',
    glow: '0 0 60px rgba(114,47,55,0.35)',
  };
}

// ─── Sub-componente: Gauge circular SVG ──────────────────────────────────────

interface ScoreArcProps {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
}

function ScoreArc({ score, size = 200, stroke = 14, label, sublabel }: ScoreArcProps) {
  const shouldReduce = useReducedMotion();
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const { ring, text, glow } = useMemo(() => scoreAccent(safeScore), [safeScore]);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 3/4 arc (270deg) — gauge estilo speedometer
  const arcLength = circumference * 0.75;
  const fillLength = (safeScore / 100) * arcLength;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size, filter: `drop-shadow(${glow})` }}
      role="img"
      aria-label={
        typeof label === 'string'
          ? `${label} ${safeScore} de 100`
          : `Score ${safeScore} de 100`
      }
    >
      <svg width={size} height={size} className="-rotate-[135deg]" aria-hidden="true">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(212,160,23,0.10)"
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ring}
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset: arcLength - fillLength }}
          transition={shouldReduce ? { duration: 0 } : { duration: 1.1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span
          className="font-serif-elite font-normal leading-none tabular-nums"
          style={{ fontSize: size * 0.32, color: text }}
        >
          {safeScore}
        </span>
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#A8A8A8]">
          {sublabel ?? '/ 100'}
        </span>
      </div>
    </div>
  );
}

// ─── Sub-componente: Breakdown bars ──────────────────────────────────────────

interface BreakdownBarProps {
  label: string;
  value: number;
  weight?: number;
  color: string;
}

function BreakdownBar({ label, value, weight, color }: BreakdownBarProps) {
  const shouldReduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-[#D4D4D4] font-medium tracking-wide">
          {label}
          {typeof weight === 'number' && (
            <span className="text-[#A8A8A8] ml-2 font-normal">
              ({Math.round(weight * 100)}%)
            </span>
          )}
        </span>
        <span className="tabular-nums text-[#F5F5F5] font-medium">
          {Math.round(pct)}/100
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[rgba(212,160,23,0.08)] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={shouldReduce ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export function VerdadArea({
  kpi = mockCompliance,
  activeFindings,
  lastOpinion = 'favorable',
  compact = false,
  className,
}: VerdadAreaProps) {
  const { t, language } = useLanguage();
  const verdad = t.elite.areas.verdad;

  const findings = useMemo<ActiveFinding[]>(() => {
    if (activeFindings && activeFindings.length > 0) return activeFindings;
    return language === 'es' ? DEFAULT_FINDINGS_ES : DEFAULT_FINDINGS_EN;
  }, [activeFindings, language]);

  // Breakdown values pulled from the KPI result (engine output)
  const breakdown = useMemo(() => {
    const map: Record<string, { value: number; weight?: number }> = {};
    (kpi.breakdown ?? []).forEach((b) => {
      map[b.label] = { value: b.value, weight: b.weight };
    });
    return {
      niif: map['NIIF'] ?? { value: 98, weight: 0.3 },
      tax: map['Tributario'] ?? { value: 95, weight: 0.25 },
      audit: map['Auditoría (hallazgos)'] ?? { value: 92, weight: 0.25 },
      legal: map['Legal'] ?? { value: 96, weight: 0.2 },
    };
  }, [kpi]);

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const opinionLabel =
    language === 'es' ? OPINION_LABEL_ES[lastOpinion] : OPINION_LABEL_EN[lastOpinion];
  const opinionTone = OPINION_TONE[lastOpinion];

  return (
    <section
      data-theme="elite"
      className={cn(
        'relative flex flex-col gap-8',
        'text-[#F5F5F5]',
        'animate-elite-fade',
        className,
      )}
    >
      {/* ── Hero + narrativa ─────────────────────────────────────────────── */}
      {!compact && (
        <div className="flex flex-col gap-6">
          <SectionHeader
            eyebrow={language === 'es' ? 'III. Integridad' : 'III. Integrity'}
            title={verdad.concept}
            subtitle={verdad.subtitle}
            align="left"
            accent="gold"
            divider
          />

          <p
            className={cn(
              'font-serif-elite font-normal text-[#D4D4D4]',
              'text-[18px] md:text-[20px] leading-[1.5]',
              'max-w-3xl',
            )}
          >
            {verdad.narrative}
          </p>

          {verdad.tagline && (
            <p className="text-[13px] text-[#A8A8A8] tracking-wide max-w-2xl -mt-2">
              {verdad.tagline}
            </p>
          )}
        </div>
      )}

      {/* ── KPI Hero: Score gauge + breakdown + opinion ──────────────────── */}
      <EliteCard variant="glass" padding="lg" className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-8 lg:gap-10 items-center">
          {/* Score gauge */}
          <div className="flex flex-col items-center gap-4">
            <ScoreArc
              score={kpi.value}
              size={220}
              stroke={14}
              label={verdad.kpiPrimary}
              sublabel={language === 'es' ? '/ 100' : '/ 100'}
            />
            <div className="text-center">
              <p className="uppercase tracking-[0.22em] text-[11px] text-[#A8A8A8] font-medium">
                {verdad.kpiPrimary}
              </p>
              <div
                className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium tracking-wide"
                style={{ backgroundColor: opinionTone.bg, color: opinionTone.text }}
              >
                <BadgeCheck className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                {language === 'es' ? 'Dictamen' : 'Opinion'}: {opinionLabel}
              </div>
            </div>
          </div>

          {/* Breakdown bars */}
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="font-serif-elite font-normal text-[22px] text-[#F5F5F5] mb-1.5 leading-tight">
                {language === 'es'
                  ? 'Desglose ponderado del score'
                  : 'Weighted score breakdown'}
              </h3>
              <p className="text-[13px] text-[#A8A8A8] font-light">
                {language === 'es'
                  ? 'Consolidación de cuatro dimensiones regulatorias. Ponderaciones alineadas con el Audit Pipeline.'
                  : 'Four regulatory dimensions consolidated. Weights aligned with the Audit Pipeline.'}
              </p>
            </div>

            <div className="flex flex-col gap-3.5">
              <BreakdownBar
                label="NIIF"
                value={breakdown.niif.value}
                weight={breakdown.niif.weight}
                color="#D4A017"
              />
              <BreakdownBar
                label={language === 'es' ? 'Tributario' : 'Tax'}
                value={breakdown.tax.value}
                weight={breakdown.tax.weight}
                color="#E8B42C"
              />
              <BreakdownBar
                label={language === 'es' ? 'Auditoría' : 'Audit'}
                value={breakdown.audit.value}
                weight={breakdown.audit.weight}
                color="#C46A76"
              />
              <BreakdownBar
                label="Legal"
                value={breakdown.legal.value}
                weight={breakdown.legal.weight}
                color="#F5D079"
              />
            </div>
          </div>
        </div>
      </EliteCard>

      {/* ── Hallazgos activos + CTA NIIF Elite ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,auto] gap-6">
        <EliteCard variant="glass" padding="md">
          <EliteCard.Header className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertCircle
                className="w-4 h-4 text-[#C46A76]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="font-serif-elite text-[18px]">
                {language === 'es' ? 'Alertas activas' : 'Active alerts'}
              </span>
            </span>
            <span
              className="text-[11px] uppercase tracking-[0.2em] font-medium px-2.5 py-1 rounded-full"
              style={{
                backgroundColor:
                  criticalCount > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.14)',
                color: criticalCount > 0 ? '#FCA5A5' : '#86EFAC',
              }}
            >
              {criticalCount}{' '}
              {language === 'es'
                ? criticalCount === 1
                  ? 'hallazgo crítico'
                  : 'hallazgos críticos'
                : criticalCount === 1
                  ? 'critical finding'
                  : 'critical findings'}
            </span>
          </EliteCard.Header>

          <EliteCard.Body>
            <ul className="flex flex-col gap-2.5">
              {findings.slice(0, 4).map((f, idx) => {
                const tone = SEVERITY_COLOR[f.severity];
                return (
                  <li
                    key={`${f.severity}-${idx}`}
                    className={cn(
                      'flex items-start gap-3 py-2 pl-3 pr-3 rounded-md',
                      'border-l-2',
                      tone.border,
                      'bg-[rgba(255,255,255,0.015)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="shrink-0 mt-1 inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tone.dot }}
                    />
                    <div className="min-w-0 flex-1 flex flex-col">
                      <p className="text-[13px] leading-relaxed text-[#F5F5F5]">
                        {f.description}
                      </p>
                      {f.norm && (
                        <p className="text-[11px] mt-0.5 text-[#A8A8A8] tracking-wide">
                          {f.norm}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </EliteCard.Body>
        </EliteCard>

        {/* CTA estrella: NIIF Elite */}
        <EliteCard
          variant="glass"
          padding="lg"
          className="flex flex-col justify-between gap-5 min-w-[280px]"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <BadgeCheck
                className="w-4 h-4 text-[#E8B42C]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="uppercase tracking-[0.22em] text-[11px] text-[#D4A017] font-medium">
                {language === 'es' ? 'Producto estrella' : 'Flagship product'}
              </span>
            </div>
            <h3 className="font-serif-elite text-[22px] leading-tight text-[#F5F5F5]">
              {language === 'es'
                ? 'Informe NIIF Elite completo'
                : 'Complete IFRS Elite Report'}
            </h3>
            <p className="text-[13px] leading-relaxed text-[#A8A8A8] font-light max-w-[32ch]">
              {language === 'es'
                ? 'Pipeline integral: Reporte NIIF + Auditoría regulatoria + Meta-auditor de calidad. El cierre definitivo de su verdad contable.'
                : 'End-to-end pipeline: IFRS report + regulatory audit + quality meta-auditor. The definitive closing of your accounting truth.'}
            </p>
          </div>
          <NiifEliteButton size="lg" className="w-full justify-center" />
        </EliteCard>
      </div>

      {/* ── Grid de submódulos ───────────────────────────────────────────── */}
      <div>
        <h3 className="font-serif-elite text-[24px] leading-tight text-[#F5F5F5] mb-4">
          {language === 'es' ? 'Módulos de aseguramiento' : 'Assurance modules'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {SUBMODULES.map((sm) => {
            const meta = verdad.submodules[sm.key];
            return (
              <SubmoduleCard
                key={sm.key}
                href={sm.href}
                icon={sm.icon}
                title={meta.title}
                description={meta.description}
              />
            );
          })}
        </div>
      </div>

      {/* ── Strip chat contextual (opcional informativo) ─────────────────── */}
      {!compact && (
        <div
          className={cn(
            'rounded-[12px] px-5 py-4',
            'bg-[rgba(212,160,23,0.04)]',
            'border border-[rgba(212,160,23,0.14)]',
            'flex flex-wrap items-center gap-x-5 gap-y-2',
          )}
        >
          <ClipboardCheck
            className="w-4 h-4 text-[#D4A017] shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="text-[13px] text-[#D4D4D4] flex-1 min-w-[240px]">
            {language === 'es' ? (
              <>
                <span className="text-[#F5F5F5] font-medium">Chat contextual.</span>{' '}
                Pregunte al asistente sobre cualquier hallazgo, partida conciliatoria
                o dictamen — el contexto se carga automáticamente.
              </>
            ) : (
              <>
                <span className="text-[#F5F5F5] font-medium">Contextual chat.</span>{' '}
                Ask the assistant about any finding, reconciliation item, or opinion
                — context loads automatically.
              </>
            )}
          </p>
          <Link
            href="/workspace"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium',
              'text-[#D4A017] hover:text-[#E8B42C]',
              'transition-colors',
            )}
          >
            {language === 'es' ? 'Abrir chat' : 'Open chat'}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}

// ─── Submodule card (interna) ────────────────────────────────────────────────

interface SubmoduleCardProps {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}

function SubmoduleCard({ href, icon: Icon, title, description }: SubmoduleCardProps) {
  const shouldReduce = useReducedMotion();
  return (
    <motion.div
      whileHover={shouldReduce ? undefined : { y: -3 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      className="h-full"
    >
      <Link
        href={href}
        className={cn(
          'group relative flex flex-col gap-4 h-full min-h-[200px]',
          'p-5 rounded-[12px]',
          'glass-elite-elevated border-elite-gold',
          'transition-[box-shadow,border-color] duration-300 ease-out',
          'hover:shadow-[0_0_40px_rgba(212,160,23,0.28)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div
            aria-hidden="true"
            className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(212,160,23,0.12)] text-[#E8B42C] transition-transform duration-300 group-hover:scale-105"
          >
            <Icon className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(212,160,23,0.22)] text-[#A8A8A8] transition-all duration-300 group-hover:text-[#E8B42C] group-hover:border-[rgba(232,180,44,0.55)] group-hover:bg-[rgba(212,160,23,0.12)] group-hover:translate-x-0.5"
          >
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="font-serif-elite text-[20px] leading-tight text-[#F5F5F5]">
            {title}
          </h4>
          <p className="text-[13px] leading-relaxed text-[#A8A8A8] font-light">
            {description}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}

// ─── Helpers públicos para páginas hijas ─────────────────────────────────────

export { ScoreArc, SEVERITY_COLOR };
