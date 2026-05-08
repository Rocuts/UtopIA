// ---------------------------------------------------------------------------
// T3 — Valor / Margin Anomaly
// ---------------------------------------------------------------------------
// Dispara cuando: días de inventario > 365  OR  margen bruto > 90%.
// El insight resultante usa `valor/advertencia` y vars con porcentajes.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const INVENTORY_THRESHOLD_DAYS = 365;
const MARGIN_THRESHOLD = 0.90;

export function runT3(
  metrics: SentinelMetrics,
  ctx: { workspaceId: string; periodId?: string | null; language?: 'es' | 'en'; empresarioNombre?: string },
): TriggerEvaluation {
  const inventoryTrigger =
    metrics.diasInventario !== null && metrics.diasInventario > INVENTORY_THRESHOLD_DAYS;
  const marginTrigger =
    metrics.margenBruto !== null && metrics.margenBruto > MARGIN_THRESHOLD;
  if (!inventoryTrigger && !marginTrigger) return { fired: false };

  const insight = fillInsightFromTemplate({
    pillar: 'valor',
    severity: 'advertencia',
    triggerCode: 'T3',
    dedupKey: `T3-valor-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language: ctx.language ?? 'es',
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      margen_bruto_pct:
        metrics.margenBruto !== null ? (metrics.margenBruto * 100).toFixed(0) : '—',
      dias_inventario: metrics.diasInventario ?? 0,
    },
  });
  return { fired: true, insight };
}
