// ---------------------------------------------------------------------------
// Alert mapping — FiscalAlerta → Insight (Capa 5)
// ---------------------------------------------------------------------------
// Mapea las alertas determinísticas del FiscalAnchor al modelo `Insight`
// (sentinel_alerts). Cero LLM.
// Conversión DB-row → AlertView para la UI: @/lib/sentinel/alert-view
// Contrato congelado: docs/wave-notes/escudo-autowire-contract.md §4.3.
// ---------------------------------------------------------------------------

import type {
  FiscalAlerta,
  FiscalAnchorBlock,
} from './types';
import type {
  Insight,
  InsightSeverity,
} from '@/lib/notifications/insight-types';
import { saldoAFavorCents } from '../fiscal-agent/tools/risk-score-calculator';

interface AlertMeta {
  /** Código corto del trigger (sentinel_alerts.trigger_code, varchar ≤ 8). */
  triggerCode: string;
  /** Mapeo de severidad fiscal → severidad del Insight. */
  severity: InsightSeverity;
  /** Título legible (ES). */
  titulo: string;
  /** Acción recomendada (label corto, ES). */
  accionLabel: string;
}

// Mapa estático por código. `triggerCode` ≤ 8 chars (varchar(8) de la tabla).
// titulo/accion son labels ES que el payload del Insight preserva; la UI los
// muestra directamente o los re-i18n por `mensaje` (i18n key).
const ALERT_META: Record<FiscalAlerta['codigo'], AlertMeta> = {
  A5_SIN_PROVISION: {
    triggerCode: 'ESC_A5',
    severity: 'critico',
    titulo: 'Utilidad sin impuesto causado',
    accionLabel: 'Provisionar impuesto de renta',
  },
  SALDO_A_FAVOR: {
    triggerCode: 'ESC_SF',
    severity: 'informativo',
    titulo: 'Saldo a favor identificado',
    accionLabel: 'Solicitar devolución o compensación',
  },
  VENCIMIENTO_15D: {
    triggerCode: 'ESC_V15',
    severity: 'advertencia',
    titulo: 'Vencimiento DIAN en ≤ 15 días',
    accionLabel: 'Preparar y presentar la obligación',
  },
  F10_BAJA: {
    triggerCode: 'ESC_F10',
    severity: 'advertencia',
    titulo: 'Cobertura de retenciones baja',
    accionLabel: 'Revisar flujo de caja para el pago',
  },
  ICA_ESTIMACION_SIN_CIIU: {
    triggerCode: 'ESC_ICA',
    severity: 'informativo',
    titulo: 'ICA estimado sin CIIU verificado',
    accionLabel: 'Verificar CIIU y tarifa municipal',
  },
};

/**
 * Impacto monetario asociado a una alerta, en centavos string (MoneyCop), o
 * `undefined` si la alerta no tiene una cifra de impacto natural. Determinístico
 * — derivado del `anchor`, no de un LLM.
 */
function impactoCentsForAlert(
  codigo: FiscalAlerta['codigo'],
  anchor: FiscalAnchorBlock,
): string | undefined {
  switch (codigo) {
    case 'A5_SIN_PROVISION':
      // Impuesto de referencia no provisionado (F02).
      return anchor.f02;
    case 'SALDO_A_FAVOR':
      // Saldo a favor procedimentable (|F04| si F04 < 0).
      return saldoAFavorCents(anchor);
    default:
      return undefined;
  }
}

/**
 * Convierte una `FiscalAlerta` en un `Insight` listo para `upsertAlert`.
 * `dedupKey = escudo:${period}:${codigo}` ⇒ idempotente por (workspace, periodo,
 * código): re-generar el reporte actualiza la alerta en vez de duplicarla.
 */
export function fiscalAlertaToInsight(
  alerta: FiscalAlerta,
  anchor: FiscalAnchorBlock,
  period: string,
  workspaceId: string,
  generatedAt: string,
): Insight {
  const meta = ALERT_META[alerta.codigo];
  const impacto = impactoCentsForAlert(alerta.codigo, anchor);
  return {
    pillar: 'escudo',
    severity: meta.severity,
    triggerCode: meta.triggerCode,
    dedupKey: `escudo:${period}:${alerta.codigo}`,
    subject: meta.titulo,
    hallazgo: alerta.mensaje,
    impacto: impacto ?? '',
    accionRecomendada: { label: meta.accionLabel, href: '/workspace/escudo' },
    vars: {
      codigo: alerta.codigo,
      mensaje: alerta.mensaje,
      norma: alerta.norma,
      titulo: meta.titulo,
      accion: meta.accionLabel,
      ...(impacto ? { impacto } : {}),
    },
    tone: 'normal',
    generatedAt,
    workspaceId,
  };
}
