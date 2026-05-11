// ---------------------------------------------------------------------------
// Agente 1: Tax Optimizer (Tax Planning Strategist) — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Consume datos crudos y emite `TaxOptimizationReportJson` validado por Zod.
// El adapter local `toLegacyShape` mantiene el contrato `TaxOptimizerResult`
// (strings markdown) que esperan downstream agents y el orchestrator de
// consolidación. Cuando se migre el consumer en Fase 3, el adapter desaparece.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import {
  TaxOptimizationReportSchema,
  type TaxOptimizationReportJson,
} from '../../contracts/tax-planning';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import { buildTaxOptimizerPrompt } from '../prompts/tax-optimizer.prompt';
import type { CompanyInfo } from '../../types';
import type { TaxOptimizerResult, TaxPlanningProgressEvent } from '../types';

/**
 * Analyzes the company's current tax structure and proposes optimization
 * strategies with projected savings in COP.
 */
export async function runTaxOptimizer(
  rawData: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions?: string,
  onProgress?: (event: TaxPlanningProgressEvent) => void,
  signal?: AbortSignal,
): Promise<TaxOptimizerResult> {
  const system = buildTaxOptimizerPrompt(company, language);

  const userContent = [
    '<context>',
    'DATOS FINANCIEROS Y TRIBUTARIOS DE LA EMPRESA:',
    '',
    rawData,
    instructions ? `\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
    '</context>',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 1,
    detail: 'Analizando estructura tributaria actual y evaluando regimenes...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'tax-optimizer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TaxOptimizationReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.taxOptimizer,
    signal,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON estricto -> shape legacy con secciones markdown
// ---------------------------------------------------------------------------
// El orchestrator de consolidación y el Agente 2 (NIIF Impact) leen
// `fullContent` como prosa markdown. Hasta que esos consumers migren al
// shape JSON, este adapter sintetiza markdown legible desde el JSON.

function toLegacyShape(json: TaxOptimizationReportJson): TaxOptimizerResult {
  const currentStructureAnalysis = renderCurrentDiagnosis(json);
  const optimizationStrategies = renderRecommendations(json);
  const projectedSavings = renderSavingsProjection(json);
  const implementationRoadmap = renderRoadmap(json);

  const fullContent = [
    '## 1. DIAGNOSTICO DE ESTRUCTURA TRIBUTARIA ACTUAL',
    '',
    currentStructureAnalysis,
    '',
    '## 2. ESTRATEGIAS DE OPTIMIZACION TRIBUTARIA',
    '',
    optimizationStrategies,
    '',
    '## 3. PROYECCION DE AHORROS',
    '',
    projectedSavings,
    '',
    '## 4. HOJA DE RUTA DE IMPLEMENTACION',
    '',
    implementationRoadmap,
    json.preparerNotes.length > 0
      ? ['', '### Notas del Preparador', ...json.preparerNotes.map((n) => `- ${n}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    currentStructureAnalysis,
    optimizationStrategies,
    projectedSavings,
    implementationRoadmap,
    fullContent,
  };
}

function renderCurrentDiagnosis(json: TaxOptimizationReportJson): string {
  const d = json.currentDiagnosis;
  const dc = d.dualCalculation;
  const benefitsRows = d.currentBenefitsUsed
    .map((b) => `| ${b.norma} | ${b.descripcion} | ${money(b.ahorroEstimadoCents)} |`)
    .join('\n');

  return [
    `- **Régimen actual:** ${d.currentRegime}`,
    `- **Renta líquida gravable:** ${money(d.taxableIncomeCents)}`,
    `- **Utilidad contable antes de impuestos (UAI):** ${money(d.accountingProfitBeforeTaxCents)}`,
    `- **Tasa efectiva actual:** ${d.effectiveTaxRatePct.toFixed(2)}%`,
    '',
    '**Cálculo dual TMT (Art. 240 parág. 6 E.T.):**',
    '',
    '| Concepto | Valor |',
    '|---|---|',
    `| Renta Ordinaria 35% (Art. 240 E.T.) | ${money(dc.rentaOrdinaria35Cents)} |`,
    `| Tributación Mínima 15% (parág. 6 Art. 240 E.T.) | ${money(dc.tributacionMinima15Cents)} |`,
    `| Impuesto a cargo del periodo (MAX) | ${money(dc.impuestoACargoCents)} |`,
    `| TMT aplicable | ${dc.tmtAplicable ? 'Sí' : 'No'} |`,
    dc.tmtExemptionReason ? `| Excepción aplicable | ${dc.tmtExemptionReason} |` : '',
    '',
    benefitsRows
      ? ['**Beneficios actualmente aprovechados:**', '', '| Norma | Descripción | Ahorro estimado |', '|---|---|---|', benefitsRows].join('\n')
      : '',
    '',
    d.diagnosticNotes,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderRecommendations(json: TaxOptimizationReportJson): string {
  if (json.recommendations.length === 0) return '_Sin estrategias propuestas._';
  return json.recommendations
    .map((r) => {
      const lines = [
        `### ${r.id}. ${r.title}`,
        `- **Base normativa:** ${r.norma}`,
        r.regimeTarget ? `- **Régimen objetivo:** ${r.regimeTarget}` : '',
        `- **Diagnóstico:** ${r.rationale}`,
        `- **Ahorro estimado:** ${money(r.estimatedSavingsCents)}`,
        `- **Costo de implementación:** ${money(r.implementationCostCents)}`,
        r.roiPct !== null ? `- **ROI:** ${r.roiPct.toFixed(1)}%` : '',
        `- **Horizonte:** ${r.horizon}`,
        `- **Prioridad:** ${r.priority}`,
        `- **Riesgo regulatorio:** ${r.riskLevel}`,
        r.preconditions.length > 0
          ? `- **Precondiciones:** ${r.preconditions.join('; ')}`
          : '',
      ];
      return lines.filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function renderSavingsProjection(json: TaxOptimizationReportJson): string {
  const p = json.savingsProjection;
  return [
    '| Escenario | Impuesto a cargo | Tasa efectiva |',
    '|---|---|---|',
    `| Actual | ${money(p.currentScenarioTaxCents)} | ${p.effectiveRateBeforePct.toFixed(2)}% |`,
    `| Optimizado | ${money(p.optimizedScenarioTaxCents)} | ${p.effectiveRateAfterPct.toFixed(2)}% |`,
    `| **Ahorro anual proyectado** | **${money(p.totalAnnualSavingsCents)}** | — |`,
    '',
    p.assumptions.length > 0
      ? ['**Supuestos del modelo:**', '', ...p.assumptions.map((a) => `- ${a}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderRoadmap(json: TaxOptimizationReportJson): string {
  if (json.implementationRoadmap.length === 0) return '_Sin hoja de ruta definida._';
  const rows = json.implementationRoadmap
    .map(
      (s) =>
        `| ${s.recommendationId} | ${s.action} | ${s.owner} | ${s.dueDaysFromKickoff}d | ${s.dependencies.length > 0 ? s.dependencies.join(', ') : '—'} |`,
    )
    .join('\n');
  return [
    '| Estrategia | Acción | Responsable | Plazo (días) | Dependencias |',
    '|---|---|---|---|---|',
    rows,
  ].join('\n');
}

function money(cents: string): string {
  return formatCopFromCents(parseMoneyCop(cents), false);
}
