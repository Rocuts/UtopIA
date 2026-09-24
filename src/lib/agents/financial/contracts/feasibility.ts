// ---------------------------------------------------------------------------
// Contratos JSON-strict — Pipeline Estudio de Factibilidad
// ---------------------------------------------------------------------------
// Tres agentes secuenciales:
//   1. Market Analyst    (DNP MGA, DANE CIIU, TAM/SAM/SOM, 5 Fuerzas Porter)
//   2. Financial Modeler (WACC, CAPM, VPN/TIR/TIRM, depreciaciones Art. 137 ET)
//   3. Risk Assessor     (matriz probabilidad x impacto, VPN ajustado, go/no-go)
//
// valoracion-09: el Modelador devuelve la inversión inicial y los flujos del
// proyecto ESTRUCTURADOS en `MoneyCop` (centavos) y los componentes del WACC;
// VPN, TIR, TIRM, payback, IR y punto de equilibrio se calculan en código
// (feasibility/calc/project-metrics.ts). La prosa sólo interpreta.
// valoracion-10: score y clasificación de cada riesgo se derivan en código
// (P × I); el VPN ajustado por riesgo se recalcula con los flujos del
// Modelador; no se pide ni se afirma una simulación Monte Carlo.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { MoneyCop, NormaRef } from './base';
import { WaccBreakdownSchema } from './valuation';

// ---------------------------------------------------------------------------
// 1. Market Analyst
// ---------------------------------------------------------------------------

export const MarketAnalysisReportSchema = z.object({
  marketSize: z
    .string()
    .min(1)
    .describe(
      'TAM/SAM/SOM con cifras en COP y CAGR; fuentes citadas (DANE, SuperSociedades, gremios)',
    ),
  targetSegment: z
    .string()
    .min(1)
    .describe('Perfil cliente (B2B/B2C), tamaño, necesidades, disposición a pagar'),
  competitiveLandscape: z
    .string()
    .min(1)
    .describe('5 Fuerzas Porter + posicionamiento + ventajas competitivas'),
  demandProjections: z
    .string()
    .min(1)
    .describe('Escenarios pesimista/base/optimista a horizonte; supuestos documentados'),
  entryBarriers: z
    .string()
    .min(1)
    .describe('Capital, tecnología, permisos (INVIMA/ANLA si aplica), costos y tiempos'),
});

export type MarketAnalysisReportJson = z.infer<typeof MarketAnalysisReportSchema>;

// ---------------------------------------------------------------------------
// 2. Financial Modeler
// ---------------------------------------------------------------------------

/** Flujo de caja libre del proyecto (FCLP) del año t = 1..n. */
export const ProjectCashFlowRowSchema = z.object({
  year: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Año del proyecto t (1..n, consecutivos); t = 0 es la inversión inicial'),
  freeCashFlowCop: MoneyCop.describe(
    'FCLP del año t en centavos COP (negativo si es salida neta). El último año incluye valor de salvamento y recuperación de capital de trabajo.',
  ),
});

export type ProjectCashFlowRowJson = z.infer<typeof ProjectCashFlowRowSchema>;

