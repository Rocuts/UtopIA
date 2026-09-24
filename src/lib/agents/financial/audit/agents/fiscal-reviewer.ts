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
  type FiscalReviewFindingJson,
  type FormalObligationJson,
  type FormalObligationStatusJson,
  type DianRiskIndicatorJson,
  type DianRiskLevelJson,
  type FiscalAuditOpinionTypeJson,
  type FiscalRequiredActionJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type {
  AuditorResult,
  AuditFinding,
  AuditIntegrity,
  AuditOpinionType,
  AuditProgressEvent,
} from '../types';
import { aggregateDianRisk, computeDianRiskIndicators } from '../bindings';

/** Contexto determinista que condiciona el dictamen (opcional). */
export interface FiscalReviewerContext {
  preprocessed?: PreprocessedBalance;
  integrity?: AuditIntegrity;
}

/**
 * Motivo del anticipo N/D (auditoria-calidad-20): el Art. 807 E.T. parte del
 * impuesto NETO de renta del año (o el promedio de los dos últimos), aplica
 * 25%/50%/75% según los años declarando y descuenta las retenciones del año.
 * Un balance de prueba no trae esos insumos verificados.
 */
export const ANTICIPO_ND_REASON =
  'N/D — el anticipo del Art. 807 E.T. = max(0, porcentaje (25/50/75% según años declarando) × impuesto neto de renta del año o promedio de los dos últimos − retenciones en la fuente del año). No se dispone de esos insumos verificados; no se estima como 75% del impuesto contable.';

export async function runFiscalReviewer(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
  context: FiscalReviewerContext = {},
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

  return toLegacyAuditorResult(json, company, defaultPeriod, context);
}

// ---------------------------------------------------------------------------
// Overrides deterministas post-LLM (Dictamen 4)
// ---------------------------------------------------------------------------

/**
 * - Indicadores de riesgo DIAN: los 6 del spec v2.1 calculados en código; nivel
 *   global y tipo de opinión fiscal con UNA regla (auditoria-calidad-23).
 * - Anticipo de renta: N/D sin insumos verificados del Art. 807 E.T.
 *   (auditoria-calidad-20).
 */
