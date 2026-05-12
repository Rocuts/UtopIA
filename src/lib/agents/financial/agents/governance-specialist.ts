// ---------------------------------------------------------------------------
// Agente 3: Especialista en Gobierno Corporativo (outcome-first GPT-5.4)
// ---------------------------------------------------------------------------
// Refactor Fase 2.A (2026-05): contrato `GovernanceReportSchema` + adapter
// LOCAL `toGovernanceResult` que sintetiza el struct legacy Markdown
// consumido por PDF Élite y validators v1.
//
// La validación anti-evasivo del struct legacy se conserva aplicada al
// fullContent post-render — si el JSON contiene una frase prohibida en
// algún `body` libre, el detector la captura. (En Fase 3 el detector se
// migra a operar directo sobre los strings del JSON estructurado.)
// ---------------------------------------------------------------------------

import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from './runtime';
import {
  GovernanceReportSchema,
  type GovernanceReportJson,
  type FinancialNoteSchema,
  type ShareholderMinutesSchema,
} from '../contracts/governance-report';
import { formatCopFromCents, parseMoneyCop } from '../contracts/money';
import {
  buildGovernancePrompt,
  type GovernanceEliteContext,
} from '../prompts/governance-specialist.prompt';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { z } from 'zod';
import type {
  CompanyInfo,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  GovernanceResult,
  FinancialProgressEvent,
} from '../types';

type FinancialNote = z.infer<typeof FinancialNoteSchema>;
type ShareholderMinutes = z.infer<typeof ShareholderMinutesSchema>;

/**
 * Takes outputs from Agents 1 and 2 and produces Notes to FS + Shareholder
 * Assembly Minutes, validated against `GovernanceReportSchema`.
 *
 * @param niifOutput      Output del Agente 1 (legacy struct).
 * @param strategyOutput  Output del Agente 2 (legacy struct).
 * @param company         Metadata de la empresa.
 * @param language        es | en
 * @param instructions    Instrucciones adicionales del usuario.
 * @param bindingTotals   Totales vinculantes pre-calculados.
 * @param preprocessed    PreprocessedBalance completo.
 * @param onProgress      Callback SSE.
 * @param elite           Contexto Élite (comparativos impracticables, actividad).
 * @param signal          AbortSignal opcional.
 */
export async function runGovernanceSpecialist(
  niifOutput: NiifAnalysisResult,
  strategyOutput: StrategicAnalysisResult,
  company: CompanyInfo,
  language: 'es' | 'en',
  instructions: string | undefined,
  bindingTotals: string,
  preprocessed: PreprocessedBalance | undefined,
  onProgress?: (event: FinancialProgressEvent) => void,
  elite?: GovernanceEliteContext,
  signal?: AbortSignal,
): Promise<GovernanceResult> {
  const systemPrompt = buildGovernancePrompt(company, language, preprocessed, elite);

  const userContent = [
    bindingTotals,
    '',
    '=== ESTADOS FINANCIEROS NIIF (Agente 1) ===',
    '',
    niifOutput.fullContent,
    '',
    '=== ANÁLISIS ESTRATÉGICO (Agente 2) ===',
    '',
    strategyOutput.fullContent,
    '',
    instructions ? `INSTRUCCIONES ADICIONALES DEL USUARIO:\n${instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  onProgress?.({
    type: 'stage_progress',
    stage: 3,
    detail: 'Redactando notas contables y acta de asamblea...',
  });

  const { json } = await callFinancialAgent({
    agentName: 'governance-specialist',
    // PREMIUM (gpt-5.5): produce notas a EEFF (14 secciones) + acta — schema
    // muy rico, amerita el techo de 128K output del modelo premium.
    model: MODELS.FINANCIAL_PIPELINE_PREMIUM,
    schema: GovernanceReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.governanceSpecialist,
    signal,
  });

  const result = toGovernanceResult(json);

  // Validador anti-evasivo (post-generación) — Wave 2.F3 refactor.
  // Ahora opera sobre el JSON estructurado y exonera `disclaimers[]` por
  // contrato (textos literales del spec Parte 9). Esto elimina los falsos
  // positivos donde un disclaimer válido se confundía con frase evasiva.
  const evasiveHits = detectForbiddenPhrasesInJson(json);
  if (evasiveHits.length > 0) {
    console.warn(
      '[governance-specialist] Frases evasivas detectadas en campos de body libre:',
      evasiveHits.slice(0, 3).map((h) => h.pattern).join(' | '),
    );
    onProgress?.({
      type: 'stage_progress',
      stage: 3,
      detail: `Atención: detectadas ${evasiveHits.length} frase(s) evasiva(s) en notas técnicas.`,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Adapter local privado: GovernanceReportJson -> GovernanceResult legacy
// ---------------------------------------------------------------------------

function renderFinancialNotes(notes: readonly FinancialNote[]): string {
  const lines: string[] = ['## 1. NOTAS A LOS ESTADOS FINANCIEROS'];
  const sorted = [...notes].sort((a, b) => a.number - b.number);
  for (const n of sorted) {
    if (n.materiality === 'omitted') continue;
    lines.push('', `### Nota ${n.number}: ${n.title}`);
    lines.push(n.body);
    if (n.normReference) lines.push(`_Norma:_ ${n.normReference}`);
  }
  return lines.join('\n');
}

