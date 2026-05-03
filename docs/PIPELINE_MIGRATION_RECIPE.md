# Pipeline Migration Recipe — BasePipeline en los 9 orchestrators financieros

**Estado:** parcial — `financial/orchestrator.ts` ya migrado (Ola 2.C, 2026-05-02). Quedan 8 pipelines.
**Siguiente Ola sugerida:** 2.D — migrar `audit/` (paralelo, mas complejo).
**Autor:** Ola 2.C (BasePipeline groundwork).

---

## 1. Por que esta abstraccion

El audit de Ola 0 detecto: cada orchestrator (`financial/`, `audit/`, `quality/`, `tax-planning/`, `transfer-pricing/`, `valuation/`, `fiscal-opinion/`, `tax-reconciliation/`, `feasibility/`) reimplementa la misma plomeria:

- recorrer stages secuenciales y emitir SSE entre cada uno
- lanzar stages paralelos con `Promise.allSettled` y consolidar
- envolver stages con `withRetry` + backoff exponencial (a veces lo olvidan)
- normalizar errores y eventos de progreso

Resultado: ~80% de codigo duplicado, drift entre pipelines (algunos retiran, otros no), y cero observabilidad cross-pipeline.

`BasePipeline` (`src/lib/agents/financial/base-pipeline.ts`) encapsula esa plomeria. La logica de dominio (preprocess, validators, prompts, parsing de outputs) sigue viviendo en cada modulo — la base solo orquesta.

---

## 2. Decision: BasePipeline ahora vs Workflow DevKit despues

### Estado de WDK al 2026-05-02

- `@vercel/workflow` **no existe en npm publico** (`npm view` devuelve 404).
- WDK aparece referenciado como GA en plugin docs internos y skills (`vercel-plugin:workflow`), pero el package real **no esta disponible** para instalar.
- Doc previo `docs/POST_MVP_WORKFLOW_MIGRATION.md` (2026-04-17) describe la API esperada (`'use workflow'`, `'use step'`, `getWritable()`, `step.do()`) pero no es operacional aun.

### Recomendacion

| Capa                    | Cuando                                     | Que aporta                                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| **BasePipeline (HOY)**  | Ola 2.C+, todas las pipelines              | Unifica API, retries, eventos. Refactor in-process, sin riesgo. |
| **Workflow DevKit**     | Cuando `@vercel/workflow` este publico Y una pipeline empiece a chocar con `maxDuration: 300s` | Durabilidad inter-request, resume tras crash, dashboard.    |

**No migrar a WDK ahora**:

- WDK exige refactor mayor (steps async + checkpointed, runs persistentes en Blob, cliente que reconecta por `runId`).
- BasePipeline cubre el 90% del valor (API unificada) con riesgo cero.
- Los stages de `BasePipeline` se mapean 1:1 a `step.do(...)` de WDK cuando este disponible — la migracion futura es drop-in.

**Migrar a WDK selectivamente cuando**:

- Una pipeline supere consistentemente los 300s (hoy ninguna lo hace).
- Johan quiera "retomar reporte en otro dispositivo" o "resume tras crash".
- Vercel anuncie disponibilidad publica del package.

---

## 3. Recipe — pasos genericos para migrar un orchestrator

### 3.1. Identificar la forma del flow

Lee el orchestrator y clasifica:

- **Sequential** (cada stage recibe el output del anterior): `financial/`, `quality/`, `tax-planning/`, `transfer-pricing/`, `tax-reconciliation/`, `feasibility/`
- **Parallel** (todos reciben el mismo input, consolidacion al final): `audit/` (4 auditores)
- **Hybrid** (paralelo + synth secuencial al final): `valuation/` (DCF + comparables → synth), `fiscal-opinion/` (3 ramas → drafter)

### 3.2. Mapear stages a `PipelineStage<TInput, TOutput>`

```ts
import { BasePipeline, type PipelineStage } from '@/lib/agents/financial/base-pipeline';

type Acc = { stageA?: TypeA; stageB?: TypeB; stageC?: TypeC };

const stages: ReadonlyArray<PipelineStage<unknown, unknown>> = [
  {
    name: 'stage-a',
    onStart: () => onProgress?.({ type: 'stage_start', stage: 1, label: '...' }),
    onSuccess: () => onProgress?.({ type: 'stage_complete', stage: 1, label: '...' }),
    run: async (input) => {
      const acc = (input as Acc) ?? {};
      const out = await runStageA(/* ... */);
      return { ...acc, stageA: out } satisfies Acc;
    },
  },
  // ...
];
```

### 3.3. Ejecutar y desempaquetar

**Sequential:**

```ts
const pipeline = new BasePipeline({ name: '<orchestrator-name>' });
const result = await pipeline.runSequential<Acc>(stages, {} as Acc);
if (!result.stageA || !result.stageB) throw new Error('incomplete output');
```

**Parallel:**

```ts
const results = await pipeline.runParallel(stages, sharedInput);
for (const r of results) {
  if (r.status === 'fulfilled') { /* consolidate */ }
  else { /* log + degradar */ }
}
```

### 3.4. Conectar SSE (opcional)

Si la API route quiere telemetria interna del pipeline (no solo los `onProgress` del dominio), pasa un encoder:

