// ---------------------------------------------------------------------------
// Agente 2: NIIF Impact Analyst — outcome-first GPT-5.4
// ---------------------------------------------------------------------------
// Consume el output legacy del Tax Optimizer (Agente 1) y emite
// `NiifImpactReportJson`. Adapter local sintetiza el shape legacy
// `NiifImpactResult` para los consumers Markdown downstream.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import {
  NiifImpactReportSchema,
  type NiifImpactReportJson,
} from '../../contracts/tax-planning';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import { buildNiifImpactPrompt } from '../prompts/niif-impact.prompt';
import type { CompanyInfo } from '../../types';
import type {
  TaxOptimizerResult,
  NiifImpactResult,
  TaxPlanningProgressEvent,
} from '../types';

/**
 * Takes the Tax Optimizer output and evaluates NIIF implications of each
 * proposed strategy — deferred tax, disclosure requirements, and statement effects.
 */
export async function runNiifImpactAnalyst(
  taxOptimizerOutput: TaxOptimizerResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TaxPlanningProgressEvent) => void,
  signal?: AbortSignal,
): Promise<NiifImpactResult> {
  const system = buildNiifImpactPrompt(company, language);

  const userContent = [
    '<context>',
    '=== ANALISIS DEL OPTIMIZADOR TRIBUTARIO (Agente 1) ===',
    '',
    taxOptimizerOutput.fullContent,
    '</context>',
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Evaluando impacto NIIF de cada estrategia tributaria...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'niif-impact-analyst',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: NiifImpactReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.niifImpactAnalyst,
    signal,
  });

  return toLegacyShape(json);
}

// ---------------------------------------------------------------------------
// Adapter local
// ---------------------------------------------------------------------------

function toLegacyShape(json: NiifImpactReportJson): NiifImpactResult {
  const impactAssessment = renderImpactPerStrategy(json);
  const deferredTaxImplications = renderDeferredTax(json);
  const disclosureRequirements = renderDisclosures(json);
  const financialStatementEffects = renderEffects(json);

  const fullContent = [
    '## 1. EVALUACION DE IMPACTO NIIF POR ESTRATEGIA',
    '',
    impactAssessment,
    '',
    '## 2. IMPLICACIONES DE IMPUESTO DIFERIDO (NIC 12)',
    '',
    deferredTaxImplications,
    '',
    '## 3. REQUISITOS DE REVELACION Y PRESENTACION',
    '',
    disclosureRequirements,
    '',
    '## 4. EFECTOS EN ESTADOS FINANCIEROS',
    '',
    financialStatementEffects,
    json.preparerNotes.length > 0
      ? ['', '### Notas del Preparador', ...json.preparerNotes.map((n) => `- ${n}`)].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    impactAssessment,
    deferredTaxImplications,
    disclosureRequirements,
    financialStatementEffects,
    fullContent,
  };
}

function renderImpactPerStrategy(json: NiifImpactReportJson): string {
  if (json.impactPerStrategy.length === 0) return '_Sin estrategias evaluadas._';
  const rows = json.impactPerStrategy
    .map(
      (i) =>
        `| ${i.recommendationId} | ${i.affectedStandards.join('; ')} | ${i.impactType} | ${i.magnitude} | ${money(i.newDtaCents)} | ${money(i.newDtlCents)} | ${i.detail} |`,
    )
    .join('\n');
  return [
    '| Estrategia | Normas afectadas | Tipo impacto | Magnitud | Nuevo DTA | Nuevo DTL | Detalle |',
    '|---|---|---|---|---|---|---|',
    rows,
  ].join('\n');
}

function renderDeferredTax(json: NiifImpactReportJson): string {
  const r = json.deferredTaxRemeasurement;
  if (!r) return '_No se identifica cambio de tarifa que requiera remedición de DTA/DTL (NIC 12 §47)._';
  return [
    '**Remedición por cambio de tarifa (NIC 12 §47):**',
    '',
    '| Concepto | Valor |',
    '|---|---|',
    `| Tarifa original | ${r.originalRatePct}% |`,
    `| Nueva tarifa aplicable | ${r.newRatePct}% |`,
    `| DTA afectado | ${money(r.affectedDtaCents)} |`,
    `| DTL afectado | ${money(r.affectedDtlCents)} |`,
    `| Efecto en resultados | ${money(r.pnlEffectCents)} |`,
    `| Efecto en ORI | ${money(r.oriEffectCents)} |`,
  ].join('\n');
}

function renderDisclosures(json: NiifImpactReportJson): string {
  if (json.disclosureRequirements.length === 0) return '_Sin revelaciones adicionales identificadas._';
  return json.disclosureRequirements
    .map((d) => [`### ${d.noteTitle}`, `- **Norma:** ${d.norma}`, '', d.noteBody].join('\n'))
    .join('\n\n');
}

function renderEffects(json: NiifImpactReportJson): string {
  const e = json.financialStatementEffects;
  return [
    '| Estado / Rubro | Efecto neto |',
    '|---|---|',
    `| Total Activo | ${money(e.balanceAssetsImpactCents)} |`,
    `| Total Pasivo | ${money(e.balanceLiabilitiesImpactCents)} |`,
    `| Total Patrimonio | ${money(e.balanceEquityImpactCents)} |`,
    `| Utilidad Neta | ${money(e.pnlNetIncomeImpactCents)} |`,
    `| ORI | ${money(e.oriImpactCents)} |`,
    `| Flujo de Operación | ${money(e.cashFlowOperatingImpactCents)} |`,
    '',
    `**Comentario sobre indicadores clave:** ${e.keyRatiosCommentary}`,
  ].join('\n');
}

function money(cents: string): string {
  return formatCopFromCents(parseMoneyCop(cents), false);
}
