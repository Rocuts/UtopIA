// ---------------------------------------------------------------------------
// Sentinel — tipos compartidos.
// ---------------------------------------------------------------------------

import type { PillarsResult } from '@/lib/pillars/types';
import type { Insight } from '@/lib/notifications/insight-types';

export type TriggerCode = 'T1' | 'T2' | 'T3' | 'T4';

export interface SentinelInput {
  workspaceId: string;
  periodId?: string | null;
  /** Email destino opcional para envío inmediato vía Resend. */
  recipient?: string;
  /** Si true, no envía emails — solo persiste alerts. */
  dryRun?: boolean;
}

export interface SentinelMetrics {
  /** equationDiff / activo. */
  equationGapPct: number;
  /** Días de autonomía (calculado por el pilar Escudo). */
  diasAutonomia: number | null;
  /** Cobertura fiscal (impuestos / utilidad×35%). */
  coberturaFiscal: number | null;
  /** Margen bruto del periodo (ingresos - costos) / ingresos. */
  margenBruto: number | null;
  /** Inventario / costo diario. */
  diasInventario: number | null;
  /** Mes índice donde el escenario conservador cae a negativo. null si nunca. */
  puntoInflexion: number | null;
  /** Caja actual. */
  efectivo: number;
  /** Utilidad neta. */
  utilidadNeta: number;
  /** Provisión actual (PUC 24). */
  impuestos: number;
}

export interface TriggerEvaluation {
  fired: boolean;
  insight?: Insight;
}

export interface SentinelEvaluation {
  workspaceId: string;
  periodId?: string | null;
  triggers: Record<TriggerCode, TriggerEvaluation>;
  pillars: PillarsResult;
  generatedAt: string;
}

export interface SentinelRunReport extends SentinelEvaluation {
  /** dedupKeys de los alerts insertados/actualizados durante el run. */
  upsertedAlerts: string[];
  /** dedupKeys de alerts que fueron escalados. */
  escalatedAlerts: string[];
  /** dedupKeys re-emitidos (≥48h sin acción). */
  reemittedAlerts: string[];
  /** Errores no fatales por trigger. */
  errors: Record<string, string>;
}
