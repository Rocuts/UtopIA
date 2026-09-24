import type {
  FinancialReport,
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
} from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { NiifReportSchema, type NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { GovernanceReportSchema } from '@/lib/agents/financial/contracts/governance-report';
import { toNiifAnalysisResult } from '@/lib/agents/financial/agents/renderer';
import {
  buildDegradationNotice,
  buildQualificationSeal,
  type ReconciliationOutcome,
} from '@/lib/agents/financial/agents/reconcile-anchors';
import {
  postProcessStrategyJson,
  renderStrategicAnalysisResult,
  strategyDegradationNotice,
} from '@/lib/agents/financial/agents/strategy-director';
import {
  actaArithmeticSeal,
  governanceDegradationNotice,
  renderGovernanceResult,
} from '@/lib/agents/financial/agents/governance-specialist';
import {
  buildAdjustmentsAuditSection,
  deriveReportSidecars,
  sellarConSalvedades,
  sellarProsaNiif,
} from '@/lib/agents/financial/orchestrator';
import { ancoraOrNull } from '@/lib/agents/financial/ancora/build-ancora';
import type { applyAdjustments } from '@/lib/agents/repair/adjustments';
import type { Adjustment } from '@/lib/agents/repair/types';
import { sealGovernanceNarrative } from '@/lib/agents/financial/validators/narrative-anchors';
import {
  buildStrategyQualificationSeal,
  buildStrategyVerificationNote,
  readStrategyQualifications,
} from '@/lib/agents/financial/validators/strategy-anchors';
import { buildConsolidatedReportMarkdown } from '@/lib/agents/financial/consolidated-markdown';
import {
  consolidateSplitReport,
  type SplitConsolidationResult,
} from '@/lib/agents/financial/split-consolidation';
import { isProvisionalDraft } from './provenance-stamp';
import {
  applyServerPartVerdicts,
  missingGovernanceJsonMotivo,
  missingStrategyJsonMotivo,
  serverPartChecks,
  type ServerActaChecks,
  type ServerNiifIntegrity,
  type ServerPartChecks,
} from './part-verdicts';

// ---------------------------------------------------------------------------
// Markdown de las Partes I–III re-renderizado en el servidor (I3)
// ---------------------------------------------------------------------------
// El Markdown de cada Parte es una función determinista de su JSON validado:
//   - Parte I: `toNiifAnalysisResult` (renderer.ts) + el sello del analista
//     (`buildQualificationSeal`, función pura de la reconciliación), el aviso
//     de pases degradados y los sellos de integridad de `runNiifPhase`
//     (validador E1–E25 y EFE, recalculados aquí con las mismas funciones).
//   - Parte II: `toStrategicAnalysisResult` (strategy-director.ts) sobre el
//     JSON pasado otra vez por el post-procesador de la fase
//     (`postProcessStrategyJson`: cifras derivadas y KPIs sin ancla) + el sello
//     y la nota de verificación de `qualifyStrategyResult`.
//   - Parte III: `toGovernanceResult` (governance-specialist.ts) con la
//     aritmética del acta + los sellos aritmético y de prosa de
//     `runGovernancePhase`.
// Ese Markdown es el que renderizan el PDF (notas, acta, recomendaciones,
// punto de equilibrio, proyecciones), el Excel (pestaña Resumen = consolidado,
// Parte II) y el consolidado persistido. Llegaba del navegador: con un JSON
// honesto y una cifra falsa sólo en el texto, /consolidate persistía la
// versión "limpia" y /export la entregaba "procedencia verificada".
//
// Aquí el servidor DESCARTA el Markdown recibido y lo vuelve a producir desde
// el JSON, con los sellos derivados de SUS veredictos (que sólo endurecen el
// del cliente). Para un informe honesto el resultado es el mismo texto que
// produjeron las fases (paridad probada con las fases reales en
// markdown-procedencia.route.test.ts); una Parte
// sin JSON válido no se puede re-renderizar: se sella y su texto se sustituye
// por el sello. Límites documentados: el sello del gate de emisión de la
// Parte I (pre-vuelo, V3/V15, periodo) no se reproduce —sus motivos siguen en
// `emittability`/`validation` y la reconciliación sigue en `clean: false`— y
// la observación "resumen del escenario distinto de su tabla" de la Parte II
// tampoco (el JSON ya trae la cifra de la tabla).
// ---------------------------------------------------------------------------

/** Pases del Analista NIIF que pueden declararse degradados (niif-analyst.ts). */
const NIIF_DEGRADABLE_PASSES = new Set([
  'Balance General y Estado de Resultados',
  'Flujo de Efectivo y Cambios en el Patrimonio',
  'Notas técnicas',
]);

function parseNiif(json: unknown): NiifReportJson | null {
  const parsed = NiifReportSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function missingNiifJsonMotivo(language: 'es' | 'en'): string {
  return language === 'en'
    ? 'Part I carries no valid structured figures (NIIF JSON missing or invalid): its statements cannot be verified against the trial balance.'
    : 'La Parte I no trae cifras estructuradas válidas (JSON NIIF ausente o inválido): sus estados no pueden verificarse contra el balance.';
}

/** `true` si la Parte llegó sin texto (el gate la declara INCOMPLETA; no se sustituye por un sello). */
function isBlankPart(part: { fullContent?: unknown } | null | undefined): boolean {
  return typeof part?.fullContent !== 'string' || part.fullContent.trim().length === 0;
}

/** Sello que sustituye el texto de una Parte sin JSON válido. */
function unverifiableSeal(part: 'I' | 'II' | 'III', motivo: string, language: 'es' | 'en'): string {
  const en = language === 'en';
  return [
    en
      ? `> ## PART ${part} WITHOUT STRUCTURED FIGURES — NOT VERIFIABLE`
      : `> ## PARTE ${part} SIN CIFRAS ESTRUCTURADAS — NO VERIFICABLE`,
    '>',
    en
      ? '> The text received for this section was discarded: without its structured figures it cannot be ' +
        'rendered or verified by the server. This section is NOT issuable as is:'
      : '> El texto recibido para esta sección se descartó: sin sus cifras estructuradas el servidor no puede ' +
        'producirlo ni verificarlo. Esta sección NO es emitible tal como está:',
    '>',
    `> - ${motivo}`,
    '',
  ].join('\n');
}

/**
 * Sello de identidad (I5-2): la Parte II/III declara una empresa, un NIT o un
 * periodo distintos de los de los estados financieros.
 */
function identitySeal(part: 'II' | 'III', motivos: readonly string[], language: 'es' | 'en'): string {
  const en = language === 'en';
  return [
    en ? `> ## PART ${part} WITH QUALIFICATIONS — IDENTITY` : `> ## PARTE ${part} CON SALVEDADES — IDENTIDAD`,
    '>',
    en
      ? '> The company or the period of this section do not match those of the financial statements. ' +
        'This section is NOT issuable as is:'
      : '> La empresa o el periodo de esta sección no coinciden con los de los estados financieros. ' +
        'Esta sección NO es emitible tal como está:',
    '>',
    ...motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Parte I
// ---------------------------------------------------------------------------

/** Sello del analista (función pura de la reconciliación); '' si no aplica o es ilegible. */
function analystSeal(reconciliation: NiifAnalysisResult['reconciliation'], language: 'es' | 'en'): string {
  if (!reconciliation || reconciliation.clean !== false) return '';
  try {
    return buildQualificationSeal(reconciliation as ReconciliationOutcome, language);
  } catch {
    // Una reconciliación con forma ilegible no debe tumbar la ruta: la Parte ya
    // está en `clean: false` y el sello de integridad (si lo hay) la declara.
    return '';
  }
}

export function renderNiifPart(
  niif: NiifAnalysisResult,
  integrity: ServerNiifIntegrity | null,
  language: 'es' | 'en',
): NiifAnalysisResult {
  const json = parseNiif(niif.json);
  if (!json) {
    if (isBlankPart(niif)) return niif;
    const seal = unverifiableSeal('I', missingNiifJsonMotivo(language), language);
    return {
      ...niif,
      balanceSheet: seal,
      incomeStatement: '',
      cashFlowStatement: '',
      equityChangesStatement: '',
      technicalNotes: '',
      fullContent: seal,
    };
  }
  const r = toNiifAnalysisResult(json, { language });
  const out: NiifAnalysisResult = {
    ...niif,
    balanceSheet: r.balanceSheet,
    incomeStatement: r.incomeStatement,
    cashFlowStatement: r.cashFlowStatement,
    equityChangesStatement: r.equityChangesStatement,
    technicalNotes: r.technicalNotes,
    fullContent: r.fullContent,
  };
  // Mismo orden que el analista: sello de reconciliación y aviso de degradación.
  const seal = analystSeal(niif.reconciliation, language);
  if (seal) {
    out.balanceSheet = `${seal}\n${out.balanceSheet}`;
    out.fullContent = `${seal}\n${out.fullContent}`;
  }
  const passes = (Array.isArray(niif.reconciliation?.degradedPasses) ? niif.reconciliation.degradedPasses : [])
    .filter((p) => NIIF_DEGRADABLE_PASSES.has(p));
  const degradation = buildDegradationNotice(passes, language);
  if (degradation) {
    out.fullContent = `${degradation}\n${out.fullContent}`;
    out.technicalNotes = `${degradation}\n${out.technicalNotes}`;
  }
  // Y los sellos de integridad de `runNiifPhase`, con su misma función.
  const reconciliation = out.reconciliation;
  if (integrity?.jsonErrors.length) sellarConSalvedades(out, integrity.jsonErrors, language);
  if (integrity?.efeViolations.length) sellarConSalvedades(out, integrity.efeViolations, language);
  if (integrity?.narrative.length) sellarProsaNiif(out, integrity.narrative, language);
  // El veredicto lo fija `applyServerPartVerdicts`; el render sólo escribe texto.
  out.reconciliation = reconciliation;
  return out;
}

// ---------------------------------------------------------------------------
// Parte II
// ---------------------------------------------------------------------------

export function renderStrategyPart(
  strategic: StrategicAnalysisResult,
  checks: ServerPartChecks,
): StrategicAnalysisResult {
  const language = checks.sources.language ?? 'es';
  const check = checks.strategy;
  if (!check) {
    if (isBlankPart(strategic)) return strategic;
    const seal = unverifiableSeal('II', missingStrategyJsonMotivo(language), language);
    return {
      ...strategic,
      kpiDashboard: seal,
      breakEvenAnalysis: '',
      projectedCashFlow: '',
      strategicRecommendations: '',
      fullContent: seal,
    };
  }
  // El JSON pasa por el MISMO post-procesador de la fase (idempotente sobre el
  // que ella publicó): punto de equilibrio, margen de seguridad, puerta de
  // liquidez, saldo inicial, tendencias y KPIs sin ancla los vuelve a fijar el
  // código. Un JSON alterado en esas cifras derivadas no las imprime.
  const derived = postProcessStrategyJson(
    check.json,
    checks.sources.preprocessed ?? undefined,
    parseNiif(checks.sources.niifJson),
    language,
    { keepWhenNoSource: true },
  );
  const r = renderStrategicAnalysisResult(derived.json, derived.checks);
  let kpiDashboard = r.kpiDashboard;
  let fullContent = r.fullContent;
  // Orden de la fase: aviso de degradación (runStrategyDirector), sello y nota
  // de verificación (qualifyStrategyResult).
  if (strategic.degraded === true) {
    const notice = strategyDegradationNotice(language);
    kpiDashboard = `${notice}\n${kpiDashboard}`;
    fullContent = `${notice}\n${fullContent}`;
  }
  const verdict = readStrategyQualifications(strategic);
  // La identidad (I5-2) lleva su propio sello; el de cifras sólo lista las
  // demás salvedades (el texto de la fase, que no cruza identidad).
  const identity = checks.identity?.strategy ?? [];
  const figureMotivos = (verdict?.motivos ?? []).filter((m) => !identity.includes(m));
  if (verdict && !verdict.clean && figureMotivos.length > 0) {
    const seal = buildStrategyQualificationSeal(figureMotivos, language);
    kpiDashboard = `${seal}\n${kpiDashboard}`;
    fullContent = `${seal}\n${fullContent}`;
  }
  if (identity.length > 0) {
    const seal = identitySeal('II', identity, language);
    kpiDashboard = `${seal}\n${kpiDashboard}`;
    fullContent = `${seal}\n${fullContent}`;
  }
  if (check.unverifiable.length > 0) {
    fullContent = `${fullContent}\n${buildStrategyVerificationNote(check.verifiedCount, check.unverifiable, language)}`;
  }
  return {
    ...strategic,
    kpiDashboard,
    breakEvenAnalysis: r.breakEvenAnalysis,
    projectedCashFlow: r.projectedCashFlow,
    strategicRecommendations: r.strategicRecommendations,
    fullContent,
    // El JSON que acompaña al texto es el derivado (el Editor Jefe HTML y el
    // Excel lo leen de la versión persistida).
    json: derived.json,
  };
}

// ---------------------------------------------------------------------------
// Parte III
// ---------------------------------------------------------------------------

/** Sello de la Parte III cuando su veredicto no es limpio y ningún cruce del servidor lo explica. */
function governanceGenericSeal(motivos: readonly string[], language: 'es' | 'en'): string {
  const en = language === 'en';
  return [
    en ? '> ## PART III WITH QUALIFICATIONS' : '> ## PARTE III CON SALVEDADES',
    '>',
    en
      ? '> The notes or the minutes carry qualifications that block their issuance. This section is NOT signable as issued:'
      : '> Las notas o el acta tienen salvedades que bloquean su emisión. Esta sección NO es firmable tal como está:',
    '>',
    ...motivos.map((m) => `> - ${m}`),
    '',
  ].join('\n');
}

export function renderGovernancePart(
  governance: GovernanceResult,
  checks: ServerPartChecks,
): GovernanceResult {
  const language = checks.sources.language ?? 'es';
  const parsed = GovernanceReportSchema.safeParse(governance.json);
  if (!parsed.success) {
    if (isBlankPart(governance)) return governance;
    const seal = unverifiableSeal('III', missingGovernanceJsonMotivo(language), language);
    return { ...governance, financialNotes: '', shareholderMinutes: seal, fullContent: seal };
  }
  const acta: ServerActaChecks | null = checks.acta;
  const r = renderGovernanceResult(parsed.data, checks.sources.company, acta?.capitalizationApplies ?? null);
  const out: GovernanceResult = {
    ...governance,
    financialNotes: r.financialNotes,
    shareholderMinutes: r.shareholderMinutes,
    fullContent: r.fullContent,
    // El JSON que acompaña al texto es el del render: sin la opinión que el
    // modelo anticipe para el Revisor Fiscal y con los firmantes del intake
    // (procedencia-R2-04). El Editor Jefe HTML y el Excel lo leen de la
    // versión persistida.
    ...(r.json ? { json: r.json } : {}),
  };
  // Orden de la fase: aviso de degradación (runGovernanceSpecialist), sello
  // aritmético y sello de prosa (runGovernancePhase).
  if (governance.degraded === true) {
    const notice = governanceDegradationNotice(language);
    out.financialNotes = `${notice}\n${out.financialNotes}`;
    out.shareholderMinutes = `${notice}\n${out.shareholderMinutes}`;
    out.fullContent = `${notice}\n${out.fullContent}`;
  }
  let sealed = false;
  if (acta && acta.arithmetic.motivos.length > 0) {
    const seal = actaArithmeticSeal(acta.arithmetic.motivos, acta.arithmetic.anchored, language);
    out.shareholderMinutes = `${seal}\n${out.shareholderMinutes}`;
    out.fullContent = `${seal}\n${out.fullContent}`;
    sealed = true;
  }
  if (acta?.narrative && acta.narrative.motivos.length > 0) {
    sealGovernanceNarrative(out, acta.narrative, language);
    sealed = true;
  }
  // El veredicto lo fija `applyServerPartVerdicts` (sealGovernanceNarrative lo
  // toca como efecto): se restituye el endurecido.
  out.actaQualifications = governance.actaQualifications;
  const verdict = governance.actaQualifications;
  // La identidad (I5-2) lleva su propio sello; el genérico sólo lista las
  // demás salvedades que ningún cruce del servidor explica.
  const identity = checks.identity?.governance ?? [];
  const otherMotivos = (Array.isArray(verdict?.motivos) ? verdict.motivos : []).filter((m) => !identity.includes(m));
  if (!sealed && verdict?.clean === false && (otherMotivos.length > 0 || identity.length === 0)) {
    const seal = governanceGenericSeal(otherMotivos, language);
    out.shareholderMinutes = `${seal}\n${out.shareholderMinutes}`;
    out.fullContent = `${seal}\n${out.fullContent}`;
  }
  if (identity.length > 0) {
    const seal = identitySeal('III', identity, language);
    out.shareholderMinutes = `${seal}\n${out.shareholderMinutes}`;
    out.fullContent = `${seal}\n${out.fullContent}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Informe completo
// ---------------------------------------------------------------------------

/**
 * Informe con los veredictos del servidor (`applyServerPartVerdicts`) y el
 * Markdown de las Partes I–III re-renderizado desde su JSON: el texto que
 * llegó del navegador se descarta. Lo usan /consolidate antes de consolidar y
 * persistir, y /export (por referencia y sin ella) antes del gate y de
 * componer el PDF/Excel. No reescribe `consolidatedReport`: ver
 * `withServerPartsInConsolidated` / `buildServerConsolidatedReport`.
 */
export function withServerRenderedParts(
  input: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en' = 'es',
): FinancialReport {
  if (!input?.niifAnalysis || !input.strategicAnalysis || !input.governance) return input;
  // Cada Parte conserva sólo sus claves conocidas (las mismas que
  // `parseReportParts` admite en /consolidate): un campo extra del cuerpo de
  // /export sin referencia —p. ej. un `governance.adjustmentsLedger` que el PDF
  // imprimiría como tabla de ajustes— no viaja con el texto re-renderizado.
  const report: FinancialReport = {
    ...input,
    niifAnalysis: knownKeys(input.niifAnalysis, NIIF_PART_KEYS),
    strategicAnalysis: knownKeys(input.strategicAnalysis, STRATEGY_PART_KEYS),
    governance: knownKeys(input.governance, GOVERNANCE_PART_KEYS),
  };
  const checks = serverPartChecks(report, preprocessed, language);
  const verified = applyServerPartVerdicts(report, checks);
  const niif = tryRender('I', verified.niifAnalysis, language, () =>
    renderNiifPart(verified.niifAnalysis, checks.niif, language),
  );
  const strategy = tryRender('II', verified.strategicAnalysis, language, () =>
    renderStrategyPart(verified.strategicAnalysis, checks),
  );
  const governance = tryRender('III', verified.governance, language, () =>
    renderGovernancePart(verified.governance, checks),
  );
  if (!niif.failure && !strategy.failure && !governance.failure) {
    return { ...verified, niifAnalysis: niif.part, strategicAnalysis: strategy.part, governance: governance.part };
  }
  // Una Parte que no se pudo producir no sale con el texto del cliente ni
  // "limpia": su veredicto y la reconciliación NIIF quedan en `clean: false`.
  const strategicAnalysis: StrategicAnalysisResult = strategy.failure
    ? {
        ...strategy.part,
        strategyQualifications: {
          clean: false,
          motivos: [...qualifiedMotivos(readStrategyQualifications(strategy.part)), strategy.failure],
          noVerificables: readStrategyQualifications(strategy.part)?.noVerificables ?? [],
        },
      }
    : strategy.part;
  const governancePart: GovernanceResult = governance.failure
    ? {
        ...governance.part,
        actaQualifications: {
          clean: false,
          motivos: [...qualifiedMotivos(governance.part.actaQualifications), governance.failure],
        },
      }
    : governance.part;
  const rec = niif.part.reconciliation;
  return {
    ...verified,
    niifAnalysis: {
      ...niif.part,
      reconciliation: {
        ...rec,
        deviations: rec?.deviations ?? [],
        lineGaps: rec?.lineGaps ?? [],
        repairAttempted: rec?.repairAttempted ?? false,
        clean: false,
      },
    },
    strategicAnalysis,
    governance: governancePart,
  };
}

const NIIF_PART_KEYS = [
  'balanceSheet',
  'incomeStatement',
  'cashFlowStatement',
  'equityChangesStatement',
  'technicalNotes',
  'fullContent',
  'json',
  'reconciliation',
] as const satisfies readonly (keyof NiifAnalysisResult)[];
const STRATEGY_PART_KEYS = [
  'kpiDashboard',
  'breakEvenAnalysis',
  'projectedCashFlow',
  'strategicRecommendations',
  'fullContent',
  'json',
  'strategyQualifications',
  'degraded',
] as const satisfies readonly (keyof StrategicAnalysisResult)[];
const GOVERNANCE_PART_KEYS = [
  'financialNotes',
  'shareholderMinutes',
  'fullContent',
  'json',
  'actaQualifications',
  'degraded',
] as const satisfies readonly (keyof GovernanceResult)[];

function knownKeys<T extends object>(part: T, keys: readonly (keyof T)[]): T {
  const out: Partial<T> = {};
  for (const k of keys) if (part[k] !== undefined) out[k] = part[k];
  return out as T;
}

function qualifiedMotivos(q: { clean?: boolean; motivos?: unknown } | null | undefined): string[] {
  return q?.clean === false && Array.isArray(q.motivos) ? q.motivos.filter((m): m is string => typeof m === 'string') : [];
}

/**
 * Render de una Parte con JSON válido. Si aun así fallara, la Parte se
 * sustituye por el sello (nunca por el texto del cliente) y se informa el
 * motivo para sellar su veredicto.
 */
function tryRender<T extends { fullContent: string }>(
  part: 'I' | 'II' | 'III',
  current: T,
  language: 'es' | 'en',
  render: () => T,
): { part: T; failure: string | null } {
  try {
    return { part: render(), failure: null };
  } catch (err) {
    console.warn(
      `[reports/part-markdown] no se pudo re-renderizar la Parte ${part}:`,
      err instanceof Error ? err.message : 'unknown',
    );
    const failure =
      language === 'en'
        ? `Part ${part}: the server could not render its text from the structured figures.`
        : `Parte ${part}: el servidor no pudo producir su texto desde las cifras estructuradas.`;
    const seal = unverifiableSeal(part, failure, language);
    const blanked: Record<string, unknown> = { ...current };
    for (const key of PART_MARKDOWN_KEYS[part]) blanked[key] = '';
    blanked[PART_SEAL_KEY[part]] = seal;
    blanked.fullContent = seal;
    return { part: blanked as T, failure };
  }
}

/** Campos Markdown de cada Parte (lo que imprimen el PDF, el Excel y el consolidado). */
const PART_MARKDOWN_KEYS = {
  I: ['balanceSheet', 'incomeStatement', 'cashFlowStatement', 'equityChangesStatement', 'technicalNotes'],
  II: ['kpiDashboard', 'breakEvenAnalysis', 'projectedCashFlow', 'strategicRecommendations'],
  III: ['financialNotes', 'shareholderMinutes'],
} as const;

/** Sección que lleva el sello además de `fullContent` (misma regla que las fases). */
const PART_SEAL_KEY = { I: 'balanceSheet', II: 'kpiDashboard', III: 'shareholderMinutes' } as const;

// ---------------------------------------------------------------------------
// Consolidado
// ---------------------------------------------------------------------------

const PART_I_HEADING_RE = /^# PARTE I: ESTADOS FINANCIEROS NIIF$/m;
const LEGAL_NOTE_RE = /^> \*\*Nota Legal:\*\*.*$/gm;

/** Segmento "# PARTE I … nota legal" del consolidado para el texto de cada Parte. */
function consolidatedPartsSegment(report: FinancialReport, language: 'es' | 'en'): string {
  const full = buildConsolidatedReportMarkdown(
    report.company,
    report.niifAnalysis.fullContent,
    report.strategicAnalysis.fullContent,
    report.governance.fullContent,
    language,
    new Date(0),
  );
  const start = full.search(PART_I_HEADING_RE);
  return full.slice(start);
}

/**
 * Sustituye, dentro de un consolidado ensamblado por el servidor (la versión
 * persistida), el segmento de las Partes I–III —desde "# PARTE I" hasta la
 * nota legal— por el que resulta del Markdown re-renderizado. Encabezado,
 * sello BORRADOR y traza de ajustes (texto del servidor) se conservan. `null`
 * si el consolidado no tiene esa estructura.
 */
export function withServerPartsInConsolidated(
  consolidated: string,
  report: FinancialReport,
  language: 'es' | 'en',
): string | null {
  if (typeof consolidated !== 'string') return null;
  const start = consolidated.search(PART_I_HEADING_RE);
  if (start < 0) return null;
  let legal: RegExpExecArray | null = null;
  LEGAL_NOTE_RE.lastIndex = 0;
  for (let m = LEGAL_NOTE_RE.exec(consolidated); m; m = LEGAL_NOTE_RE.exec(consolidated)) legal = m;
  if (!legal || legal.index < start) return null;
  let end = legal.index + legal[0].length;
  if (consolidated[end] === '\n') end += 1;
  return consolidated.slice(0, start) + consolidatedPartsSegment(report, language) + consolidated.slice(end);
}

/**
 * Versión PERSISTIDA con el Markdown de las Partes re-renderizado desde su JSON
 * (`withServerRenderedParts`), el segmento de las Partes de su consolidado
 * sustituido (encabezado, BORRADOR y traza de ajustes del servidor se
 * conservan) y el gate de texto de /consolidate (validación post-render y
 * V8/V9/V10/V15) recalculado sobre ese texto: una versión persistida antes de
 * I3 pudo pasar esos gates con el texto del navegador. Lo usan /export y /html
 * por referencia. Si el consolidado persistido no tiene la estructura
 * esperada, se usa el que reconstruye el servidor (nunca el texto guardado).
 */
export function withServerRenderedPersisted(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en',
): FinancialReport {
  const rendered = withServerRenderedParts(report, preprocessed, language);
  if (rendered === report) return report;
  const gate = buildServerConsolidatedReport({
    report: rendered,
    preprocessed,
    language,
    clientConsolidated: report.consolidatedReport,
  });
  const consolidated = withServerPartsInConsolidated(report.consolidatedReport, rendered, language);
  return {
    ...rendered,
    consolidatedReport: consolidated ?? gate.consolidatedReport,
    ...foldServerEmittability(rendered, gate, preprocessed),
  };
}

/** Fuentes re-derivadas en el servidor para reconstruir el texto de un informe recibido. */
export interface ServerReportTextSource {
  preprocessed: PreprocessedBalance | null | undefined;
  /** Ajustes confirmados aplicados y su detalle (traza de ajustes del consolidado). */
  adjustments?: { applied: Adjustment[]; affected: ReturnType<typeof applyAdjustments>['affected'] } | null;
  /** `rawData` efectivo de la petición (metadata del archivo para el gate), si lo trae. */
  rawData?: string | null;
}

/**
 * Informe RECIBIDO de un cliente (sin versión persistida) con el texto que
 * produce el servidor: Partes I–III re-renderizadas desde su JSON
 * (`withServerRenderedParts`) y consolidado reconstruido entero con la misma
 * función que /consolidate (`buildServerConsolidatedReport`, con la traza de
 * ajustes del ledger de la petición); su validación y emitibilidad se pliegan
 * sobre las recibidas (sólo endurecen). Lo usan /export sin referencia y las
 * Partes IV/V (/api/financial-audit, /api/financial-quality,
 * /api/fiscal-audit-opinion), cuyos LLM leen `consolidatedReport` (I5-1).
 * `null` si el informe no trae las tres Partes: su texto no puede producirse
 * en el servidor.
 */
export function withServerRenderedClientReport(
  input: FinancialReport,
  source: ServerReportTextSource,
  language: 'es' | 'en',
): FinancialReport | null {
  if (!input?.niifAnalysis || !input.strategicAnalysis || !input.governance) return null;
  const report = withServerSidecars(input, source);
  const rendered = withServerRenderedParts(report, source.preprocessed, language);
  const rebuilt = buildServerConsolidatedReport({
    report: rendered,
    preprocessed: source.preprocessed,
    language,
    clientConsolidated: report.consolidatedReport,
    adjustmentsSection: source.adjustments
      ? buildAdjustmentsAuditSection(source.adjustments.applied, source.adjustments.affected, language)
      : null,
    rawData: source.rawData,
  });
  // El gate de emisión (V1–V15) y la validación post-render corren sobre el
  // texto reconstruido, como en /consolidate: una emitibilidad "limpia" que
  // el cliente declaró para OTRO texto no levanta los bloqueantes del que se
  // usa (revisión I3).
  return {
    ...rendered,
    consolidatedReport: rebuilt.consolidatedReport,
    // I5-4: un informe recibido pliega TODOS los bloqueantes del gate
    // recalculado sobre el balance re-derivado (V1–V15), no sólo los de texto.
    ...foldServerEmittability(report, rebuilt, source.preprocessed, {
      scope: 'all',
      hasRawData: typeof source.rawData === 'string' && source.rawData.trim().length > 0,
    }),
  };
}

/**
 * Campos del informe que no son Partes y que el cliente reenvía (I5-4):
 *   - `fiscalSnapshot` y `ancora` se recalculan desde el balance re-derivado
 *     con la misma función que /niif y /consolidate (`deriveReportSidecars`);
 *     sin balance no se conservan los del cuerpo;
 *   - `generatedAt` inválido o futuro (fecha del encabezado del consolidado)
 *     se sustituye por la hora del servidor.
 * `company` se cruza con el JSON NIIF en el gate (`identityBlockers`) y la
 * identidad de las Partes II/III en `serverPartChecks` (I5-2).
 */
function withServerSidecars(report: FinancialReport, source: ServerReportTextSource): FinancialReport {
  const { fiscalSnapshot: _clientSnapshot, ancora: _clientAncora, ...rest } = report;
  void _clientSnapshot;
  void _clientAncora;
  const now = new Date();
  const generated = new Date(typeof report.generatedAt === 'string' ? report.generatedAt : NaN);
  const generatedAt =
    Number.isNaN(generated.getTime()) || generated.getTime() > now.getTime() ? now.toISOString() : report.generatedAt;
  if (!source.preprocessed?.primary) return { ...rest, generatedAt };
  const sidecars = deriveReportSidecars({
    preprocessed: source.preprocessed,
    company: report.company,
    rawData: source.rawData ?? null,
    hoy: now,
  });
  const ancora = ancoraOrNull(sidecars.ancora);
  return {
    ...rest,
    generatedAt,
    ...(sidecars.fiscalSnapshot ? { fiscalSnapshot: sidecars.fiscalSnapshot } : {}),
    ...(ancora ? { ancora } : {}),
  };
}

/** Razón declarada en el sello BORRADOR de un consolidado (texto del usuario). */
export function provisionalReasonOf(consolidated: unknown): string {
  if (typeof consolidated !== 'string') return '';
  const m = /^> (?:Razon declarada|User-stated reason): "(.*)"$/m.exec(consolidated);
  return m ? m[1] : '';
}

/**
 * Consolidado de una exportación SIN referencia persistida: el del cuerpo es
 * texto del cliente (encabezado, Partes, sello BORRADOR y traza de ajustes),
 * así que se reconstruye entero con la misma función que /consolidate
 * (`consolidateSplitReport`) sobre las Partes re-renderizadas. El sello
 * BORRADOR se conserva si el recibido lo traía (sólo puede añadir la
 * aclaración) y la traza de ajustes la calcula el servidor desde el ledger de
 * la petición. Devuelve también la validación post-render y la emitibilidad
 * de ESE texto (gates V1–V15 de /consolidate): el llamador las pliega sobre
 * las recibidas.
 */
export function buildServerConsolidatedReport(input: {
  report: FinancialReport;
  preprocessed: PreprocessedBalance | null | undefined;
  language: 'es' | 'en';
  clientConsolidated: unknown;
  adjustmentsSection?: string | null;
  /** `rawData` de la petición (metadata del archivo para el gate), si la trae. */
  rawData?: string | null;
}): SplitConsolidationResult {
  const { report, language } = input;
  const generatedAt = new Date(typeof report.generatedAt === 'string' ? report.generatedAt : NaN);
  const draft = isProvisionalDraft({ consolidatedReport: input.clientConsolidated });
  const result = consolidateSplitReport({
    company: report.company,
    preprocessed: input.preprocessed ?? undefined,
    rawData: typeof input.rawData === 'string' ? input.rawData : '',
    niifContent: report.niifAnalysis.fullContent,
    strategyContent: report.strategicAnalysis.fullContent,
    governanceContent: report.governance.fullContent,
    language,
    now: Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt,
    provisional: draft ? { active: true, reason: provisionalReasonOf(input.clientConsolidated) } : null,
  });
  return {
    ...result,
    consolidatedReport: input.adjustmentsSection
      ? `${result.consolidatedReport}\n\n${input.adjustmentsSection}`
      : result.consolidatedReport,
  };
}

/**
 * Bloqueantes del gate de emisión que dependen del TEXTO del informe (IFRS 18,
 * reserva legal SAS, TTD, declaración §3.14/§10.21). Son los que cambian al
 * sustituir el Markdown recibido por el re-render; el resto (ecuación,
 * identidad del archivo, DV del NIT, libros no cerrados…) depende del balance
 * y de la empresa, no del texto.
 */
const TEXT_GATE_CODES = new Set(['V8', 'V9', 'V10', 'V15']);

/**
 * Bloqueantes que dependen de la identidad leída del ARCHIVO del balance
 * (`rawData`): V5 (razón social y NIT extraídos del encabezado) y V6 (DV del
 * NIT del archivo). Sin `rawData` en la petición el gate no puede evaluarlos
 * (los daría por ausentes): no se pliegan.
 */
const FILE_IDENTITY_GATE_CODES = new Set(['V5', 'V6']);

export interface FoldEmittabilityOptions {
  /**
   * `'text'` (default; versión persistida, cuya emitibilidad calculó el
   * servidor en /consolidate): sólo V8/V9/V10/V15, que cambian con el
   * re-render. `'all'` (informe RECIBIDO de un cliente, I5-4): todos los
   * bloqueantes del gate recalculado sobre el balance re-derivado —V1–V7 y
   * V11–V14 además de los de texto—; V5/V6 sólo si hay `rawData`.
   */
  scope?: 'text' | 'all';
  /** La petición trae el `rawData` del que se re-derivó el balance. */
  hasRawData?: boolean;
}

/**
 * Validación y emitibilidad de una exportación SIN referencia, plegadas con
 * las del texto que el servidor acaba de reconstruir
 * (`buildServerConsolidatedReport`, el mismo gate que /consolidate). Las del
 * cliente se calcularon sobre SU texto —o simplemente se declararon—, así que:
 *   - la validación post-render del servidor sustituye a la recibida salvo que
 *     ésta ya sea negativa;
 *   - un bloqueante de texto (V8/V9/V10/V15) del servidor vuelve la
 *     emitibilidad `no-emitible`;
 *   - una emitibilidad `emittable` no lleva bloqueantes (así la produce el
 *     gate): los que declare el cliente no se imprimen en el anexo del PDF.
 * Sólo endurecen. Sin preprocesado el gate no corre (sólo diría "sin balance
 * verificado") y se conservan las recibidas, como antes.
 */
export function foldServerEmittability(
  report: FinancialReport,
  server: SplitConsolidationResult,
  preprocessed: PreprocessedBalance | null | undefined,
  options: FoldEmittabilityOptions = {},
): Pick<FinancialReport, 'validation' | 'emittability'> {
  const folds = (code: string): boolean =>
    options.scope === 'all'
      ? !FILE_IDENTITY_GATE_CODES.has(code) || options.hasRawData === true
      : TEXT_GATE_CODES.has(code);
  const client = report.emittability;
  const sanitized =
    client?.kind === 'emittable' ? { ...client, blockers: [], suggestedAdjustments: [] } : client;
  if (!preprocessed?.primary) {
    return {
      ...(report.validation ? { validation: report.validation } : {}),
      ...(sanitized ? { emittability: sanitized } : {}),
    };
  }
  const validation = report.validation?.ok === false ? report.validation : server.validation;
  const received = client?.kind === 'no-emitible' ? client.blockers : [];
  const seen = new Set(received.map((b) => `${b.code}\u0000${b.message}`));
  const textBlockers = server.emittability.blockers.filter(
    (b) => folds(b.code) && !seen.has(`${b.code}\u0000${b.message}`),
  );
  if (textBlockers.length === 0) return { validation, ...(sanitized ? { emittability: sanitized } : {}) };
  return {
    validation,
    emittability: {
      kind: 'no-emitible',
      blockers: [...received, ...textBlockers],
      suggestedAdjustments: client?.kind === 'no-emitible' ? client.suggestedAdjustments : [],
    },
  };
}
