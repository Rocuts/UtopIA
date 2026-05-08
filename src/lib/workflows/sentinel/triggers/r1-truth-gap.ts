// ---------------------------------------------------------------------------
// T1 — Verdad / Truth Gap
// ---------------------------------------------------------------------------
// Dispara cuando |equationDiff| / totalActivo > 0.01% (≥ 0.0001).
// El insight resultante usa la plantilla `verdad/critico/es|en` y vars con
// el monto exacto del descalce.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const GAP_THRESHOLD = 0.0001; // 0.01%

export function runT1(
  metrics: SentinelMetrics & { equationGapAmount: number },
  ctx: { workspaceId: string; periodId?: string | null; language?: 'es' | 'en'; empresarioNombre?: string },
): TriggerEvaluation {
  if (Math.abs(metrics.equationGapPct) <= GAP_THRESHOLD) {
    return { fired: false };
  }

  const insight = fillInsightFromTemplate({
    pillar: 'verdad',
    severity: 'critico',
    triggerCode: 'T1',
    dedupKey: `T1-verdad-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language: ctx.language ?? 'es',
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      monto_diferencia: formatCop(metrics.equationGapAmount),
    },
  });
  return { fired: true, insight };
}

function formatCop(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}
