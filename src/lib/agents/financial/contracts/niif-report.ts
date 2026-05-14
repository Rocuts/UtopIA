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
import {
  AnomalyFlagSchema,
  CompanyInfoSchema,
  ConfidenceLevelSchema,
  MoneyCop,
  ReportModeSchema,
  StatementLineSchema,
  StatementNoteSchema,
} from './base';

// ---------------------------------------------------------------------------
// Extensiones spec v8.1 (Wave 4.F1)
// ---------------------------------------------------------------------------
// La spec v8.1 introduce 3 building blocks que extienden el schema NIIF Report
// sin tocar `StatementLineSchema` en `./base` (regla "diff sólo niif-report.ts"):
//
//   1. `confidence` + `anomalyFlag` por línea de estado financiero (§1.5, §1.3).
//   2. `modeBanner` en Balance + P&L (§1.7).
//   3. `degeneracyFlag` en EFE (§5 Slide 08).
//   4. `reportMode` en el root (§3, echo del input).
//
// Hotfix Wave 4 (2026-05-13): los 8 campos arriba se endurecieron a
// `.nullable()` puro (antes eran `.nullable().optional()` = `.nullish()`).
// Razón: OpenAI strict mode (`experimental_output: Output.object({ schema })`
// en AI SDK v6) EXIGE que cada property esté listada en `required[]` del
// JSON schema generado. Zod `.optional()` produce `required[]` sin la clave,
// que OpenAI rechaza con error en runtime:
//
//   "Invalid schema for response_format 'response': In context=(...),
//   'required' is required to be supplied and to be an array including every
//   key in properties. Missing 'confidence'."
//
// Bajo `.nullable()` puro el campo es `T | null` (NUNCA undefined): Zod
// emite el field en `required[]` con `type: [..., 'null']`, lo que OpenAI
// strict acepta. Las fixtures de tests se actualizaron en el mismo hotfix
// para incluir los campos explícitamente como `null`.
//
// CLAUDE.md §"Prompt patterns GPT-5.4" hard rule 5 ("Strict schema, no
// optional fields") es ahora ley dura: `.nullable()` siempre, `.optional()`
// nunca, en schemas que vayan al LLM.
//
// Refs:
//   - docs/spec/financial-report-v8.1.md §1.3 (anomalyFlag por línea)
//   - docs/spec/financial-report-v8.1.md §1.5 (confidence dot por cifra)
//   - docs/spec/financial-report-v8.1.md §1.7 (modeBanner Balance/P&L)
//   - docs/spec/financial-report-v8.1.md §3   (reportMode root echo)
//   - docs/spec/financial-report-v8.1.md §5 Slide 08 (degeneracyFlag EFE)
// ---------------------------------------------------------------------------

/**
 * Statement line spec v8.1 — agrega `confidence` y `anomalyFlag` opcionales a
 * cada línea de Balance, P&L y EFE. Pre-F4 ambos campos son opcionales/null:
 *   - `confidence: null | undefined` → confianza implícita 'high' (sin dot).
 *   - `anomalyFlag: null | undefined` → sin anomalía sectorial detectada.
 *
 * La shape base (`account`, `label`, `amountPrimary`, `amountComparative`,
 * `level`, `isAbsolute`) viene tal cual de `StatementLineSchema` en `./base`.
 */
const StatementLineV8Schema = StatementLineSchema.extend({
  confidence: ConfidenceLevelSchema.nullable().describe(
    'Nivel de confianza de la cifra (v8.1 §1.5). Null = high implícito (sin dot visual).',
  ),
  anomalyFlag: AnomalyFlagSchema.nullable().describe(
    'Flag de anomalía sectorial CIIU (v8.1 §1.3). Null = sin outlier detectado.',
  ),
});

// ---------------------------------------------------------------------------
// Estado de Cambios en el Patrimonio (ECP) — desglose por columnas
// ---------------------------------------------------------------------------
// El ECP es matricial: filas = movimientos, columnas = rubros patrimoniales.
// Modelado como lista de filas tipadas para maximizar validabilidad.

export const EquityChangeRowSchema = z.object({
  kind: z
    .enum([
      'opening_balance',
      'prior_period_result_cancellation',
      'profit_for_period',
      'other_comprehensive_income',
      'capital_contribution',
      'dividend_distribution',
      'reserve_appropriation',
      'convergence_adjustment',
      'closing_balance',
    ])
    .describe('Tipo de fila — taxonomía controlada para validación determinística. `prior_period_result_cancellation` (v2.5) es el asiento de cierre que cancela el resultado del periodo anterior arrastrado en PUC 3605 cuando ese saldo no fue trasladado a PUC 37 al cierre prior — la fila lleva resultadoEjercicio con signo NEGATIVO igual a opening_balance.resultadoEjercicio y total NEGATIVO de la misma magnitud (no es distribución de dividendos ni flujo de efectivo).'),
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
  lines: z.array(StatementLineV8Schema).describe('Líneas de la sección en orden de presentación (con confidence/anomalyFlag v8.1)'),
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
  // Spec v8.1 §5 Slide 08 — flag para el caso degenerado del método indirecto.
  // Cuando >=6 líneas del EFE indirecto son cero (caja sin movimiento real),
  // el EFE pierde valor informativo y la slide 08 reemplaza el waterfall por
  // un callout explicativo. Opcional/null pre-F4.
  //   - 'none'                       → EFE útil, render normal.
  //   - 'indirect_method_unreliable' → degenerado, render alternativo.
  degeneracyFlag: z
    .enum(['none', 'indirect_method_unreliable'])
    .nullable()
    .describe('Flag de degeneración del método indirecto (v8.1 §5 Slide 08). Null = no evaluado / no aplica.'),
});