export const FinancialModelReportSchema = z.object({
  proFormaStatements: z
    .string()
    .min(1)
    .describe('P&L proyectado + FCLP + Balance resumido a horizonte completo'),
  capitalStructure: z
    .string()
    .min(1)
    .describe('Estructura de capital objetivo y justificación de los componentes del WACC'),
  wacc: WaccBreakdownSchema.describe('Componentes del WACC en COP; el código recalcula Ke y WACC'),
  discountRateSource: z
    .enum(['wacc_calculado', 'tasa_indicada_por_usuario'])
    .describe('wacc_calculado salvo que el usuario haya indicado expresamente una tasa de descuento'),
  discountRatePercent: z
    .number()
    .describe('Tasa de descuento usada (WACC o la tasa indicada por el usuario), en porcentaje'),
  initialInvestmentCop: MoneyCop.describe('Inversión inicial I0 (t = 0) en centavos COP, monto POSITIVO'),
  cashFlows: z
    .array(ProjectCashFlowRowSchema)
    .min(1)
    .describe('FCLP por año del proyecto 1..n; VPN/TIR/TIRM/payback/IR se calculan en código con estos flujos'),
  breakEvenInputs: z.object({
    fixedCostsCop: MoneyCop.nullable().describe('Costos fijos anuales del año 1 en centavos; null si no se dispone'),
    unitPriceCop: MoneyCop.nullable().describe('Precio unitario de venta del año 1 en centavos; null si no aplica'),
    unitVariableCostCop: MoneyCop.nullable().describe('Costo variable unitario del año 1 en centavos; null si no aplica'),
  }),
  projectEvaluation: z
    .string()
    .min(1)
    .describe(
      'Interpretación de los criterios de decisión (VPN > 0, TIR > tasa, IR > 1). NO reescribas cifras de VPN/TIR/TIRM/payback/IR: las calcula el código.',
    ),
  sensitivityAnalysis: z
    .string()
    .min(1)
    .describe('Tablas ±10/20% precio, volumen, costos, WACC + escenarios'),
  breakEvenAnalysis: z
    .string()
    .min(1)
    .describe('Interpretación del punto de equilibrio y margen de seguridad; el punto de equilibrio lo calcula el código'),
});

export type FinancialModelReportJson = z.infer<typeof FinancialModelReportSchema>;

// ---------------------------------------------------------------------------
// 3. Risk Assessor
// ---------------------------------------------------------------------------

export const RiskCategorySchema = z.enum([
  'politico_regulatorio',
  'mercado',
  'financiero',
  'operativo',
  'legal_cumplimiento',
  'ambiental_social',
  'zomac',
  'metodologico',
]);

export const RiskItemSchema = z.object({
  category: RiskCategorySchema,
  description: z.string().min(1),
  probability: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1=Muy baja .. 5=Muy alta'),
  impact: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1=Insignificante .. 5=Catastrófico'),
  // score (P × I) y classification se derivan en código (valoracion-10).
  mitigation: z.string().describe('Estrategia de mitigación; vacío si bajo'),
  normReference: NormaRef.nullable().describe(
    'Norma colombiana asociada (Ley 99/1993, ET, etc.) si aplica',
  ),
});

export type RiskItemJson = z.infer<typeof RiskItemSchema>;

export const GoNoGoDecisionSchema = z.enum(['go', 'go_con_condiciones', 'no_go']);

export const RiskAssessmentReportSchema = z.object({
  riskMatrix: z
    .array(RiskItemSchema)
    .describe('Mínimo 10 riesgos identificados, clasificados y puntuados'),
  riskAdjustedNpv: z
    .string()
    .min(1)
    .describe(
      'Análisis cualitativo o de escenarios del ajuste por riesgo. No afirmes simulaciones, iteraciones ni probabilidades que no se hayan ejecutado.',
    ),
  riskAdjustedDiscountRatePercent: z
    .number()
    .nullable()
    .describe(
      'Tasa de descuento ajustada por riesgo (tasa base + prima de riesgo) si la propones; el código recalcula el VPN ajustado con los flujos del Modelador. null si no aplica.',
    ),
  mitigationStrategies: z
    .string()
    .min(1)
    .describe('Plan de mitigación para riesgos altos/críticos con responsables y KRIs'),
  insuranceRecommendations: z
    .string()
    .min(1)
    .describe('Seguros + instrumentos de cobertura (forwards, hedging) + costo estimado'),
  goNoGoDecision: GoNoGoDecisionSchema,
  goNoGoRationale: z
    .string()
    .min(1)
    .describe(
      'Fundamentación de la decisión + condiciones previas + hitos de revisión + alertas tempranas',
    ),
  executiveSummary: z
    .string()
    .min(1)
    .describe('Resumen ejecutivo 1 página: proyecto, hallazgos, métricas, riesgo, recomendación'),
});

export type RiskAssessmentReportJson = z.infer<typeof RiskAssessmentReportSchema>;
