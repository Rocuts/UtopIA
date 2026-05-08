// ---------------------------------------------------------------------------
// Insight notifications — tipos.
// ---------------------------------------------------------------------------
// Sentinel (P6) emite `Insight`s cuando alguno de los 4 pilares cambia de
// estado. Esos insights llegan al usuario por:
//   1. In-app: InsightToast (alta prioridad) o InsightInbox (todos)
//   2. Email vía Resend (cuando hay recipient + RESEND_API_KEY)
//   3. (Futuro) Web Push / WhatsApp — vía adapter al WS6 dispatch.
// ---------------------------------------------------------------------------

import type { PillarId } from '@/lib/pillars/types';

export type InsightSeverity = 'critico' | 'advertencia' | 'informativo';
export type InsightTone = 'normal' | 'escalated' | 'critical';

export interface InsightAction {
  /** Etiqueta visible. */
  label: string;
  /** Path interno de UtopIA (priorizado sobre URL externa). */
  href?: string;
  /** Identificador del flujo de acción (e.g. para tracking analytics). */
  flow?: string;
}

export interface InsightVariables {
  empresario_nombre?: string;
  monto_diferencia?: string;
  impuesto_proyectado?: string;
  provision_actual?: string;
  pct_reduccion?: number | string;
  meses_inflexion?: number | string;
  mes_anio_inflexion?: string;
  trimestre_inflexion?: string;
  margen_bruto_pct?: number | string;
  dias_inventario?: number | string;
  dias_autonomia?: number | string;
  /** Variables ad-hoc que el trigger pueda añadir. */
  [key: string]: string | number | undefined;
}

export interface Insight {
  id?: string;
  pillar: PillarId;
  severity: InsightSeverity;
  /** Código corto (T1/T2/T3/T4 de Sentinel). */
  triggerCode: string;
  /** Clave de deduplicación para que el upsert sea idempotente. */
  dedupKey: string;
  subject: string;
  hallazgo: string;
  impacto: string;
  accionRecomendada: InsightAction;
  vars: InsightVariables;
  tone: InsightTone;
  generatedAt: string;
  /** Workspace asociado, para ruteo multi-tenant. */
  workspaceId?: string;
  /** Idioma preferido para render (default 'es'). */
  language?: 'es' | 'en';
}

export interface InsightTemplate {
  subjectTpl: string;
  hallazgoTpl: string;
  impactoTpl: string;
  accionLabelTpl: string;
  /** Path para CTA. Soporta interpolación. */
  accionHrefTpl: string;
}

/** Resultado del envío del insight (email, push, etc). */
export interface SendInsightResult {
  /** Si la notificación se envió por email exitosamente. */
  emailSent: boolean;
  /** Resend message id, si lo devolvió. */
  emailMessageId?: string;
  /** Razón por la que se omitió el envío (e.g. falta API key, falta recipient). */
  skipped?: string;
  /** Errores encontrados, si los hubo. */
  error?: string;
}

export interface SendInsightOptions {
  /** Email destino. Si está ausente o vacío, no enviamos email. */
  recipient?: string;
  language?: 'es' | 'en';
  /** Override de plantilla (e.g. para testing). */
  templateOverride?: Partial<InsightTemplate>;
  /** Si true, salta el envío real (dry-run para tests/staging). */
  dryRun?: boolean;
}