// ---------------------------------------------------------------------------
// Sub-objetos reutilizables (Fase 3 chunking)
// ---------------------------------------------------------------------------
// Estas constantes encapsulan la forma exacta de cada sub-sección del reporte
// para que `NiifReportSchema` (monolítico) y los sub-schemas chunked compartan
// definición sin duplicar shape ni divergir.

const BalanceSheetSchema = z.object({
  assets: z.array(StatementLineV8Schema).describe('Activos corrientes y no corrientes en orden (con confidence/anomalyFlag v8.1)'),
  liabilities: z.array(StatementLineV8Schema).describe('Pasivos corrientes y no corrientes en orden (con confidence/anomalyFlag v8.1)'),
  equity: z.array(StatementLineV8Schema).describe('Patrimonio: capital, reservas, resultados, ORI (con confidence/anomalyFlag v8.1)'),
  totalAssetsPrimary: MoneyCop,
  totalAssetsComparative: MoneyCop.nullable(),
  totalLiabilitiesPrimary: MoneyCop,
  totalLiabilitiesComparative: MoneyCop.nullable(),
  totalEquityPrimary: MoneyCop,
  totalEquityComparative: MoneyCop.nullable(),
  notes: z.array(StatementNoteSchema),
  // Spec v8.1 §1.7 — banner explicativo del modo del reporte. Texto canónico
  // inyectado por Pass-1.
  modeBanner: z
    .string()
    .nullable()
    .describe(
      'Banner explicativo del modo del reporte (LINEA_BASE/TRANSICION/COMPARATIVO_COMPLETO). v8.1 §1.7. Null = no banner.',
    ),
});

const IncomeStatementSchema = z.object({
  lines: z.array(StatementLineV8Schema).describe('Ingresos, costos, gastos, resultado (con confidence/anomalyFlag v8.1)'),
  grossProfitPrimary: MoneyCop,
  grossProfitComparative: MoneyCop.nullable(),
  operatingProfitPrimary: MoneyCop.describe('EBIT'),
  operatingProfitComparative: MoneyCop.nullable(),
  netIncomePrimary: MoneyCop.describe('Utilidad/Pérdida Neta del ejercicio'),
  netIncomeComparative: MoneyCop.nullable(),
  oriPrimary: MoneyCop.describe('Otro Resultado Integral del periodo'),
  oriComparative: MoneyCop.nullable(),
  notes: z.array(StatementNoteSchema),
  // Spec v8.1 §1.7 — banner explicativo del modo del reporte para P&L. Mismo
  // contrato que `balanceSheet.modeBanner`.
  modeBanner: z
    .string()
    .nullable()
    .describe('Banner explicativo del modo del reporte para P&L. v8.1 §1.7. Null = no banner.'),
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

  // -- 7. Modo del reporte (eco del input, spec v8.1 §3) -------------------
  // Echo del `reportMode` derivado por `deriveReportMode()` en el orchestrator
  // (F0) y propagado a Pass-1. El assembler lo propaga literal desde Pass-1
  // (ver `assembleNiifReport`).
  reportMode: ReportModeSchema.nullable().describe(
    'Modo del reporte (LINEA_BASE | TRANSICION | COMPARATIVO_COMPLETO). v8.1 §3. Echo del input al pipeline. Null si no derivado.',
  ),
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
  // Spec v8.1 §3 — Pass-1 recibe `reportMode` del orchestrator (F0) por
  // `<context>` y lo emite literal.
  reportMode: ReportModeSchema.nullable().describe(
    'Eco literal del reportMode derivado por el orchestrator. v8.1 §3. Null si no derivado.',
  ),
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
  // Tras el hotfix Wave 4 (endurecimiento OpenAI strict mode), `reportMode`
  // dejó de ser opcional — el schema lo exige presente (null válido). El
  // assembler propaga el valor literal desde Pass-1, que es quien lo recibe
  // del orchestrator vía `deriveReportMode()` (v8.1 §3).
  return {
    company: pass1.company,
    balanceSheet: pass1.balanceSheet,
    incomeStatement: pass1.incomeStatement,
    cashFlow: pass2.cashFlow,
    equityChanges: pass2.equityChanges,
    technicalNotes: pass3.technicalNotes,
    curatorFlags: pass1.curatorFlags,
    reportMode: pass1.reportMode,
  };
}
