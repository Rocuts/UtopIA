// ---------------------------------------------------------------------------
// Agente 3: Especialista en Documentación de Precios de Transferencia (GPT-5.4)
// ---------------------------------------------------------------------------
//
// Output contract: `TpDocumentationReportSchema` (Art. 260-5 E.T., Decreto
// 2120/2017, Acción 13 BEPS, Art. 647 E.T. — Diferencia de Criterio).
// El renderer es LOCAL — produce la estructura legacy `TPDocumentationResult`.
// ---------------------------------------------------------------------------

import { callFinancialAgent } from '../../agents/runtime';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { buildTPDocumentationPrompt } from '../prompts/tp-documentation.prompt';
import {
  TpDocumentationReportSchema,
  type TpDocumentationReportJson,
} from '../../contracts/transfer-pricing';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type {
  TPAnalysisResult,
  ComparableAnalysisResult,
  TPDocumentationResult,
  TPProgressEvent,
} from '../types';

/**
 * Toma los outputs de los Agentes 1 + 2 y produce la documentación
 * comprobatoria + Master File + guía Formato 1125 + sanciones + defensa
 * Art. 647 E.T.
 */
export async function runTPDocumentationWriter(
  tpAnalysis: TPAnalysisResult,
  comparableAnalysis: ComparableAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: TPProgressEvent) => void,
  signal?: AbortSignal,
): Promise<TPDocumentationResult> {
  const system = buildTPDocumentationPrompt(company, language);

  const userContent = [
    'ANÁLISIS DEL AGENTE 1 — ANALISTA DE PRECIOS DE TRANSFERENCIA:',
    '',
    tpAnalysis.fullContent,
    '',
    '---',
    '',
    'ANÁLISIS DEL AGENTE 2 — ESTUDIO DE COMPARABLES Y BENCHMARKING:',
    '',
    comparableAnalysis.fullContent,
  ].join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 3,
    detail: 'Redactando Local File, Master File, Formato 1125 y defensa Art. 647 E.T...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'tp-documentation-writer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TpDocumentationReportSchema,
    system,
    userContent,
    ...MODELS_CONFIG.tpDocumentationWriter,
    signal,
  });

  return toTPDocumentationResult(json, language);
}

// ---------------------------------------------------------------------------
// Adapter local: TpDocumentationReportJson -> TPDocumentationResult legacy
// ---------------------------------------------------------------------------

function renderExecutiveSummary(json: TpDocumentationReportJson, lang: 'es' | 'en'): string {
  const e = json.executiveSummary;
  const conclusionLabel: Record<typeof e.overallComplianceConclusion, string> = {
    cumple: lang === 'en' ? 'COMPLIES' : 'CUMPLE',
    no_cumple: lang === 'en' ? 'DOES NOT COMPLY' : 'NO CUMPLE',
    cumple_con_ajustes: lang === 'en' ? 'COMPLIES WITH ADJUSTMENTS' : 'CUMPLE CON AJUSTES',
  };
  return [
    `**${lang === 'en' ? 'Objective' : 'Objetivo'}:** ${e.objective}`,
    `**${lang === 'en' ? 'Period' : 'Periodo'}:** ${e.period}`,
    `**${lang === 'en' ? 'Methods applied' : 'Métodos aplicados'}:** ${e.methodsApplied.join(', ')}`,
    `**${lang === 'en' ? 'Compliance conclusion' : 'Conclusión global'}:** ${conclusionLabel[e.overallComplianceConclusion]}`,
    '',
    e.transactionsOverview,
    '',
    `**${lang === 'en' ? 'Key risks' : 'Riesgos clave'}:**`,
    e.keyRisks.length > 0 ? e.keyRisks.map((r) => `- ${r}`).join('\n') : (lang === 'en' ? '_None._' : '_Ninguno._'),
    '',
    `**${lang === 'en' ? 'Key recommendations' : 'Recomendaciones clave'}:**`,
    e.keyRecommendations.length > 0 ? e.keyRecommendations.map((r) => `- ${r}`).join('\n') : (lang === 'en' ? '_None._' : '_Ninguna._'),
  ].join('\n');
}

