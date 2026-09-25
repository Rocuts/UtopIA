// ---------------------------------------------------------------------------
// T2 — Escudo / Liquidity Risk
// ---------------------------------------------------------------------------
// Dispara cuando los días de autonomía (efectivo PUC 11 / egresos diarios del
// periodo, pilar Escudo) caen por debajo de 45.
//   - < 30 días  → `escudo/critico`     (autonomía de caja crítica)
//   - 30–45 días → `escudo/advertencia` (liquidez bajo umbral)
//
// IW4 (ratios-kpis-10): antes también disparaba con "efectivo < utilidad ×
// 35 %" y el correo afirmaba un "impuesto de renta proyectado" = UN × 35 %.
// La utilidad contable no es base fiscal y el grupo 24 mezcla IVA, ICA y
// retenciones: sin renta líquida verificada no hay disparador ni cifra fiscal.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const AUTONOMY_THRESHOLD_DAYS = 45;
const AUTONOMY_CRITICAL_DAYS = 30;

export function runT2(
  metrics: SentinelMetrics,
  ctx: { workspaceId: string; periodId?: string | null; language?: 'es' | 'en'; empresarioNombre?: string },
): TriggerEvaluation {
  const dias = metrics.diasAutonomia;
  if (dias === null || !Number.isFinite(dias) || dias >= AUTONOMY_THRESHOLD_DAYS) {
    return { fired: false };
  }

  const insight = fillInsightFromTemplate({
    pillar: 'escudo',
    severity: dias < AUTONOMY_CRITICAL_DAYS ? 'critico' : 'advertencia',
    triggerCode: 'T2',
    dedupKey: `T2-escudo-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language: ctx.language ?? 'es',
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      dias_autonomia: Math.max(0, Math.round(dias)),
    },
  });
  return { fired: true, insight };
}
