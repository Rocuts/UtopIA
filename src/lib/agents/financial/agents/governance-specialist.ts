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

  // Validador anti-evasivo (post-generación) — conservado de la versión
  // anterior. Solo registra warnings si el JSON contiene frases prohibidas
  // en algún `body` libre; no re-promptea (el schema strict ya reduce
  // dramáticamente la incidencia).
  const evasiveHits = detectForbiddenPhrases(result.fullContent);
  if (evasiveHits.length > 0) {
    console.warn(
      '[governance-specialist] Frases evasivas detectadas en JSON estructurado:',
      evasiveHits.slice(0, 3).map((h) => h.match).join(' | '),
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

function toGovernanceResult(json: GovernanceReportJson): GovernanceResult {
  const financialNotes = renderFinancialNotes(json.financialNotes);
  const shareholderMinutes = renderShareholderMinutes(json.shareholderMinutes, json.company);
  const preparerNotes = renderPreparerNotes(json);
  const fullContent = [financialNotes, '', shareholderMinutes, preparerNotes ? `\n${preparerNotes}` : '']
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
// Detector de frases evasivas — conservado de la versión legacy.
// ---------------------------------------------------------------------------

interface EvasiveHit {
  pattern: string;
  match: string;
  offset: number;
}

const FORBIDDEN_PATTERNS: { id: string; rx: RegExp }[] = [
  { id: 'no_suministro_informacion', rx: /no\s+se\s+suministr[oó]\s+(?:la\s+)?informaci[oó]n/i },
  { id: 'informacion_no_detallada', rx: /informaci[oó]n\s+no\s+(?:detallada|provista|disponible)/i },
  { id: 'datos_no_disponibles', rx: /datos\s+no\s+(?:disponibles|suministrados)(?!\s*\))/i },
  { id: 'falta_totales_vinculantes', rx: /(?:falta|ausencia)\s+de\s+totales\s+vinculantes/i },
  { id: 'totales_no_provistos', rx: /totales\s+vinculantes\s+no\s+(?:provistos|disponibles)/i },
  { id: 'pendiente_validacion', rx: /pendiente\s+de\s+validaci[oó]n/i },
  { id: 'sujeto_verificacion', rx: /sujeto\s+(?:a\s+)?(?:verificaci[oó]n|confirmaci[oó]n)/i },
  { id: 'no_se_conto_datos', rx: /no\s+se\s+cont[oó]\s+con\s+(?:los\s+)?datos/i },
  { id: 'no_se_cuenta_informacion', rx: /no\s+se\s+cuenta\s+con\s+(?:la\s+)?informaci[oó]n/i },
];

function detectForbiddenPhrases(text: string): EvasiveHit[] {
  if (!text) return [];
  const preparerSectionRx = /###\s*Notas\s+del\s+Preparador[\s\S]*?(?=\n##\s|$)/i;
  const scanText = text.replace(preparerSectionRx, '');
  const hits: EvasiveHit[] = [];
  for (const { id, rx } of FORBIDDEN_PATTERNS) {
    const m = rx.exec(scanText);
    if (m && typeof m.index === 'number') {
      hits.push({ pattern: id, match: m[0], offset: m.index });
    }
  }
  return hits;
}
