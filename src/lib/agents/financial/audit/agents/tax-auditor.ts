// ---------------------------------------------------------------------------
// Auditor Tributario — outcome-first GPT-5.4 (Fase 2.B)
// ---------------------------------------------------------------------------
// Llama a `callFinancialAgent` con `TaxAuditReportSchema` y adapta el JSON
// validado al struct legacy `AuditorResult`. Mantiene el `impactCop` en el
// Markdown legacy concatenando "Exposicion COP: $X.XXX" al campo impact si
// el modelo lo cuantifico — los renderers downstream (PDF Elite/Excel) ya
// saben leer ese formato.
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../../agents/runtime';
import { buildTaxAuditorPrompt } from '../prompts/tax-auditor.prompt';
import {
  TaxAuditReportSchema,
  type TaxAuditReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';

/** Format MoneyCop (string en centavos) -> "$X.XXX,XX" estilo COP. */
function fmtMoneyCop(value: string): string {
  return formatCopFromCents(parseMoneyCop(value), /* absolute */ true);
}

export async function runTaxAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
): Promise<AuditorResult> {
  onProgress?.({
    type: 'auditor_progress',
    domain: 'tributario',
    detail: 'Validando cumplimiento tributario contra E.T. 2026...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'tax-auditor',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: TaxAuditReportSchema,
    system: buildTaxAuditorPrompt(company, language),
    userContent: `REPORTE FINANCIERO A AUDITAR:\n\n${reportContent}`,
    ...MODELS_CONFIG.taxAuditor,
  });

  return toLegacyAuditorResult(json, defaultPeriod);
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

function toLegacyAuditorResult(
  json: TaxAuditReportJson,
  defaultPeriod: string | undefined,
): AuditorResult {
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'tributario',
    auditorName: 'Auditor Tributario',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings),
    failed: false,
  };
}

function mapFinding(
  f: AuditFindingJson,
  defaultPeriod: string | undefined,
): AuditFinding {
  // El AuditFinding legacy no tiene impactCop. Concatenamos la exposicion al
  // campo `impact` cuando el LLM la cuantifique — el renderer PDF Elite ya
  // sabe extraerla del impact text.
  const baseImpact = f.impact;
  const cop = f.impactCop;
  const exposureLine =
    cop !== null
      ? ` (Exposicion estimada: ${fmtMoneyCop(cop)})`
      : '';

  return {
    code: f.code,
    severity: f.severity,
    domain: 'tributario',
    title: f.title,
    description: f.description,
    normReference: f.normReference,
    recommendation: f.recommendation,
    impact: `${baseImpact}${exposureLine}`,
    period: f.period ?? defaultPeriod,
  };
}

// ---------------------------------------------------------------------------
// Renderer v2.1 — Dictamen Tributario formato ASCII boxed
// ---------------------------------------------------------------------------
// Cuando el agente emite los analisis 2-9 (rentaAnalysis, retencionesAnalysis,
// ivaIcaAnalysis, tmtAnalysis, riesgosTributarios, calendario2026, auditOpinion,
// requiredActions) se renderiza el dictamen formal con marco ASCII y secciones
// numeradas. Cuando alguno es null, el bloque cae al render legacy.
// ---------------------------------------------------------------------------

const ASCII_FRAME =
  '═══════════════════════════════════════════════════════════════════';

const NO_DATA = '— Dato no suministrado';

function fmtMoneyOrNa(value: string | null): string {
  return value === null ? NO_DATA : fmtMoneyCop(value);
}

function fmtPctOrNa(value: number | null, suffix = '%'): string {
  return value === null ? NO_DATA : `${value}${suffix}`;
}

function evaluacionIcon(e: 'coherente' | 'observacion' | 'incoherente'): string {
  switch (e) {
    case 'coherente':
      return '✅';
    case 'observacion':
      return '⚠';
    case 'incoherente':
      return '❌';
  }
}

function tmtIcon(status: 'cumple' | 'no_cumple' | 'no_aplica'): string {
  switch (status) {
    case 'cumple':
      return '✅';
    case 'no_cumple':
      return '❌';
    case 'no_aplica':
      return '—';
  }
}

function riesgoIcon(p: 'alta' | 'media' | 'baja'): string {
  switch (p) {
    case 'alta':
      return '❌';
    case 'media':
      return '⚠';
    case 'baja':
      return '✅';
  }
}

function taxOpinionLabel(
  type: 'sin_hallazgos' | 'con_observaciones' | 'con_hallazgos_criticos',
): string {
  switch (type) {
    case 'sin_hallazgos':
      return 'DICTAMEN SIN HALLAZGOS';
    case 'con_observaciones':
      return 'DICTAMEN CON OBSERVACIONES';
    case 'con_hallazgos_criticos':
      return 'DICTAMEN CON HALLAZGOS CRITICOS';
  }
}

