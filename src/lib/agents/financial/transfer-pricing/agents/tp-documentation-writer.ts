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
import {
  notaSinMontosDelModelo,
  textoSinMontosDeAjuste,
  textosSinMontosDeAjuste,
  tpAjusteCopDeterminista,
  tpMotivoRango,
  type TpRangeCheck,
} from '../lib/deterministic';
import {
  ART_260_11_FUENTE,
  ART_260_11_SANCIONES,
  enforceTpSanctions,
  topeCentavos,
} from '../lib/sanciones-260-11';

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
  const check = comparableAnalysis.rangeCheck;
  // Los topes de sanción se expresan con la UVT del año de presentación de la
  // documentación (año gravable + 1); si esa UVT no está registrada → N/D.
  const sanctionYear = tpAnalysis.taxYear + 1;

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
    '',
    check.conclusive
      ? ''
      : `ESTADO DEL ANÁLISIS ECONÓMICO: ${check.reason} La conclusión global y las filas del Formato 1125 deben presentarse como escenario ilustrativo, no como definitivas.`,
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

  return toTPDocumentationResult(
    enforceTpDocumentation(enforceTpSanctions(json, sanctionYear), check, language),
    check,
    sanctionYear,
    language,
  );
}

/**
 * Sobrescribe en las filas del Formato 1125 el rango (Q1, mediana, Q3) y
 * «¿en rango?» con el cálculo determinista del Agente 2. Si el análisis no es
 * concluyente las filas se marcan como ilustrativas.
 */
export function enforceTpDocumentation(
  json: TpDocumentationReportJson,
  check: TpRangeCheck,
  language: 'es' | 'en' = 'es',
): TpDocumentationReportJson {
  const s = check.stats;
  const ilustrativa =
    (language === 'en' ? 'ILLUSTRATIVE — do not file: ' : 'ILUSTRATIVA — no presentar: ') +
    (tpMotivoRango(check, language) ?? '');
  // Ajuste en COP: "0" dentro del rango; fuera de él N/D (el contrato no trae
  // la base del PLI en COP por operación — fase 2, pendiente #8).
  const ajusteCop = tpAjusteCopDeterminista(check);
  // Textos libres del modelo que hablan del ajuste: sin montos que el código
  // no calculó cuando el ajuste en COP es N/D (I4-escudo 7). Los montos de las
  // operaciones (transactionsDetail / transactionsOverview) no son el ajuste.
  const sinMontos = (t: string) => textoSinMontosDeAjuste(t, ajusteCop, language);
  return {
    ...json,
    executiveSummary: {
      ...json.executiveSummary,
      keyRisks: textosSinMontosDeAjuste(json.executiveSummary.keyRisks, ajusteCop, language),
      keyRecommendations: textosSinMontosDeAjuste(json.executiveSummary.keyRecommendations, ajusteCop, language),
    },
    localFile: {
      ...json.localFile,
      economicAnalysisDetail: sinMontos(json.localFile.economicAnalysisDetail),
      conclusionsByOperation: json.localFile.conclusionsByOperation.map((c) => ({
        ...c,
        requiredAdjustmentCop: ajusteCop,
        fiscalImpactNote: notaSinMontosDelModelo(c.fiscalImpactNote, ajusteCop, language),
      })),
    },
    formato1125Rows: json.formato1125Rows.map((r) => {
      const remarks = r.remarks === null ? null : sinMontos(r.remarks);
      return {
        ...r,
        q1Percent: s ? s.q1 : null,
        medianPercent: s ? s.median : null,
        q3Percent: s ? s.q3 : null,
        isWithinRange: check.isWithinRange === true,
        adjustmentCop: ajusteCop,
        remarks: check.conclusive ? remarks : [ilustrativa, remarks].filter(Boolean).join(' | '),
      };
    }),
    recommendations: json.recommendations.map((rec) => ({ ...rec, detail: sinMontos(rec.detail) })),
    art647Defense: { ...json.art647Defense, rationale: sinMontos(json.art647Defense.rationale) },
  };
}

function fmtAjuste(cents: string | null, lang: 'es' | 'en'): string {
  return cents === null ? 'N/D' + (lang === 'en' ? ' (no verified PLI base)' : ' (sin base del PLI verificada)') : formatCopFromCents(parseMoneyCop(cents), true);
}

// ---------------------------------------------------------------------------
// Adapter local: TpDocumentationReportJson -> TPDocumentationResult legacy
// ---------------------------------------------------------------------------