function renderShareholderMinutes(minutes: ShareholderMinutes, company: GovernanceReportJson['company']): string {
  const lines: string[] = [];
  lines.push(`## 2. ACTA DE ${minutes.assemblyType.toUpperCase()} ORDINARIA`);
  lines.push('');
  lines.push(`**${company.name.toUpperCase()}** — NIT ${company.nit}`);
  lines.push(`Régimen: ${minutes.entityRegimeCitation}`);
  if (minutes.city) lines.push(`Ciudad: ${minutes.city}`);
  if (minutes.meetingDate) lines.push(`Fecha: ${minutes.meetingDate}`);

  // Why: Art. 424 C.Co. — declaración de convocatoria precede al quorum
  // porque sin convocatoria válida la asamblea es impugnable.
  lines.push('', '### Verificación de Convocatoria', minutes.convocationStatement);
  lines.push('_Norma:_ Art. 424 Código de Comercio.');

  lines.push('', '### Quorum', minutes.quorumStatement);

  lines.push('', '### Orden del día');
  for (const item of minutes.agenda) {
    lines.push(`${item.number}. ${item.topic}`);
  }

  lines.push('', '### Desarrollo de los puntos');
  for (const dev of minutes.developments) {
    lines.push('', `**Punto ${dev.itemNumber}**`);
    lines.push(dev.body);
  }

  lines.push('', '### Destinación del resultado del ejercicio');
  const dist = minutes.resultDistribution;
  lines.push(
    `Utilidad Neta del Ejercicio: ${formatCopFromCents(parseMoneyCop(dist.netIncomeCop), true)}`,
  );
  if (dist.applies && dist.lines.length > 0) {
    lines.push('');
    lines.push('| Concepto | Monto | Norma |');
    lines.push('|---|---:|---|');
    for (const ln of dist.lines) {
      lines.push(
        `| ${ln.label} | ${formatCopFromCents(parseMoneyCop(ln.amountCop), true)} | ${ln.normReference} |`,
      );
    }
  } else if (dist.neutralProposalText) {
    lines.push('', dist.neutralProposalText);
  }

  if (minutes.capitalizationProposal.applies) {
    lines.push(
      '',
      '### Proposición — Capitalización 40% de utilidades retenidas acumuladas',
      minutes.capitalizationProposal.body,
      `_Base:_ ${formatCopFromCents(parseMoneyCop(minutes.capitalizationProposal.retainedEarningsBaseCop), true)}`,
      `_Monto a capitalizar:_ ${formatCopFromCents(parseMoneyCop(minutes.capitalizationProposal.capitalizationAmountCop), true)}`,
      `_Fundamento:_ ${minutes.capitalizationProposal.legalReference}`,
    );
  }

  lines.push('', '### Cierre', minutes.closingStatement);

  lines.push('', '---', '', '## CERTIFICACIÓN');
  lines.push('', '### Firmas');
  lines.push('| Cargo | Nombre | Identificación | Firma |');
  lines.push('|---|---|---|---|');
  const roleLabel = {
    presidente_asamblea: `Presidente de ${minutes.assemblyType}`,
    secretario_asamblea: `Secretario de ${minutes.assemblyType}`,
    representante_legal: 'Representante Legal',
    revisor_fiscal: 'Revisor Fiscal',
    contador_publico: 'Contador Público',
  } as const;
  for (const sig of minutes.signatures) {
    const name = sig.name ?? '— (a completar al firmar)';
    const id = sig.identification ?? '———————';
    lines.push(`| ${roleLabel[sig.role]} | ${name} | ${id} | ——————— |`);
  }

  const op = minutes.fiscalReviewerOpinion;
  lines.push('', '### Dictamen del Revisor Fiscal');
  if (op.applies) {
    const opTypeLabel = {
      favorable: 'favorable',
      con_salvedades: 'con salvedades',
      desfavorable: 'desfavorable',
      abstension: 'abstención',
    } as const;
    lines.push(
      `${op.reviewerName ?? '— (a completar al firmar)'}${op.reviewerTp ? ` — T.P. ${op.reviewerTp}` : ''}, Revisor Fiscal de ${company.name} (NIT ${company.nit}), emite dictamen ${op.opinionType ? opTypeLabel[op.opinionType] : 'pendiente'}.`,
    );
    if (op.opinionBody) lines.push('', op.opinionBody);
    lines.push('', '_Sustento normativo:_ Ley 43 de 1990, Art. 207-209 C.Co., NIA 700/705/706.');
  } else {
    lines.push(op.exemptionReason ?? 'Entidad no obligada a Revisor Fiscal por umbral Art. 203 C.Co.');
  }

  lines.push('', '**FIN DEL ACTA**', '');
  return lines.join('\n');
}

