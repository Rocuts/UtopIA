// ---------------------------------------------------------------------------
// T4 — Futuro / Inflection Point
// ---------------------------------------------------------------------------
// Dispara cuando el escenario conservador (-15%) proyecta caja negativa en
// los próximos 12 meses. El insight resultante usa `futuro/critico` y vars
// con el mes/año exacto y trimestre.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const INFLECTION_THRESHOLD_MONTHS = 12;

export function runT4(
  metrics: SentinelMetrics,
  ctx: {
    workspaceId: string;
    periodId?: string | null;
    language?: 'es' | 'en';
    empresarioNombre?: string;
    /** Año/mes desde el cual proyectar (default: hoy). */
    referenceDate?: Date;
  },
): TriggerEvaluation {
  if (metrics.puntoInflexion === null) return { fired: false };
  if (metrics.puntoInflexion >= INFLECTION_THRESHOLD_MONTHS) return { fired: false };

  const ref = ctx.referenceDate ?? new Date();
  const inflectionDate = new Date(ref);
  inflectionDate.setMonth(inflectionDate.getMonth() + metrics.puntoInflexion);
  const monthYear = inflectionDate.toLocaleDateString(ctx.language === 'en' ? 'en-US' : 'es-CO', {
    month: 'long',
    year: 'numeric',
  });
  const trimestre = `T${Math.floor(inflectionDate.getMonth() / 3) + 1} ${inflectionDate.getFullYear()}`;

  const insight = fillInsightFromTemplate({
    pillar: 'futuro',
    severity: 'critico',
    triggerCode: 'T4',
    dedupKey: `T4-futuro-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language: ctx.language ?? 'es',
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      meses_inflexion: metrics.puntoInflexion,
      mes_anio_inflexion: monthYear,
      trimestre_inflexion: trimestre,
    },
  });
  return { fired: true, insight };
}
