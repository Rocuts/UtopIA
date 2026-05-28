// ---------------------------------------------------------------------------
// Capa 4 — Agente Fiscal — Orchestrator
// ---------------------------------------------------------------------------
//
// Decide qué módulos ejecutar según `FiscalAgentMode` y los corre con la
// concurrencia adecuada:
//
//   - Módulo 1 (CCV) y 3 (Risk Score) son INDEPENDIENTES — paralelo.
//   - Módulo 2 (Conciliación), 4 (Planeación), 6 (Devoluciones) son
//     INDEPENDIENTES entre sí y dependen solo del Âncora — paralelo.
//   - Módulo 5 (Defensa DIAN) es INDEPENDIENTE — paralelo.
//   - Módulo 8 (Supervivencia) consume el Risk Score — usa sus inputs
//     directos (no necesita esperar al Risk Score LLM porque también lee el
//     breakdown determinístico), por lo que también va en paralelo.
//   - Sintetizador es SECUENCIAL — necesita todos los resultados anteriores.
//
// Resiliencia: usa `Promise.allSettled` — si un módulo falla, marca
// `metadata.partial = true` y sigue. El sintetizador trabaja con lo que tenga.
// ---------------------------------------------------------------------------

import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { UVT_2026_COP } from '@/lib/accounting/tax-engine/constants';
import { buildFiscalAnchor } from '../fiscal-anchor';
import type { FiscalAnchorBlock } from '../fiscal-anchor/types';
import { runCcvFiscalAgent } from './agents/ccv-fiscal.agent';
import { runConciliacionAgent } from './agents/conciliacion.agent';
import { runRiskScoreAgent } from './agents/risk-score.agent';
import { runPlaneacionAgent } from './agents/planeacion.agent';
import { runDefensaDianAgent } from './agents/defensa-dian.agent';
import { runDevolucionesAgent } from './agents/devoluciones.agent';
import { runSupervivenciaAgent } from './agents/supervivencia.agent';
import { runSynthesizer } from './agents/synthesizer.agent';
import type {
  CcvModuleResult,
  ConciliacionModuleResult,
  DefensaDianModuleResult,
  DevolucionesModuleResult,
  FiscalAgentInput,
  FiscalAgentMode,
  FiscalAgentOrchestratorCallbacks,
  FiscalAgentOrchestratorInput,
  FiscalAgentReport,
  FiscalAgentStage,
  PlaneacionModuleResult,
  RiskScoreModuleResult,
  SupervivenciaModuleResult,
} from './types';

// ---------------------------------------------------------------------------
// Selección de módulos por modo
// ---------------------------------------------------------------------------

interface ModulesToRun {
  ccv: boolean;
  conciliacion: boolean;
  riskScore: boolean;
  planeacion: boolean;
  defensaDian: boolean;
  devoluciones: boolean;
  supervivencia: boolean;
}

