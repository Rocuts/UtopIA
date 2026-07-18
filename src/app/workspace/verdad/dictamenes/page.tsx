'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  Stamp,
  Award,
  CalendarCheck,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Accent colour for verdad area ──────────────────────────────────────────
const ACCENT = '#3D6B7E';

// ─── Types ───────────────────────────────────────────────────────────────────

type Grade = 'A' | 'B' | 'C';

interface Dictamen {
  id: string;
  title: string;
  opinion: string;
  excerpt: string;
  grade: Grade;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const DICTAMENES: Dictamen[] = [
  {
    id: 'eeff-2025',
    title: 'Estados Financieros 2025',
    opinion: 'Opinión limpia · sin salvedades',
    excerpt:
      'Los EEFF presentan razonablemente la situación financiera de la entidad en todos sus aspectos materiales, de conformidad con NIIF para PYMES.',
    grade: 'A',
  },
  {
    id: 'tributario-2025',
    title: 'Declaraciones Tributarias',
    opinion: 'Opinión limpia con énfasis',
    excerpt:
      'Cumplimiento formal verificado ante la DIAN. Se hace énfasis en la conciliación del impuesto diferido pendiente de agotar en el ejercicio 2026.',
    grade: 'A',
  },
  {
    id: 'control-interno-2025',
    title: 'Control Interno',
    opinion: 'Opinión con salvedades',
    excerpt:
      'Se identificaron 3 deficiencias significativas en segregación de funciones del área de tesorería. Plan de remediación en curso.',
    grade: 'B',
  },
  {
    id: 'sagrlaft-2025',
    title: 'SAGRLAFT 2025',
    opinion: 'Opinión limpia · sistema operativo',
    excerpt:
      'Programa de compliance aprobado por la UIAF. Controles LA/FT implementados y operativos conforme a la Circular Básica Jurídica.',
    grade: 'A',
  },
];

// ─── Grade badge ──────────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: Grade }) {
  const styles: Record<Grade, string> = {
    A: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30',
    B: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30',
    C: 'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0',
        styles[grade],
      )}
      aria-label={`Calificación ${grade}`}
    >
      {grade}
    </span>
  );
}

// ─── Grade icon ───────────────────────────────────────────────────────────────

function GradeIcon({ grade }: { grade: Grade }) {
  if (grade === 'A') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} aria-hidden="true" />;
  }
  return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" strokeWidth={2} aria-hidden="true" />;
}

// ─── Stats row ────────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Dictámenes emitidos', value: '4' },
  { label: 'Vigentes', value: '4' },
  { label: 'Próximo vencimiento', value: '90 días' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DictamenesPage() {
  const shouldReduce = useReducedMotion();

  return (
    <div data-lenis-prevent className="min-h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">

        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-n-500 hover:text-n-800 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Volver a La Verdad
        </Link>

        {/* Heading */}
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2.5">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: `${ACCENT}22`, color: ACCENT }}
              aria-hidden="true"
            >
              <Award className="w-5 h-5" strokeWidth={1.6} />
            </span>
            <span
              className="text-xs uppercase tracking-[0.18em] font-medium"
              style={{ color: ACCENT }}
            >
              La Verdad — Dictámenes
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-n-1000 leading-tight">
            Dictámenes
          </h1>
          <p className="text-base text-n-700 leading-relaxed max-w-xl">
            Opinión técnica especializada por materia. Damos fe del cumplimiento con criterio independiente.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-n-200/60 dark:border-n-700/40 bg-n-50/60 dark:bg-n-900/40 px-4 py-4 flex flex-col gap-1 text-center"
            >
              <span
                className="text-2xl font-semibold tabular-nums"
                style={{ color: ACCENT }}
              >
                {s.value}
              </span>
              <span className="text-xs text-n-600 leading-snug">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Section title */}
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-n-900 uppercase tracking-[0.1em]">
            Dictámenes vigentes
          </h2>
          <span className="text-xs text-n-500 tabular-nums">4 emitidos</span>
        </div>

        {/* Dictámenes list */}
        <div className="flex flex-col gap-3">
          {DICTAMENES.map((d, idx) => (
            <motion.div
              key={d.id}
              initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
              whileInView={shouldReduce ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -6% 0px' }}
              transition={{ delay: idx * 0.06, duration: 0.35 }}
            >
              <div className="rounded-xl border border-n-200/70 dark:border-n-700/40 bg-n-50/60 dark:bg-n-900/40 px-5 py-4 flex items-start gap-4 hover:border-[#3D6B7E]/40 transition-colors">
                {/* Icon */}
                <span
                  className="mt-0.5 shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ background: `${ACCENT}1A`, color: ACCENT }}
                  aria-hidden="true"
                >
                  <Stamp className="w-5 h-5" strokeWidth={1.6} />
                </span>

                {/* Text */}
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <GradeIcon grade={d.grade} />
                    <span className="text-xs text-n-500">{d.opinion}</span>
                  </div>
                  <p className="text-base font-semibold text-n-1000 leading-snug">
                    {d.title}
                  </p>
                  <p className="text-sm text-n-700 leading-relaxed line-clamp-2">
                    {d.excerpt}
                  </p>
                </div>

                {/* Grade badge */}
                <GradeBadge grade={d.grade} />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Callout: Próxima emisión */}
        <div
          className="rounded-xl border px-5 py-4 flex items-start gap-3"
          style={{
            borderColor: `${ACCENT}33`,
            background: `${ACCENT}0D`,
          }}
        >
          <CalendarCheck
            className="w-5 h-5 mt-0.5 shrink-0"
            style={{ color: ACCENT }}
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>
              Próxima emisión
            </span>
            <p className="text-sm text-n-800 leading-relaxed">
              Dictamen EEFF 2026 — fecha límite de emisión:{' '}
              <span className="font-medium text-n-1000">30 septiembre 2026</span>.
              Documentación en preparación. Asegúrese de tener los estados financieros de corte al 31 de diciembre de 2025 debidamente aprobados.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
