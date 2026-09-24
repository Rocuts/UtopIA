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
import {
  buildTaxAuditorPrompt,
  regimenRentaDeEmpresa,
  type RegimenRentaAuditoria,
} from '../prompts/tax-auditor.prompt';
import {
  TaxAuditReportSchema,
  type TaxAuditReportJson,
  type AuditFindingJson,
} from '../../contracts/audit-report';
import { formatCopFromCents, parseMoneyCop, serializeMoneyCop } from '../../contracts/money';
import type { CompanyInfo } from '../../types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { AuditorResult, AuditFinding, AuditProgressEvent } from '../types';
import { computeRentaPosition } from '../bindings';

/**
 * Format MoneyCop (string en centavos) -> "$X.XXX,XX" estilo COP, CON signo
 * (paréntesis NIIF para negativos). El signo de brecha, posición fiscal e
 * IVA neto tiene significado contractual (auditoria-calidad-02).
 */
function fmtMoneyCop(value: string): string {
  return formatCopFromCents(parseMoneyCop(value), false);
}

/**
 * Motivo por el que la TTD (par. 6 Art. 240 E.T.) no se determina en el
 * Dictamen 2: TTD = ID / UD (impuesto depurado / utilidad depurada) con su
 * ámbito verificado. El impuesto contable / UAI NO es la TTD
 * (prompts-normativa-03; mismo criterio que CCV/Supervivencia).
 */
export const TTD_NO_DETERMINABLE_REASON =
  'TTD no determinable: faltan impuesto depurado (ID), utilidad depurada (UD) y la verificación del ámbito del par. 6 Art. 240 E.T.; el impuesto contable / UAI no es la TTD.';

/**
 * Régimen SIMPLE declarado en el intake (re-auditoría 2026-09-24, NT-02).
 * Art. 903 E.T. (estatuto_tributario_completo.md): el impuesto unificado
 * «sustituye el impuesto sobre la renta», así que la TTD del par. 6 del
 * Art. 240 no aplica y el impuesto teórico a la tarifa del Art. 240 (35% × UAI)
 * no es una referencia de conciliación del contribuyente. Mismo criterio que
 * V10 en el gate (auditoria-calidad-31).
 */
export const TTD_NO_APLICA_SIMPLE_REASON =
  'no aplica: la entidad declaró el Régimen Simple de Tributación, cuyo impuesto unificado sustituye el impuesto sobre la renta (Art. 903 E.T.); la TTD del par. 6 Art. 240 E.T. no le aplica.';

export const RENTA_TEORICA_NO_APLICA_SIMPLE_REASON =
  'N/D — Régimen Simple de Tributación (Art. 903 E.T.): el impuesto unificado sustituye el impuesto sobre la renta; no se calcula el impuesto teórico a la tarifa del Art. 240 E.T.';

export { regimenRentaDeEmpresa, type RegimenRentaAuditoria };

export async function runTaxAuditor(
  reportContent: string,
  company: CompanyInfo,
  language: 'es' | 'en',
  onProgress?: (event: AuditProgressEvent) => void,
  defaultPeriod?: string,
  preprocessed?: PreprocessedBalance,
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

  return toLegacyAuditorResult(json, defaultPeriod, preprocessed, regimenRentaDeEmpresa(company));
}

// ---------------------------------------------------------------------------
// Overrides deterministas post-LLM
// ---------------------------------------------------------------------------

/**
 * Reemplaza la aritmética fiscal del LLM por cifras deterministas:
 *   - TTD (análisis 5): `tasaEfectivaPct=null`, `status='no_determinable'`
 *     mientras no existan ID/UD y ámbito verificados (prompts-normativa-03).
 *   - Renta (análisis 2): impuesto teórico = UAI × tarifa y diferencia de
 *     conciliación recalculados en BigInt (referencia NIC 12, no renta líquida).
 *   - Posición de renta (análisis 3): (1355 renta + 1805 fiscal) − 2404 desde el
 *     preprocesador; sin detalle auxiliar → N/D (auditoria-calidad-22).
 *   - Régimen SIMPLE del intake (NT-02): TTD 'no_aplica' (Art. 903 E.T.) y sin
 *     impuesto teórico a la tarifa del Art. 240 ni diferencia de conciliación.
 */
