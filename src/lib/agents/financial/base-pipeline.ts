// ---------------------------------------------------------------------------
// BasePipeline — abstraccion reusable para los 9 orchestrators financieros
// ---------------------------------------------------------------------------
// Que problema resuelve:
//  Los pipelines `financial/`, `audit/`, `quality/`, `tax-planning/`,
//  `transfer-pricing/`, `valuation/`, `fiscal-opinion/`, `tax-reconciliation/`
//  y `feasibility/` reimplementan cada uno la misma plomeria:
//    * recorrer stages secuenciales y emitir SSE entre cada uno
//    * lanzar stages paralelos con `Promise.allSettled` y consolidar resultados
//    * envolver cada stage con `withRetry` + backoff exponencial
//    * normalizar errores y eventos de progreso
//  Esta clase encapsula esas mecanicas en una API minima (`runSequential` /
//  `runParallel`) que cada orchestrator puede consumir sin perder libertad
//  para construir prompts, parsear outputs o validar resultados — la logica
//  de dominio sigue viviendo en sus respectivos modulos.
//
// Por que NO es Workflow DevKit:
//  WDK aporta durabilidad inter-request (resume tras crash, supera el techo
//  de `maxDuration`) pero exige refactor mayor (steps async + checkpointed,
//  `getWritable()`, runs persistentes). BasePipeline es la capa intermedia:
//  unifica la API en proceso para que la migracion futura a WDK sea un
//  drop-in (cada `PipelineStage` se mapea a un `step.do(...)`). Ver
//  `docs/PIPELINE_MIGRATION_RECIPE.md` para la decision documentada.
// ---------------------------------------------------------------------------

/**
 * Definicion de un stage del pipeline. Los nombres son arbitrarios pero
 * deben ser estables (los SSE events los usan como `stage`). `run` recibe
 * el output del stage anterior en flujos secuenciales o el input compartido
 * en flujos paralelos.
 */
export interface PipelineStage<TInput = unknown, TOutput = unknown> {
  /** Identificador estable, se emite en eventos SSE. */
  name: string;
  /** Logica del stage. Recibe el output del stage previo (sequential) o el input shared (parallel). */
  run: (input: TInput) => Promise<TOutput>;
  /**
   * Numero de reintentos adicionales si `run` lanza. Default 0 (sin retry).
   * El backoff es exponencial: 250ms, 500ms, 1s, ...
   *
   * Nota: para retries con clasificacion de errores (rate-limit vs validacion),
   * usa el helper `withRetry` de `@/lib/agents/utils/retry` dentro de `run`.
   * BasePipeline retries son simples — sirven para flakiness transitorio.
   */
  retries?: number;
  /**
   * Hook opcional al iniciar el stage. Se invoca DESPUES de emitir el evento
   * `stage:start`. Util para logs por stage o mediciones por dominio.
   */
  onStart?: () => void;
  /** Hook opcional al completar exitosamente. Recibe el output. */
  onSuccess?: (output: TOutput) => void;
  /** Hook opcional ante error terminal (ya agotados los retries). */
  onError?: (err: unknown) => void;
}

/**
 * Eventos de telemetria emitidos por la pipeline. El orchestrator decide
 * como traducirlos al formato SSE de su API route (cada uno tiene su propio
 * `XxxProgressEvent`). Ver `sse-encoder.ts` para el encoder generico.
 */
export interface PipelineEvent {
  type:
    | 'stage:start'
    | 'stage:success'
    | 'stage:error'
    | 'pipeline:complete'
    | 'pipeline:abort';
  stage?: string;
  data?: unknown;
  error?: string;
  /** Numero de intento (1-based). Util para emitir progreso en retries. */
  attempt?: number;
  /** ms desde Date.now() al momento del evento. */
  timestamp: number;
}

export interface BasePipelineOptions {
  /** Identificador del pipeline (e.g. `financial`, `audit`). Se incluye en logs. */
  name: string;
  /** Sink para los eventos. Puede ser un encoder SSE o un logger. */
  emit?: (event: PipelineEvent) => void;
  /** Senal de aborto del cliente. Si firma, abortamos antes del siguiente stage. */
  abortSignal?: AbortSignal;
}

export interface ParallelStageResult<T = unknown> {
  stage: string;
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: unknown;
}

/**
 * BasePipeline coordina ejecucion secuencial o paralela de stages, retries
 * con backoff y emision de eventos. Es agnostico al dominio — los outputs y
 * tipos los maneja el caller via parametros genericos.
 *
 * @example Sequential
 * ```ts
 * const pipeline = new BasePipeline({ name: 'financial', emit: ssEmit });
 * const final = await pipeline.runSequential([
 *   { name: 'niif', run: async (input) => runNiifAnalyst(input) },
 *   { name: 'strategy', run: async (niif) => runStrategy(niif) },
 *   { name: 'governance', run: async (strategy) => runGovernance(strategy) },
 * ], initialInput);
 * ```
 *
 * @example Parallel
 * ```ts
 * const results = await pipeline.runParallel([
 *   { name: 'niif-auditor',   run: () => runNiifAuditor(report) },
 *   { name: 'tax-auditor',    run: () => runTaxAuditor(report) },
 *   { name: 'legal-auditor',  run: () => runLegalAuditor(report) },
 *   { name: 'fiscal-reviewer', run: () => runFiscalReviewer(report) },
 * ], sharedInput);
 * ```
 */
