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
// Output completo del NIIF Analyst
// ---------------------------------------------------------------------------

export const NiifReportSchema = z.object({
  /** Eco de los datos de la empresa, validados — el modelo no debe inventar */
  company: CompanyInfoSchema,

  // -- 1. Balance General (Estado de Situación Financiera) -----------------
  balanceSheet: z.object({
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
  }),

  // -- 2. Estado de Resultados Integral (P&L) -------------------------------
  incomeStatement: z.object({
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
  }),

  // -- 3. Estado de Flujos de Efectivo --------------------------------------
  cashFlow: CashFlowStatementSchema,

  // -- 4. Estado de Cambios en el Patrimonio --------------------------------
  equityChanges: z.object({
    rows: z.array(EquityChangeRowSchema).describe('Filas en orden cronológico: apertura → movimientos → cierre'),
    notes: z.array(StatementNoteSchema),
  }),

  // -- 5. Notas técnicas globales -------------------------------------------
  technicalNotes: z.array(StatementNoteSchema).describe('Notas sobre mapeo PUC, reclasificaciones, impracticabilidades'),

  // -- 6. Banderas de auditoría / Curator -----------------------------------
  curatorFlags: z.object({
    equityConvergenceApplied: z.boolean(),
    cashFlowClosureForced: z.boolean(),
    negativeAssetReclassified: z.boolean(),
    presumedCostWarning: z.boolean(),
    reclassifiedAmountCop: MoneyCop.describe('Total reclasificado por R1 en centavos'),
  }),
});

export type NiifReportJson = z.infer<typeof NiifReportSchema>;
