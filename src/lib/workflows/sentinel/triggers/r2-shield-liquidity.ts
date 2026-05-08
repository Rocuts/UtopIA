// ---------------------------------------------------------------------------
// T2 — Escudo / Liquidity Risk
// ---------------------------------------------------------------------------
// Dispara cuando: días de autonomía < 45  OR  efectivo < utilidad × 35%.
// El insight resultante usa `escudo/critico/es|en` y vars con impuesto
// proyectado y reducción de autonomía estimada.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const TAX_RATE = 0.35;
const AUTONOMY_THRESHOLD_DAYS = 45;

export function runT2(
  metrics: SentinelMetrics,
  ctx: { workspaceId: string; periodId?: string | null; language?: 'es' | 'en'; empresarioNombre?: string },
): TriggerEvaluation {
  const expectedTax = Math.max(0, metrics.utilidadNeta) * TAX_RATE;
  const autonomyTrigger =
    metrics.diasAutonomia !== null && metrics.diasAutonomia < AUTONOMY_THRESHOLD_DAYS;
  const cashTrigger = metrics.efectivo < expectedTax;
  if (!autonomyTrigger && !cashTrigger) return { fired: false };

  // Reducción de autonomía si se materializara la salida fiscal:
  // (impuestoEsperado / efectivo) % aproximado.
  const pctReduccion = metrics.efectivo > 0 ? Math.min(100, Math.round((expectedTax / metrics.efectivo) * 100)) : 100;

  const insight = fillInsightFromTemplate({
    pillar: 'escudo',
    severity: 'critico',
    triggerCode: 'T2',
    dedupKey: `T2-escudo-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language: ctx.language ?? 'es',
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      impuesto_proyectado: formatCop(expectedTax),
      provision_actual: formatCop(metrics.impuestos),
      pct_reduccion: pctReduccion,
      dias_autonomia: metrics.diasAutonomia ?? 0,
    },
  });
  return { fired: true, insight };
}

function formatCop(n: number): string {
  return `$${Math.abs(n).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}