function selectModules(mode: FiscalAgentMode): ModulesToRun {
  switch (mode) {
    case 'quick':
      return {
        ccv: true,
        conciliacion: false,
        riskScore: true,
        planeacion: false,
        defensaDian: false,
        devoluciones: false,
        supervivencia: false,
      };
    case 'full':
      return {
        ccv: true,
        conciliacion: true,
        riskScore: true,
        planeacion: true,
        defensaDian: false,
        devoluciones: true,
        supervivencia: false,
      };
    case 'supervivencia':
      return {
        ccv: true,
        conciliacion: false,
        riskScore: true,
        planeacion: false,
        defensaDian: false,
        devoluciones: false,
        supervivencia: true,
      };
    case 'defensa_dian':
      return {
        ccv: true,
        conciliacion: false,
        riskScore: true,
        planeacion: false,
        defensaDian: true,
        devoluciones: false,
        supervivencia: false,
      };
    case 'devolucion':
      return {
        ccv: true,
        conciliacion: false,
        riskScore: false,
        planeacion: false,
        defensaDian: false,
        devoluciones: true,
        supervivencia: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers de ejecución resiliente
// ---------------------------------------------------------------------------

interface ModuleRunMeta {
  stage: FiscalAgentStage;
  ok: boolean;
  errorMessage?: string;
}

async function runOrSettle<T>(
  stage: FiscalAgentStage,
  enabled: boolean,
  fn: () => Promise<T>,
  callbacks: FiscalAgentOrchestratorCallbacks | undefined,
): Promise<{ value: T | null; meta: ModuleRunMeta }> {
  if (!enabled) {
    callbacks?.onProgress?.({ stage, status: 'skipped' });
    return { value: null, meta: { stage, ok: true } };
  }
  callbacks?.onProgress?.({ stage, status: 'started' });
  try {
    const value = await fn();
    callbacks?.onProgress?.({ stage, status: 'completed' });
    return { value, meta: { stage, ok: true } };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'unknown';
    callbacks?.onProgress?.({ stage, status: 'failed', message: errorMessage });
    return { value: null, meta: { stage, ok: false, errorMessage } };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator principal
// ---------------------------------------------------------------------------

export async function orchestrateFiscalAgent(
  inp: FiscalAgentOrchestratorInput,
  callbacks?: FiscalAgentOrchestratorCallbacks,
): Promise<FiscalAgentReport> {
  const startedAt = Date.now();
  const mode: FiscalAgentMode = inp.mode ?? 'full';
  const language = inp.language ?? 'es';
  const company = inp.company ?? {};

  // ── 1. Preprocesamiento ────────────────────────────────────────────────
  callbacks?.onProgress?.({ stage: 'preprocessing', status: 'started' });
  const preprocessed = inp.preprocessed ?? (() => {
    const rows = parseTrialBalanceCSV(inp.rawData);
    if (rows.length === 0) {
      throw new Error('No se pudieron parsear filas del balance de prueba.');
    }
    return preprocessTrialBalance(rows);
  })();
  const fiscalAnchor: FiscalAnchorBlock =
    inp.fiscalAnchor ??
    buildFiscalAnchor({
      preprocessed,
      company,
      hoy: new Date(),
      nitFromFile: company.nit ?? null,
    });
  callbacks?.onProgress?.({ stage: 'preprocessing', status: 'completed' });

  // ── 2. Input compartido ─────────────────────────────────────────────────
  const sharedInput: FiscalAgentInput = {
    preprocessed,
    fiscalAnchor,
    company,
    language,
    mode,
    instructions: inp.instructions,
    dianRequirementText: inp.dianRequirementText,
    dianRequirementKind: inp.dianRequirementKind,
  };

  const modules = selectModules(mode);

  // ── 3. Ejecución paralela de los 7 módulos LLM ──────────────────────────
  // Los módulos son INDEPENDIENTES — todos leen el Âncora precomputado.
  const [
    ccvR,
    conciliacionR,
    riskR,
    planeacionR,
    defensaR,
    devolucionesR,
    supervivenciaR,
  ] = await Promise.all([
    runOrSettle<CcvModuleResult>(
      'ccv',
      modules.ccv,
      () => runCcvFiscalAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<ConciliacionModuleResult>(
      'conciliacion',
      modules.conciliacion,
      () => runConciliacionAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<RiskScoreModuleResult>(
      'risk_score',
      modules.riskScore,
      () => runRiskScoreAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<PlaneacionModuleResult>(
      'planeacion',
      modules.planeacion,
      () => runPlaneacionAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<DefensaDianModuleResult>(
      'defensa_dian',
      modules.defensaDian,
      () => runDefensaDianAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<DevolucionesModuleResult>(
      'devoluciones',
      modules.devoluciones,
      () => runDevolucionesAgent({ input: sharedInput }),
      callbacks,
    ),
    runOrSettle<SupervivenciaModuleResult>(
      'supervivencia',
      modules.supervivencia,
      () => runSupervivenciaAgent({ input: sharedInput, forceActive: mode === 'supervivencia' }),
      callbacks,
    ),
  ]);

  // ── 4. Validación: CCV y RiskScore son obligatorios para sintetizar ────
  if (modules.ccv && !ccvR.value) {
    throw new Error(
      `Módulo 1 (CCV) falló y es obligatorio: ${ccvR.meta.errorMessage ?? 'sin detalle'}`,
    );
  }
  if (modules.riskScore && !riskR.value) {
    throw new Error(
      `Módulo 3 (Risk Score) falló y es obligatorio: ${riskR.meta.errorMessage ?? 'sin detalle'}`,
    );
  }

  // ── 5. Synthesis (secuencial — necesita los outputs anteriores) ────────
  callbacks?.onProgress?.({ stage: 'synthesis', status: 'started' });
  // Si CCV o RiskScore no se ejecutaron, sintetizamos con stubs vacíos para
  // no romper el shape — solo ocurre en modos donde uno de los dos está off
  // (devolucion no ejecuta risk_score). En esos modos el synthesis igual
  // tiene sentido sobre lo que sí se ejecutó.
  const ccvForSynth = ccvR.value;
  const riskForSynth = riskR.value;
  if (!ccvForSynth || !riskForSynth) {
    throw new Error(
      'No se puede sintetizar sin CCV ni RiskScore. Asegúrate de que el modo seleccionado los incluya.',
    );
  }
  const synthesis = await runSynthesizer({
    input: sharedInput,
    modules: {
      ccv: ccvForSynth,
      riskScore: riskForSynth,
      conciliacion: conciliacionR.value,
      planeacion: planeacionR.value,
      defensaDian: defensaR.value,
      devoluciones: devolucionesR.value,
      supervivencia: supervivenciaR.value,
    },
  });
  callbacks?.onProgress?.({ stage: 'synthesis', status: 'completed' });

  // ── 6. Metadata y respuesta final ──────────────────────────────────────
  const moduleMetas: ModuleRunMeta[] = [
    ccvR.meta,
    conciliacionR.meta,
    riskR.meta,
    planeacionR.meta,
    defensaR.meta,
    devolucionesR.meta,
    supervivenciaR.meta,
  ];
  const modulesRun = moduleMetas
    .filter((m) => m.ok && (m === ccvR.meta || m === riskR.meta || enabledFor(m.stage, modules)))
    .map((m) => m.stage);
  const modulesFailed = moduleMetas.filter((m) => !m.ok).map((m) => m.stage);
  const partial = modulesFailed.length > 0;

  return {
    ccv: ccvForSynth,
    conciliacion: conciliacionR.value,
    riskScore: riskForSynth,
    planeacion: planeacionR.value,
    defensaDian: defensaR.value,
    devoluciones: devolucionesR.value,
    supervivencia: supervivenciaR.value,
    synthesis,
    metadata: {
      mode,
      uvt: UVT_2026_COP,
      periodo: fiscalAnchor.fuente.periodo,
      nit: company.nit ?? fiscalAnchor.calendarioDian.nit ?? null,
      generatedAt: new Date().toISOString(),
      partial,
      durationMs: Date.now() - startedAt,
      modulesRun,
      modulesFailed,
    },
  };
}

function enabledFor(stage: FiscalAgentStage, modules: ModulesToRun): boolean {
  switch (stage) {
    case 'ccv':
      return modules.ccv;
    case 'conciliacion':
      return modules.conciliacion;
    case 'risk_score':
      return modules.riskScore;
    case 'planeacion':
      return modules.planeacion;
    case 'defensa_dian':
      return modules.defensaDian;
    case 'devoluciones':
      return modules.devoluciones;
    case 'supervivencia':
      return modules.supervivencia;
    case 'preprocessing':
    case 'synthesis':
    case 'validation':
      return true;
  }
}
