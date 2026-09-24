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
  governanceDegradationNotice,
  renderGovernanceResult,
} from '@/lib/agents/financial/agents/governance-specialist';
import { sellarConSalvedades } from '@/lib/agents/financial/orchestrator';
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
  const r = toNiifAnalysisResult(json);
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
  if (verdict && !verdict.clean) {
    const seal = buildStrategyQualificationSeal(verdict.motivos, language);
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

/** Sello aritmético del acta: mismo texto que `runGovernancePhase`. */
function actaArithmeticSeal(motivos: readonly string[], anchored: boolean, language: 'es' | 'en'): string {
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
  if (!sealed && verdict?.clean === false) {
    const seal = governanceGenericSeal(Array.isArray(verdict.motivos) ? verdict.motivos : [], language);
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
): Pick<FinancialReport, 'validation' | 'emittability'> {
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
  const textBlockers = server.emittability.blockers.filter((b) => TEXT_GATE_CODES.has(b.code));
  if (textBlockers.length === 0) return { validation, ...(sanitized ? { emittability: sanitized } : {}) };
  return {
    validation,
    emittability: {
      kind: 'no-emitible',
      blockers: [...(client?.kind === 'no-emitible' ? client.blockers : []), ...textBlockers],
      suggestedAdjustments: client?.kind === 'no-emitible' ? client.suggestedAdjustments : [],
    },
  };
}
