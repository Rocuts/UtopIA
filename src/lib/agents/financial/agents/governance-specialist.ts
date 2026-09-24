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
  buildActaExpectedArithmetic,
  buildGovernancePrompt,
  convocatoriaCitationFor,
  normalizeTipoSocietario,
  type GovernanceEliteContext,
} from '../prompts/governance-specialist.prompt';
import { buildDegradationNotice } from './reconcile-anchors';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { ReportMode } from '../contracts/base';
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
 * @param reportMode      Modo del reporte (v8.1 §2) — pre-derivado por
 *                        `prepareFinancialContext`. Default
 *                        `'COMPARATIVO_COMPLETO'` para backward compat. F6
 *                        lo cableará al `buildGovernancePrompt`.
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
  reportMode: ReportMode = 'COMPARATIVO_COMPLETO',
): Promise<GovernanceResult> {
  const systemPrompt = buildGovernancePrompt(company, language, preprocessed, elite, reportMode);

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

  // Degradación visible (pipeline-flujo-15): mismo patrón que el Analista
  // NIIF — el aviso de `callFinancialAgent` se reenvía como progreso y la
  // sección viaja marcada en el cuerpo.
  const agentResult = await callFinancialAgent({
    agentName: 'governance-specialist',
    // PREMIUM (gpt-5.5): produce notas a EEFF (14 secciones) + acta — schema
    // muy rico, amerita el techo de 128K output del modelo premium.
    model: MODELS.FINANCIAL_PIPELINE_PREMIUM,
    schema: GovernanceReportSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.governanceSpecialist,
    signal,
    onDegraded: (info) => onProgress?.({ type: 'stage_progress', stage: 3, detail: info.message }),
  });
  const json = agentResult.json;

  // La MISMA aritmética del acta que viajó al prompt y contra la que el
  // orquestador reconcilia: si dice que la capitalización no aplica, el acta
  // no imprime un monto a capitalizar aunque el modelo emita applies=true
  // (pipeline-flujo-12). El JSON conserva lo emitido para que el reconciliador
  // selle la desviación.
  const actaEsperada = buildActaExpectedArithmetic(company, preprocessed);
  const result = toGovernanceResult(json, company, {
    capitalizationApplies: actaEsperada ? actaEsperada.capitalizationApplies : null,
  });
  if (agentResult.meta?.degraded === true) {
    const notice = governanceDegradationNotice(language);
    result.degraded = true;
    result.financialNotes = `${notice}\n${result.financialNotes}`;
    result.shareholderMinutes = `${notice}\n${result.shareholderMinutes}`;
    result.fullContent = `${notice}\n${result.fullContent}`;
  }

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
// Render de la Parte III desde el JSON persistido (I3: procedencia del Markdown)
// ---------------------------------------------------------------------------
// Las notas, el acta, el checklist y los avisos son una función determinista
// del JSON validado, del tipo societario y grupo NIIF de la empresa y de la
// aritmética del acta (`capitalizationApplies`). El servidor vuelve a producir
// ese Markdown en /consolidate y /export (src/lib/reports/part-markdown.ts)
// en lugar de aceptar el que reenvía el navegador.
// ---------------------------------------------------------------------------

/**
 * Sello aritmético del acta (I5-7): lo antepone `runGovernancePhase` cuando la
 * destinación no coincide con la aritmética determinista (`anchored`) o no
 * pudo contrastarse con ella (sin preprocesado), y el re-render del servidor
 * (`renderGovernancePart`, part-markdown.ts) con la MISMA función.
 */
export function actaArithmeticSeal(motivos: readonly string[], anchored: boolean, language: 'es' | 'en'): string {
  const es = language === 'es';
  if (anchored) {
    return [
      es ? '> ## ACTA CON SALVEDADES — INTEGRIDAD ARITMÉTICA' : '> ## MINUTES WITH QUALIFICATIONS — ARITHMETIC INTEGRITY',
      '>',
      es
        ? '> Las cifras del acta no coinciden con la aritmética determinista sobre la ' +
          'utilidad del ejercicio. Este documento NO es firmable ni inscribible tal como está:'
        : '> The minutes figures do not match the deterministic arithmetic over the ' +
          'period result. This document is NOT signable as issued:',
      '>',
      ...motivos.map((m) => `> - ${m}`),
      '',
    ].join('\n');
  }
  return [
    es ? '> ## ACTA CON SALVEDADES — CIFRAS SIN VERIFICAR' : '> ## MINUTES WITH QUALIFICATIONS — UNVERIFIED FIGURES',
    '>',
    es
      ? '> El acta propone cifras de destinación que no pudieron contrastarse con una ' +
        'aritmética determinista sobre la utilidad del ejercicio. Este documento NO es firmable ' +
        'ni inscribible tal como está:'
      : '> The minutes propose allocation figures that could not be checked against ' +
        'deterministic arithmetic over the period result. This document is NOT signable as issued:',
    '>',
    ...motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
}

/** Aviso de sección degradada de la Parte III (mismo texto en la fase y en el servidor). */
export function governanceDegradationNotice(language: 'es' | 'en'): string {
  return buildDegradationNotice(
    [language === 'es' ? 'Gobierno corporativo (Parte III)' : 'Corporate governance (Part III)'],
    language,
  );
}

/**
 * Markdown de la Parte III desde su JSON (el adaptador de la fase, sin sellos).
 * `capitalizationApplies` es el de `buildActaExpectedArithmetic` (`null` sin
 * balance preprocesado).
 */
export function renderGovernanceResult(
  json: GovernanceReportJson,
  company: Partial<CompanyInfo> | undefined,
  capitalizationApplies: boolean | null,
): GovernanceResult {
  return toGovernanceResult(json, company, { capitalizationApplies });
}

// ---------------------------------------------------------------------------
// Firmantes del acta desde el intake (procedencia-R2-04)
// ---------------------------------------------------------------------------
// El acta imprimía nombre, identificación y T.P. de los firmantes y del Revisor
// Fiscal tal como los escribía el modelo en el JSON de la Parte III, sin
// cruzarlos con los de la empresa: un PDF "procedencia verificada" podía
// nombrar como Representante Legal y Revisor Fiscal a personas ajenas al
// intake mientras su propio bloque de firmas imprimía las del intake. La
// identidad de un firmante no es un juicio del modelo: sale del intake
// (`company.signatories` o los campos legacy) y, si el intake no la trae, se
// imprime "a completar al firmar". Presidente y Secretario de la asamblea no
// tienen campo en el intake: siempre "a completar al firmar".
// ---------------------------------------------------------------------------

/** Identidad de un firmante según el intake (`null` = sin dato). */
interface IntakeSignatory {
  name: string;
  /** C.C. del Representante Legal (sin prefijo). */
  cedula: string | null;
  /** T.P. del Revisor Fiscal / Contador (`12345-T`). */
  tp: string | null;
}

interface IntakeSignatories {
  representanteLegal: IntakeSignatory | null;
  revisorFiscal: IntakeSignatory | null;
  contadorPublico: IntakeSignatory | null;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Firmantes declarados en el intake: forma canónica `signatories` primero y
 * los campos legacy (`legalRepresentative`, `fiscalAuditor`, `accountant` y sus
 * identificaciones) como respaldo — misma precedencia que el bloque de firmas
 * del PDF (`signatoriesFromCompany`). Un nombre sin T.P. se conserva: la T.P.
 * sale "a completar".
 */
export function intakeSignatories(company: Partial<CompanyInfo> | undefined): IntakeSignatories {
  const c = company ?? {};
  const s = c.signatories;
  const rlName = nonEmpty(s?.representanteLegal?.nombre) ?? nonEmpty(c.legalRepresentative);
  const rfName = nonEmpty(s?.revisorFiscal?.nombre) ?? nonEmpty(c.fiscalAuditor);
  const cpName = nonEmpty(s?.contadorPublico?.nombre) ?? nonEmpty(c.accountant);
  return {
    representanteLegal: rlName
      ? { name: rlName, cedula: nonEmpty(s?.representanteLegal?.cedula) ?? nonEmpty(c.legalRepresentativeId), tp: null }
      : null,
    revisorFiscal: rfName
      ? { name: rfName, cedula: null, tp: nonEmpty(s?.revisorFiscal?.tp) ?? nonEmpty(c.fiscalAuditorTp) }
      : null,
    contadorPublico: cpName
      ? { name: cpName, cedula: null, tp: nonEmpty(s?.contadorPublico?.tp) ?? nonEmpty(c.accountantTp) }
      : null,
  };
}

const TP_RE = /^\d+-T$/i;

/**
 * JSON de la Parte III con la identidad de los firmantes tomada del intake:
 * `shareholderMinutes.signatures`, `fiscalReviewerOpinion.reviewerName/Tp` y
 * los espejos `signatories` / `company.signatories`. Lo que el intake no trae
 * queda en `null` (el render imprime "a completar al firmar"). El resto del
 * JSON no cambia.
 */
export function withIntakeSignatories(
  json: GovernanceReportJson,
  company: Partial<CompanyInfo> | undefined,
): GovernanceReportJson {
  const intake = intakeSignatories(company);
  const minutes = json.shareholderMinutes;
  const signatures = minutes.signatures.map((sig) => {
    switch (sig.role) {
      case 'representante_legal':
        return {
          ...sig,
          name: intake.representanteLegal?.name ?? null,
          identification: intake.representanteLegal?.cedula ? `C.C. ${intake.representanteLegal.cedula}` : null,
        };
      case 'revisor_fiscal':
        return {
          ...sig,
          name: intake.revisorFiscal?.name ?? null,
          identification: intake.revisorFiscal?.tp ? `T.P. ${intake.revisorFiscal.tp}` : null,
        };
      case 'contador_publico':
        return {
          ...sig,
          name: intake.contadorPublico?.name ?? null,
          identification: intake.contadorPublico?.tp ? `T.P. ${intake.contadorPublico.tp}` : null,
        };
      default:
        // Presidente y Secretario de la asamblea: sin campo en el intake.
        return { ...sig, name: null, identification: null };
    }
  });
  // Espejo del contrato (`SignatoriesSchema`): la T.P. debe tener el formato
  // de la Junta Central; sin él el slot queda en null (nunca un JSON inválido).
  const withTp = (p: IntakeSignatory | null) =>
    p && p.tp && TP_RE.test(p.tp) ? { nombre: p.name, tp: p.tp } : null;
  const mirror = {
    representanteLegal: intake.representanteLegal ? { nombre: intake.representanteLegal.name } : null,
    revisorFiscal: withTp(intake.revisorFiscal),
    contadorPublico: withTp(intake.contadorPublico),
  };
  const hasMirror = mirror.representanteLegal !== null || mirror.revisorFiscal !== null || mirror.contadorPublico !== null;
  return {
    ...json,
    signatories: hasMirror ? mirror : null,
    company: { ...json.company, signatories: hasMirror ? mirror : null },
    shareholderMinutes: {
      ...minutes,
      signatures,
      fiscalReviewerOpinion: {
        ...minutes.fiscalReviewerOpinion,
        reviewerName: intake.revisorFiscal?.name ?? null,
        reviewerTp: intake.revisorFiscal?.tp ?? null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter local privado: GovernanceReportJson -> GovernanceResult legacy
// ---------------------------------------------------------------------------

/**
 * Nota de preparación IFRS 18: sólo aplica al Grupo 1. Para Grupo 2/3 (o
 * grupo no informado, que el pipeline trata como Grupo 2) la nota no se
 * incluye (Corrección 6 v2.1 + Pass-3 NIIF "IFRS 18 NUNCA mencionada"); si
 * el modelo la emite igual, se trata como omitida. Sin esta salvaguarda el
 * gate V8 bloquea todo informe de Grupo 2 que obedezca al prompt anterior.
 */
const IFRS18_NOTE_TITLE_RX = /\b(?:IFRS|NIIF)\s*18\b/i;

function isOmittedNote(n: FinancialNote, niifGroup: number | null | undefined): boolean {
  if (n.materiality === 'omitted') return true;
  if (niifGroup !== 1 && IFRS18_NOTE_TITLE_RX.test(n.title)) return true;
  return false;
}

function renderFinancialNotes(
  notes: readonly FinancialNote[],
  niifGroup: number | null | undefined,
): string {
  const lines: string[] = ['## 1. NOTAS A LOS ESTADOS FINANCIEROS'];
  const sorted = [...notes].sort((a, b) => a.number - b.number);
  for (const n of sorted) {
    if (isOmittedNote(n, niifGroup)) continue;
    lines.push('', `### Nota ${n.number}: ${n.title}`);
    lines.push(n.body);
    if (n.normReference) lines.push(`_Norma:_ ${n.normReference}`);
  }
  return lines.join('\n');
}

/** Rótulo con signo del resultado del ejercicio (NIIF: pérdida entre paréntesis). */
function resultadoDelEjercicioLine(netIncomeCop: string): string {
  const net = parseMoneyCop(netIncomeCop);
  const label = net < BigInt(0) ? 'Pérdida neta del ejercicio' : 'Utilidad neta del ejercicio';
  return `${label}: ${formatCopFromCents(net, false)}`;
}

/** Cifra con signo (paréntesis NIIF para negativos) — nunca valor absoluto. */
function signedCop(value: string): string {
  return formatCopFromCents(parseMoneyCop(value), false);
}

function renderShareholderMinutes(
  minutes: ShareholderMinutes,
  company: GovernanceReportJson['company'],
  entityType: string | null | undefined,
  expectedCapitalizationApplies: boolean | null = null,
): string {
  const lines: string[] = [];
  lines.push(`## 2. ACTA DE ${minutes.assemblyType.toUpperCase()} ORDINARIA`);
  lines.push('');
  lines.push(`**${company.name.toUpperCase()}** — NIT ${company.nit}`);
  lines.push(`Régimen: ${minutes.entityRegimeCitation}`);
  if (minutes.city) lines.push(`Ciudad: ${minutes.city}`);
  if (minutes.meetingDate) lines.push(`Fecha: ${minutes.meetingDate}`);

  // Why: la declaración de convocatoria precede al quorum porque sin
  // convocatoria válida la asamblea es impugnable. La norma depende del tipo
  // societario: SAS → estatutos + Art. 20 Ley 1258/2008; S.A. → Art. 424
  // C.Co.; Ltda. → estatutos + Arts. 181-186 C.Co. (prompts-normativa-13).
  const citation = convocatoriaCitationFor(normalizeTipoSocietario(entityType));
  lines.push('', '### Verificación de Convocatoria', minutes.convocationStatement);
  lines.push(`_Norma:_ ${citation.charAt(0).toUpperCase()}${citation.slice(1)}.`);

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
  // El reconciliador exige que netIncomeCop sea la cifra FIRMADA de los
  // totales vinculantes; imprimirla en valor absoluto convertía una pérdida
  // en "utilidad" en un documento para firma (auditoria-calidad-01).
  lines.push(resultadoDelEjercicioLine(dist.netIncomeCop));
  if (dist.applies && dist.lines.length > 0) {
    lines.push('');
    lines.push('| Concepto | Monto | Norma |');
    lines.push('|---|---:|---|');
    for (const ln of dist.lines) {
      lines.push(
        `| ${ln.label} | ${signedCop(ln.amountCop)} | ${ln.normReference} |`,
      );
    }
  } else if (dist.neutralProposalText) {
    lines.push('', dist.neutralProposalText);
  }

  // Sin ancla (`null`) se respeta lo emitido: el orquestador lo sella como
  // cifra sin verificar. Con ancla que dice "no aplica", no se imprime.
  if (minutes.capitalizationProposal.applies && expectedCapitalizationApplies !== false) {
    lines.push(
      '',
      // v2.5 #13: la base es la utilidad neta del ejercicio, no el saldo
      // acumulado del PUC 36 (pipeline-flujo-18).
      '### Proposición — Capitalización del 40% de la utilidad neta del ejercicio',
      minutes.capitalizationProposal.body,
      `_Base (utilidad neta del ejercicio):_ ${signedCop(minutes.capitalizationProposal.retainedEarningsBaseCop)}`,
      `_Monto a capitalizar:_ ${signedCop(minutes.capitalizationProposal.capitalizationAmountCop)}`,
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
    // El acta NO anticipa la opinión: el dictamen lo emite el Revisor Fiscal
    // (Arts. 207-209 C.Co.) y la auditoría Parte IV lleva su propia opinión
    // con salvaguardas. Publicar aquí el tipo que redactó el modelo de
    // Governance producía dos "dictámenes" contradictorios (auditoria-calidad-18).
    lines.push(
      `${op.reviewerName ?? '— (a completar al firmar)'}${op.reviewerTp ? ` — T.P. ${op.reviewerTp}` : ''}, Revisor Fiscal de ${company.name} (NIT ${company.nit}): dictamen pendiente de emisión por el Revisor Fiscal. El acta no anticipa ni califica su opinión.`,
    );
    lines.push('', '_Sustento normativo:_ Arts. 207-209 C.Co., Ley 43 de 1990, NIA 700/705/706.');
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

/**
 * El JSON expuesto a consumidores downstream tampoco lleva la opinión que el
 * modelo de Governance haya redactado para el Revisor Fiscal.
 */
function withoutReviewerOpinion(json: GovernanceReportJson): GovernanceReportJson {
  const op = json.shareholderMinutes.fiscalReviewerOpinion;
  if (op.opinionType === null && op.opinionBody === null) return json;
  return {
    ...json,
    shareholderMinutes: {
      ...json.shareholderMinutes,
      fiscalReviewerOpinion: { ...op, opinionType: null, opinionBody: null },
    },
  };
}

function toGovernanceResult(
  rawJson: GovernanceReportJson,
  company?: Partial<CompanyInfo>,
  options: {
    /** `capitalizationApplies` de la aritmética determinista del acta; `null` = sin ancla. */
    capitalizationApplies?: boolean | null;
  } = {},
): GovernanceResult {
  // Firmantes del intake (R2-04): el acta y el JSON expuesto no llevan la
  // identidad que escribió el modelo.
  const json = withIntakeSignatories(withoutReviewerOpinion(rawJson), company);
  const niifGroup = company?.niifGroup ?? json.company.niifGroup;
  const entityType = company?.entityType ?? json.company.entityType;
  const financialNotes = renderFinancialNotes(json.financialNotes, niifGroup);
  const shareholderMinutes = renderShareholderMinutes(
    json.shareholderMinutes,
    json.company,
    entityType,
    options.capitalizationApplies ?? null,
  );
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
//
// Por qué los patrones de marketing usan \b (word boundary):
//   Evitan falsos positivos en strings normativos legítimos:
//   "Decreto 2420/2015" no hace match a ningún patrón.
//   "Excelencia" matchea porque es adjetivo publicitario prohibido (§1.6 v8.1).
//   El detector NO escanea disclaimers[] ni preparerNotes[] — exentos por contrato.
//   El detector NO escanea complianceChecklist[].topic ni .norma — son códigos
//   normativos legítimos (ej. "Decreto 2420/2015", "Art. 452 C.Co.").
const FORBIDDEN_EVASIVE_PHRASES: { id: string; rx: RegExp }[] = [
  // Frases evasivas de entrega — sin complemento calificador.
  { id: 'no_suministro_informacion', rx: /no\s+se\s+suministr[oó]\s+(?:la\s+)?informaci[oó]n(?!\s+(?:detalle|específica|sobre|respecto|de))/i },
  { id: 'informacion_no_detallada', rx: /informaci[oó]n\s+no\s+(?:detallada|provista|disponible)(?!\s+(?:por|debido|sobre|respecto))/i },
  { id: 'datos_no_disponibles', rx: /datos\s+no\s+(?:disponibles|suministrados)(?!\s*\)|\s+(?:para|sobre|respecto|de))/i },
  { id: 'falta_totales_vinculantes', rx: /(?:falta|ausencia)\s+de\s+totales\s+vinculantes/i },
  { id: 'totales_no_provistos', rx: /totales\s+vinculantes\s+no\s+(?:provistos|disponibles)/i },
  { id: 'pendiente_validacion', rx: /pendiente\s+de\s+validaci[oó]n/i },
  { id: 'sujeto_verificacion', rx: /sujeto\s+(?:a\s+)?(?:verificaci[oó]n|confirmaci[oó]n)/i },
  { id: 'no_se_conto_datos', rx: /no\s+se\s+cont[oó]\s+con\s+(?:los\s+)?datos/i },
  { id: 'no_se_cuenta_informacion', rx: /no\s+se\s+cuenta\s+con\s+(?:la\s+)?informaci[oó]n/i },
  // Vocabulario marketing prohibido (§1.6 spec v8.1).
  // Why: la autoridad del reporte proviene de la precisión normativa, no del
  // adjetivo. Estos términos se detectan en body libre y son violaciones
  // bloqueantes. No se escanean en complianceChecklist.norma/topic porque
  // esos campos contienen códigos normativos, no prosa libre.
  { id: 'marketing_elite', rx: /\b[ÉéEe]lite\b/i },
  { id: 'marketing_excelencia', rx: /\bexcelencia\b/i },
  { id: 'marketing_premium', rx: /\bpremium\b/i },
  { id: 'marketing_excepcional', rx: /\bexcepcional\b/i },
  { id: 'marketing_unico', rx: /\b[úu]nico\b/i },
  { id: 'marketing_mejor', rx: /\b(?:el|la|lo)\s+mejor\b/i },
  { id: 'marketing_solido', rx: /\bs[óo]lido\b/i },
  { id: 'marketing_robusto', rx: /\brobusto\b/i },
  { id: 'marketing_extraordinario', rx: /\bextraordinario\b/i },
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
  // complianceChecklist: escaneamos SOLO evidencia y accionRequerida (prosa libre).
  // NOT escaneamos topic ni norma — son códigos normativos legítimos (ej.
  // "Decreto 2420/2015", "Art. 452 C.Co.") que no contienen marketing prohibido.
  // Why: los patrones de marketing usan \b word-boundary; "Decreto 2420/2015"
  // no dispara ningún patrón. Pero para seguridad arquitectural, excluimos
  // los campos de código normativo del scanner por diseño.
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

// ---------------------------------------------------------------------------
// Test-only re-export — el adapter es interno; la superficie pública es
// `runGovernanceSpecialist` (una llamada LLM). No importar fuera de tests.
// ---------------------------------------------------------------------------
export const __test_toGovernanceResult = toGovernanceResult;