function renderExecutiveSummary(
  json: TpDocumentationReportJson,
  check: TpRangeCheck,
  lang: 'es' | 'en',
): string {
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
    `**${lang === 'en' ? 'Compliance conclusion' : 'Conclusión global'}:** ${
      check.conclusive
        ? conclusionLabel[e.overallComplianceConclusion]
        : `${lang === 'en' ? 'NOT CONCLUSIVE (illustrative scenario)' : 'NO CONCLUYENTE (escenario ilustrativo)'} — ${tpMotivoRango(check, lang)}`
    }`,
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

function renderLocalFile(
  json: TpDocumentationReportJson,
  check: TpRangeCheck,
  lang: 'es' | 'en',
): string {
  const lf = json.localFile;
  const conclusions = lf.conclusionsByOperation
    .map((c) => {
      const adj = fmtAjuste(c.requiredAdjustmentCop, lang);
      const cmp = !check.conclusive
        ? (lang === 'en' ? 'NOT CONCLUSIVE' : 'NO CONCLUYENTE')
        : c.complies ? (lang === 'en' ? 'COMPLIES' : 'CUMPLE') : (lang === 'en' ? 'DOES NOT COMPLY' : 'NO CUMPLE');
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
    const adj = fmtAjuste(r.adjustmentCop, lang);
    const inRange = r.isWithinRange ? (lang === 'en' ? 'Yes' : 'Sí') : 'No';
    return `| ${r.operationCode} | ${r.relatedPartyName} | ${r.relatedPartyTaxId} | ${r.countryCode} | ${amt} | ${r.methodCode} | ${fmtPct(r.observedPliPercent)} | ${fmtPct(r.q1Percent)} | ${fmtPct(r.medianPercent)} | ${fmtPct(r.q3Percent)} | ${inRange} | ${adj} |`;
  });
  const remarks = json.formato1125Rows
    .filter((r) => r.remarks)
    .map((r) => `- **${r.operationCode} / ${r.relatedPartyName}:** ${r.remarks}`)
    .join('\n');
  return [header, rows.join('\n'), '', remarks].filter(Boolean).join('\n');
}

function renderSanctions(
  json: TpDocumentationReportJson,
  sanctionYear: number,
  lang: 'es' | 'en',
): string {
  const escenarios = json.potentialSanctions.length > 0
    ? Array.from(new Set(json.potentialSanctions.map((s) => s.scenario)))
    : (Object.keys(ART_260_11_SANCIONES) as Array<keyof typeof ART_260_11_SANCIONES>);
  const header = lang === 'en'
    ? `| Literal | Scenario | Rate | Cap (UVT) | Cap (COP, UVT ${sanctionYear}) |\n|---|---|---|---:|---:|`
    : `| Literal | Escenario | Tarifa | Tope (UVT) | Tope (COP, UVT ${sanctionYear}) |\n|---|---|---|---:|---:|`;
  const rows = escenarios.flatMap((esc) =>
    ART_260_11_SANCIONES[esc].map((s) => {
      const cents = topeCentavos(s.topeUvt, sanctionYear);
      const cop = s.topeUvt === null
        ? '—'
        : cents === null
          ? `N/D (UVT ${sanctionYear} no registrada)`
          : formatCopFromCents(BigInt(cents), true);
      const uvt = s.topeUvt === null ? '—' : s.topeUvt.toLocaleString('es-CO');
      return `| ${s.literal} | ${s.descripcion} | ${s.tarifa} | ${uvt} | ${cop} |`;
    }),
  );
  return [header, rows.join('\n'), '', `_${lang === 'en' ? 'Source' : 'Fuente'}: ${ART_260_11_FUENTE}. ${lang === 'en' ? 'The sanction is settled with the UVT of the year it is imposed.' : 'La sanción se liquida con la UVT del año en que se impone.'}_`].join('\n');
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

export function toTPDocumentationResult(
  json: TpDocumentationReportJson,
  check: TpRangeCheck,
  sanctionYear: number,
  lang: 'es' | 'en',
): TPDocumentationResult {
  const executiveSummary = renderExecutiveSummary(json, check, lang);
  const localReport = renderLocalFile(json, check, lang);
  const masterFileEquivalent = renderMasterFile(json, lang);
  const formato1125Guide = renderFormato1125(json, lang);

  const sanctionsBlock = renderSanctions(json, sanctionYear, lang);
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
