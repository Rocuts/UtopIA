// ---------------------------------------------------------------------------
// Contrato JSON-strict del Agente 1 (NIIF Analyst)
// ---------------------------------------------------------------------------
// Este schema es el output canónico del NIIF Analyst tras el refactor GPT-5.4.
// Lo consumen, en orden:
//
//   1. El renderer determinístico `renderNiifReportMarkdown(json)` que produce
//      el `NiifAnalysisResult` markdown legacy (compatibilidad Fase 1+2).
//   2. Los validators Elite del Protocolo de 3 capas (integridad aritmética,
//      lógica de negocio, defensa tributaria) — operan directo sobre JSON.
//   3. Los renderers PDF Élite / Excel después de Fase 3 (consumo directo).
//
// Decisiones de diseño:
//
// - Las cuatro tablas (Balance, P&G, EFE, ECP) son arrays de `StatementLine`
//   con jerarquía explícita por `level`. El modelo NO compone HTML/Markdown —
//   solo produce datos estructurados, la presentación es del renderer.
// - Los cuadres invariantes (Activo = Pasivo + Patrimonio, EFE final = PUC 11,
//   ECP saldo final = Patrimonio Balance) se VALIDAN post-LLM por el validator
//   determinístico, no por el prompt. El prompt los expone como
//   `<success_criteria>` (outcome-first GPT-5.4) y el validator es el árbitro.
// - Las notas técnicas son arrays con `norma` citable, no prosa libre.
//
// Fase 3 (chunked schema, 2026-05-12):
//
// El schema monolítico se genera en una sola llamada LLM que rozaba el budget
// de output (32K) y disparaba `finish_reason=length` con `gpt-5.4-mini`.
// Partir la generación en 3 passes secuenciales le da a cada uno reasoning
// budget completo y elimina el bug por construcción, permitiendo revertir el
// NIIF Analyst de `gpt-5.5` ($30/1M output) a `gpt-5.4-mini` ($4.50/1M).
//
// Para soportar el chunking sin duplicar shape, los sub-objetos
// `balanceSheet`, `incomeStatement`, `curatorFlags` y `equityChanges` se
// extraen como `const` reutilizables y luego se componen en:
//   - `NiifReportSchema`          (monolítico, target final de ensamblaje)
//   - `BalanceAndPnlSubSchema`    (Pass 1: company + balance + P&L + flags)
//   - `CashFlowAndEquitySubSchema`(Pass 2: EFE + ECP)
//   - `TechnicalNotesSubSchema`   (Pass 3: notas técnicas)
//
// `assembleNiifReport(pass1, pass2, pass3)` reensambla los 3 outputs en el
// `NiifReportJson` canónico con un merge puro determinístico.
//
// Refs:
//   - NIC 1 §10 / NIIF for SMEs §3.17: el "conjunto completo de EEFF" es
//     requisito de PRESENTACIÓN; el chunking es interno de generación y no
//     viola la norma — el output reensamblado cumple §3.17.
//   - OpenAI cookbook 2026 "Breaking Down Tasks with Prompt Chaining": peak
//     performance cuando tareas separables van en turnos distintos.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { CompanyInfoSchema, MoneyCop, StatementLineSchema, StatementNoteSchema } from './base';

// ---------------------------------------------------------------------------
// Estado de Cambios en el Patrimonio (ECP) — desglose por columnas
// ---------------------------------------------------------------------------
// El ECP es matricial: filas = movimientos, columnas = rubros patrimoniales.
// Modelado como lista de filas tipadas para maximizar validabilidad.

export const EquityChangeRowSchema = z.object({
  kind: z
    .enum([
      'opening_balance',
      'profit_for_period',
      'other_comprehensive_income',
      'capital_contribution',
      'dividend_distribution',
      'reserve_appropriation',
      'convergence_adjustment',
      'closing_balance',
    ])
    .describe('Tipo de fila — taxonomía controlada para validación determinística'),
  label: z.string().min(1).describe('Etiqueta legible. Ej: "Saldo al 1 de enero de 2025"'),
  capitalSocial: MoneyCop,
  primaColocacion: MoneyCop,
  reservaLegal: MoneyCop,
  otrasReservas: MoneyCop,
  resultadosAcumulados: MoneyCop,
  resultadoEjercicio: MoneyCop,
  ori: MoneyCop.describe('Otro Resultado Integral'),
  total: MoneyCop.describe('Suma de columnas — el renderer NO recalcula, valida'),
});

export type EquityChangeRowJson = z.infer<typeof EquityChangeRowSchema>;

// ---------------------------------------------------------------------------
// Estado de Flujos de Efectivo (EFE) — Método Indirecto, NIC 7 / Sec. 7 PYMES
// ---------------------------------------------------------------------------

