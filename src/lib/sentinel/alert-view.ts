// ---------------------------------------------------------------------------
// Sentinel alert view — row → UI model
// ---------------------------------------------------------------------------
// `alertRowToView` converts a persisted `SentinelAlertRow` (DB layer) into the
// `AlertView` shape that the Escudo UI consumes. Kept here (Sentinel service
// layer) so that the fiscal-anchor domain does not need to import schema types.
// ---------------------------------------------------------------------------

import type { SentinelAlertRow } from '@/lib/db/schema-sentinel';
import type { Insight, InsightSeverity } from '@/lib/notifications/insight-types';

/**
 * Forma de salida que consume la UI del Escudo. Las cifras monetarias viajan
 * como string de centavos (MoneyCop).
 */
export interface AlertView {
  id: string;
  codigo: string;
  severidad: 'error' | 'warning' | 'info';
  titulo: string;
  mensaje: string;
  norma: string;
  impacto?: string;
  accion?: string;
  status: 'pending' | 'snoozed' | 'resolved' | 'escalated';
  createdAt: string;
}

const SEVERITY_TO_SEVERIDAD: Record<InsightSeverity, AlertView['severidad']> = {
  critico: 'error',
  advertencia: 'warning',
  informativo: 'info',
};

/**
 * Reconstruye una `AlertView` desde la fila persistida. El payload del Insight
 * conserva codigo/mensaje/norma/titulo/impacto/accion — los leemos de ahí con
 * fallbacks defensivos para filas antiguas.
 */
export function alertRowToView(row: SentinelAlertRow): AlertView {
  const payload = (row.payload ?? {}) as Partial<Insight> & {
    vars?: Record<string, unknown>;
  };
  const vars = (payload.vars ?? {}) as Record<string, unknown>;
  const codigo = typeof vars.codigo === 'string' ? vars.codigo : row.triggerCode;
  const titulo =
    typeof payload.subject === 'string' && payload.subject
      ? payload.subject
      : typeof vars.titulo === 'string'
        ? vars.titulo
        : codigo;
  const mensaje =
    typeof payload.hallazgo === 'string' && payload.hallazgo
      ? payload.hallazgo
      : typeof vars.mensaje === 'string'
        ? vars.mensaje
        : '';
  const norma = typeof vars.norma === 'string' ? vars.norma : '';
  const impacto =
    typeof payload.impacto === 'string' && payload.impacto
      ? payload.impacto
      : typeof vars.impacto === 'string' && vars.impacto
        ? (vars.impacto as string)
        : undefined;
  const accion =
    payload.accionRecomendada?.label ??
    (typeof vars.accion === 'string' ? vars.accion : undefined);

  return {
    id: row.id,
    codigo,
    severidad: SEVERITY_TO_SEVERIDAD[row.severity],
    titulo,
    mensaje,
    norma,
    impacto,
    accion,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