function renderPreparerNotes(json: GovernanceReportJson): string {
  if (json.preparerNotes.length === 0) return '';
  return [
    '### Notas del Preparador',
    ...json.preparerNotes.map((n) => `- ${n.body}${n.norma ? ` (${n.norma})` : ''}`),
  ].join('\n');
}

// Why: Parte III §3 spec v2.0 — checklist tipado debe aparecer al cierre del
// documento de Gobierno con tabla auditable.
function renderComplianceChecklist(json: GovernanceReportJson): string {
  if (json.complianceChecklist.length === 0) return '';
  const statusLabel: Record<typeof json.complianceChecklist[number]['status'], string> = {
    cumplido: 'Cumplido',
    parcial: 'Parcial',
    pendiente: 'Pendiente',
    no_aplica: 'No aplica',
  };
  const lines: string[] = [
    '## 3. CHECKLIST DE CUMPLIMIENTO NORMATIVO',
    '',
    '| Área | Norma | Estado | Evidencia | Acción requerida |',
    '|---|---|---|---|---|',
  ];
  for (const item of json.complianceChecklist) {
    const accion = item.accionRequerida ?? '—';
    lines.push(`| ${item.topic} | ${item.norma} | ${statusLabel[item.status]} | ${item.evidencia} | ${accion} |`);
  }
  return lines.join('\n');
}