export class BasePipeline {
  private readonly opts: BasePipelineOptions;

  constructor(opts: BasePipelineOptions) {
    this.opts = opts;
  }

  /**
   * Ejecuta los stages en serie. Cada stage recibe el output del anterior como
   * input. El primer stage recibe `initialInput`. Si un stage falla y agota
   * sus retries, lanza el ultimo error y emite `pipeline:abort`.
   *
   * Nota tipos: como cada stage puede transformar el shape, el caller declara
   * el tipo final de retorno via `<T>`. Internamente usamos `unknown` para no
   * forzar al caller a un encadenamiento tipado complejo.
   */
  async runSequential<T = unknown>(
    stages: ReadonlyArray<PipelineStage<unknown, unknown>>,
    initialInput: unknown,
  ): Promise<T> {
    let current: unknown = initialInput;
    for (const stage of stages) {
      this.checkAbort();
      this.emit({ type: 'stage:start', stage: stage.name, timestamp: Date.now() });
      stage.onStart?.();
      try {
        current = await this.runWithRetry(stage, current);
        stage.onSuccess?.(current);
        this.emit({
          type: 'stage:success',
          stage: stage.name,
          timestamp: Date.now(),
        });
      } catch (err) {
        stage.onError?.(err);
        this.emit({
          type: 'stage:error',
          stage: stage.name,
          error: errorMessage(err),
          timestamp: Date.now(),
        });
        this.emit({ type: 'pipeline:abort', timestamp: Date.now() });
        throw err;
      }
    }
    this.emit({ type: 'pipeline:complete', timestamp: Date.now() });
    return current as T;
  }

  /**
   * Ejecuta los stages en paralelo. Todos reciben el mismo `input`. Devuelve
   * un array de resultados via `Promise.allSettled` — un fallo individual NO
   * aborta los demas, replicando el comportamiento del audit orchestrator.
   *
   * El caller decide como consolidar (e.g. weighted score, mejor-esfuerzo,
   * fail-fast si hay un dominio critico fallado).
   */
  async runParallel<T = unknown>(
    stages: ReadonlyArray<PipelineStage<unknown, T>>,
    input: unknown,
  ): Promise<Array<ParallelStageResult<T>>> {
    this.checkAbort();
    // Trabajamos los retries con shape `unknown` (igual que runSequential) y
    // casteamos al tipo del caller en el sitio de lectura. Esto evita un
    // problema de varianza al pasar `PipelineStage<unknown, T>` como parametro
    // a `runWithRetry(stage: PipelineStage<unknown, unknown>)`.
    const erasedStages = stages as ReadonlyArray<PipelineStage<unknown, unknown>>;
    const settled = await Promise.allSettled(
      erasedStages.map((stage, i) =>
        (async () => {
          this.emit({ type: 'stage:start', stage: stage.name, timestamp: Date.now() });
          stage.onStart?.();
          try {
            const out = await this.runWithRetry(stage, input);
            const typed = out as T;
            stages[i].onSuccess?.(typed);
            this.emit({ type: 'stage:success', stage: stage.name, timestamp: Date.now() });
            return typed;
          } catch (err) {
            stage.onError?.(err);
            this.emit({
              type: 'stage:error',
              stage: stage.name,
              error: errorMessage(err),
              timestamp: Date.now(),
            });
            throw err;
          }
        })(),
      ),
    );

    this.emit({ type: 'pipeline:complete', timestamp: Date.now() });

    return settled.map((r, i) => {
      const stageName = stages[i].name;
      if (r.status === 'fulfilled') {
        return { stage: stageName, status: 'fulfilled' as const, value: r.value };
      }
      return { stage: stageName, status: 'rejected' as const, reason: r.reason };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async runWithRetry(
    stage: PipelineStage<unknown, unknown>,
    input: unknown,
  ): Promise<unknown> {
    const maxAttempts = (stage.retries ?? 0) + 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.checkAbort();
      try {
        return await stage.run(input);
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          const delay = 250 * Math.pow(2, attempt - 1);
          this.emit({
            type: 'stage:error',
            stage: stage.name,
            error: `attempt ${attempt}/${maxAttempts}: ${errorMessage(err)} — retry in ${delay}ms`,
            attempt,
            timestamp: Date.now(),
          });
          await sleep(delay);
        }
      }
    }
    throw lastErr;
  }

  private checkAbort(): void {
    if (this.opts.abortSignal?.aborted) {
      this.emit({ type: 'pipeline:abort', timestamp: Date.now() });
      throw new PipelineAbortError(this.opts.name);
    }
  }

  private emit(event: PipelineEvent): void {
    try {
      this.opts.emit?.(event);
    } catch (err) {
      // Un sink que lanza no debe romper el pipeline. Lo logueamos y seguimos.
      console.warn(
        `[base-pipeline:${this.opts.name}] emit threw on ${event.type}:`,
        errorMessage(err),
      );
    }
  }
}

/** Error especifico de aborto — los API routes lo traducen a 499/cancelled. */
export class PipelineAbortError extends Error {
  constructor(pipelineName: string) {
    super(`Pipeline "${pipelineName}" aborted by client`);
    this.name = 'PipelineAbortError';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
