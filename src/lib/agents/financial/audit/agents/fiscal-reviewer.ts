// ---------------------------------------------------------------------------
// Auditor de Revisoria Fiscal — outcome-first GPT-5.4 (Fase 2.B) + Wave 7.B2
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `FiscalReviewReportSchema` y adapta al
// struct legacy. Mantiene el override `enforceOpinionCoherence` (no-blanqueo)
// que ya existia en la version anterior — es una salvaguarda determinista que
// debe sobrevivir al refactor.
//
// Wave 7.B2: renderMarkdown emite PRIMERO el formato visual ASCII-boxed del
// Spec v2.1 "Dictamen 4 — Auditor Fiscal" (cuando los nuevos campos estan
// poblados) y al final preserva el dictamen NIA-700 con bloque de firma
// literal (legacy intacto). Los dos roles del Revisor Fiscal/Auditor Fiscal
// coexisten en la misma salida.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildFiscalReviewerPrompt } from '../prompts/fiscal-reviewer.prompt';
import {
  FiscalReviewReportSchema,
  type FiscalReviewReportJson,
  type AuditFindingJson,
  type FormalObligationJson,
  type FormalObligationStatusJson,
  type DianRiskIndicatorJson,
  type DianRiskLevelJson,
  type FiscalAuditOpinionTypeJson,
  type FiscalRequiredActionJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type {
  AuditorResult,
  AuditFinding,
  AuditOpinionType,
  AuditProgressEvent,
} from '../types';

export async function runFiscalReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult & { opinionType: AuditOpinionType; dictamen: string }> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'revisoria',
    detail: 'Evaluando razonabilidad y materialidad (NIA/ISA)...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'fiscal-reviewer',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: FiscalReviewReportSchema,
    system: buildFiscalReviewerPrompt(company, language),
    userContent: `REPORTE FINANCIERO COMPLETO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.fiscalReviewer,
  });

  return toLegacyAuditorResult(json, company, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy + opinionType + dictamen
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: FiscalReviewReportJson,
  company: CompanyInfo,
  defaultPeriod: string | undefined,
): AuditorResult & { opinionType: AuditOpinionType; dictamen: string } {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));

  // Why: salvaguarda determinista — el LLM puede emitir findings criticos y
  // concluir con opinion favorable (blanqueo). Forzamos coherencia minima.
  const opinionType = enforceOpinionCoherence(json.opinionType, findings);

  return {
    domain: 'revisoria',
    auditorName: 'Auditor de Revisoria Fiscal',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings, opinionType, company),
    failed: false,
    opinionType,
    dictamen: json.dictamen,
  };
}

/**
 * Override post-parse: garantiza que la opinion del Revisor Fiscal sea
 * COHERENTE con los hallazgos que el mismo emitio. Reglas (NIA 705 §7-§10):
 *  - 1+ findings "critico" → DESFAVORABLE como minimo.
 *  - 1+ findings "alto" → CON SALVEDADES como minimo.
 *  - Resto → respeta la opinion del LLM.
 */
function enforceOpinionCoherence(
  raw: AuditOpinionType,
  findings: AuditFinding[],
): AuditOpinionType {
  const hasCritico = findings.some((f) => f.severity === 'critico');
  const hasAlto = findings.some((f) => f.severity === 'alto');

  if (hasCritico) {
    if (raw === 'favorable' || raw === 'con_salvedades') return 'desfavorable';
    return raw;
  }
  if (hasAlto) {
    if (raw === 'favorable') return 'con_salvedades';
    return raw;
  }
  return raw;
}

function mapFinding(
  f: AuditFindingJson,
  defaultPeriod: string | undefined,
): AuditFinding {
  return {
    code: f.code,
    severity: f.severity,
    domain: 'revisoria',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: f.impact,
    period: f.period ?? defaultPeriod,
  };
}

// ---------------------------------------------------------------------------
// renderMarkdown — Spec v2.1 Dictamen 4 (ASCII boxed) + NIA-700 legacy
// ---------------------------------------------------------------------------

const ASCII_FRAME = '═══════════════════════════════════════════════════════════════════';

const FORMAL_STATUS_BADGE: Record<FormalObligationStatusJson, string> = {
  al_dia: '[✅ AL DIA]',
  verificar: '[⚠ VERIFICAR]',
  posible_mora: '[❌ POSIBLE MORA]',
  no_aplica: '[— N/A]',
};

const RISK_BADGE: Record<DianRiskLevelJson, string> = {
  bajo: '[✅ BAJO]',
  medio: '[⚠ MEDIO]',
  alto: '[❌ ALTO]',
};

const FISCAL_OPINION_LABEL: Record<FiscalAuditOpinionTypeJson, string> = {
  riesgo_bajo: 'RIESGO BAJO DE FISCALIZACION DIAN',
  riesgo_medio: 'RIESGO MEDIO DE FISCALIZACION DIAN',
  riesgo_alto: 'RIESGO ALTO DE FISCALIZACION DIAN',
};

/**
 * Renderiza el dictamen del Auditor Fiscal/Revisor Fiscal a Markdown.
 * Exportado para testeo de snapshot. Cuando los campos v2.1 son null,
 * produce el render legacy compatible con el orchestrator existente.
 */
export function renderFiscalReviewerMarkdown(
  json: FiscalReviewReportJson,
  findings: AuditFinding[],
  opinionType: AuditOpinionType,
  company: CompanyInfo,
): string {
  return renderMarkdown(json, findings, opinionType, company);
}

function renderMarkdown(
  json: FiscalReviewReportJson,
  findings: AuditFinding[],
  opinionType: AuditOpinionType,
  company: CompanyInfo,
): string {
  const hasV21Structure =
    json.formalObligations !== null ||
    json.criticalSaldos !== null ||
    json.dianRiskIndicators !== null ||
    json.riesgoFiscalizacionGlobal !== null ||
    json.obligations2026 !== null ||
    json.fiscalAuditOpinion !== null ||
    json.fiscalRequiredActions !== null;

  const lines: string[] = [];

  if (hasV21Structure) {
    lines.push(ASCII_FRAME);
    lines.push('  DICTAMEN 4 — AUDITOR FISCAL (DIAN)');
    lines.push(`  ${company.name}  ·  NIT ${company.nit}  ·  Periodo ${company.fiscalPeriod}`);
    lines.push(ASCII_FRAME);
    lines.push('');
    lines.push(`**Score de cumplimiento fiscal:** ${json.complianceScore}/100`);
    lines.push('');
    lines.push('## 1. RESUMEN EJECUTIVO');
    lines.push('');
    lines.push(json.executiveSummary);
    lines.push('');

    if (json.formalObligations && json.formalObligations.length > 0) {
      lines.push('## 2. OBLIGACIONES FORMALES DIAN');
      lines.push('');
      for (let i = 0; i < json.formalObligations.length; i++) {
        const o: FormalObligationJson = json.formalObligations[i];
        const idx = String(i + 1).padStart(2, '0');
        const badge = FORMAL_STATUS_BADGE[o.status];
        lines.push(`- ${idx}. ${badge} **${o.obligation}** (${o.periodicidad}) — ${o.reference}`);
        if (o.vencimientoProximo) {
          lines.push(`     Proximo vencimiento: ${o.vencimientoProximo}`);
        }
      }
      lines.push('');
    }

    if (json.criticalSaldos) {
      const s = json.criticalSaldos;
      lines.push('## 3. SALDOS CRITICOS');
      lines.push('');
      lines.push(ASCII_FRAME);
      lines.push(`  Retenciones a terceros (Cta. 2365)  : ${fmtMoneyOrND(s.retenciones2365Cop)}`);
      lines.push(`  Retenciones a favor (Cta. 1355)     : ${fmtMoneyOrND(s.retenciones1355Cop)}`);
      lines.push(`  IVA por pagar neto                  : ${fmtMoneyOrND(s.ivaPorPagarNetoCop)}`);
      lines.push(`  Anticipo renta siguiente periodo    : ${fmtMoneyOrND(s.anticipoRentaSiguienteCop)}`);
      lines.push(`  Sancion potencial por mora          : ${fmtMoneyOrND(s.sancionPotencialMoraCop)}`);
      lines.push(ASCII_FRAME);
      lines.push('');
    }

    if (json.dianRiskIndicators && json.dianRiskIndicators.length > 0) {
      lines.push('## 4. INDICADORES DE RIESGO DIAN');
      lines.push('');
      for (let i = 0; i < json.dianRiskIndicators.length; i++) {
        const r: DianRiskIndicatorJson = json.dianRiskIndicators[i];
        const idx = String(i + 1).padStart(2, '0');
        const badge = RISK_BADGE[r.level];
        lines.push(`- ${idx}. ${badge} **${r.indicator}**`);
        if (r.observation) {
          lines.push(`     ${r.observation}`);
        }
      }
      lines.push('');
    }

    if (json.riesgoFiscalizacionGlobal !== null) {
      lines.push('## 5. RIESGO GLOBAL DE FISCALIZACION');
      lines.push('');
      lines.push(ASCII_FRAME);
      lines.push(`  Nivel agregado: ${RISK_BADGE[json.riesgoFiscalizacionGlobal]}`);
      lines.push(ASCII_FRAME);
      lines.push('');
    }

    if (json.obligations2026) {
      const o = json.obligations2026;
      lines.push('## 6. OBLIGACIONES DEL SIGUIENTE PERIODO');
      lines.push('');
      lines.push(`- **Anticipo de renta (Art. 807 E.T.):** ${fmtMoneyOrND(o.anticipoRenta2026Cop)}`);
      lines.push(`    Base: ${o.baseAnticipo}`);
      lines.push(`- **ICA estimado:** ${fmtMoneyOrND(o.icaEstimado2026Cop)}`);
      if (o.baseIca) {
        lines.push(`    Base: ${o.baseIca}`);
      }
      lines.push('');
    }

    if (json.fiscalAuditOpinion) {
      lines.push('## 7. OPINION DEL AUDITOR FISCAL');
      lines.push('');
      lines.push(ASCII_FRAME);
      lines.push(`  ${FISCAL_OPINION_LABEL[json.fiscalAuditOpinion.type]}`);
      lines.push(ASCII_FRAME);
      lines.push('');
      lines.push(json.fiscalAuditOpinion.text);
      lines.push('');
    }

    if (json.fiscalRequiredActions && json.fiscalRequiredActions.length > 0) {
      lines.push('## 8. ACCIONES REQUERIDAS DIAN');
      lines.push('');
      for (const a of json.fiscalRequiredActions) {
        const a2: FiscalRequiredActionJson = a;
        lines.push(`- ${a2.action}`);
        lines.push(`    Norma: ${a2.reference}`);
        if (a2.fechaLimite) lines.push(`    Fecha limite: ${a2.fechaLimite}`);
        lines.push(`    Consecuencia: ${a2.consecuenciaIncumplimiento}`);
      }
      lines.push('');
    }

    lines.push(ASCII_FRAME);
    lines.push('');
  }

  // ----- Bloque NIA-700/706 (Revisor Fiscal) — siempre presente -------------
  // Este bloque es el dictamen formal Ley 43/1990 + NIA 700-706. Coexiste con
  // el v2.1 Dictamen 4 — son dos roles del mismo cuarto seat de la auditoria.
  lines.push(ASCII_FRAME);
  lines.push('  DICTAMEN DEL REVISOR FISCAL (NIA 700-706 / Ley 43/1990)');
  lines.push(ASCII_FRAME);
  lines.push('');
  lines.push(`## SCORE\n${json.complianceScore}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  lines.push('');
  lines.push('## MATERIALIDAD');
  lines.push(`- **Benchmark:** ${json.materiality.benchmarkLabel}`);
  lines.push(`- **Materialidad:** ${formatCopFromCents(parseMoneyCop(json.materiality.materialityAmountCop), true)}`);
  lines.push(`- **Materialidad de ejecucion:** ${formatCopFromCents(parseMoneyCop(json.materiality.performanceMateriality), true)}`);
  lines.push(`- **Comentario:** ${json.materiality.comment}`);
  lines.push('');
  lines.push('## EMPRESA EN FUNCIONAMIENTO');
  lines.push(
    `- **Incertidumbre material:** ${json.goingConcern.hasMaterialUncertainty ? 'SI' : 'NO'}`,
  );
  if (json.goingConcern.indicatorsFound.length > 0) {
    lines.push('- **Indicadores observados:**');
    for (const ind of json.goingConcern.indicatorsFound) lines.push(`  - ${ind}`);
  }
  lines.push(`- **Conclusion:** ${json.goingConcern.conclusion}`);
  lines.push('');
  lines.push('## HALLAZGOS');
  for (const f of findings) {
    lines.push('');
    lines.push(`### ${f.code}: ${f.title}`);
    lines.push(`- **Severidad:** ${f.severity.toUpperCase()}`);
    lines.push(`- **Norma:** ${f.normReference}`);
    lines.push(`- **Descripcion:** ${f.description}`);
    lines.push(`- **Recomendacion:** ${f.recommendation}`);
    lines.push(`- **Impacto:** ${f.impact}`);
    if (f.period) lines.push(`- **Periodo:** ${f.period}`);
  }
  lines.push('');
  lines.push(`## TIPO DE OPINION\n${opinionType}`);
  lines.push('');
  lines.push(`## DICTAMEN\n${json.dictamen}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers de render
// ---------------------------------------------------------------------------

function fmtMoneyOrND(value: string | null): string {
  if (value === null) return 'N/D';
  try {
    return formatCopFromCents(parseMoneyCop(value), true);
  } catch {
    return 'N/D';
  }
}
