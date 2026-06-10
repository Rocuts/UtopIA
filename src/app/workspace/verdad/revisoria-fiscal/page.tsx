'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Eye,
  BookOpen,
  FileText,
  ClipboardList,
  Building2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Area accent ──────────────────────────────────────────────────────────────
const ACCENT = '#3D6B7E';

// ─── Stats ────────────────────────────────────────────────────────────────────
const STATS = [
  { label: 'Score', value: '94/100', accent: true },
  { label: 'Hallazgos', value: '2', accent: false },
  { label: 'Subsanados', value: '18', accent: false },
];

// ─── Checklist ────────────────────────────────────────────────────────────────
type CheckStatus = 'ok' | 'warning';

interface CheckItem {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  meta: string;
  status: CheckStatus;
  badge: string;
}

const CHECKLIST: CheckItem[] = [
  {
    icon: BookOpen,
    title: 'Libros contables',
    meta: 'Registros actualizados y foliados',
    status: 'ok',
    badge: 'Al día',
  },
  {
    icon: FileText,
    title: 'Declaraciones tributarias',
    meta: 'IVA, renta y retenciones verificados',
    status: 'ok',
    badge: 'Al día',
  },
  {
    icon: ClipboardList,
    title: 'Libros de actas',
    meta: '2 actas de junta pendientes de firma',
    status: 'warning',
    badge: 'Pendiente',
  },
  {
    icon: Building2,
    title: 'Aportes parafiscales',
    meta: 'SENA, ICBF y Caja compensación al día',
    status: 'ok',
    badge: 'Al día',
  },
];

export default function RevisoriaFiscalPage() {
  return (
    <div
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">

        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-n-500 hover:text-n-800 transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Volver a La Verdad
        </Link>

        {/* Heading */}
        <div className="flex flex-col gap-2">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-n-500">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded"
              style={{ color: ACCENT }}
              aria-hidden="true"
            >
              <Eye className="w-4 h-4" strokeWidth={2} />
            </span>
            La Verdad — Revisoría Fiscal
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-n-1000 leading-tight">
            Revisoría Fiscal
          </h1>
          <p className="text-base text-n-700 max-w-xl">
            Vigilancia permanente del cumplimiento legal y estatutario de su empresa.
          </p>
        </div>

        {/* Stats row */}
        <section aria-label="Cumplimiento">
          <div className="text-xs uppercase tracking-widest text-n-500 mb-3">
            Cumplimiento
          </div>
          <div className="grid grid-cols-3 gap-4 max-w-2xl">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-n-200 bg-n-100 px-5 py-4 flex flex-col gap-1"
              >
                <span className="text-xs text-n-600 uppercase tracking-widest">
                  {s.label}
                </span>
                <span
                  className={cn(
                    'text-3xl font-bold leading-none',
                    s.accent ? '' : 'text-n-1000',
                  )}
                  style={s.accent ? { color: ACCENT } : undefined}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Checklist */}
        <section aria-label="Lista de verificación">
          <div className="text-xs uppercase tracking-widest text-n-500 mb-3">
            Lista de verificación
          </div>
          <div className="flex flex-col divide-y divide-n-200 rounded-xl border border-n-200 bg-n-100 overflow-hidden max-w-2xl">
            {CHECKLIST.map((item) => {
              const Icon = item.icon;
              const isOk = item.status === 'ok';
              return (
                <div
                  key={item.title}
                  className="flex items-center gap-4 px-5 py-4"
                >
                  {/* Status icon */}
                  <span
                    className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full"
                    style={{
                      backgroundColor: isOk
                        ? 'rgba(34,197,94,0.12)'
                        : 'rgba(234,179,8,0.12)',
                      color: isOk ? '#16a34a' : '#ca8a04',
                    }}
                    aria-hidden="true"
                  >
                    {isOk ? (
                      <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                    ) : (
                      <AlertTriangle className="w-4 h-4" strokeWidth={2} />
                    )}
                  </span>

                  {/* Area icon */}
                  <span
                    className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{
                      backgroundColor: `${ACCENT}18`,
                      color: ACCENT,
                    }}
                    aria-hidden="true"
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                  </span>

                  {/* Text */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium text-n-1000">
                      {item.title}
                    </span>
                    <span className="text-xs text-n-700">{item.meta}</span>
                  </div>

                  {/* Badge */}
                  <span
                    className={cn(
                      'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      isOk
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700',
                    )}
                  >
                    {item.badge}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