export const CashFlowSectionSchema = z.object({
  section: z.enum(['operating', 'investing', 'financing']),
  lines: z.array(StatementLineSchema).describe('Líneas de la sección en orden de presentación'),
  netFlow: MoneyCop.describe('Flujo neto de la sección'),
});

export const CashFlowStatementSchema = z.object({
  sections: z
    .array(CashFlowSectionSchema)
    .length(3, 'Las 3 secciones (operating, investing, financing) son obligatorias'),
  netChange: MoneyCop.describe('Aumento (disminución) neto en efectivo'),
  cashOpening: MoneyCop.describe('Efectivo al inicio del periodo (igual al cierre comparativo)'),
  cashClosing: MoneyCop.describe('Efectivo al final del periodo. DEBE igualar PUC 11 del Balance, tolerancia $0'),
  methodNote: z
    .literal('indirect')
    .describe('Método indirecto siempre — NIC 7 §18.b'),
});

// ---------------------------------------------------------------------------
// Sub-objetos reutilizables (Fase 3 chunking)
// ---------------------------------------------------------------------------
// Estas constantes encapsulan la forma exacta de cada sub-sección del reporte
// para que `NiifReportSchema` (monolítico) y los sub-schemas chunked compartan
// definición sin duplicar shape ni divergir.

const BalanceSheetSchema = z.object({
  assets: z.array(StatementLineSchema).describe('Activos corrientes y no corrientes en orden'),
  liabilities: z.array(StatementLineSchema).describe('Pasivos corrientes y no corrientes en orden'),
  equity: z.array(StatementLineSchema).describe('Patrimonio: capital, reservas, resultados, ORI'),
  totalAssetsPrimary: MoneyCop,
  totalAssetsComparative: MoneyCop.nullable(),
  totalLiabilitiesPrimary: MoneyCop,
  totalLiabilitiesComparative: MoneyCop.nullable(),
  totalEquityPrimary: MoneyCop,
  totalEquityComparative: MoneyCop.nullable(),
  notes: z.array(StatementNoteSchema),
});

const IncomeStatementSchema = z.object({
  lines: z.array(StatementLineSchema).describe('Ingresos, costos, gastos, resultado'),
  grossProfitPrimary: MoneyCop,
  grossProfitComparative: MoneyCop.nullable(),
  operatingProfitPrimary: MoneyCop.describe('EBIT'),
  operatingProfitComparative: MoneyCop.nullable(),
  netIncomePrimary: MoneyCop.describe('Utilidad/Pérdida Neta del ejercicio'),
  netIncomeComparative: MoneyCop.nullable(),
  oriPrimary: MoneyCop.describe('Otro Resultado Integral del periodo'),
  oriComparative: MoneyCop.nullable(),
  notes: z.array(StatementNoteSchema),
});

const EquityChangesSchema = z.object({
  rows: z.array(EquityChangeRowSchema).describe('Filas en orden cronológico: apertura → movimientos → cierre'),
  notes: z.array(StatementNoteSchema),
});

const CuratorFlagsSchema = z.object({
  equityConvergenceApplied: z.boolean(),
  cashFlowClosureForced: z.boolean(),
  negativeAssetReclassified: z.boolean(),
  presumedCostWarning: z.boolean(),
  reclassifiedAmountCop: MoneyCop.describe('Total reclasificado por R1 en centavos'),
});

// ---------------------------------------------------------------------------
// Output completo del NIIF Analyst (monolítico — target de ensamblaje Fase 3)
// ---------------------------------------------------------------------------

export const NiifReportSchema = z.object({
  /** Eco de los datos de la empresa, validados — el modelo no debe inventar */
  company: CompanyInfoSchema,

  // -- 1. Balance General (Estado de Situación Financiera) -----------------
  balanceSheet: BalanceSheetSchema,

  // -- 2. Estado de Resultados Integral (P&L) -------------------------------
  incomeStatement: IncomeStatementSchema,

  // -- 3. Estado de Flujos de Efectivo --------------------------------------
  cashFlow: CashFlowStatementSchema,

  // -- 4. Estado de Cambios en el Patrimonio --------------------------------
  equityChanges: EquityChangesSchema,

  // -- 5. Notas técnicas globales -------------------------------------------
  technicalNotes: z.array(StatementNoteSchema).describe('Notas sobre mapeo PUC, reclasificaciones, impracticabilidades'),

  // -- 6. Banderas de auditoría / Curator -----------------------------------
  curatorFlags: CuratorFlagsSchema,
});

export type NiifReportJson = z.infer<typeof NiifReportSchema>;

