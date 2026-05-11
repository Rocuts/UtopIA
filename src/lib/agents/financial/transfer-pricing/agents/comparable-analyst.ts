// ---------------------------------------------------------------------------
// Agente 2: Analista de Comparables y Benchmarking (GPT-5.4, JSON-strict)
// ---------------------------------------------------------------------------
//
// Output contract: `ComparableAnalysisReportSchema` (Art. 260-4 E.T.).
// El renderer es LOCAL — produce la estructura legacy `ComparableAnalysisResult`
// para el orchestrator y el report consolidado.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildComparableAnalystPrompt } from '../prompts/comparable-analyst.prompt';
import {
  ComparableAnalysisReportSchema,
  type ComparableAnalysisReportJson,
} from '../../contracts/transfer-pricing';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type {
  TPAnalysisResult,
  ComparableAnalysisResult,
  TPProgressEvent,
} from '../types';

/**
 * Toma el output del TP Analyst y produce el estudio de comparabilidad +
 * rango intercuartil + ajustes + conclusión sobre plena competencia.
 */
export async function runComparableAnalyst(
  tpAnalysis: TPAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TPProgressEvent) => void,
  signal?: AbortSignal,
): Promise<ComparableAnalysisResult> {
  const system = buildComparableAnalystPrompt(company, language);

  const userContent = [
    'ANÁLISIS DE PRECIOS DE TRANSFERENCIA DEL AGENTE 1:',
    '',
    tpAnalysis.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 2,
    detail: 'Diseñando búsqueda y calculando rango intercuartil (Art. 260-4 E.T.)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'comparable-analyst',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: ComparableAnalysisReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.comparableAnalyst,
    signal,
  });

  return toComparableAnalysisResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: ComparableAnalysisReportJson -> ComparableAnalysisResult
// ---------------------------------------------------------------------------

function renderSearchStrategy(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  const s = json.searchStrategy;
  return [
    `**${lang === 'en' ? 'Sector codes' : 'Códigos sectoriales'}:** ${s.sectorCodes.join(', ') || '—'}`,
    `**${lang === 'en' ? 'Geographic scope' : 'Geografía priorizada'}:** ${s.geographicScope.join(' > ')}`,
    `**${lang === 'en' ? 'Time window' : 'Ventana temporal'}:** ${s.timeWindow}`,
    `**${lang === 'en' ? 'Exclusion filters' : 'Filtros de exclusión'}:** ${s.exclusionFilters.join(', ') || '—'}`,
    '',
    s.rationale,
  ].join('\n');
}

function renderComparabilityCriteria(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  if (json.comparabilityFactors.length === 0) {
    return lang === 'en' ? '_No factors documented._' : '_Sin factores documentados._';
  }
  const factorLabel: Record<typeof json.comparabilityFactors[number]['factor'], string> = {
    caracteristicas_bienes_servicios: lang === 'en' ? 'Goods/services characteristics' : 'Características de bienes/servicios',
    analisis_funcional: lang === 'en' ? 'Functional analysis' : 'Análisis funcional',
    condiciones_contractuales: lang === 'en' ? 'Contractual terms' : 'Condiciones contractuales',
    circunstancias_economicas: lang === 'en' ? 'Economic circumstances' : 'Circunstancias económicas',
    estrategias_empresariales: lang === 'en' ? 'Business strategies' : 'Estrategias empresariales',
  };
  return json.comparabilityFactors
    .map((f) => {
      const diffs = f.materialDifferences.length > 0
        ? `\n  _${lang === 'en' ? 'Material differences' : 'Diferencias materiales'}:_ ${f.materialDifferences.join('; ')}`
        : '';
      return `- **${factorLabel[f.factor]}:** ${f.description}${diffs}`;
    })
    .join('\n');
}

function renderSelectedComparables(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  if (json.selectedComparables.length === 0) {
    return lang === 'en' ? '_No comparables selected._' : '_Sin comparables seleccionados._';
  }
  const header = lang === 'en'
    ? '| Comparable | Country | Source | PLI | Quality | Simulated? |\n|---|---|---|---:|:---:|:---:|'
    : '| Comparable | País | Fuente | PLI | Calidad | ¿Simulado? |\n|---|---|---|---:|:---:|:---:|';
  const rows = json.selectedComparables.map((c) => {
    const sim = c.isSimulated ? (lang === 'en' ? 'Yes' : 'Sí') : 'No';
    return `| ${c.name} | ${c.jurisdiction} | ${c.source} | ${c.pliPercent.toFixed(2)}% | ${c.comparabilityQuality} | ${sim} |`;
  });
  const rationales = json.selectedComparables
    .map((c) => `- **${c.name}:** ${c.inclusionRationale}${c.adjustmentsApplied.length > 0 ? ` _(${c.adjustmentsApplied.join('; ')})_` : ''}`)
    .join('\n');
  return [header, rows.join('\n'), '', `**${lang === 'en' ? 'Rationale by comparable' : 'Justificación por comparable'}:**`, rationales].join('\n');
}