export function applyFiscalDeterministicOverrides(
  json: FiscalReviewReportJson,
  preprocessed?: PreprocessedBalance | null,
): FiscalReviewReportJson {
  const out: FiscalReviewReportJson = { ...json };
  const hasV21 =
    json.dianRiskIndicators !== null ||
    json.riesgoFiscalizacionGlobal !== null ||
    json.fiscalAuditOpinion !== null;
  if (hasV21) {
    const indicators = computeDianRiskIndicators(preprocessed ?? null);
    const hasCritical = json.findings.some((f) => f.severity === 'critico');
    const { global, opinionType } = aggregateDianRisk(indicators, hasCritical);
    out.dianRiskIndicators = indicators;
    out.riesgoFiscalizacionGlobal = global;
    if (json.fiscalAuditOpinion) {
      out.fiscalAuditOpinion = { ...json.fiscalAuditOpinion, type: opinionType };
    }
  }
  if (json.obligations2026) {
    out.obligations2026 = {
      ...json.obligations2026,
      anticipoRenta2026Cop: null,
      baseAnticipo: ANTICIPO_ND_REASON,
    };
  }
  if (json.criticalSaldos) {
    out.criticalSaldos = { ...json.criticalSaldos, anticipoRentaSiguienteCop: null };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy + opinionType + dictamen
// ---------------------------------------------------------------------------

export function toLegacyFiscalReviewerResult(
  rawJson: FiscalReviewReportJson,
  company: CompanyInfo,
  defaultPeriod: string | undefined,
  context: FiscalReviewerContext = {},
): AuditorResult & { opinionType: AuditOpinionType; dictamen: string } {
  return toLegacyAuditorResult(rawJson, company, defaultPeriod, context);
}

function toLegacyAuditorResult(
  rawJson: FiscalReviewReportJson,
  company: CompanyInfo,
  defaultPeriod: string | undefined,
  context: FiscalReviewerContext = {},
): AuditorResult & { opinionType: AuditOpinionType; dictamen: string } {
  const json = applyFiscalDeterministicOverrides(rawJson, context.preprocessed);
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));

  // Why: salvaguarda determinista — el LLM puede emitir findings criticos y
  // concluir con opinion favorable (blanqueo), y la integridad aritmetica
  // determinista puede estar rota sin que el LLM lo note. Forzamos coherencia
  // NIA 705.
  const opinionType = enforceOpinionCoherence(json.opinionType, findings, context.integrity);

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
 * Override post-parse: la opinion del Revisor Fiscal debe ser COHERENTE con
 * sus hallazgos, con la integridad aritmetica determinista y con la NIA 705
 * (auditoria-calidad-03 / -12):
 *  - Limitacion al alcance con efectos generalizados → ABSTENCION (§9-10).
 *  - Incorreccion material Y generalizada (pervasive) → DESFAVORABLE (§8).
 *  - Hallazgo critico/alto, limitacion al alcance no generalizada o
 *    integridad determinista rota → CON SALVEDADES como minimo (§7); un
 *    hallazgo critico aislado NO basta para una opinion adversa.
 *  - Sin sustento (ningun hallazgo generalizado / de alcance), una opinion
 *    adversa o una abstencion no son conformes: se reducen a CON SALVEDADES.
 *  - Resto → respeta la opinion del LLM.
 */
export function enforceOpinionCoherence(
  raw: AuditOpinionType,
  findings: AuditFinding[],
  integrity?: AuditIntegrity,
): AuditOpinionType {
  const material = findings.filter((f) => f.severity === 'critico' || f.severity === 'alto');
  const pervasiveScope = material.some((f) => f.pervasive === true && f.scopeLimitation === true);
  const pervasiveMisstatement = material.some((f) => f.pervasive === true && f.scopeLimitation !== true);
  const anyScope = findings.some((f) => f.scopeLimitation === true);
  const integrityBroken = integrity?.status === 'con_bloqueantes';

  if (pervasiveScope) return 'abstension';
  if (pervasiveMisstatement) return 'desfavorable';
  if (raw === 'desfavorable' || raw === 'abstension') return 'con_salvedades';
  if (material.length > 0 || anyScope || integrityBroken) return 'con_salvedades';
  return raw;
}

function mapFinding(
  f: FiscalReviewFindingJson,
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
    pervasive: f.pervasive ?? null,
    scopeLimitation: f.scopeLimitation ?? null,
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
  no_determinable: '[— N/D]',
};

const FISCAL_OPINION_LABEL: Record<FiscalAuditOpinionTypeJson, string> = {
  riesgo_bajo: 'RIESGO BAJO DE FISCALIZACION DIAN',
  riesgo_medio: 'RIESGO MEDIO DE FISCALIZACION DIAN',
  riesgo_alto: 'RIESGO ALTO DE FISCALIZACION DIAN',
  riesgo_no_determinable: 'RIESGO DE FISCALIZACION DIAN NO DETERMINABLE (sin indicadores calculables)',
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
      if (json.formalObligations.length !== 10) {
        lines.push(
          `> ⚠ Tabla incompleta: ${json.formalObligations.length} de 10 obligaciones formales exigidas por el spec v2.1.`,
        );
        lines.push('');
      }
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
      lines.push(`  IVA por pagar neto                  : ${fmtIvaNetoOrND(s.ivaPorPagarNetoCop)}`);
      lines.push(`  Anticipo renta siguiente periodo    : ${fmtMoneyOrND(s.anticipoRentaSiguienteCop)}`);
      lines.push(`  Sancion por extemporaneidad (Art. 641 E.T.): ${fmtMoneyOrND(s.sancionPotencialMoraCop)}`);
      lines.push('  Intereses moratorios (Arts. 634-635 E.T.): se liquidan sobre el impuesto pagado en mora; no se estiman sin fechas de pago.');
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
  lines.push(`- **Materialidad:** ${fmtMoneyOrND(json.materiality.materialityAmountCop)}`);
  lines.push(`- **Materialidad de ejecucion:** ${fmtMoneyOrND(json.materiality.performanceMateriality)}`);
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

/** Cifra con signo (paréntesis NIIF para negativos) — auditoria-calidad-02. */
function fmtMoneyOrND(value: string | null): string {
  if (value === null) return 'N/D';
  try {
    return formatCopFromCents(parseMoneyCop(value), false);
  } catch {
    return 'N/D';
  }
}

/** IVA neto: positivo = saldo a pagar; negativo = saldo a favor. */
function fmtIvaNetoOrND(value: string | null): string {
  if (value === null) return 'N/D';
  try {
    const v = parseMoneyCop(value);
    const f = formatCopFromCents(v, false);
    if (v === BigInt(0)) return f;
    return `${f} (${v > BigInt(0) ? 'saldo a pagar' : 'saldo a favor'})`;
  } catch {
    return 'N/D';
  }
}
