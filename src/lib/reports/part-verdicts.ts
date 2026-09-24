import type {
  CompanyInfo,
  FinancialReport,
  GovernanceResult,
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
import { StrategyReportSchema } from '@/lib/agents/financial/contracts/strategy-report';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import {
  checkGovernanceNarrative,
  narrativeSourcesFromPreprocessed,
} from '@/lib/agents/financial/validators/narrative-anchors';
import {
  readStrategyQualifications,
  reconcileStrategyAnchors,
  strategyAnchorSources,
} from '@/lib/agents/financial/validators/strategy-anchors';
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

/**
 * Veredicto de la Parte III según el servidor: aritmética del acta + cifras en
 * la prosa de notas y acta. `null` si la Parte III no trae JSON estructurado
 * (no hay cifras que cruzar).
 */
export function serverActaVerdict(
  governanceJson: unknown,
  sources: ServerVerdictSources,
): PartVerdict | null {
  if (!governanceJson || typeof governanceJson !== 'object' || Array.isArray(governanceJson)) return null;
  const json = governanceJson as GovernanceReportJson;
  const { company, preprocessed } = sources;
  const motivos: string[] = [];
  try {
    // La MISMA aritmética que alimentó el prompt del Especialista de Gobierno.
    const expected = preprocessed ? buildActaExpectedArithmetic(company, preprocessed) : null;
    const acta = json.shareholderMinutes as ActaJson | null | undefined;
    if (acta && typeof acta === 'object') motivos.push(...actaArithmeticMotivos(acta, expected));
    const narrative = checkGovernanceNarrative(
      json,
      narrativeSourcesFromPreprocessed(preprocessed, parseNiif(sources.niifJson), { acta: expected }),
      sources.language ?? 'es',
    );
    motivos.push(...narrative.motivos);
  } catch (err) {
    // Una Parte III con forma ilegible no se declara limpia: sus cifras no se
    // pudieron cruzar.
    console.warn(
      '[reports/part-verdicts] no se pudo verificar la Parte III:',
      err instanceof Error ? err.message : 'unknown',
    );
    motivos.push(NARRATIVE_UNVERIFIABLE);
  }
  const unique = Array.from(new Set(motivos));
  return { clean: unique.length === 0, motivos: unique };
}

/**
 * Veredicto de la Parte II según el servidor (`reconcileStrategyAnchors`, que
 * incluye la prosa). `null` si la Parte II no trae un JSON válido: el gate de
 * exportación tampoco puede cruzarla y conserva el veredicto recibido.
 */
export function serverStrategyVerdict(
  strategyJson: unknown,
  sources: ServerVerdictSources,
): (PartVerdict & { noVerificables: string[] }) | null {
  const parsed = StrategyReportSchema.safeParse(strategyJson);
  if (!parsed.success) return null;
  const check = reconcileStrategyAnchors(
    parsed.data,
    strategyAnchorSources(sources.preprocessed ?? undefined, parseNiif(sources.niifJson)),
    sources.language ?? 'es',
  );
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
    if (client) return strategic;
    const clean: StrategyQualifications = { clean: true, motivos: [], noVerificables: verdict.noVerificables };
    return { ...strategic, strategyQualifications: clean };
  }
  const clientMotivos = client?.clean === false ? client.motivos : [];
  const qualifications: StrategyQualifications = {
    clean: false,
    motivos: Array.from(new Set([...clientMotivos, ...verdict.motivos])),
    noVerificables: client?.noVerificables.length ? client.noVerificables : verdict.noVerificables,
  };
  return { ...strategic, strategyQualifications: qualifications };
}

/**
 * Informe con los veredictos de las Partes II y III recalculados por el
 * servidor y plegados sobre la reconciliación NIIF (el canal que apaga las
 * descargas en la UI y que ve el gate de exportación). Lo usan /consolidate al
 * persistir la versión y /export antes del gate, con o sin referencia.
 */
export function withServerPartVerdicts(
  report: FinancialReport,
  preprocessed: PreprocessedBalance | null | undefined,
  language: 'es' | 'en' = 'es',
): FinancialReport {
  if (!report?.niifAnalysis || !report.strategicAnalysis || !report.governance) return report;
  const sources: ServerVerdictSources = {
    company: report.company,
    preprocessed,
    niifJson: report.niifAnalysis.json,
    language,
  };
  const governance = withServerActaVerdict(report.governance, serverActaVerdict(report.governance.json, sources));
  const strategicAnalysis = withServerStrategyVerdict(
    report.strategicAnalysis,
    serverStrategyVerdict(report.strategicAnalysis.json, sources),
  );
  return {
    ...report,
    niifAnalysis: foldReportQualifications(report.niifAnalysis, strategicAnalysis, governance),
    strategicAnalysis,
    governance,
  };
}
