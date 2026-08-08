'use client';

import Link from 'next/link';
import {
  Zap,
  ArrowLeft,
  Shield,
  FileCheck,
  PieChart,
  PiggyBank,
  Percent,
  Cpu,
  AlertTriangle,
} from 'lucide-react';

const ACCENT = '#A83838';

interface DefenseCard {
  icon: React.ReactNode;
  name: string;
  description: string;
  badge: string;
  badgeColor: 'green' | 'warning' | 'accent';
}

const cards: DefenseCard[] = [
  {
    icon: <Shield size={22} />,
    name: 'AntiDIAN',
    description: 'Blindaje total contra requerimientos DIAN',
    badge: 'Activo',
    badgeColor: 'green',
  },
  {
    icon: <FileCheck size={22} />,
    name: 'Retenciones',
    description: 'Retenciones en la fuente verificadas',
    badge: 'Al día',
    badgeColor: 'green',
  },
  {
    icon: <PieChart size={22} />,
    name: 'Dividendos',
    description: 'Distribución de dividendos bajo análisis',
    badge: 'En revisión',
    badgeColor: 'warning',
  },
  {
    icon: <PiggyBank size={22} />,
    name: 'Reserva Contingencia',
    description: '3.5 meses de reserva fiscal disponible',
    badge: 'Activo',
    badgeColor: 'green',
  },
  {
    icon: <Percent size={22} />,
    name: 'TET',
    description: 'Tasa efectiva de tributación actual',
    badge: '28.4%',
    badgeColor: 'accent',
  },
  {
    icon: <Cpu size={22} />,
    name: 'Sintetizador',
    description: 'Motor de optimización ejecutándose',
    badge: 'Operativo',
    badgeColor: 'green',
  },
];

const badgeStyles: Record<DefenseCard['badgeColor'], string> = {
  green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30',
  accent: 'ring-1 ring-[#A83838]/40',
};

export default function SupervivenciaPage() {
  return (
    <div className="min-h-screen bg-n-50 text-n-1000">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Back link */}
        <Link
          href="/workspace/escudo"
          className="inline-flex items-center gap-2 text-n-700 hover:text-n-1000 transition-colors mb-8 group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm font-medium">Volver a El Escudo</span>
        </Link>

        {/* Page heading */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg"
              style={{ background: `${ACCENT}1A`, color: ACCENT }}
            >
              <Zap size={16} />
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-n-500">
              El Escudo
            </span>
          </div>
          <h1 className="text-3xl font-bold text-n-1000 mb-2">Modo Supervivencia</h1>
          <p className="text-n-700 text-base max-w-2xl">
            Controles de blindaje activados cuando el riesgo sube. Seis defensas que protegen su flujo y su reputación fiscal.
          </p>
        </div>

        {/* Alert banner */}
        <div
          className="flex items-start gap-3 rounded-xl px-5 py-4 mb-8 ring-1"
          style={{
            background: `${ACCENT}12`,
            borderColor: `${ACCENT}40`,
          }}
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: ACCENT }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: ACCENT }}>
              Protocolo de emergencia tributaria activado
            </p>
            <p className="text-n-700 text-sm mt-0.5">
              Todas las defensas están monitoreadas en tiempo real. Revise cada control para validar el estado actual.
            </p>
          </div>
        </div>

        {/* Section header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-n-1000 text-lg">Defensas activas</h2>
          {/* n-500 sobre n-100 da 3.24:1 y esto es texto-xs con contenido real
              (el conteo de controles), no un eyebrow decorativo: n-700 → 7.85:1. */}
          <span className="text-xs font-medium text-n-700 bg-n-100 px-2.5 py-1 rounded-full">
            6 controles
          </span>
        </div>

        {/* 6-card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <article
              key={card.name}
              className="group relative flex flex-col gap-3 rounded-2xl border border-n-200 bg-n-0 p-5 hover:border-[#A83838]/40 hover:shadow-md transition-all cursor-pointer"
            >
              {/* Icon */}
              <div
                className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                style={{
                  background:
                    card.badgeColor === 'green'
                      ? 'rgb(16 185 129 / 0.12)'
                      : card.badgeColor === 'warning'
                      ? 'rgb(245 158 11 / 0.12)'
                      : `${ACCENT}1A`,
                  color:
                    card.badgeColor === 'green'
                      ? '#10B981'
                      : card.badgeColor === 'warning'
                      ? '#F59E0B'
                      : ACCENT,
                }}
              >
                {card.icon}
              </div>

              {/* Text */}
              <div className="flex-1">
                <p className="font-semibold text-n-1000 text-sm mb-1">{card.name}</p>
                <p className="text-n-700 text-xs leading-relaxed">{card.description}</p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-n-100">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${badgeStyles[card.badgeColor]}`}
                  style={
                    card.badgeColor === 'accent'
                      ? { background: `${ACCENT}15`, color: ACCENT }
                      : undefined
                  }
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background:
                        card.badgeColor === 'green'
                          ? '#10B981'
                          : card.badgeColor === 'warning'
                          ? '#F59E0B'
                          : ACCENT,
                    }}
                  />
                  {card.badge}
                </span>
                <span className="text-n-500 group-hover:text-n-800 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M3 7h8M7 3l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
