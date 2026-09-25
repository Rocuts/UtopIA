// ---------------------------------------------------------------------------
// Agente 3: Evaluador de Riesgos (Feasibility)
// ---------------------------------------------------------------------------
// Refactor outcome-first GPT-5.4 con `callFinancialAgent` +
// `RiskAssessmentReportSchema` + `MODELS_CONFIG.riskAssessor`.
//
// valoracion-09: recibe los datos e instrucciones del usuario y las métricas
//   calculadas en código por el Modelador Financiero.
// valoracion-10: score = P × I y clasificación se derivan en código; el VPN
//   ajustado por riesgo se recalcula con los flujos del Modelador; la decisión
//   go/no-go pasa por reglas deterministas; no se afirma ninguna simulación.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildRiskAssessorPrompt } from '../prompts/risk-assessor.prompt';
import {
  RiskAssessmentReportSchema,
  type RiskAssessmentReportJson,
  type RiskItemJson,
} from '../../contracts/feasibility';
import { formatCopFromCents } from '../../contracts/money';
import { computeNpvCents } from '../calc/project-metrics';
import type {
  ProjectInfo,
  MarketAnalysisResult,
  FinancialModelResult,
  RiskAssessmentResult,
  FeasibilityProgressEvent,
} from '../types';

export interface RiskAssessorInput {
  marketOutput: MarketAnalysisResult;
  financialOutput: FinancialModelResult;
  project: ProjectInfo;
  language: 'es' | 'en';
  projectData: string;
  instructions?: string;
  onProgress?: (event: FeasibilityProgressEvent) => void;
}

/**
 * Takes outputs from Agent 1 (Market) and Agent 2 (Financial) plus the user's
 * data to produce a risk assessment with a rule-checked go/no-go decision.
 */
export async function runRiskAssessor(input: RiskAssessorInput): Promise<RiskAssessmentResult> {
  const { marketOutput, financialOutput, project, language, projectData, instructions, onProgress } = input;
  onProgress?.({ type: 'stage_progress', stage: 3, detail: 'Evaluando riesgos y construyendo matriz probabilidad-impacto...' });

  const m = financialOutput.metrics;
  const metricsJson = JSON.stringify(
    {
      unidad: 'centavos COP (MoneyCop)',
      tasaDescuentoPercent: financialOutput.discountRate.percent,
      origenTasa: financialOutput.discountRate.source,
      vpnCop: m?.npvCop ?? null,
      tirPercent: m?.irrPercent ?? null,
      tirmPercent: m?.mirrPercent ?? null,
      paybackAnios: m?.paybackYears ?? null,
      paybackDescontadoAnios: m?.discountedPaybackYears ?? null,
      indiceRentabilidad: m?.profitabilityIndex ?? null,
      motivosND: financialOutput.metricsUnavailableReasons,
    },
    null,
    2,
  );

  const userContent = [
    '=== DATOS DEL PROYECTO SUMINISTRADOS POR EL USUARIO ===',
    '',
    projectData,
    '',
    instructions ? `=== INSTRUCCIONES ADICIONALES DEL USUARIO ===\n\n${instructions}\n` : '',
    '=== METRICAS CALCULADAS EN CODIGO (vinculantes) ===',
    '',
    metricsJson,
    '',
    '=== ANALISIS DE MERCADO (Agente 1) ===',
    '',
    marketOutput.fullContent,
    '',
    '=== MODELO FINANCIERO (Agente 2) ===',
    '',
    financialOutput.fullContent,
  ]
    .filter(Boolean)
    .join('\n');

  const { json } = await callFinancialAgent({
    agentName: 'risk-assessor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: RiskAssessmentReportSchema,
    system: buildRiskAssessorPrompt(project, language),
    userContent,
    ...MODELS_CONFIG.riskAssessor,
  });

  return toRiskAssessmentResult(json, financialOutput, language);
}

// ---------------------------------------------------------------------------
// Reglas deterministas
// ---------------------------------------------------------------------------

export type RiskClassification = 'bajo' | 'medio' | 'alto' | 'critico';

