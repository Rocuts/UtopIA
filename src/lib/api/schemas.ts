// ---------------------------------------------------------------------------
// Contrato Zod del API v1 — ÚNICA fuente de verdad del shape público.
//
// snake_case (convención fintech: Stripe/GitHub/OpenAI/Zalando 118) y
// strictObject en TODA entrada (minimización Ley 1581: se rechaza lo que no
// se procesa). Estos schemas NO viajan al LLM — el guard strict-mode del
// repo no aplica y `.optional()` es válido aquí.
// El documento OpenAPI 3.1 se genera de estos mismos schemas (openapi.ts).
// ---------------------------------------------------------------------------

import { z } from 'zod';

import { WEBHOOK_EVENT_TYPES } from './webhooks';

// ---------------------------------------------------------------------------
// trial-balances
// ---------------------------------------------------------------------------

/** Fila PUC estructurada (equivale a RawAccountRow del preprocesador). */
export const RawRowInputSchema = z.strictObject({
  code: z.string().min(1).max(20),
  name: z.string().max(300),
  level: z.string().max(20),
  transactional: z.boolean(),
  /** Saldos por periodo en PESOS (ej. {"2025": 1500000.5}). */
  balances_by_period: z.record(z.string().max(10), z.number()),
});

export type RawRowInput = z.infer<typeof RawRowInputSchema>;

export const TrialBalanceCreateSchema = z
  .strictObject({
    /** Etiqueta del periodo cuando el CSV/filas no traen año (ej. "2025"). */
    period_label: z.string().min(1).max(20).optional(),
    /** CSV con los mismos alias de columnas que acepta la plataforma. */
    csv: z.string().min(1).max(2_000_000).optional(),
    /** Alternativa estructurada al CSV. */
    rows: z.array(RawRowInputSchema).min(1).max(20_000).optional(),
  })
  .refine((v) => Boolean(v.csv) !== Boolean(v.rows), {
    message: 'Enviar exactamente uno de: csv o rows.',
  });

export type TrialBalanceCreateInput = z.infer<typeof TrialBalanceCreateSchema>;

// ---------------------------------------------------------------------------
// webhook-endpoints
// ---------------------------------------------------------------------------

export const WebhookEndpointCreateSchema = z.strictObject({
  /** https, puerto 443, host público (se valida anti-SSRF además del shape). */
  url: z.string().min(12).max(2000),
  description: z.string().max(500).optional(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
});

export type WebhookEndpointCreateInput = z.infer<typeof WebhookEndpointCreateSchema>;

export const WebhookEndpointUpdateSchema = z
  .strictObject({
    url: z.string().min(12).max(2000).optional(),
    description: z.string().max(500).nullable().optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
    status: z.enum(['enabled', 'disabled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'El PATCH debe traer al menos un campo.',
  });

export type WebhookEndpointUpdateInput = z.infer<typeof WebhookEndpointUpdateSchema>;
