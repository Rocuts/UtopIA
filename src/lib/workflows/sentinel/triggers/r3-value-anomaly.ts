// ---------------------------------------------------------------------------
// T3 — Valor / Margin Anomaly
// ---------------------------------------------------------------------------
// Dispara cuando: días de inventario > 365  OR  margen bruto > 90%.
// El insight usa `valor/advertencia` con el asunto y el impacto de la
// condición que disparó (ICU-06): margen, inventario o ambos.
// ---------------------------------------------------------------------------

import { fillInsightFromTemplate, getValorAnomaliaTemplate } from '@/lib/notifications/insight-templates';
import type { TriggerEvaluation, SentinelMetrics } from '../types';

const INVENTORY_THRESHOLD_DAYS = 365;
const MARGIN_THRESHOLD = 0.90;

/**
 * Margen en porcentaje con un decimal cuando hace falta (ICU-06): «90,4 %»
 * no se imprime como «90 %» junto a un umbral «> 90 %»; 95 % sigue «95%».
 */
function formatMargenPct(margen: number, language: 'es' | 'en'): string {
  const pct = Math.round(margen * 1000) / 10;
  const txt = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${language === 'es' ? txt.replace('.', ',') : txt}%`;
}

export function runT3(
  metrics: SentinelMetrics,
  ctx: { workspaceId: string; periodId?: string | null; language?: 'es' | 'en'; empresarioNombre?: string },
): TriggerEvaluation {
  const inventoryTrigger =
    metrics.diasInventario !== null && metrics.diasInventario > INVENTORY_THRESHOLD_DAYS;
  const marginTrigger =
    metrics.margenBruto !== null && metrics.margenBruto > MARGIN_THRESHOLD;
  if (!inventoryTrigger && !marginTrigger) return { fired: false };

  const language = ctx.language ?? 'es';
  const sinDato = language === 'en' ? 'N/A' : 'N/D';
  const disparador = inventoryTrigger && marginTrigger ? 'ambos' : marginTrigger ? 'margen' : 'inventario';
  const insight = fillInsightFromTemplate({
    pillar: 'valor',
    severity: 'advertencia',
    template: getValorAnomaliaTemplate(disparador, language),
    triggerCode: 'T3',
    dedupKey: `T3-valor-${ctx.workspaceId}-${ctx.periodId ?? 'global'}`,
    workspaceId: ctx.workspaceId,
    language,
    vars: {
      empresario_nombre: ctx.empresarioNombre ?? 'empresario',
      // El '%' viaja en la variable: T3 puede dispararse sólo por inventario
      // con margen sin dato, y la plantilla imprimía "—%".
      margen_bruto_pct:
        metrics.margenBruto !== null ? formatMargenPct(metrics.margenBruto, language) : sinDato,
      // Sin dato es N/D, nunca "0 días" (ratios-kpis-26): el KPI del
      // preprocesador (`controlTotals.diasInventario`) puede ser null con
      // motivo (costos < 1 %, periodo sin meses) y T3 puede dispararse sólo
      // por el margen.
      dias_inventario:
        metrics.diasInventario !== null ? Math.round(metrics.diasInventario) : sinDato,
    },
  });
  return { fired: true, insight };
}
