// ---------------------------------------------------------------------------
// Contratos JSON-strict — Pipeline Estudio de Factibilidad
// ---------------------------------------------------------------------------
// Tres agentes secuenciales:
//   1. Market Analyst    (DNP MGA, DANE CIIU, TAM/SAM/SOM, 5 Fuerzas Porter)
//   2. Financial Modeler (WACC, CAPM, VPN/TIR/TIRM, depreciaciones Art. 137 ET)
//   3. Risk Assessor     (matriz probabilidad x impacto, VPN ajustado, go/no-go)
//
// Las cifras de proyectos viajan como `number` en COP (no centavos) por
// compatibilidad con la UI del módulo Feasibility (ProjectInfo.estimatedInvestment
// también es `number`). En Fase 3 se migra a MoneyCop strict.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { NormaRef } from './base';

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

export const FinancialModelReportSchema = z.object({
  proFormaStatements: z
    .string()
    .min(1)
    .describe('P&L proyectado + FCLP + Balance resumido a horizonte completo'),
  capitalStructure: z
    .string()
    .min(1)
    .describe('WACC con Rf (TES), beta sectorial, prima mercado, CRP (EMBI), Kd, t'),
  projectEvaluation: z
    .string()
    .min(1)
    .describe('VPN, TIR, TIRM, Payback simple/descontado, IR con criterios de decisión'),
  sensitivityAnalysis: z
    .string()
    .min(1)
    .describe('Tablas ±10/20% precio, volumen, costos, WACC + escenarios'),
  breakEvenAnalysis: z
    .string()
    .min(1)
    .describe('Punto de equilibrio operativo y financiero + margen de seguridad'),
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
  score: z
    .number()
    .int()
    .min(1)
    .max(25)
    .describe('probability x impact (1-25)'),
  classification: z.enum(['bajo', 'medio', 'alto', 'critico']),
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
      'Cálculo del VPN ajustado por riesgo + descripción cualitativa Monte Carlo',
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