// Why: Parte 9 spec v2.0 — disclaimers automáticos con texto literal.
// Renderizan en sección dedicada al final del documento para no contaminar
// las notas técnicas con avisos de limitación.
function renderDisclaimers(json: GovernanceReportJson): string {
  if (json.disclaimers.length === 0) return '';
  const lines: string[] = ['## 4. LIMITACIONES Y DISCLAIMERS AUTOMÁTICOS', ''];
  for (const d of json.disclaimers) {
    lines.push(`- ${d.texto}`);
    lines.push(`  _Activador:_ ${d.trigger}`);
  }
  return lines.join('\n');
}

function toGovernanceResult(json: GovernanceReportJson): GovernanceResult {
  const financialNotes = renderFinancialNotes(json.financialNotes);
  const shareholderMinutes = renderShareholderMinutes(json.shareholderMinutes, json.company);
  const complianceChecklist = renderComplianceChecklist(json);
  const disclaimers = renderDisclaimers(json);
  const preparerNotes = renderPreparerNotes(json);
  const fullContent = [
    financialNotes,
    '',
    shareholderMinutes,
    complianceChecklist ? `\n${complianceChecklist}` : '',
    disclaimers ? `\n${disclaimers}` : '',
    preparerNotes ? `\n${preparerNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    financialNotes,
    shareholderMinutes,
    fullContent,
    // Exposición del JSON estricto para consumers post-Fase-3.
    json,
  };
}

// ---------------------------------------------------------------------------
// Detector de frases evasivas — refactor Wave 2.F3 (2026-05-12)
// ---------------------------------------------------------------------------
// Why: el detector legacy bloqueaba indiscriminadamente cualquier ocurrencia
// de "no se suministró información" en el fullContent. El problema: los 6
// disclaimers válidos del spec Parte 9 USAN frases con "no se suministró"
// como prefijo CALIFICADO (ej. "No se suministró detalle de obligaciones
// laborales") — el detector los confundía con frases evasivas y disparaba
// falsos positivos que bloqueaban informes legítimos.
//
// Fix estructural:
//   1. Los disclaimers ahora viven en `json.disclaimers[]` con `code`
//      enumerado — son entidades de primera clase, no prosa libre.
//   2. El detector solo escanea campos de body LIBRE (financialNotes.body,
//      shareholderMinutes prosa). Los disclaimers están EXENTOS por contrato.
//   3. Los patrones EVASIVE_PHRASES llevan look-ahead negativo para no
//      atrapar las frases calificadas del spec — solo las EVASIVAS reales
//      (sin complemento que especifique qué falta).

interface EvasiveHit {
  pattern: string;
  match: string;
  offset: number;
}

// Why: las frases evasivas REALES no llevan complemento calificador.
// "no se suministró información" → evasivo (qué información? ninguna pista).
// "no se suministró detalle de obligaciones laborales" → disclaimer válido
// (especifica qué información falta y por qué se omite el rubro).
const FORBIDDEN_EVASIVE_PHRASES: { id: string; rx: RegExp }[] = [
  // "no se suministró información" sin complemento que califique qué.
  { id: 'no_suministro_informacion', rx: /no\s+se\s+suministr[oó]\s+(?:la\s+)?informaci[oó]n(?!\s+(?:detalle|específica|sobre|respecto|de))/i },
  // "información no detallada" sin razón.
  { id: 'informacion_no_detallada', rx: /informaci[oó]n\s+no\s+(?:detallada|provista|disponible)(?!\s+(?:por|debido|sobre|respecto))/i },
  // "datos no disponibles" sin complemento.
  { id: 'datos_no_disponibles', rx: /datos\s+no\s+(?:disponibles|suministrados)(?!\s*\)|\s+(?:para|sobre|respecto|de))/i },
  // Estos sí son siempre evasivos sin matiz aceptable.
  { id: 'falta_totales_vinculantes', rx: /(?:falta|ausencia)\s+de\s+totales\s+vinculantes/i },
  { id: 'totales_no_provistos', rx: /totales\s+vinculantes\s+no\s+(?:provistos|disponibles)/i },
  { id: 'pendiente_validacion', rx: /pendiente\s+de\s+validaci[oó]n/i },
  { id: 'sujeto_verificacion', rx: /sujeto\s+(?:a\s+)?(?:verificaci[oó]n|confirmaci[oó]n)/i },
  { id: 'no_se_conto_datos', rx: /no\s+se\s+cont[oó]\s+con\s+(?:los\s+)?datos/i },
  { id: 'no_se_cuenta_informacion', rx: /no\s+se\s+cuenta\s+con\s+(?:la\s+)?informaci[oó]n/i },
];

/**
 * Escanea SOLO los campos de body libre del JSON estructurado.
 * NO escanea `disclaimers[]` (textos literales del spec Parte 9 — válidos por
 * contrato) ni `preparerNotes[]` (notas explícitas del preparador).
 *
 * Por qué Wave 2.F3 reformó esto:
 *   El detector legacy operaba sobre `fullContent` (Markdown ya renderizado),
 *   donde disclaimers válidos y frases evasivas se mezclaban indistinguibles.
 *   Ahora opera sobre el JSON estructurado: los disclaimers tienen su propio
 *   campo tipado (`code` enumerado) y se exoneran by-design.
 */
function detectForbiddenPhrasesInJson(json: GovernanceReportJson): EvasiveHit[] {
  const freeTextSegments: { field: string; text: string }[] = [];

  for (const note of json.financialNotes) {
    if (note.materiality === 'omitted') continue;
    freeTextSegments.push({ field: `financialNotes[${note.number}].body`, text: note.body });
  }

  const m = json.shareholderMinutes;
  freeTextSegments.push({ field: 'shareholderMinutes.quorumStatement', text: m.quorumStatement });
  freeTextSegments.push({ field: 'shareholderMinutes.convocationStatement', text: m.convocationStatement });
  freeTextSegments.push({ field: 'shareholderMinutes.closingStatement', text: m.closingStatement });
  for (const dev of m.developments) {
    freeTextSegments.push({ field: `shareholderMinutes.developments[${dev.itemNumber}].body`, text: dev.body });
  }
  if (m.resultDistribution.neutralProposalText) {
    freeTextSegments.push({ field: 'shareholderMinutes.resultDistribution.neutralProposalText', text: m.resultDistribution.neutralProposalText });
  }
  if (m.capitalizationProposal.applies) {
    freeTextSegments.push({ field: 'shareholderMinutes.capitalizationProposal.body', text: m.capitalizationProposal.body });
  }
  if (m.fiscalReviewerOpinion.applies && m.fiscalReviewerOpinion.opinionBody) {
    freeTextSegments.push({ field: 'shareholderMinutes.fiscalReviewerOpinion.opinionBody', text: m.fiscalReviewerOpinion.opinionBody });
  }
  // complianceChecklist.evidencia/accionRequerida: campos cortos, pero
  // los escaneamos porque siguen siendo prosa libre.
  for (let i = 0; i < json.complianceChecklist.length; i += 1) {
    const item = json.complianceChecklist[i];
    freeTextSegments.push({ field: `complianceChecklist[${i}].evidencia`, text: item.evidencia });
    if (item.accionRequerida) {
      freeTextSegments.push({ field: `complianceChecklist[${i}].accionRequerida`, text: item.accionRequerida });
    }
  }
  // disclaimers[] EXENTO por contrato — textos literales del spec Parte 9.
  // preparerNotes[] EXENTO — notas explícitas del preparador (legacy).

  const hits: EvasiveHit[] = [];
  for (const { field, text } of freeTextSegments) {
    if (!text) continue;
    for (const { id, rx } of FORBIDDEN_EVASIVE_PHRASES) {
      const match = rx.exec(text);
      if (match && typeof match.index === 'number') {
        hits.push({ pattern: `${field} :: ${id}`, match: match[0], offset: match.index });
      }
    }
  }
  return hits;
}
