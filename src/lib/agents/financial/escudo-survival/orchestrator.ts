// ---------------------------------------------------------------------------
// Modo Supervivencia Élite — Orchestrator
// ---------------------------------------------------------------------------
// Pipeline: rawData -> preprocessTrialBalance -> [5 agentes en paralelo] ->
// sintetizador -> EscudoSurvivalReport.
//
// Patron: Promise.allSettled. Si CUALQUIER agente falla, el reporte se entrega
// con `metadata.partial = true` y el resto de submodulos disponibles. NUNCA
// abortar todo el pipeline por una falla aislada — el dueño necesita ver lo
// que SI se pudo calcular.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import { MODELS, MODELS_CONFIG } from '@/lib/config/models';
import { callFinancialAgent } from '../agents/runtime';
import { runTetCalculator } from './agents/tet-calculator';
import { runRetentionShield } from './agents/retention-shield';
import { runAntiDianAuditor } from './agents/anti-dian-auditor';
import { runContingencyReserve } from './agents/contingency-reserve';
import { runDividendOptimizer } from './agents/dividend-optimizer';
import type {
  AntiDianResult,
  ContingencyReserveResult,
  DividendOptimizerResult,
  EscudoSurvivalProgressEvent,
  EscudoSurvivalProgressStage,
  EscudoSurvivalReport,
  Language,
  OrchestrateEscudoSurvivalCallbacks,
  OrchestrateEscudoSurvivalInput,
  RetentionShieldResult,
  SurvivalAgentInput,
  SynthesisResult,
  TetCalculatorResult,
} from './types';
import { UVT_2026 } from './types';

// ---------------------------------------------------------------------------
// Synthesizer schema — el LLM consolida los 5 resultados en topRecommendations
// ---------------------------------------------------------------------------

