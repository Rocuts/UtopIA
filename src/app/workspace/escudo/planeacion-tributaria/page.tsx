'use client';

import Link from 'next/link';
import { ArrowLeft, Shield, FlaskConical, UserPlus, MapPin, GitMerge, Heart } from 'lucide-react';

const ACCENT = '#A83838';

const stats = [
  { label: 'Ahorro proyectado', value: '$420M', accent: true },
  { label: 'Estrategias', value: '5', accent: false },
  { label: 'TEF objetivo', value: '24,0%', accent: false },
];

const strategies = [
  {
    Icon: FlaskConical,
    title: 'Deducción por inversión en I+D+i',
    legal: 'Art. 256 E.T.',
    savings: 'Ahorro $180M',
    priority: 'Alta',
    priorityColor: 'bg-[#A83838]/10 text-[#A83838]',
  },
  {
    Icon: UserPlus,
    title: 'Descuento por primer empleo joven',
    legal: 'Art. 108-5 E.T.',
    savings: 'Ahorro $95M',
    priority: 'Alta',
    priorityColor: 'bg-[#A83838]/10 text-[#A83838]',
  },
  {
    Icon: MapPin,
    title: 'Beneficios de zona económica (ZESE)',
    legal: 'Art. 268 Ley 2010',
    savings: 'Ahorro $76M',
    priority: 'Media',
    priorityColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    Icon: GitMerge,
    title: 'Reorganización societaria',
    legal: 'Art. 319 E.T.',
    savings: 'Ahorro $45M',
    priority: 'Media',
    priorityColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    Icon: Heart,
    title: 'Donaciones con descuento tributario',
    legal: 'Art. 257 E.T.',
    savings: 'Ahorro $24M',
    priority: 'Baja',
    priorityColor: 'bg-n-200 text-n-600',
  },
];

export default function PlaneacionTributariaPage() {
  return (
    <div className="relative w-full min-h-full overflow-y-auto">
      <div className="relative z-[1] max-w-[1240px] mx-auto px-6 md:px-10 pt-6 pb-24 space-y-10">

        {/* Back link */}
        <Link
          href="/workspace/escudo"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-500 hover:text-n-1000 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Volver a El Escudo
        </Link>

        {/* Heading */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-n-500">
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            El Escudo — Planeación Tributaria
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-n-1000 leading-tight">
            Planeación Tributaria
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-n-700">
            Optimización lícita de su carga fiscal. Modelamos escenarios para bajar su Tasa
            Efectiva de Tributación sin riesgo.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map(({ label, value, accent }) => (
            <div
              key={label}
              className="rounded-xl border border-n-200 bg-n-100 dark:bg-n-900 dark:border-n-700 px-5 py-4 space-y-1"
            >
              <div className="text-xs font-medium text-n-500 uppercase tracking-wide">{label}</div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={accent ? { color: ACCENT } : undefined}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Strategies */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-n-500">
            Estrategias
          </h2>
          <div className="space-y-3">
            {strategies.map(({ Icon, title, legal, savings, priority, priorityColor }) => (
              <div
                key={title}
                className="flex items-center gap-4 rounded-xl border border-n-200 bg-n-100 dark:bg-n-900 dark:border-n-700 px-5 py-4"
              >
                {/* Icon container */}
                <div
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${ACCENT}1A`, color: ACCENT }}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-sm font-semibold text-n-1000 leading-snug">{title}</div>
                  <div className="text-xs text-n-600">{legal} · {savings}</div>
                </div>

                {/* Priority badge */}
                <span
                  className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${priorityColor}`}
                >
                  {priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
