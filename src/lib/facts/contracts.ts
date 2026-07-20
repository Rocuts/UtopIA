// Contratos Zod + tipos compartidos de la memoria de hechos del negocio.
// SIN import de DB — safe para cliente, tool y panel. Strict-mode 2026:
// `.nullable()` siempre, nunca `.optional()`/`.default()`/`z.record()`.

import { z } from 'zod';

export type FactKind = 'narrative' | 'donation' | 'leasing' | 'loss_carryforward';

/** MoneyCop: entero serializado en centavos. Regex idéntico al de money.ts
 *  (copia deliberada: mantiene este módulo puro sin importar del árbol financiero). */
const moneyCop = z.string().regex(/^-?\d+$/, 'monto debe ser entero en centavos (MoneyCop)');

/** Structured de una donación (piloto Art. 257 E.T.). */
export const donationStructuredSchema = z.object({
  montoCentavos: moneyCop,
  articulo: z.string(),
  fiscalYear: z.string(),
});
export type DonationStructured = z.infer<typeof donationStructuredSchema>;

/**
 * Contrato de la tool `registrar_hecho_negocio`. Piloto: kind ∈
 * {narrative, donation}. `structured` es null para narrative y el objeto
 * de donación para donation (coherencia kind↔structured la valida el
 * handler server-side, no el LLM).
 */
export const registrarHechoInputSchema = z.object({
  kind: z.enum(['narrative', 'donation']),
  title: z.string(),
  body: z.string(),
  structured: donationStructuredSchema.nullable(),
  fiscalPeriod: z.string().max(8).nullable(), // varchar(8) en DB: año 'YYYY'
});
export type RegistrarHechoInput = z.infer<typeof registrarHechoInputSchema>;

/** Contenido semántico que compara la reconciliación (T3). */
export interface FactContent {
  title: string;
  body: string;
  structured: Record<string, unknown> | null;
}