/** Escala del prompt: 1-4 bajo, 5-9 medio, 10-15 alto, 16-25 crítico. */
export function classifyRiskScore(score: number): RiskClassification {
  if (score >= 16) return 'critico';
  if (score >= 10) return 'alto';
  if (score >= 5) return 'medio';
  return 'bajo';
}

export interface ScoredRisk extends RiskItemJson {
  score: number;
  classification: RiskClassification;
}

export function scoreRisks(items: readonly RiskItemJson[]): ScoredRisk[] {
  return items.map((r) => {
    const score = r.probability * r.impact;
    return { ...r, score, classification: classifyRiskScore(score) };
  });
}

export type FinalDecision = RiskAssessmentResult['decision'];

/**
 * Decisión final: el código sólo la hace MÁS conservadora que la del LLM.
 *   VPN N/D → no determinable; VPN < 0 → no_go; riesgo crítico sin mitigación
 *   → no_go; "go" con riesgos altos/críticos → go_con_condiciones.
 */
export function deriveGoNoGo(
  llmDecision: RiskAssessmentReportJson['goNoGoDecision'],
  risks: readonly ScoredRisk[],
  npvCents: bigint | null,
): { decision: FinalDecision; overrides: string[] } {
  const overrides: string[] = [];
  if (npvCents === null) {
    overrides.push('VPN no calculable en código: la decisión no es determinable.');
    return { decision: 'no_determinable', overrides };
  }
  if (npvCents < BigInt(0)) {
    if (llmDecision !== 'no_go') overrides.push('VPN calculado < 0 ⇒ NO-GO.');
    return { decision: 'no_go', overrides };
  }
  const unmitigatedCritical = risks.filter((r) => r.classification === 'critico' && r.mitigation.trim() === '');
  if (unmitigatedCritical.length > 0) {
    if (llmDecision !== 'no_go') overrides.push(`${unmitigatedCritical.length} riesgo(s) crítico(s) (score ≥ 16) sin mitigación ⇒ NO-GO.`);
    return { decision: 'no_go', overrides };
  }
  const highOrCritical = risks.filter((r) => r.classification === 'alto' || r.classification === 'critico');
  if (llmDecision === 'go' && highOrCritical.length > 0) {
    overrides.push(`${highOrCritical.length} riesgo(s) alto(s)/crítico(s) ⇒ GO CON CONDICIONES (mitigación previa).`);
    return { decision: 'go_con_condiciones', overrides };
  }
  return { decision: llmDecision, overrides };
}

// ---------------------------------------------------------------------------
// Adapter local — JSON-strict -> RiskAssessmentResult legacy
// ---------------------------------------------------------------------------

const DECISION_LABEL: Record<FinalDecision, string> = {
  go: 'GO — Recomendado',
  go_con_condiciones: 'GO CON CONDICIONES',
  no_go: 'NO-GO',
  no_determinable: 'N/D — no determinable (sin VPN calculable)',
};

function renderRiskAdjustedNpv(
  json: RiskAssessmentReportJson,
  financial: FinancialModelResult,
  lang: 'es' | 'en',
): string {
  const en = lang === 'en';
  const lines: string[] = [];
  const rate = json.riskAdjustedDiscountRatePercent;
  const base = financial.discountRate.percent;
  if (rate === null) {
    lines.push(en ? '**Risk-adjusted NPV:** N/D (no risk-adjusted rate proposed).' : '**VPN ajustado por riesgo:** N/D (no se propuso tasa ajustada por riesgo).');
  } else if (!financial.metrics) {
    lines.push(en ? '**Risk-adjusted NPV:** N/D (no computable cash flows).' : '**VPN ajustado por riesgo:** N/D (flujos no calculables).');
  } else {
    const npv = computeNpvCents(financial.initialInvestmentCop, financial.cashFlows, rate);
    lines.push(
      `**${en ? 'Risk-adjusted NPV (computed in code)' : 'VPN ajustado por riesgo (calculado en código)'}:** ${formatCopFromCents(npv, false)} @ ${rate.toFixed(2)}%`,
    );
    if (base !== null && rate < base) {
      lines.push(en
        ? `_Note: the proposed rate (${rate.toFixed(2)}%) is below the base rate (${base.toFixed(2)}%): it is not a risk adjustment._`
        : `_Nota: la tasa propuesta (${rate.toFixed(2)}%) es inferior a la tasa base (${base.toFixed(2)}%): no constituye un ajuste por riesgo._`);
    }
  }
  if (/monte\s*carlo|iteraci[oó]n/i.test(json.riskAdjustedNpv)) {
    lines.push(en
      ? '_Note: no Monte Carlo simulation was executed; any reference to it below is qualitative and carries no computed probabilities._'
      : '_Nota: no se ejecutó ninguna simulación Monte Carlo; cualquier referencia a ella es cualitativa y no contiene probabilidades calculadas._');
  }
  lines.push('', `**${en ? 'Qualitative / scenario analysis' : 'Análisis cualitativo / de escenarios'}:** ${json.riskAdjustedNpv}`);
  return lines.join('\n');
}