function renderLocalFile(json: TpDocumentationReportJson, lang: 'es' | 'en'): string {
  const lf = json.localFile;
  const conclusions = lf.conclusionsByOperation
    .map((c) => {
      const adj = formatCopFromCents(parseMoneyCop(c.requiredAdjustmentCop), true);
      const cmp = c.complies ? (lang === 'en' ? 'COMPLIES' : 'CUMPLE') : (lang === 'en' ? 'DOES NOT COMPLY' : 'NO CUMPLE');
      return `- **${c.transactionDescription}** — ${cmp} | ${lang === 'en' ? 'Adjustment' : 'Ajuste'}: ${adj}${c.fiscalImpactNote ? ` | _${c.fiscalImpactNote}_` : ''}`;
    })
    .join('\n');
  return [
    '### 2.1. ' + (lang === 'en' ? 'Taxpayer information' : 'Información del contribuyente'),
    lf.taxpayerInfo,
    '',
    '### 2.2. ' + (lang === 'en' ? 'Industry description' : 'Descripción de la industria'),
    lf.industryDescription,
    '',
    '### 2.3. ' + (lang === 'en' ? 'Controlled transactions' : 'Transacciones controladas'),
    lf.transactionsDetail,
    '',
    '### 2.4. ' + (lang === 'en' ? 'Functional analysis' : 'Análisis funcional'),
    lf.functionalAnalysisDetail,
    '',
    '### 2.5. ' + (lang === 'en' ? 'Economic analysis' : 'Análisis económico'),
    lf.economicAnalysisDetail,
    '',
    '### 2.6. ' + (lang === 'en' ? 'Conclusions by operation' : 'Conclusiones por operación'),
    conclusions || (lang === 'en' ? '_No operations._' : '_Sin operaciones._'),
  ].join('\n');
}

function renderMasterFile(json: TpDocumentationReportJson, lang: 'es' | 'en'): string {
  const mf = json.masterFile;
  return [
    `### ${lang === 'en' ? 'Group organizational structure' : 'Estructura organizacional del grupo'}`,
    mf.groupOrganizationalStructure,
    '',
    `### ${lang === 'en' ? 'Group business description' : 'Descripción del negocio del grupo'}`,
    mf.groupBusinessDescription,
    '',
    `### ${lang === 'en' ? 'Group intangibles' : 'Intangibles del grupo'}`,
    mf.groupIntangibles,
    '',
    `### ${lang === 'en' ? 'Intercompany financial activities' : 'Actividades financieras intercompañía'}`,
    mf.intercompanyFinancialActivities,
    '',
    `### ${lang === 'en' ? 'Group financial and tax positions' : 'Posiciones financieras y fiscales del grupo'}`,
    mf.groupFinancialAndTaxPositions,
  ].join('\n');
}

function renderFormato1125(json: TpDocumentationReportJson, lang: 'es' | 'en'): string {
  if (json.formato1125Rows.length === 0) {
    return lang === 'en' ? '_No rows for Formato 1125._' : '_Sin filas para Formato 1125._';
  }
  const header = lang === 'en'
    ? '| Code | Related Party | Tax ID | Country | Amount | Method | PLI | Q1 | Median | Q3 | In Range? | Adjustment |\n|---|---|---|---|---:|:---:|---:|---:|---:|---:|:---:|---:|'
    : '| Código | Vinculado | NIT/Tax ID | País | Monto | Método | PLI | Q1 | Mediana | Q3 | ¿En rango? | Ajuste |\n|---|---|---|---|---:|:---:|---:|---:|---:|---:|:---:|---:|';
  const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
  const rows = json.formato1125Rows.map((r) => {
    const amt = formatCopFromCents(parseMoneyCop(r.amountCop), true);
    const adj = formatCopFromCents(parseMoneyCop(r.adjustmentCop), true);
    const inRange = r.isWithinRange ? (lang === 'en' ? 'Yes' : 'Sí') : 'No';
    return `| ${r.operationCode} | ${r.relatedPartyName} | ${r.relatedPartyTaxId} | ${r.countryCode} | ${amt} | ${r.methodCode} | ${fmtPct(r.observedPliPercent)} | ${fmtPct(r.q1Percent)} | ${fmtPct(r.medianPercent)} | ${fmtPct(r.q3Percent)} | ${inRange} | ${adj} |`;
  });
  const remarks = json.formato1125Rows
    .filter((r) => r.remarks)
    .map((r) => `- **${r.operationCode} / ${r.relatedPartyName}:** ${r.remarks}`)
    .join('\n');
  return [header, rows.join('\n'), '', remarks].filter(Boolean).join('\n');
}

