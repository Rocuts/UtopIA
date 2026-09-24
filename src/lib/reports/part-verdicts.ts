import type {
  CompanyInfo,
  FinancialReport,
  GovernanceResult,
  NiifAnalysisResult,
  StrategicAnalysisResult,
  StrategyQualifications,
} from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { buildActaExpectedArithmetic } from '@/lib/agents/financial/prompts/governance-specialist.prompt';
import {
  describeActaQualifications,
  reconcileActaArithmetic,
  type ActaArithmetic,
} from '@/lib/agents/financial/contracts/base';
import { parseMoneyCop } from '@/lib/agents/financial/contracts/money';
import { NiifReportSchema, type NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import { StrategyReportSchema, type StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import {
  GovernanceReportSchema,
  type GovernanceReportJson,
} from '@/lib/agents/financial/contracts/governance-report';
import {
  checkGovernanceNarrative,
  narrativeSourcesFromPreprocessed,
  type NarrativeCheckResult,
} from '@/lib/agents/financial/validators/narrative-anchors';
import {
  readStrategyQualifications,
  reconcileStrategyAnchors,
  strategyAnchorSources,
  type StrategyAnchorCheck,
} from '@/lib/agents/financial/validators/strategy-anchors';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import {
  checkCashFlowInvariants,
  formatCashFlowViolations,
} from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { buildNiifValidatorOptions } from '@/lib/agents/financial/orchestrator';
import { foldReportQualifications } from './fold-qualifications';

// ---------------------------------------------------------------------------
// Veredictos de las Partes II y III recalculados por el servidor
// ---------------------------------------------------------------------------
// /consolidate recibe las Partes II y III (con `strategyQualifications` y
// `actaQualifications`) del navegador, y /export y /html sin referencia
// reciben el informe entero del navegador. Un veredicto omitido o reescrito
// por el cliente no puede decidir la emisión: /export sólo mira los flags y la
// versión persistida sale sellada "procedencia verificada". Aquí se vuelven a
// calcular con las MISMAS funciones que las fases (`runStrategyPhase`,
// `runGovernancePhase`) sobre el balance re-derivado por el servidor:
//
//   - Parte III: la aritmética determinista del acta
//     (`buildActaExpectedArithmetic` + `reconcileActaArithmetic`) y las cifras
//     citadas en la prosa de las notas y del acta (`checkGovernanceNarrative`
//     contra el balance, el JSON NIIF y esa misma aritmética; P3).
//   - Parte II: `reconcileStrategyAnchors` (dashboard, KPIs, DuPont, gate de
//     liquidez y la prosa, que el validador de P3 cruza dentro).
//
// El resultado sólo puede ENDURECER el veredicto del cliente, nunca levantarlo:
// un `clean: false` recibido se conserva con sus motivos.
// ---------------------------------------------------------------------------

export interface PartVerdict {
  clean: boolean;
  motivos: string[];
}

/** Alias histórico (P1): el veredicto del acta. */
export type ActaVerdict = PartVerdict;

export interface ServerVerdictSources {
  /** Empresa del informe: tipo societario y estatutos fijan la reserva legal. */
  company: CompanyInfo;
  /** Balance re-derivado por el servidor (o el de la versión persistida). */
  preprocessed: PreprocessedBalance | null | undefined;
  /** JSON NIIF del mismo informe (anclas de respaldo de la prosa). */
  niifJson?: unknown;
  language?: 'es' | 'en';
}

type ActaJson = NonNullable<GovernanceReportJson['shareholderMinutes']>;

const NARRATIVE_UNVERIFIABLE =
  'Parte III — la prosa de las notas y del acta no pudo cruzarse con el balance (estructura ilegible): ' +
  'sus cifras no tienen respaldo verificable.';

function isMoney(v: unknown): v is string {
  return typeof v === 'string' && /^-?\d+$/.test(v);
}

function parseNiif(json: unknown): NiifReportJson | null {
  const parsed = NiifReportSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Aritmética del acta (P1): contra el balance, o sin él, destinación sin ancla. */
function actaArithmeticMotivos(acta: ActaJson, expected: ActaArithmetic | null): string[] {
  if (expected) {
    const devs = reconcileActaArithmetic(
      {
        netIncomeCop: acta.resultDistribution?.netIncomeCop ?? null,
        distributionApplies: acta.resultDistribution?.applies ?? false,
        distributionLines: (acta.resultDistribution?.lines ?? []).map((l) => ({
          label: l.label,
          amountCop: l.amountCop,
        })),
        capitalizationApplies: acta.capitalizationProposal?.applies ?? false,
        capitalizationBaseCop: acta.capitalizationProposal?.retainedEarningsBaseCop ?? null,
        capitalizationAmountCop: acta.capitalizationProposal?.capitalizationAmountCop ?? null,
      },
      expected,
    );
    return devs.length > 0 ? describeActaQualifications(devs) : [];
  }
  // Sin aritmética esperada (sin balance preprocesado): una destinación o una
  // capitalización con monto no tiene ancla (pipeline-flujo-03, mismo criterio
  // que la fase de Gobierno).
  const nonZero = (v: unknown) => isMoney(v) && parseMoneyCop(v) !== BigInt(0);
  const distributes =
    acta.resultDistribution?.applies === true ||
    (acta.resultDistribution?.lines ?? []).some((l) => nonZero(l.amountCop));
  const capitalizes =
    acta.capitalizationProposal?.applies === true ||
    nonZero(acta.capitalizationProposal?.capitalizationAmountCop);
  return distributes || capitalizes
    ? [
        'Acta — propone destinación de utilidades o capitalización sin el balance preprocesado: ' +
          'sus cifras no pueden reconciliarse con la aritmética determinista.',
      ]
    : [];
}

/** Componentes del cruce de la Parte III (el sello del Markdown los reproduce por separado). */
export interface ServerActaChecks {
  /**
   * Aritmética del acta: `anchored` cuando hubo balance (desviaciones contra
   * `buildActaExpectedArithmetic`); sin él, destinación o capitalización sin
   * ancla.
   */
  arithmetic: { anchored: boolean; motivos: string[] };
  /** Cifras citadas en la prosa de notas y acta (`checkGovernanceNarrative`). */
  narrative: (NarrativeCheckResult & { notesFindings: number; actaFindings: number }) | null;
  /** Motivo cuando la estructura no se pudo cruzar (Parte III ilegible). */
  unreadable: string | null;
  /** `capitalizationApplies` de la aritmética esperada; `null` sin balance. */
  capitalizationApplies: boolean | null;
}

/**
 * Cruces de la Parte III según el servidor: aritmética del acta + cifras en la
 * prosa de notas y acta. `null` si la Parte III no trae JSON estructurado (no
 * hay cifras que cruzar; `withServerPartVerdicts` la sella aparte).
 */
export function serverActaChecks(
  governanceJson: unknown,
  sources: ServerVerdictSources,
): ServerActaChecks | null {
  if (!governanceJson || typeof governanceJson !== 'object' || Array.isArray(governanceJson)) return null;
  const json = governanceJson as GovernanceReportJson;
  const { company, preprocessed } = sources;
  const out: ServerActaChecks = {
    arithmetic: { anchored: false, motivos: [] },
    narrative: null,
    unreadable: null,
    capitalizationApplies: null,
  };
  try {
    // La MISMA aritmética que alimentó el prompt del Especialista de Gobierno.
    const expected = preprocessed ? buildActaExpectedArithmetic(company, preprocessed) : null;
    out.capitalizationApplies = expected ? expected.capitalizationApplies : null;
    out.arithmetic.anchored = expected !== null;
    const acta = json.shareholderMinutes as ActaJson | null | undefined;
    if (acta && typeof acta === 'object') out.arithmetic.motivos = actaArithmeticMotivos(acta, expected);
    out.narrative = checkGovernanceNarrative(
      json,
      narrativeSourcesFromPreprocessed(preprocessed, parseNiif(sources.niifJson), { acta: expected }),
      sources.language ?? 'es',
    );
  } catch (err) {
    // Una Parte III con forma ilegible no se declara limpia: sus cifras no se
    // pudieron cruzar.
    console.warn(
      '[reports/part-verdicts] no se pudo verificar la Parte III:',
      err instanceof Error ? err.message : 'unknown',
    );
    out.unreadable = NARRATIVE_UNVERIFIABLE;
  }
  return out;
}

/** Motivos del veredicto de la Parte III a partir de sus cruces. */
export function actaVerdictOf(checks: ServerActaChecks): PartVerdict {
  const motivos = Array.from(
    new Set([
      ...checks.arithmetic.motivos,
      ...(checks.narrative?.motivos ?? []),
      ...(checks.unreadable ? [checks.unreadable] : []),
    ]),
  );
  return { clean: motivos.length === 0, motivos };
}

/**
 * Veredicto de la Parte III según el servidor: aritmética del acta + cifras en
 * la prosa de notas y acta. `null` si la Parte III no trae JSON estructurado
 * (no hay cifras que cruzar).
 */
export function serverActaVerdict(
  governanceJson: unknown,
  sources: ServerVerdictSources,
): PartVerdict | null {
  const checks = serverActaChecks(governanceJson, sources);
  return checks ? actaVerdictOf(checks) : null;
}

/**
 * Cruce de la Parte II según el servidor (`reconcileStrategyAnchors`, que
 * incluye la prosa). `null` si la Parte II no trae un JSON válido.
 */
export function serverStrategyCheck(
  strategyJson: unknown,
  sources: ServerVerdictSources,
): (StrategyAnchorCheck & { json: StrategyReportJson }) | null {
  const parsed = StrategyReportSchema.safeParse(strategyJson);
  if (!parsed.success) return null;
  const check = reconcileStrategyAnchors(
    parsed.data,
    strategyAnchorSources(sources.preprocessed ?? undefined, parseNiif(sources.niifJson)),
    sources.language ?? 'es',
  );
  return { ...check, json: parsed.data };
}

/**
 * Veredicto de la Parte II según el servidor (`reconcileStrategyAnchors`, que
 * incluye la prosa). `null` si la Parte II no trae un JSON válido: el gate de
 * exportación tampoco puede cruzarla (`withServerPartVerdicts` la sella aparte).
 */
export function serverStrategyVerdict(
  strategyJson: unknown,
  sources: ServerVerdictSources,
): (PartVerdict & { noVerificables: string[] }) | null {
  const check = serverStrategyCheck(strategyJson, sources);
  if (!check) return null;
  return {
    clean: check.deviations.length === 0,
    motivos: check.deviations,
    noVerificables: check.unverifiable,
  };
}

/**
 * Parte III con el veredicto del servidor aplicado: un `clean: false` del
 * cliente se conserva (con sus motivos) y uno del servidor lo añade; un
 * `clean: true` del servidor sólo se escribe si el cliente no traía veredicto.
 */
export function withServerActaVerdict(
  governance: GovernanceResult,
  verdict: PartVerdict | null,
): GovernanceResult {
  if (!verdict) return governance;
  const client = governance.actaQualifications;
  if (verdict.clean) {
    return client ? governance : { ...governance, actaQualifications: { clean: true, motivos: [] } };
  }
  const clientMotivos = client?.clean === false && Array.isArray(client.motivos) ? client.motivos : [];
  return {
    ...governance,
    actaQualifications: {
      clean: false,
      motivos: Array.from(new Set([...clientMotivos, ...verdict.motivos])),
    },
  };
}

/** Parte II con el veredicto del servidor aplicado (misma regla que el acta). */
export function withServerStrategyVerdict(
  strategic: StrategicAnalysisResult,
  verdict: (PartVerdict & { noVerificables: string[] }) | null,
): StrategicAnalysisResult {
  if (!verdict) return strategic;
  const client = readStrategyQualifications(strategic);
  if (verdict.clean) {
    // El veredicto del cliente se conserva; lo no verificable es el del cruce.
    if (client) return { ...strategic, strategyQualifications: { ...client, noVerificables: verdict.noVerificables } };
    const clean: StrategyQualifications = { clean: true, motivos: [], noVerificables: verdict.noVerificables };
    return { ...strategic, strategyQualifications: clean };
  }
  const clientMotivos = client?.clean === false ? client.motivos : [];
  const qualifications: StrategyQualifications = {
    clean: false,
    motivos: Array.from(new Set([...clientMotivos, ...verdict.motivos])),
    // Lo no verificable lo declara el cruce del servidor (el render lo imprime
    // en el cuerpo de la Parte II): una lista del cliente no lo sustituye.
    noVerificables: verdict.noVerificables,
  };
  return { ...strategic, strategyQualifications: qualifications };
}

// ---------------------------------------------------------------------------
// Partes sin JSON estructurado válido (I3)
// ---------------------------------------------------------------------------
// El Markdown de cada Parte es una función determinista de su JSON; sin un
// JSON válido el texto recibido no tiene cifras estructuradas contra las
// cuales verificarse, así que la Parte se SELLA (antes se conservaba el
// veredicto limpio del cliente y el texto salía "procedencia verificada").
// ---------------------------------------------------------------------------

export function missingStrategyJsonMotivo(language: 'es' | 'en' = 'es'): string {
  return language === 'en'
    ? 'Part II carries no valid structured figures (strategy JSON missing or invalid): its text cannot be verified against the trial balance.'
    : 'La Parte II no trae cifras estructuradas válidas (JSON de Estrategia ausente o inválido): su texto no puede verificarse contra el balance.';
}

export function missingGovernanceJsonMotivo(language: 'es' | 'en' = 'es'): string {
  return language === 'en'
    ? 'Part III carries no valid structured figures (governance JSON missing or invalid): its notes and minutes cannot be verified against the trial balance.'
    : 'La Parte III no trae cifras estructuradas válidas (JSON de Gobierno ausente o inválido): sus notas y su acta no pueden verificarse contra el balance.';
}

/** `true` si el JSON de la Parte III cumple el contrato (`GovernanceReportSchema`). */
export function isValidGovernanceJson(json: unknown): json is GovernanceReportJson {
  return GovernanceReportSchema.safeParse(json).success;
}

/**
 * Veredicto de la Parte III con el endurecimiento de I3: los cruces del
 * servidor y, si el JSON falta o no cumple el contrato, el motivo que sella la
 * Parte (el render no puede reproducir su texto).
 */
function governanceVerdict(
  governance: GovernanceResult,
  checks: ServerActaChecks | null,
  language: 'es' | 'en',
): PartVerdict {
  const base = checks ? actaVerdictOf(checks) : { clean: true, motivos: [] as string[] };
  if (isValidGovernanceJson(governance.json)) return base;
  return { clean: false, motivos: Array.from(new Set([...base.motivos, missingGovernanceJsonMotivo(language)])) };
}

function strategyVerdict(
  check: (StrategyAnchorCheck & { json: StrategyReportJson }) | null,
  language: 'es' | 'en',
): PartVerdict & { noVerificables: string[] } {
  if (!check) return { clean: false, motivos: [missingStrategyJsonMotivo(language)], noVerificables: [] };
  return { clean: check.deviations.length === 0, motivos: check.deviations, noVerificables: check.unverifiable };
}

// ---------------------------------------------------------------------------
// Parte I: invariantes del JSON NIIF recalculados (mismo canal que la fase)
// ---------------------------------------------------------------------------

/** Errores del validador E1–E25 y de los invariantes del EFE sobre el JSON NIIF. */
export interface ServerNiifIntegrity {
  /** Errores del validador JSON (los que `runNiifPhase` sella). */
  jsonErrors: string[];
  /** Violaciones de las identidades del EFE (`checkCashFlowInvariants`). */
  efeViolations: string[];
}

/**
 * Los MISMOS cruces con que `runNiifPhase` sella la Parte I
 * (`validateNiifReportJson` con las anclas del balance y los invariantes del
 * EFE). `null` si la Parte I no trae un JSON válido.
 */
export function serverNiifIntegrity(
  niifJson: unknown,
  reconciliation: NiifAnalysisResult['reconciliation'],
  preprocessed: PreprocessedBalance | null | undefined,
): ServerNiifIntegrity | null {
  const json = parseNiif(niifJson);
  if (!json) return null;
  const validation = validateNiifReportJson(json, preprocessed ? buildNiifValidatorOptions(preprocessed) : {});
  // E18 repite el cruce del EFE que el analista ya declaró en su sello.
  const declared = new Set(reconciliation?.cashFlowDiscrepancies ?? []);
  const jsonErrors = validation.errors.filter(
    (e) => !(e.startsWith('E18. ') && declared.has(e.slice('E18. '.length))),
  );
  const efeViolations = json.cashFlow ? formatCashFlowViolations(checkCashFlowInvariants(json.cashFlow)) : [];
  return { jsonErrors, efeViolations };
}

/**
 * Reconciliación de la Parte I endurecida: `clean: true` sólo si el JSON es
 * válido, no hay desviaciones, brechas de desglose ni discrepancias del EFE
 * declaradas, y los invariantes recalculados no fallan.
 */
function hardenedReconciliation(
  niif: NiifAnalysisResult,
  integrity: ServerNiifIntegrity | null,
): NiifAnalysisResult['reconciliation'] {
  const rec = niif.reconciliation;
  const qualified =
    !integrity ||
    integrity.jsonErrors.length > 0 ||
    integrity.efeViolations.length > 0 ||
    (rec?.deviations?.length ?? 0) > 0 ||
    (rec?.lineGaps?.length ?? 0) > 0 ||
    (rec?.cashFlowDiscrepancies?.length ?? 0) > 0;
  if (!qualified) return rec;
  return {
    ...rec,
    deviations: rec?.deviations ?? [],
    lineGaps: rec?.lineGaps ?? [],
    repairAttempted: rec?.repairAttempted ?? false,
    clean: false,
  };
}

/** Cruces del servidor sobre las tres Partes (insumo del veredicto y del render). */
export interface ServerPartChecks {
  sources: ServerVerdictSources;
  niif: ServerNiifIntegrity | null;
  strategy: (StrategyAnchorCheck & { json: StrategyReportJson }) | null;
  acta: ServerActaChecks | null;
}

export function serverPartChecks(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en' = 'es',
): ServerPartChecks {
  const sources: ServerVerdictSources = {
    company: report.company,
    preprocessed,
    niifJson: report.niifAnalysis.json,
    language,
  };
  return {
    sources,
    niif: serverNiifIntegrity(report.niifAnalysis.json, report.niifAnalysis.reconciliation, preprocessed),
    strategy: serverStrategyCheck(report.strategicAnalysis.json, sources),
    acta: serverActaChecks(report.governance.json, sources),
  };
}

export interface ApplyVerdictOptions {
  /**
   * Sellar la Parte II/III sin JSON válido (default `true`): su texto vino del
   * navegador o de una versión persistida y no puede verificarse. Sólo el
   * pipeline completo de /export —cuyo Markdown lo acaba de producir el
   * servidor en la misma petición— lo desactiva.
   */
  sealUnstructuredParts?: boolean;
}

/** Aplica a las tres Partes los veredictos derivados de `checks` (sólo endurecen). */
export function applyServerPartVerdicts(
  report: FinancialReport,
  checks: ServerPartChecks,
  options: ApplyVerdictOptions = {},
): FinancialReport {
  const language = checks.sources.language ?? 'es';
  const seal = options.sealUnstructuredParts !== false;
  const governance = withServerActaVerdict(
    report.governance,
    seal ? governanceVerdict(report.governance, checks.acta, language) : checks.acta ? actaVerdictOf(checks.acta) : null,
  );
  const strategicAnalysis = withServerStrategyVerdict(
    report.strategicAnalysis,
    seal || checks.strategy ? strategyVerdict(checks.strategy, language) : null,
  );
  const niifAnalysis: NiifAnalysisResult = {
    ...report.niifAnalysis,
    reconciliation: hardenedReconciliation(report.niifAnalysis, checks.niif),
  };
  return {
    ...report,
    niifAnalysis: foldReportQualifications(niifAnalysis, strategicAnalysis, governance),
    strategicAnalysis,
    governance,
  };
}

/**
 * Informe con los veredictos de las tres Partes recalculados por el servidor
 * y plegados sobre la reconciliación NIIF (el canal que apaga las descargas en
 * la UI y que ve el gate de exportación): Parte I con los invariantes del JSON
 * NIIF, Parte II con anclas y prosa, Parte III con la aritmética y la prosa
 * del acta. Una Parte II/III sin JSON válido queda sellada (I3). Para además
 * sustituir el Markdown recibido por el render del servidor, ver
 * `withServerRenderedParts` (./part-markdown.ts), que usan /consolidate y
 * /export.
 */
export function withServerPartVerdicts(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en' = 'es',
  options: ApplyVerdictOptions = {},
): FinancialReport {
  if (!report?.niifAnalysis || !report.strategicAnalysis || !report.governance) return report;
  return applyServerPartVerdicts(report, serverPartChecks(report, preprocessed, language), options);
}