// ---------------------------------------------------------------------------
// Sub-schemas chunked (Fase 3) — generación en 3 passes secuenciales
// ---------------------------------------------------------------------------
//
// Pass 1 (Backbone): el modelo construye el esqueleto numérico — company,
// balance, P&L y banderas del curator. Es el ancla de cifras que los dos
// passes siguientes referencian sin recalcular.
//
// Pass 2 (Flujos y Patrimonio): el modelo construye EFE + ECP recibiendo
// los totales de Pass 1 como `<previously_computed>` para anclar el cierre
// del EFE al saldo de efectivo del Balance y el saldo final del ECP al
// patrimonio del Balance.
//
// Pass 3 (Notas técnicas): el modelo redacta notas referenciando las cifras
// reales de Pass 1 + Pass 2 (mapeo PUC, reclasificaciones, impracticabilidades).

/**
 * Pass 1 — Backbone numérico: company info, Balance General, Estado de
 * Resultados y banderas del curator. Es el cimiento que los passes 2 y 3
 * referencian como contexto pre-computado.
 */
export const BalanceAndPnlSubSchema = z.object({
  company: CompanyInfoSchema,
  balanceSheet: BalanceSheetSchema,
  incomeStatement: IncomeStatementSchema,
  curatorFlags: CuratorFlagsSchema,
});

export type BalanceAndPnlSubJson = z.infer<typeof BalanceAndPnlSubSchema>;

/**
 * Pass 2 — Estado de Flujos de Efectivo (método indirecto, NIC 7) y Estado
 * de Cambios en el Patrimonio. Se construye con los totales de Pass 1 ya
 * fijados, para que `cashClosing` cuadre con PUC 11 del Balance y el cierre
 * del ECP cuadre con el patrimonio del Balance — tolerancia $0 centavos.
 */
export const CashFlowAndEquitySubSchema = z.object({
  cashFlow: CashFlowStatementSchema,
  equityChanges: EquityChangesSchema,
});

export type CashFlowAndEquitySubJson = z.infer<typeof CashFlowAndEquitySubSchema>;

/**
 * Pass 3 — Notas técnicas globales del reporte: mapeo PUC, reclasificaciones
 * por R1, impracticabilidades NIIF, supuestos. El modelo recibe Pass 1 + Pass
 * 2 como contexto y referencia cifras reales en las notas (sin inventar).
 */
export const TechnicalNotesSubSchema = z.object({
  technicalNotes: z.array(StatementNoteSchema).describe('Notas sobre mapeo PUC, reclasificaciones, impracticabilidades'),
});

export type TechnicalNotesSubJson = z.infer<typeof TechnicalNotesSubSchema>;

// ---------------------------------------------------------------------------
// Assembler determinístico (Fase 3)
// ---------------------------------------------------------------------------

/**
 * Reensambla las 3 sub-salidas del NIIF Analyst chunked en el `NiifReportJson`
 * canónico. Función pura determinística — dado el mismo triple input, siempre
 * produce el mismo output byte-a-byte.
 *
 * Diseño Fase 3 (2026-05-12): el monolithic `NiifReportSchema` se generaba
 * en una sola llamada LLM que rozaba el budget de output (32K) y disparaba
 * `finish_reason=length` con `gpt-5.4-mini`. Partir en 3 passes da a cada
 * uno reasoning budget completo y permite revertir a mini ($4.50/1M vs $30
 * de gpt-5.5).
 *
 * NO valida el output contra `NiifReportSchema.parse()` — esa validación la
 * realiza el caller (niif-analyst.ts) como guarda adicional. El assembler es
 * un merge puro: los campos no se transforman ni se cruzan, solo se componen.
 *
 * Refs:
 *   - NIC 1 §10 / NIIF for SMEs §3.17: el "conjunto completo de EEFF" es
 *     requisito de PRESENTACIÓN; el chunking es interno de generación y
 *     no viola la norma — el output reensamblado cumple §3.17.
 *   - OpenAI cookbook 2026 "Breaking Down Tasks": peak performance cuando
 *     tareas separables van en turnos distintos.
 */
export function assembleNiifReport(
  pass1: BalanceAndPnlSubJson,
  pass2: CashFlowAndEquitySubJson,
  pass3: TechnicalNotesSubJson,
): NiifReportJson {
  return {
    company: pass1.company,
    balanceSheet: pass1.balanceSheet,
    incomeStatement: pass1.incomeStatement,
    cashFlow: pass2.cashFlow,
    equityChanges: pass2.equityChanges,
    technicalNotes: pass3.technicalNotes,
    curatorFlags: pass1.curatorFlags,
  };
}
