// ---------------------------------------------------------------------------
// Bloque Âncora NIIF + Fiscal — contrato compartido entre agentes
// ---------------------------------------------------------------------------
// El Âncora es un set de cifras numéricas determinísticas (centavos COP,
// MoneyCop string) calculadas desde el `PreprocessedBalance` por TS puro,
// SIN llamada a LLM. Es la fuente de verdad numérica que consumen el
// Strategy Director (Agente 2), Governance Specialist (Agente 3) y el
// pipeline Escudo — todos citan A01..A22 / X01..X04 / F01..F10 literal en
// sus prompts en vez de re-derivar de los estados financieros.
//
// Spec: "Corrección niif_phase — Bloque Âncora" (Mayo 2026).
// Productor:  src/lib/agents/financial/ancora/build-ancora.ts
// Renderer:   src/lib/agents/financial/ancora/render-ancora.ts
// Emisión SSE: event `niif_ancora` (route /api/financial-report/niif).
// ---------------------------------------------------------------------------

import { z } from 'zod';

/**
 * MoneyCop centavos string. Ej. "150000000" = $1.500.000,00.
 * Mismo contrato que en el resto del pipeline financiero (ver
 * `src/lib/agents/financial/contracts/money.ts`). String entero, sin signo
 * de pesos, sin separadores, sin decimales. Negativos llevan prefijo "-".
 */
const MoneyCop = z
  .string()
  .regex(/^-?\d+$/, 'MoneyCop debe ser string entero en centavos (ej. "150000000").');

/**
 * Porcentaje (no centavos). String decimal con hasta 2 decimales.
 * Ej. "35.00" = 35,00%. Negativos permitidos.
 */
const Percent = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Percent debe ser decimal con hasta 2 decimales (ej. "35.00").');

// ---------------------------------------------------------------------------
// CCV NIIF — Cifras Clave Vinculantes contables
// ---------------------------------------------------------------------------
export const CcvNiifSchema = z.object({
  // Activo
  A01: MoneyCop, // Total Activo periodo actual
  A02: MoneyCop, // Total Activo periodo comparativo
  // Pasivo
  A03: MoneyCop, // Total Pasivo periodo actual
  A04: MoneyCop, // Total Pasivo periodo comparativo
  // Patrimonio
  A05: MoneyCop, // Patrimonio actual = A01 - A03
  A06: MoneyCop, // Patrimonio comparativo = A02 - A04
  // Ingresos
  A07: MoneyCop, // Ingresos actual (Clase 4 neto de devoluciones 4175 si aplica)
  A08: MoneyCop, // Ingresos comparativo
  // Ganancia Operacional (EBIT)
  A09: MoneyCop, // Ganancia Operacional actual
  A10: MoneyCop, // Ganancia Operacional comparativo
  // Ganancia Neta
  A11: MoneyCop, // Utilidad Neta actual
  A12: MoneyCop, // Utilidad Neta comparativo
  // Efectivo
  A13: MoneyCop, // Efectivo actual (saldo Cta. 11)
  A14: MoneyCop, // Efectivo comparativo
  // Capital de trabajo
  A15: MoneyCop, // Pasivo Corriente actual
  A16: MoneyCop, // Inventarios actual (Cta. 14)
  A17: MoneyCop, // Cartera / Deudores actual (Cta. 13)
  A18: MoneyCop, // Proveedores actual (Cta. 22)
  // Flujo de caja
  A19: MoneyCop, // Variación de caja del período = A13 - A14
  // Anexos derivados (X-series)
  X01: MoneyCop, // Ganancia Bruta actual = A07 - (Costo Ventas + Costo Producción)
  X02: MoneyCop, // Ganancia Bruta comparativo
  X03: MoneyCop, // Activo Corriente actual
  X04: MoneyCop, // Activo No Corriente actual
});
export type CcvNiif = z.infer<typeof CcvNiifSchema>;

// ---------------------------------------------------------------------------
// CCV Fiscal — Cifras Clave Vinculantes tributarias
// ---------------------------------------------------------------------------
// F01 = UAI (anclada a Utilidad Neta del período actual; cuando no existe
// Clase 54 en el balance, UAI ≡ Utilidad Neta porque impuesto = $0).
// F09 (tasa efectiva) y F10 (eficiencia fiscal) se expresan como porcentaje.
// ---------------------------------------------------------------------------
export const CcvFiscalSchema = z.object({
  F01: MoneyCop, // UAI = utilidad antes de impuestos (≈ A11 si no hay Clase 54)
  F02: MoneyCop, // Impuesto referencial 35% = F01 × 0,35
  F03: MoneyCop, // Retenciones a favor = Cta. 1355 + Cta. 1805
  F04: MoneyCop, // Saldo neto a pagar = F02 - F03
  F05: MoneyCop, // IVA neto = |Cta. 2408|
  F06: MoneyCop, // Retención por declarar = |Cta. 2365|
  F07: MoneyCop, // ICA = |Cta. 2368|
  F08: MoneyCop, // Total pasivos fiscales = |Cta. 24 total|
  F09: Percent, // Tasa efectiva (0% si no hay Clase 54)
  F10: Percent, // Eficiencia fiscal = F03 / F02 × 100 (0 si F02 = 0)
});
export type CcvFiscal = z.infer<typeof CcvFiscalSchema>;

// ---------------------------------------------------------------------------
// Verificaciones determinísticas del Âncora
// ---------------------------------------------------------------------------
export const AncoraChecksSchema = z.object({
  /** Diferencia A = P + C actual (centavos string; "0" = cuadra al centavo). */
  patrimonioDelta2025: MoneyCop,
  /** Diferencia A = P + C comparativo. */
  patrimonioDelta2024: MoneyCop,
  /** Δcaja: A14 + A19 == A13 → 'ok' si cuadra al centavo, 'error' si no. */
  efeReconcilia: z.enum(['ok', 'error']),
  /** Alerta A5 (brecha impuesto contable vs teórico) activa si F02 > 0 y no hay Clase 54. */
  alertaA5: z.enum(['activa', 'inactiva']),
  /** Alerta DEV (devoluciones materiales) activa si totalDevoluciones > 1% ingresos. */
  alertaDev: z.enum(['activa', 'inactiva']),
});
export type AncoraChecks = z.infer<typeof AncoraChecksSchema>;

// ---------------------------------------------------------------------------
// Bloque Âncora consolidado
// ---------------------------------------------------------------------------
export const NiifAncoraSchema = z.object({
  /** Period labels capturados literalmente del preprocesador. */
  periodos: z.object({
    actual: z.string(),
    comparativo: z.string().nullable(),
  }),
  /** Último dígito del NIT (string del char) — anchor de routing fiscal. */
  nitDigito: z.string().regex(/^[0-9]$/, 'nitDigito debe ser un único dígito 0-9.'),
  ccvNiif: CcvNiifSchema,
  ccvFiscal: CcvFiscalSchema,
  checks: AncoraChecksSchema,
  /**
   * Versión del builder. Bump cuando cambien fórmulas determinísticas
   * para invalidar caches downstream.
   */
  version: z.literal('1.0'),
  /** ISO 8601 — timestamp del cálculo. */
  computedAt: z.string(),
});
export type NiifAncora = z.infer<typeof NiifAncoraSchema>;