export function toRiskAssessmentResult(
  json: RiskAssessmentReportJson,
  financial: FinancialModelResult,
  lang: 'es' | 'en',
): RiskAssessmentResult {
  const risks = scoreRisks(json.riskMatrix);
  const npv = financial.metrics ? BigInt(financial.metrics.npvCop) : null;
  const { decision, overrides } = deriveGoNoGo(json.goNoGoDecision, risks, npv);

  const riskMatrixMd = renderRiskMatrix(risks);
  const riskAdjustedNpv = renderRiskAdjustedNpv(json, financial, lang);
  const overridesMd = overrides.length > 0
    ? `\n\n**Ajustes deterministas a la decisión del modelo (${DECISION_LABEL[json.goNoGoDecision as FinalDecision]} → ${DECISION_LABEL[decision]}):**\n${overrides.map((o) => `- ${o}`).join('\n')}`
    : '';
  const goNoGoMd = `**Decision:** ${DECISION_LABEL[decision]}${overridesMd}\n\n${json.goNoGoRationale}`;

  const fullContent = [
    '## 1. MATRIZ DE RIESGOS',
    '',
    riskMatrixMd,
    '',
    '## 2. VPN AJUSTADO POR RIESGO',
    '',
    riskAdjustedNpv,
    '',
    '## 3. ESTRATEGIAS DE MITIGACION',
    '',
    json.mitigationStrategies,
    '',
    '## 4. RECOMENDACIONES DE SEGUROS Y COBERTURAS',
    '',
    json.insuranceRecommendations,
    '',
    '## 5. RECOMENDACION GO / NO-GO',
    '',
    goNoGoMd,
    '',
    '## 6. RESUMEN EJECUTIVO',
    '',
    json.executiveSummary,
  ].join('\n');

  return {
    riskMatrix: riskMatrixMd,
    riskAdjustedNpv,
    mitigationStrategies: json.mitigationStrategies,
    insuranceRecommendations: json.insuranceRecommendations,
    goNoGoRecommendation: goNoGoMd,
    executiveSummary: json.executiveSummary,
    fullContent,
    decision,
    decisionOverrides: overrides,
  };
}

function renderRiskMatrix(items: ScoredRisk[]): string {
  if (items.length === 0) return '(Sin riesgos identificados)';
  const header = '| # | Categoria | Descripcion | P | I | Score (P×I) | Clasificacion | Norma |';
  const sep = '|---|---|---|---:|---:|---:|---|---|';
  const rows = items
    .map(
      (r, idx) =>
        `| ${idx + 1} | ${r.category} | ${r.description.replace(/\|/g, '\\|')} | ${r.probability} | ${r.impact} | ${r.score} | ${r.classification} | ${r.normReference ?? '—'} |`,
    )
    .join('\n');
  const highOrCritical = items.filter((r) => r.classification === 'alto' || r.classification === 'critico');
  const mitigations = highOrCritical
    .map((r, idx) => `${idx + 1}. (${r.category}) ${r.description} → Mitigacion: ${r.mitigation.trim() || '**SIN MITIGACION DOCUMENTADA**'}`)
    .join('\n');
  return [
    header,
    sep,
    rows,
    '',
    '_Score y clasificación calculados en código (P × I; 1-4 bajo, 5-9 medio, 10-15 alto, 16-25 crítico)._',
    '',
    '**Mitigaciones para riesgos altos/criticos:**',
    '',
    mitigations || '(Sin riesgos altos/criticos)',
  ].join('\n');
}