function priorityLabel(p: 'alta' | 'media' | 'baja'): string {
  return p.toUpperCase();
}

export function renderTaxDictamenMarkdown(
  json: TaxAuditReportJson,
  findings: AuditFinding[],
): string {
  return renderMarkdown(json, findings);
}

function renderMarkdown(json: TaxAuditReportJson, findings: AuditFinding[]): string {
  const hasV21 =
    json.rentaAnalysis !== null &&
    json.retencionesAnalysis !== null &&
    json.ivaIcaAnalysis !== null &&
    json.tmtAnalysis !== null &&
    json.riesgosTributarios !== null &&
    json.calendario2026 !== null &&
    json.auditOpinion !== null &&
    json.requiredActions !== null;

  if (!hasV21) {
    return renderLegacyMarkdown(json, findings);
  }

  const lines: string[] = [];
  lines.push(ASCII_FRAME);
  lines.push('DICTAMEN 2 — AUDITOR TRIBUTARIO');
  lines.push(ASCII_FRAME);
  lines.push('');
  lines.push(`Score de cumplimiento tributario: ${json.complianceScore}/100`);
  lines.push('');

  // 1. ALCANCE
  lines.push('## 1. ALCANCE');
  lines.push('');
  lines.push(json.executiveSummary);
  if (json.totalFiscalExposureCop !== null) {
    lines.push('');
    lines.push(
      `**Exposicion fiscal total estimada:** ${fmtMoneyCop(json.totalFiscalExposureCop)}`,
    );
  }
  lines.push('');

  // 2. IMPUESTO DE RENTA (CASCADA TEORICA)
  const renta = json.rentaAnalysis!;
  lines.push('## 2. IMPUESTO DE RENTA — CASCADA TEORICA');
  lines.push('');
  lines.push(`- Tarifa general aplicable: ${renta.tarifaGeneralPct}%`);
  lines.push(`- Utilidad antes de impuestos: ${fmtMoneyOrNa(renta.utilidadAntesImpuestosCop)}`);
  lines.push(`- Provision teorica (${renta.tarifaGeneralPct}%): ${fmtMoneyOrNa(renta.provisionTeoricaCop)}`);
  lines.push(`- Impuesto registrado: ${fmtMoneyOrNa(renta.impuestoRegistradoCop)}`);
  lines.push(`- Brecha (teorico - registrado): ${fmtMoneyOrNa(renta.brechaCop)}`);
  lines.push(`- Evaluacion: ${evaluacionIcon(renta.evaluacion)} ${renta.evaluacion.toUpperCase()}`);
  lines.push(`- Accion: ${renta.accion}`);
  lines.push(`- Referencia: ${renta.reference}`);
  lines.push('');

  // 3. RETENCIONES Y POSICION FISCAL NETA
  const ret = json.retencionesAnalysis!;
  lines.push('## 3. RETENCIONES, ANTICIPOS Y POSICION FISCAL NETA');
  lines.push('');
  lines.push(`- Saldo Cta.1355 (anticipos): ${fmtMoneyOrNa(ret.saldo1355Cop)}`);
  lines.push(`- Saldo Cta.1805 (impuesto diferido activo): ${fmtMoneyOrNa(ret.saldo1805Cop)}`);
  lines.push(`- Saldo Cta.24 (impuestos por pagar): ${fmtMoneyOrNa(ret.saldo24Cop)}`);
  lines.push(`- Posicion fiscal neta: ${fmtMoneyOrNa(ret.posicionFiscalNetaCop)}`);
  lines.push(`- Evaluacion: ${ret.evaluacion}`);
  lines.push(`- Referencia: ${ret.reference}`);
  lines.push('');

  // 4. IVA / ICA / TERRITORIALES
  const iva = json.ivaIcaAnalysis!;
  lines.push('## 4. IVA / ICA / IMPUESTOS TERRITORIALES');
  lines.push('');
  lines.push(`- Pasivo IVA neto: ${fmtMoneyOrNa(iva.pasivoIvaNetoCop)}`);
  lines.push(
    `- Regimen IVA: ${iva.regimenIva === null ? NO_DATA : iva.regimenIva.replace(/_/g, ' ')}`,
  );
  lines.push(`- ICA: ${iva.icaComment}`);
  lines.push(`- Referencia: ${iva.reference}`);
  lines.push('');

  // 5. TMT
  const tmt = json.tmtAnalysis!;
  lines.push('## 5. TASA MINIMA DE TRIBUTACION (TMT)');
  lines.push('');
  lines.push(`- Tasa minima exigida: ${tmt.tasaMinimaExigidaPct}%`);
  lines.push(`- Tasa efectiva calculada: ${fmtPctOrNa(tmt.tasaEfectivaPct)}`);
  lines.push(`- Estado: ${tmtIcon(tmt.status)} ${tmt.status.replace(/_/g, ' ').toUpperCase()}`);
  lines.push(`- Referencia: ${tmt.reference}`);
  lines.push('');

  // 6. RIESGOS TRIBUTARIOS
  const riesgos = json.riesgosTributarios!;
  lines.push('## 6. RIESGOS TRIBUTARIOS PRIORIZADOS');
  lines.push('');
  if (riesgos.length === 0) {
    lines.push('Sin riesgos materiales identificados.');
  } else {
    for (const r of riesgos) {
      lines.push(`- ${riesgoIcon(r.probabilidad)} **[${r.probabilidad.toUpperCase()}]** ${r.descripcion}`);
      lines.push(`  - Exposicion estimada: ${fmtMoneyOrNa(r.exposicionCop)}`);
      lines.push(`  - Referencia: ${r.reference}`);
    }
  }
  lines.push('');

  // 7. CALENDARIO 2026
  const cal = json.calendario2026!;
  lines.push('## 7. CALENDARIO TRIBUTARIO 2026');
  lines.push('');
  if (cal.length === 0) {
    lines.push('Sin obligaciones materiales pendientes identificadas.');
  } else {
    for (const c of cal) {
      lines.push(`- □ **${c.obligacion}** — Fecha limite: ${c.fechaLimite}`);
      if (c.notes) lines.push(`  - Notas: ${c.notes}`);
      lines.push(`  - Referencia: ${c.reference}`);
    }
  }
  lines.push('');

  // 8. OPINION TRIBUTARIA FORMAL
  const op = json.auditOpinion!;
  lines.push('## 8. OPINION TRIBUTARIA FORMAL');
  lines.push('');
  lines.push(`**${taxOpinionLabel(op.type)}**`);
  lines.push('');
  lines.push(op.text);
  if (op.exposicionTotalCop !== null) {
    lines.push('');
    lines.push(`Exposicion fiscal total estimada: ${fmtMoneyCop(op.exposicionTotalCop)}`);
  }
  lines.push('');

  // 9. ACCIONES REQUERIDAS
  const actions = json.requiredActions!;
  lines.push('## 9. ACCIONES REQUERIDAS');
  lines.push('');
  if (actions.length === 0) {
    lines.push('□ Ninguna accion adicional requerida.');
  } else {
    for (const a of actions) {
      lines.push(`- □ **[${priorityLabel(a.priority)}]** ${a.action}`);
      lines.push(`  - Referencia: ${a.reference}`);
    }
  }
  lines.push('');

  // HALLAZGOS DETALLADOS (despues de las secciones formales)
  if (findings.length > 0) {
    lines.push('## HALLAZGOS DETALLADOS');
    lines.push('');
    for (const f of findings) {
      lines.push(`### ${f.code}: ${f.title}`);
      lines.push(`- **Severidad:** ${f.severity.toUpperCase()}`);
      lines.push(`- **Norma:** ${f.normReference}`);
      lines.push(`- **Descripcion:** ${f.description}`);
      lines.push(`- **Recomendacion:** ${f.recommendation}`);
      lines.push(`- **Impacto:** ${f.impact}`);
      if (f.period) lines.push(`- **Periodo:** ${f.period}`);
      lines.push('');
    }
  }

  lines.push('## CONCLUSION');
  lines.push('');
  lines.push(json.conclusion);
  lines.push('');
  lines.push(ASCII_FRAME);
  lines.push('FIN DEL DICTAMEN 2');
  lines.push(ASCII_FRAME);

  return lines.join('\n');
}

function renderLegacyMarkdown(json: TaxAuditReportJson, findings: AuditFinding[]): string {
  const lines: string[] = [];
  lines.push(`## SCORE\n${json.complianceScore}`);
  lines.push('');
  lines.push(`## RESUMEN EJECUTIVO\n${json.executiveSummary}`);
  if (json.totalFiscalExposureCop !== null) {
    lines.push('');
    lines.push(
      `**Exposicion fiscal total estimada:** ${fmtMoneyCop(json.totalFiscalExposureCop)}`,
    );
  }
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
  lines.push(`## CONCLUSION\n${json.conclusion}`);
  return lines.join('\n');
}
