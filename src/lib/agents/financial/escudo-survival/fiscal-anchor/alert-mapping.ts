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
  // Utilidad contable sin gasto de renta (grupo 54): hallazgo informativo sin
  // cifra. La UAI no es base fiscal y F02 (35 % × UAI) no es el impuesto; si
  // hay renta por causar lo determina la depuración (Art. 26 E.T.), igual que
  // CUR-R4 del curator (re-auditoría 2026-09, NM-05).
  A5_SIN_PROVISION: {
    triggerCode: 'ESC_A5',
    severity: 'informativo',
    titulo: 'Sin gasto de renta causado — requiere depuración fiscal',
    accionLabel: 'Verificar con el contador la causación y la depuración de la renta',
  },
  // F04 < 0 es una estimación contable (UAI × 35% − F03), no el saldo a favor
  // de la declaración: sin impacto monetario ni acción de devolución
  // (auditoría 2026-09, tributario-modulos-02; riesgo Art. 670 E.T.).
  SALDO_A_FAVOR: {
    triggerCode: 'ESC_SF',
    severity: 'informativo',
    titulo: 'Posible saldo a favor (estimación contable, no liquidación)',
    accionLabel: 'Verificar contra la declaración de renta (Formulario 110)',
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
 * `undefined` si la alerta no tiene una cifra de impacto anclada. Hoy ninguna
 * la tiene:
 *   - A5_SIN_PROVISION: F02 = 35 % × UAI es una referencia contable, no el
 *     impuesto omitido (Art. 26 E.T.; re-auditoría 2026-09, NM-05).
 *   - SALDO_A_FAVOR: |F04| no es un saldo a favor determinable.
 * Una alerta futura sólo puede publicar impacto si la cifra sale del `anchor`
 * con base verificada (nunca de un LLM ni de la UAI).
 */
function impactoCentsForAlert(codigo: FiscalAlerta['codigo']): string | undefined {
  switch (codigo) {
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
  const impacto = impactoCentsForAlert(alerta.codigo);
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