export function applyTaxDeterministicOverrides(
  json: TaxAuditReportJson,
  preprocessed?: PreprocessedBalance | null,
  regimen: RegimenRentaAuditoria = null,
): TaxAuditReportJson {
  const out: TaxAuditReportJson = { ...json };

  if (regimen === 'simple') {
    if (json.tmtAnalysis) {
      out.tmtAnalysis = {
        ...json.tmtAnalysis,
        tasaMinimaExigidaPct: 15,
        tasaEfectivaPct: null,
        status: 'no_aplica',
        reference: 'Art. 903 E.T. (Régimen Simple de Tributación); Art. 240 par. 6 E.T.',
      };
    }
    if (json.rentaAnalysis) {
      out.rentaAnalysis = { ...json.rentaAnalysis, provisionTeoricaCop: null, brechaCop: null };
    }
  } else if (json.tmtAnalysis) {
    out.tmtAnalysis = {
      ...json.tmtAnalysis,
      tasaMinimaExigidaPct: 15,
      tasaEfectivaPct: null,
      status: 'no_determinable',
      reference: 'Art. 240 par. 6 E.T. (Ley 2277/2022 art. 10)',
    };
  }

  if (json.rentaAnalysis && regimen !== 'simple') {
    const r = json.rentaAnalysis;
    let provisionTeoricaCop: string | null = null;
    let brechaCop: string | null = null;
    if (r.utilidadAntesImpuestosCop !== null && Number.isFinite(r.tarifaGeneralPct)) {
      const uai = parseMoneyCop(r.utilidadAntesImpuestosCop);
      const tarifaBps = BigInt(Math.round(r.tarifaGeneralPct * 100));
      provisionTeoricaCop = serializeMoneyCop((uai * tarifaBps) / BigInt(10_000));
      if (r.impuestoRegistradoCop !== null) {
        brechaCop = serializeMoneyCop(parseMoneyCop(provisionTeoricaCop) - parseMoneyCop(r.impuestoRegistradoCop));
      }
    }
    out.rentaAnalysis = { ...r, provisionTeoricaCop, brechaCop };
  }

  if (json.retencionesAnalysis) {
    const pos = computeRentaPosition(preprocessed?.primary);
    out.retencionesAnalysis = {
      ...json.retencionesAnalysis,
      saldo1355Cop: pos.saldo1355RentaCop,
      saldo1805Cop: pos.saldo1805FiscalCop,
      saldo24Cop: pos.saldo2404Cop,
      posicionFiscalNetaCop: pos.posicionFiscalNetaCop,
      evaluacion: pos.motivo ? `${pos.motivo} ${json.retencionesAnalysis.evaluacion}` : json.retencionesAnalysis.evaluacion,
    };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Adapter local: JSON strict -> AuditorResult legacy
// ---------------------------------------------------------------------------

export function toLegacyTaxAuditorResult(
  rawJson: TaxAuditReportJson,
  defaultPeriod: string | undefined,
  preprocessed?: PreprocessedBalance | null,
  regimen: RegimenRentaAuditoria = null,
): AuditorResult {
  return toLegacyAuditorResult(rawJson, defaultPeriod, preprocessed, regimen);
}

function toLegacyAuditorResult(
  rawJson: TaxAuditReportJson,
  defaultPeriod: string | undefined,
  preprocessed?: PreprocessedBalance | null,
  regimen: RegimenRentaAuditoria = null,
): AuditorResult {
  const json = applyTaxDeterministicOverrides(rawJson, preprocessed, regimen);
  const findings: AuditFinding[] = json.findings.map((f) => mapFinding(f, defaultPeriod));
  return {
    domain: 'tributario',
    auditorName: 'Auditor Tributario',
    complianceScore: json.complianceScore,
    findings,
    summary: json.executiveSummary,
    fullContent: renderMarkdown(json, findings, regimen),
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

function tmtIcon(status: 'cumple' | 'no_cumple' | 'no_aplica' | 'no_determinable'): string {
  switch (status) {
    case 'cumple':
      return '✅';
    case 'no_cumple':
      return '❌';
    case 'no_aplica':
    case 'no_determinable':
      return '—';
  }
}

/** Monto con rótulo de sentido: + saldo a favor / − saldo a pagar. */
function fmtPosicion(value: string | null): string {
  if (value === null) return NO_DATA;
  const v = parseMoneyCop(value);
  if (v === BigInt(0)) return `${fmtMoneyCop(value)} (sin saldo)`;
  return `${fmtMoneyCop(value)} (${v > BigInt(0) ? 'saldo a favor' : 'saldo a pagar'})`;
}

/** Pasivo neto de IVA: + a pagar / − saldo a favor. */
function fmtIvaNeto(value: string | null): string {
  if (value === null) return NO_DATA;
  const v = parseMoneyCop(value);
  if (v === BigInt(0)) return `${fmtMoneyCop(value)} (sin saldo)`;
  return `${fmtMoneyCop(value)} (${v > BigInt(0) ? 'saldo a pagar' : 'saldo a favor'})`;
}

/** Utilidad con rótulo de pérdida cuando es negativa. */
function fmtResultado(value: string | null): string {
  if (value === null) return NO_DATA;
  return parseMoneyCop(value) < BigInt(0) ? `${fmtMoneyCop(value)} (pérdida)` : fmtMoneyCop(value);
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
  regimen: RegimenRentaAuditoria = null,
): string {
  return renderMarkdown(json, findings, regimen);
}

function renderMarkdown(
  json: TaxAuditReportJson,
  findings: AuditFinding[],
  regimen: RegimenRentaAuditoria = null,
): string {
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
  if (regimen === 'simple') {
    // NT-02: con SIMPLE no hay tarifa del Art. 240 ni cascada teórica.
    lines.push('- Regimen de renta: Regimen Simple de Tributacion (Arts. 903-916 E.T.)');
    lines.push(`- Utilidad antes de impuestos: ${fmtResultado(renta.utilidadAntesImpuestosCop)}`);
    lines.push(`- Impuesto teorico a la tarifa del Art. 240 E.T.: ${RENTA_TEORICA_NO_APLICA_SIMPLE_REASON}`);
    lines.push(`- Impuesto corriente registrado: ${fmtMoneyOrNa(renta.impuestoRegistradoCop)}`);
    lines.push('- Diferencia de conciliacion (teorico - registrado): N/D — sin impuesto teorico del Art. 240 E.T.');
  } else {
    lines.push(`- Tarifa general aplicable: ${renta.tarifaGeneralPct}%`);
    lines.push(`- Utilidad antes de impuestos: ${fmtResultado(renta.utilidadAntesImpuestosCop)}`);
    lines.push(
      `- Impuesto teorico a tarifa nominal (${renta.tarifaGeneralPct}% x UAI — referencia de conciliacion NIC 12, no renta liquida): ${fmtMoneyOrNa(renta.provisionTeoricaCop)}`,
    );
    lines.push(`- Impuesto corriente registrado: ${fmtMoneyOrNa(renta.impuestoRegistradoCop)}`);
    lines.push(`- Diferencia de conciliacion (teorico - registrado): ${fmtMoneyOrNa(renta.brechaCop)}`);
  }
  lines.push(`- Evaluacion: ${evaluacionIcon(renta.evaluacion)} ${renta.evaluacion.toUpperCase()}`);
  lines.push(`- Accion: ${renta.accion}`);
  lines.push(`- Referencia: ${renta.reference}`);
  lines.push('');

  // 3. RETENCIONES Y POSICION FISCAL NETA
  const ret = json.retencionesAnalysis!;
  lines.push('## 3. RETENCIONES, ANTICIPOS Y POSICION FISCAL NETA');
  lines.push('');
  lines.push(`- Anticipos y retenciones de renta (Cta.1355 — 135505/135515): ${fmtMoneyOrNa(ret.saldo1355Cop)}`);
  lines.push(
    `- Saldo fiscal en Cta.1805 (solo si su nombre indica impuesto): ${ret.saldo1805Cop === null ? 'no aplica' : fmtMoneyCop(ret.saldo1805Cop)}`,
  );
  lines.push(`- Impuesto de renta por pagar (Cta.2404): ${fmtMoneyOrNa(ret.saldo24Cop)}`);
  lines.push(`- Posicion fiscal neta de renta: ${fmtPosicion(ret.posicionFiscalNetaCop)}`);
  lines.push(`- Evaluacion: ${ret.evaluacion}`);
  lines.push(`- Referencia: ${ret.reference}`);
  lines.push('');

  // 4. IVA / ICA / TERRITORIALES
  const iva = json.ivaIcaAnalysis!;
  lines.push('## 4. IVA / ICA / IMPUESTOS TERRITORIALES');
  lines.push('');
  lines.push(`- Pasivo IVA neto: ${fmtIvaNeto(iva.pasivoIvaNetoCop)}`);
  lines.push(
    `- Regimen IVA: ${iva.regimenIva === null ? NO_DATA : iva.regimenIva.replace(/_/g, ' ')}`,
  );
  lines.push(`- ICA: ${iva.icaComment}`);
  lines.push(`- Referencia: ${iva.reference}`);
  lines.push('');

  // 5. TTD — Tasa de Tributación Depurada (Art. 240 par. 6 E.T.)
  const tmt = json.tmtAnalysis!;
  lines.push('## 5. TASA DE TRIBUTACION DEPURADA (TTD, ART. 240 PAR. 6 E.T.)');
  lines.push('');
  lines.push(`- Tasa minima exigida: ${tmt.tasaMinimaExigidaPct}%`);
  if (tmt.status === 'no_determinable') {
    lines.push(`- Tasa de tributacion depurada (TTD = ID / UD): N/D — ${TTD_NO_DETERMINABLE_REASON}`);
  } else if (tmt.status === 'no_aplica' && regimen === 'simple') {
    lines.push(`- Tasa de tributacion depurada (TTD = ID / UD): ${TTD_NO_APLICA_SIMPLE_REASON}`);
  } else {
    lines.push(`- Tasa de tributacion depurada (TTD = ID / UD): ${fmtPctOrNa(tmt.tasaEfectivaPct)}`);
  }
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