function renderInterquartileRange(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  const r = json.interquartileRange;
  const pli = r.observedPliPercent !== null ? `${r.observedPliPercent.toFixed(2)}%` : 'N/D';
  return [
    lang === 'en'
      ? '| Statistic | Value |\n|---|---:|'
      : '| Estadístico | Valor |\n|---|---:|',
    `| Min (P0) | ${r.min.toFixed(2)}% |`,
    `| Q1 (P25) | ${r.q1.toFixed(2)}% |`,
    `| ${lang === 'en' ? 'Median' : 'Mediana'} (P50) | ${r.median.toFixed(2)}% |`,
    `| Q3 (P75) | ${r.q3.toFixed(2)}% |`,
    `| Max (P100) | ${r.max.toFixed(2)}% |`,
    '',
    `**${lang === 'en' ? 'Observed PLI' : 'PLI observado'}:** ${pli}`,
    `**${lang === 'en' ? 'Within Q1-Q3?' : '¿Dentro de Q1-Q3?'}** ${r.isWithinRange ? (lang === 'en' ? 'Yes' : 'Sí') : 'No'}`,
  ].join('\n');
}

function renderAdjustments(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  if (json.adjustments.length === 0) {
    return lang === 'en' ? '_No adjustments applied._' : '_Sin ajustes aplicados._';
  }
  return json.adjustments
    .map((a) => {
      const impact = a.quantitativeImpactPercent !== null
        ? `${a.quantitativeImpactPercent >= 0 ? '+' : ''}${a.quantitativeImpactPercent.toFixed(2)} pp`
        : 'N/D';
      return `- **${a.type.replace(/_/g, ' ')}:** ${a.description} _(${lang === 'en' ? 'Impact' : 'Impacto'}: ${impact})._ ${a.rationale}`;
    })
    .join('\n');
}

function renderArmLengthConclusion(json: ComparableAnalysisReportJson, lang: 'es' | 'en'): string {
  const c = json.armLengthConclusion;
  const adj = formatCopFromCents(parseMoneyCop(c.requiredAdjustmentCop), true);
  return [
    `**${lang === 'en' ? 'Arm\'s length compliance' : 'Cumplimiento plena competencia'}:** ${c.complies ? (lang === 'en' ? 'COMPLIES' : 'CUMPLE') : (lang === 'en' ? 'DOES NOT COMPLY' : 'NO CUMPLE')}`,
    `**${lang === 'en' ? 'Required adjustment to median' : 'Ajuste requerido a la mediana'}:** ${adj} (${c.requiredAdjustmentPercent.toFixed(2)}%)`,
    c.taxImpactNote ? `**${lang === 'en' ? 'Tax impact' : 'Impacto fiscal'}:** ${c.taxImpactNote}` : '',
    '',
    c.rationale,
  ]
    .filter(Boolean)
    .join('\n');
}

function toComparableAnalysisResult(
  json: ComparableAnalysisReportJson,
  lang: 'es' | 'en',
): ComparableAnalysisResult {
  const searchStrategy = renderSearchStrategy(json, lang);
  const comparabilityCriteria = renderComparabilityCriteria(json, lang);
  const selectedComparables = renderSelectedComparables(json, lang);
  const interquartileRange = renderInterquartileRange(json, lang);
  const adjustmentsApplied = renderAdjustments(json, lang);
  const armLengthConclusion = renderArmLengthConclusion(json, lang);

  const fullContent = [
    '## 1. ESTRATEGIA DE BÚSQUEDA DE COMPARABLES',
    searchStrategy,
    '',
    '## 2. CRITERIOS DE COMPARABILIDAD',
    comparabilityCriteria,
    '',
    '## 3. COMPARABLES SELECCIONADOS',
    selectedComparables,
    '',
    '## 4. RANGO INTERCUARTIL Y MEDIANA',
    interquartileRange,
    '',
    '## 5. AJUSTES DE COMPARABILIDAD',
    adjustmentsApplied,
    '',
    '## 6. CONCLUSIÓN SOBRE PLENA COMPETENCIA',
    armLengthConclusion,
    '',
    json.citations.length > 0
      ? `_Citas: ${json.citations.join(' · ')}_`
      : '',
    json.technicalNotes.length > 0
      ? `\n**${lang === 'en' ? 'Technical notes' : 'Notas técnicas'}:**\n${json.technicalNotes.map((n) => `- ${n}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    searchStrategy,
    comparabilityCriteria,
    selectedComparables,
    interquartileRange,
    adjustmentsApplied,
    armLengthConclusion,
    fullContent,
  };
}