function renderSanctions(json: TpDocumentationReportJson, lang: 'es' | 'en'): string {
  if (json.potentialSanctions.length === 0) {
    return lang === 'en' ? '_No sanctions documented._' : '_Sin sanciones documentadas._';
  }
  const header = lang === 'en'
    ? '| Scenario | Max UVT | Max COP | Description |\n|---|---:|---:|---|'
    : '| Escenario | Máximo UVT | Máximo COP | Descripción |\n|---|---:|---:|---|';
  const rows = json.potentialSanctions.map((s) => {
    const cop = formatCopFromCents(parseMoneyCop(s.maximumCop), true);
    return `| ${s.scenario.replace(/_/g, ' ')} | ${s.maximumUvt.toLocaleString('es-CO')} | ${cop} | ${s.description} |`;
  });
  return [header, rows.join('\n')].join('\n');
}

function renderRecommendationsAndDefense(
  json: TpDocumentationReportJson,
  lang: 'es' | 'en',
): string {
  const recs = json.recommendations
    .map((r) => `- **${r.title}** — ${r.detail}${r.norm ? ` _(${r.norm})_` : ''}`)
    .join('\n');
  const defense = json.art647Defense.applies
    ? [
        '',
        `### ${lang === 'en' ? 'Defense — Art. 647 E.T. (Difference of Criterion)' : 'Defensa — Art. 647 E.T. (Diferencia de Criterio)'}`,
        json.art647Defense.rationale,
      ].join('\n')
    : `\n### ${lang === 'en' ? 'Defense — Art. 647 E.T.' : 'Defensa — Art. 647 E.T.'}\n_${lang === 'en' ? 'Not applicable for this case' : 'No aplica para este caso'}: ${json.art647Defense.rationale}_`;
  return [recs || (lang === 'en' ? '_None._' : '_Ninguna._'), defense].join('\n');
}

function toTPDocumentationResult(
  json: TpDocumentationReportJson,
  lang: 'es' | 'en',
): TPDocumentationResult {
  const executiveSummary = renderExecutiveSummary(json, lang);
  const localReport = renderLocalFile(json, lang);
  const masterFileEquivalent = renderMasterFile(json, lang);
  const formato1125Guide = renderFormato1125(json, lang);

  const sanctionsBlock = renderSanctions(json, lang);
  const recsAndDefense = renderRecommendationsAndDefense(json, lang);
  const conclusions = [
    '### ' + (lang === 'en' ? 'Potential sanctions (Art. 260-11 E.T.)' : 'Sanciones potenciales (Art. 260-11 E.T.)'),
    sanctionsBlock,
    '',
    '### ' + (lang === 'en' ? 'Recommendations' : 'Recomendaciones'),
    recsAndDefense,
  ].join('\n');

  const fullContent = [
    '## 1. RESUMEN EJECUTIVO',
    executiveSummary,
    '',
    '## 2. INFORME LOCAL (DOCUMENTACIÓN COMPROBATORIA)',
    localReport,
    '',
    '## 3. MASTER FILE (ARCHIVO MAESTRO)',
    masterFileEquivalent,
    '',
    '## 4. CONCLUSIONES Y RECOMENDACIONES',
    conclusions,
    '',
    '## 5. GUÍA DE DILIGENCIAMIENTO — FORMATO 1125 DIAN',
    formato1125Guide,
    '',
    json.citations.length > 0
      ? `_${lang === 'en' ? 'Citations' : 'Citas'}: ${json.citations.join(' · ')}_`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    executiveSummary,
    localReport,
    masterFileEquivalent,
    conclusions,
    formato1125Guide,
    fullContent,
  };
}