const synthesizerSchema = z.object({
  markdown: z.string().min(20),
  topRecommendations: z
    .array(
      z.object({
        orden: z.number().int().min(1),
        titulo: z.string().min(3),
        impacto: z.number(),
        norma: z.string().min(3),
      }),
    )
    .min(1)
    .max(5),
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function orchestrateEscudoSurvival(
  input: OrchestrateEscudoSurvivalInput,
  callbacks: OrchestrateEscudoSurvivalCallbacks = {},
): Promise<EscudoSurvivalReport> {
  const startTime = Date.now();
  const language: Language = input.language ?? 'es';
  const company = input.company ?? {};
  const onProgress = callbacks.onProgress;

  // -------------------------------------------------------------------------
  // Stage 0: Preprocessing (deterministico)
  // -------------------------------------------------------------------------
  emit(onProgress, 'preprocessing', 'started');
  let preprocessed: PreprocessedBalance;
  try {
    const rows = parseTrialBalanceCSV(input.rawData);
    preprocessed = preprocessTrialBalance(rows);
  } catch (err) {
    emit(
      onProgress,
      'preprocessing',
      'failed',
      err instanceof Error ? err.message : 'parse_error',
    );
    throw new Error(
      `[escudo-survival] No se pudo preprocesar el balance: ${
        err instanceof Error ? err.message : 'unknown_error'
      }`,
    );
  }
  emit(
    onProgress,
    'preprocessing',
    'completed',
    `Periodo ${preprocessed.primary.period} — ${preprocessed.auxiliaryCount} auxiliares`,
  );

  // -------------------------------------------------------------------------
  // Stage 1-5: Cinco agentes en paralelo (Promise.allSettled)
  // -------------------------------------------------------------------------
  const sharedInput: SurvivalAgentInput = {
    preprocessed,
    company,
    language,
    instructions: input.instructions,
  };

  // Lanzamos todos a la vez. Cada uno emite su `started` y `completed/failed`
  // a traves del wrapper `runStage`.
  const stagePromises = [
    runStage(onProgress, 'tet', () => runTetCalculator(sharedInput)),
    runStage(onProgress, 'retention', () => runRetentionShield(sharedInput)),
    runStage(onProgress, 'antiDian', () => runAntiDianAuditor(sharedInput)),
    runStage(onProgress, 'reserve', () => runContingencyReserve(sharedInput)),
    runStage(onProgress, 'dividend', () => runDividendOptimizer(sharedInput)),
  ] as const;

  const [
    tetSettled,
    retentionSettled,
    antiDianSettled,
    reserveSettled,
    dividendSettled,
  ] = await Promise.all(stagePromises);

  const tet = tetSettled.value ?? buildFallbackTet();
  const retentionShield = retentionSettled.value ?? buildFallbackRetention();
  const antiDian = antiDianSettled.value ?? buildFallbackAntiDian();
  const contingencyReserve = reserveSettled.value ?? buildFallbackReserve();
  const dividendOptimizer = dividendSettled.value ?? buildFallbackDividend();

  const partial =
    tetSettled.failed ||
    retentionSettled.failed ||
    antiDianSettled.failed ||
    reserveSettled.failed ||
    dividendSettled.failed;

  // -------------------------------------------------------------------------
  // Stage 6: Sintetizador — consolida los 5 hallazgos
  // -------------------------------------------------------------------------
  emit(onProgress, 'synthesis', 'started');
  let synthesis: SynthesisResult;
  try {
    synthesis = await runSynthesizer(
      { tet, retentionShield, antiDian, contingencyReserve, dividendOptimizer },
      language,
      company,
    );
    emit(onProgress, 'synthesis', 'completed');
  } catch (err) {
    emit(
      onProgress,
      'synthesis',
      'failed',
      err instanceof Error ? err.message : 'synth_error',
    );
    synthesis = buildFallbackSynthesis(language);
  }

  // -------------------------------------------------------------------------
  // Resultado final
  // -------------------------------------------------------------------------
  return {
    tet,
    retentionShield,
    antiDian,
    contingencyReserve,
    dividendOptimizer,
    synthesis,
    metadata: {
      uvt: UVT_2026,
      period: preprocessed.primary.period,
      generatedAt: new Date().toISOString(),
      partial,
      durationMs: Date.now() - startTime,
    },
  };
}

// ---------------------------------------------------------------------------
// Synthesizer
// ---------------------------------------------------------------------------

async function runSynthesizer(
  results: {
    tet: TetCalculatorResult;
    retentionShield: RetentionShieldResult;
    antiDian: AntiDianResult;
    contingencyReserve: ContingencyReserveResult;
    dividendOptimizer: DividendOptimizerResult;
  },
  language: Language,
  company: { name?: string; nit?: string },
): Promise<SynthesisResult> {
  const langLine =
    language === 'en'
      ? 'Respond entirely in English (Colombian Spanish for citations).'
      : 'Responde completamente en espanol colombiano (es-CO).';

  const systemPrompt = `Eres el director de la asesoria UtopIA Escudo. Tu tarea es consolidar los 5 hallazgos del Modo Supervivencia Élite en un dictamen ejecutivo de UNA pagina dirigido al dueño de la empresa, mas un ranking de las 3-5 acciones de mayor impacto.

## Reglas
- Lenguaje claro, ejecutivo, sin tecnicismos innecesarios. Que el dueño entienda QUE pasa, POR QUE le importa, y QUE hacer la proxima semana.
- Cita SIEMPRE el articulo del Estatuto Tributario o resolucion DIAN cuando ranqueas una accion.
- Las top recomendaciones se ordenan de mayor a menor IMPACTO (en COP). Maximo 5.
- Si el reporte viene con \`partial: true\`, declara explicitamente que algunos submodulos no se pudieron calcular y por que el dictamen es parcial.
- NUNCA inventes cifras. Trabaja SOLO con los datos que recibes en el JSON.

## Formato del markdown ejecutivo (1 pagina)
\`\`\`
## Dictamen Ejecutivo — Modo Supervivencia Élite
**Empresa:** {nombre} (NIT {nit})

### Estado actual
[Una frase: nivel de alerta TET, exposicion DIAN, capital atrapado, etc.]

### 3 hallazgos criticos
1. ...
2. ...
3. ...

### Plan de accion proximo trimestre
- [Accion #1 - mayor impacto]
- [Accion #2]
- [Accion #3]
\`\`\`

${langLine}`;

  const payload = {
    empresa: { name: company.name ?? null, nit: company.nit ?? null },
    tet: results.tet.data,
    retentionShield: results.retentionShield.data,
    antiDian: results.antiDian.data,
    contingencyReserve: results.contingencyReserve.data,
    dividendOptimizer: results.dividendOptimizer.data,
  };

  const userContent = `Aqui estan los 5 hallazgos estructurados (data) de los submodulos. Genera el dictamen ejecutivo y el ranking topRecommendations:

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``;

  // Migrado a `callFinancialAgent` para recuperar el auto-fallback contra
  // `finish_reason=length` (introducido en commit 13a0dfd) y la telemetria
  // unificada. El refactor outcome-first del prompt (CTCO + XML) queda fuera
  // de scope en esta fase — solo se migra la LLAMADA al runtime canonico.
  const { json } = await callFinancialAgent({
    agentName: 'escudo-survival-synth',
    model: MODELS.FINANCIAL_PIPELINE,
    schema: synthesizerSchema,
    system: systemPrompt,
    userContent,
    ...MODELS_CONFIG.escudoSynthesizer,
    maxAttempts: 2,
  });

  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface StageOutcome<T> {
  value: T | null;
  failed: boolean;
}

function emit(
  onProgress: ((event: EscudoSurvivalProgressEvent) => void) | undefined,
  stage: EscudoSurvivalProgressStage,
  status: 'started' | 'completed' | 'failed',
  message?: string,
): void {
  if (!onProgress) return;
  onProgress({ stage, status, message });
}

async function runStage<T>(
  onProgress: ((event: EscudoSurvivalProgressEvent) => void) | undefined,
  stage: EscudoSurvivalProgressStage,
  fn: () => Promise<T>,
): Promise<StageOutcome<T>> {
  emit(onProgress, stage, 'started');
  try {
    const value = await fn();
    emit(onProgress, stage, 'completed');
    return { value, failed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    console.warn(`[escudo-survival] stage ${stage} failed:`, msg);
    emit(onProgress, stage, 'failed', msg);
    return { value: null, failed: true };
  }
}

// ---------------------------------------------------------------------------
// Fallbacks — devuelven shape valida cuando un agente falla. Los warnings
// declaran explicitamente que el submodulo no fue calculado por el LLM.
// ---------------------------------------------------------------------------

function buildFallbackTet(): TetCalculatorResult {
  return {
    markdown:
      '## TET Calculator — submodulo no disponible\n\nEste submodulo no se pudo ejecutar en esta corrida. Reintenta o consulta los logs del orchestrator.',
    warnings: ['tet_calculator_failed'],
    data: {
      tet: 0,
      ttd: 0,
      nivelAlerta: 'verde',
      impuestoProyectado: 0,
      uai: 0,
      sugerenciasOptimizacion: [],
    },
  };
}

function buildFallbackRetention(): RetentionShieldResult {
  return {
    markdown:
      '## Escudo de Retenciones — submodulo no disponible\n\nReintenta la corrida.',
    warnings: ['retention_shield_failed'],
    data: {
      retencionesAcumuladas: 0,
      impuestoProyectado: 0,
      saldoAFavorProyectado: 0,
      acciones: [],
    },
  };
}

function buildFallbackAntiDian(): AntiDianResult {
  return {
    markdown:
      '## Anti-DIAN Preventivo — submodulo no disponible\n\nReintenta la corrida.',
    warnings: ['anti_dian_failed'],
    data: {
      pagosEfectivoTotal: 0,
      pagosNoDeduciblesIndividuales: [],
      excesoNoDeducibleGeneral: 0,
      crucesExogenaSospechosos: [],
      mayorImpuestoEstimado: 0,
    },
  };
}

function buildFallbackReserve(): ContingencyReserveResult {
  return {
    markdown:
      '## Reserva de Contingencia — submodulo no disponible\n\nReintenta la corrida.',
    warnings: ['contingency_reserve_failed'],
    data: {
      utilidadNeta: 0,
      reservaSugerida: 0,
      pctUtilidad: 0.1,
      cuentaSugerida: '11 - Caja y Bancos (subcuentas de alta liquidez)',
    },
  };
}

function buildFallbackDividend(): DividendOptimizerResult {
  return {
    markdown:
      '## Optimizacion de Dividendos — submodulo no disponible\n\nReintenta la corrida.',
    warnings: ['dividend_optimizer_failed'],
    data: {
      utilidadDistribuible: 0,
      escenarios: {
        distribuirTotal: { ahorroSocio: 0, impuestoSocio: 0, netoSocio: 0 },
        capitalizarTotal: {
          ahorroSocio: 0,
          impuestoSocio: 0,
          netoSocio: 0,
          fortPatrimonio: 0,
        },
        hibrido50_50: {
          ahorroSocio: 0,
          impuestoSocio: 0,
          netoSocio: 0,
          fortPatrimonio: 0,
        },
      },
      recomendacion: 'Submodulo no disponible. Reintenta la corrida.',
      norma: 'Art. 242 E.T.',
    },
  };
}

function buildFallbackSynthesis(language: Language): SynthesisResult {
  const md =
    language === 'en'
      ? '## Executive Synthesis — Unavailable\n\nThe synthesizer failed during this run. The 5 sub-modules above remain valid; rerun the synthesizer step or check the orchestrator logs.'
      : '## Sintesis ejecutiva — no disponible\n\nEl sintetizador fallo en esta corrida. Los 5 submodulos arriba siguen siendo validos; reintenta la corrida del sintetizador o revisa los logs del orchestrator.';
  return {
    markdown: md,
    topRecommendations: [],
  };
}
