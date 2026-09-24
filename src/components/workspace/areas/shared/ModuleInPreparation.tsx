'use client';

/**
 * ModuleInPreparation — estado honesto para las subpáginas de área que aún no
 * están conectadas a datos de la empresa.
 *
 * Auditoría V7a-extra-01 / valoracion-03: las subpáginas de El Escudo, El Valor
 * y La Verdad eran maquetas estáticas con cifras literales (saldos a favor,
 * ahorros proyectados, tasa de éxito, WACC, casos con nombre de cliente…) sin
 * rótulo de demostración. Este componente las sustituye: título y descripción
 * del submódulo (i18n existente), rótulo visible "Módulo en preparación — sin
 * datos de su empresa" y, cuando existe un flujo real, el CTA que lo inicia.
 * Nunca muestra números.
 */

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Construction } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { EliteButton } from '@/components/ui/EliteButton';
import type { CaseType } from '@/types/platform';
import type { AreaAccent } from '@/components/workspace/layouts/AreaShell';

type AreaKey = Exclude<AreaAccent, 'pyme'>;

const AREA_HREF: Record<AreaKey, string> = {
  escudo: '/workspace/escudo',
  valor: '/workspace/valor',
  verdad: '/workspace/verdad',
  futuro: '/workspace/futuro',
};

const AREA_ACCENT: Record<AreaKey, string> = {
  escudo: '#A83838',
  valor: '#B8934A',
  verdad: '#3D6B7E',
  futuro: '#5A7F7A',
};

export interface ModuleInPreparationProps {
  area: AreaKey;
  /** Título del submódulo (normalmente `t.elite.areas.<area>.submodules.<k>.title`). */
  title: string;
  /** Descripción corta del submódulo (misma fuente i18n). */
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  /** Flujo real existente que el usuario puede iniciar con sus datos. */
  intakeCaseType?: CaseType;
}

export function ModuleInPreparation({
  area,
  title,
  description,
  icon: Icon,
  intakeCaseType,
}: ModuleInPreparationProps) {
  const { t } = useLanguage();
  const { openIntakeForType } = useWorkspace();
  const ds = t.elite.dataStatus;
  const areaName = t.elite.areas[area].concept;
  const accent = AREA_ACCENT[area];

  return (
    <div className="relative w-full min-h-full overflow-y-auto" data-module-status="in-preparation">
      <div className="relative z-[1] max-w-[860px] mx-auto px-4 md:px-10 pt-6 pb-24 space-y-8">
        <Link
          href={AREA_HREF[area]}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-n-600 hover:text-n-1000 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {ds.backTo} {areaName}
        </Link>

        <header className="space-y-2">
          <div
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            <span>
              {areaName} — {title}
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-n-1000">{title}</h1>
          <p className="max-w-xl text-base leading-relaxed text-n-700">{description}</p>
        </header>

        <section
          role="status"
          aria-live="polite"
          className="flex items-start gap-4 rounded-xl border border-n-300 bg-n-100 px-5 py-4"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
          >
            <Construction className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-n-1000">{ds.moduleInPreparationNotice}</p>
            <p className="text-sm leading-relaxed text-n-700">{ds.moduleInPreparationBody}</p>
          </div>
        </section>

        {intakeCaseType && (
          <EliteButton
            variant="primary"
            size="md"
            rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={2} />}
            onClick={() => openIntakeForType(intakeCaseType)}
          >
            {ds.startAnalysis}
          </EliteButton>
        )}
      </div>
    </div>
  );
}

export default ModuleInPreparation;