```ts
import { createSseEncoder } from '@/lib/agents/financial/sse-encoder';

const sse = createSseEncoder();
// ... en la API route:
return new Response(stream, { headers: sse.headers() });
```

Y en el orchestrator:

```ts
const pipeline = new BasePipeline({
  name: 'audit',
  emit: (e) => writer.write(sse.encodePipelineEvent(e)),
  abortSignal: req.signal,
});
```

### 3.5. Preservar contratos del dominio

**Lo que NO se toca:**

- preprocess (`PreprocessedBalance`, `parseTrialBalanceCSV`, `applyAdjustments`)
- validators (`validateConsolidatedReport`, gates de balance)
- watermarks/sanity checks (Doctor de Datos, binding totals)
- API publica del orchestrator (signature, return type, errores)
- shape de eventos del dominio (`FinancialProgressEvent`, `AuditProgressEvent`)

`BasePipeline` solo reemplaza el **flow de control entre stages**. Todo lo de pre/post se mantiene.

---

## 4. Lista priorizada para Olas futuras

### Prioridad 1 — `audit/orchestrator.ts` (Ola 2.D)

- **Forma:** parallel (4 auditores: NIIF, Tax, Legal, Fiscal Reviewer).
- **Por que primero:** es el orchestrator donde mas valor aporta `runParallel` (encapsula `Promise.allSettled` + clasificacion fulfilled/rejected). Hoy hace `Promise.allSettled` manual + `for` de extraccion + arrays paralelos para domain names — 50 lineas que se vuelven 10.
- **Cuidado:** preservar `complianceScore` weighted (NIIF 30%, Tax 25%, Legal 20%, Fiscal 25%) y la extraccion del `opinionType` del Fiscal Reviewer.

### Prioridad 2 — `valuation/` y `fiscal-opinion/` (Ola 2.E)

- **Forma:** hybrid (paralelo + synth final).
- **Patron:** `runParallel` para las ramas + `runSequential` con un solo stage para el synth, encadenadas manualmente.
- **Alternativa simpler:** un solo `runSequential` donde el primer stage hace internamente `Promise.allSettled`. Mas legible.

### Prioridad 3 — `quality/`, `tax-planning/`, `transfer-pricing/`, `tax-reconciliation/`, `feasibility/`

- **Forma:** sequential simple (2-3 stages).
- **Migracion:** copy/paste del recipe seccion 3.2-3.3, ~30 min cada uno.
- **Por que ultimo:** son pipelines mas pequenos, ganancia menor por archivo. Pero unifica la API across el repo.

---

## 5. Diff conceptual — `financial/orchestrator.ts` (Ola 2.C ya hecha)

**Antes:** 3 bloques imperativos `await runNiifAnalyst(...)`, `await runStrategy(...)`, `await runGovernance(...)` con 6 `onProgress?.({ type: 'stage_start' | 'stage_complete' })` inline (24 lineas de plomeria).

**Despues:**

- Declaracion de `stages: ReadonlyArray<PipelineStage>` con `onStart`/`onSuccess` que disparan los mismos `FinancialProgressEvent`s.
- Acumulador `SequentialAccumulator` con `niif?`, `strategy?`, `governance?` que cada stage agranda.
- Una llamada `pipeline.runSequential<SequentialAccumulator>(stages, {})`.
- Guarda defensivo final: si `runSequential` resolvio sin lanzar, los 3 outputs estan presentes — chequeo paranoico antes de llamar `buildConsolidatedReport`.

**Lo que NO cambio:**

- Stages 0.0 (auto-pull ERP), 0 (preprocess), 0.4 (apply adjustments), 0.5 (validation gate), 4 (consolidation + post-render validation, watermark provisional, audit section).
- Sanity-check `niifOutputMentionsBindingTotals` — sigue corriendo en `onSuccess` del primer stage.
- API publica `orchestrateFinancialReport(request, options)` y todos los tipos.
- Shape de `FinancialProgressEvent` — los SSE events emitidos son identicos.

---

## 6. Smoke test sugerido (cuando Johan ejecute la pipeline)

1. Subir un balance simple via `/api/financial-report` y observar SSE: deben llegar 4 pares `stage_start`/`stage_complete` (1, 2, 3, 4) en el orden actual.
2. Romper el binding totals (forzar un balance descuadrado): el `BalanceValidationError` debe seguir saliendo en stage 0.5 sin tocar BasePipeline.
3. Provocar fallo en stage 1 (e.g. simular timeout en `runNiifAnalyst`): el cliente debe ver un `error` event y la respuesta debe terminar — no debe colgarse.

Si los 3 escenarios pasan, la migracion es no-regresiva.

---

## 7. Archivos relevantes

- `src/lib/agents/financial/base-pipeline.ts` — abstraccion (Ola 2.C)
- `src/lib/agents/financial/sse-encoder.ts` — encoder generico (Ola 2.C)
- `src/lib/agents/financial/orchestrator.ts` — primer migrado (Ola 2.C)
- `src/lib/agents/utils/retry.ts` — `withRetry` con clasificacion de errores (sigue siendo el helper para retries dominio-aware dentro de `run`)
- `docs/POST_MVP_WORKFLOW_MIGRATION.md` — plan WDK cuando este disponible
