# Post-MVP: Migración del pipeline financiero a Vercel Workflow DevKit

**Estado:** pendiente — hacerlo cuando UtopIA deje de ser MVP.
**Prioridad:** alta, pero NO urgente. Los parches defensivos actuales cubren el 90% de los casos de falla de red.
**Autor:** Claude Opus 4.7 (1M) + Johan (2026-04-17).

---

## 1. Por qué existe este documento

El pipeline "NIIF Elite" (y los otros 9 pipelines financieros: auditoría, calidad, tax-planning, transfer-pricing, valuation, fiscal-opinion, tax-reconciliation, feasibility, etc.) está hoy orquestado **desde el cliente** en `src/components/workspace/PipelineWorkspace.tsx`. El cliente hace tres `fetch` secuenciales (`/api/financial-report` → `/api/financial-audit` → `/api/financial-quality`) y consume SSE de las dos primeras.

Este diseño tiene una fragilidad fundamental: **la red del cliente es el único punto de coordinación**. Si hay un `ERR_NETWORK_CHANGED`, un cambio de WiFi, una VPN que se reconecta, o el usuario cierra el tab por error, se pierde trabajo ya completado por el servidor (potencialmente 5-10 minutos de tokens de LLM y agentes secuenciales costosos).

El **2026-04-17** Johan reportó un incidente real: Fase 1 (Analista NIIF) completó, Fase 2 (auditoría) completó, y al iniciar Fase 3 (meta-auditoría de calidad) el navegador disparó `net::ERR_NETWORK_CHANGED`. Todo el pipeline quedó congelado con "Failed to fetch" y, peor, Fases 1 y 2 se perdieron porque la persistencia a `localStorage` solo ocurría al final del flujo.

La Ola 1 de mitigación (ya aplicada, ver `commit` del 2026-04-17) introdujo:

- **Checkpoint tras Fase 1**: se persiste en `localStorage` inmediatamente tras completar la fase crítica.
- **Fases 2 y 3 no-bloqueantes**: cada una en su propio `try/catch`, fallar una NO destruye el reporte.
- **Retry con backoff en Fase 3**: 2 reintentos (1s, 3s) ante `TypeError: Failed to fetch`.
- `maxDuration = 300s` en `/api/financial-quality` (igualando Fases 1 y 2).

Son parches correctos para MVP, pero **no resuelven el caso patológico**: si la red se cae durante el streaming de Fase 1 (la más larga), el reporte NIIF se pierde completo.

Post-MVP hay que migrar a la arquitectura canónica Vercel 2026: **Vercel Workflow DevKit (WDK)**.

---

## 2. Arquitectura objetivo

```
┌─────────────────────┐      ┌──────────────────────────────────────────────┐
│  Cliente (Next.js)  │      │  Servidor — Fluid Compute + WDK              │
│                     │      │                                              │
│  POST /api/pipeline │─────▶│  startWorkflow("niif-elite", input)          │
│       → runId       │      │     │                                        │
│                     │      │     ├─▶ step.do("preprocess",  fn)  ── Blob  │
│  localStorage.runId │      │     ├─▶ step.do("niif-report", fn)  ── Blob  │
│                     │      │     ├─▶ step.do("audit",       fn)  ── Blob  │
│  GET  /api/runs/:id │─────▶│     └─▶ step.do("quality",     fn)  ── Blob  │
│   SSE stream        │      │                                              │
│   (Last-Event-ID)   │      │  Cada step.do escribe su output a storage    │
│                     │      │  durable. Crash → reanuda desde el ultimo    │
└─────────────────────┘      │  step completado. Retries exponenciales      │
                             │  built-in por step.                          │
                             └──────────────────────────────────────────────┘
```

**Lo que resuelve WDK** que no resuelve la Ola 1:

| Problema                                        | Ola 1 (MVP) | WDK (post-MVP) |
|-------------------------------------------------|-------------|----------------|
| Fase 3 falla por red                            | ✅ retry    | ✅ retry nativo |
| Fase 1 ya completó pero red falla antes del fin | ✅ checkpoint tras fase | ✅ checkpoint tras CADA step |
| Red se cae DURANTE streaming de Fase 1          | ❌ pierde   | ✅ `step.do` aisla el trabajo del stream |
| Usuario cierra el tab                           | ❌ pierde   | ✅ workflow sigue server-side |
| Crash del servidor (deploy, OOM)                | ❌ pierde   | ✅ reanuda del último checkpoint |
| Retomar reporte en otro dispositivo             | ❌ no       | ✅ por `runId` |
| Visibilidad/auditoría de runs                   | Limitada    | ✅ dashboard WDK |

---

## 3. Plan de migración

### Fase A — Piloto: pipeline "NIIF Elite"

1. **Instalar WDK**
   ```bash
   npm install @vercel/workflow
   ```

2. **Wrappear el pipeline actual en un `workflow`** usando las directivas `"use workflow"` / `"use step"` (API real de WDK — NO es un builder, son directivas de función):
   - Nuevo archivo: `src/lib/agents/financial/workflow.ts`
   - Cada fase actual se convierte en una función con `"use step"` (tiene Node.js completo, acceso a `@ai-sdk/openai`, `fs`, etc.), y la orquestación vive en la función `"use workflow"` (sandbox V8):
     ```ts
     import { getWritable } from 'workflow';
     import { runFinancialReport } from './orchestrator';
     import { runAudit } from './audit/orchestrator';
     import { runQualityAudit } from './quality/agent';
     import { preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
     import type { NiifPipelineInput, NiifPipelineOutput } from './types';

     // Steps tienen acceso completo a Node.js + npm. AQUI va la logica pesada.
     // Logging en entry/exit facilita debug de hangs en `npx workflow inspect`.
     async function preprocess(raw: string) {
       'use step';
       console.log('[wf/preprocess] start', { bytes: raw.length });
       const out = preprocessTrialBalance(raw);
       console.log('[wf/preprocess] done');
       return out;
     }

     async function niifReport(input: NiifPipelineInput, preprocessed: unknown) {
       'use step';
       console.log('[wf/niif-report] start', { nit: input.company.nit });
       const writer = getWritable({ namespace: 'progress' }).getWriter();
       try {
         await writer.write({ phase: 'niif-report', status: 'started' });
       } finally {
         writer.releaseLock();
       }
       const out = await runFinancialReport({ ...input, preprocessed });
       console.log('[wf/niif-report] done');
       return out;
     }

     async function audit(report: unknown, language: string) {
       'use step';
       console.log('[wf/audit] start');
       const out = await runAudit({ report, language });
       console.log('[wf/audit] done');
       return out;
     }

     async function quality(report: unknown, auditReport: unknown, language: string) {
       'use step';
       console.log('[wf/quality] start');
       const out = await runQualityAudit({ report, auditReport, language });
       console.log('[wf/quality] done');
       return out;
     }

     // Workflow function — orquestacion pura. Sandbox V8 (sin fs/crypto nativos).
     // Retries built-in, resume crash-safe, cada `await` es un checkpoint.
     export async function niifElitePipeline(input: NiifPipelineInput): Promise<NiifPipelineOutput> {
       'use workflow';
       const preprocessed = await preprocess(input.rawData);
       const report = await niifReport(input, preprocessed);
       const auditReport = input.options.auditPipeline
         ? await audit(report, input.language)
         : null;
       const qualityReport = input.options.metaAudit
         ? await quality(report, auditReport, input.language)
         : null;
       return { report, auditReport, qualityReport };
     }
     ```

   **Notas críticas de la API (corregidas 2026-04-17 vs. memoria desactualizada):**
   - NO existe `workflow('name', fn)` ni `step.do(...)`. La API son **directivas de función** (`"use workflow"`, `"use step"`).
   - La función con `"use workflow"` corre en sandbox V8 — NO tiene acceso a Node.js. Por eso la lógica I/O va en steps.
   - `start()` desde `workflow/api` es lo que arranca un workflow desde un route handler.
   - Para streaming de progreso se usa `getWritable({ namespace })` — un canal por tipo de evento (progreso, logs, resultado final).

3. **Nueva ruta `POST /api/pipeline/niif-elite`** que arranca el workflow:
   ```ts
   import { start } from 'workflow/api';
   import { niifElitePipeline } from '@/lib/agents/financial/workflow';

   export async function POST(req: Request) {
     const input = await req.json();
     const run = await start(niifElitePipeline, [input]);
     return Response.json({ runId: run.runId });
   }
   ```

4. **Nueva ruta `GET /api/runs/:id/stream` con SSE** que proxy-ea los namespaced streams del run a SSE consumible por el browser. WDK expone `getRun(runId).getReadable({ namespace })` — se puede leer `progress` y el default stream (resultado final). Para resume tras caída de red, usar `startIndex` en query param + el `Last-Event-ID` spec nativo de `EventSource`.

5. **Refactor del cliente** en `PipelineWorkspace.tsx`:
   - Guardar `runId` en `localStorage` inmediatamente después de iniciar.
   - Reemplazar `consumeSSE` directo por `EventSource` contra `/api/runs/:id` (lo cual da reconexión automática con `Last-Event-ID` gratis por el spec).
   - En mount, si hay un `runId` huérfano en `localStorage` y no tiene reporte asociado, reconectar a ese run.

6. **Persistencia de artefactos**: los outputs grandes (reporte NIIF consolidado, auditoría completa) a **Vercel Blob private**. El workflow retorna solo IDs/URLs; el cliente descarga lo que necesite.

7. **Rolling Release**: desplegar con rolling release (GA desde junio 2025) al 10% → 50% → 100%. WDK GA por verificar en docs actuales.

### Fase B — Resto de pipelines

Replicar el patrón en los otros 9 pipelines (`/api/tax-planning`, `/api/transfer-pricing`, `/api/business-valuation`, `/api/fiscal-audit-opinion`, `/api/tax-reconciliation`, `/api/feasibility-study`, ...). Cada uno se convierte en un `workflow` con sus agentes como steps.

Tiempo estimado: **1 sprint dedicado** (2 semanas de un ingeniero full-time) para los 10 pipelines una vez el piloto esté validado.

### Fase C — Resume desde cualquier dispositivo

Una vez los pipelines sean durables server-side, se puede:
- Listar runs del usuario en sidebar ("Reportes en progreso").
- Retomar un run en otro navegador/dispositivo con solo el `runId`.
- Guardar `runId` por usuario (requiere introducir auth — ver nota abajo).

---

## 4. Dependencias / precondiciones

Antes de arrancar Fase A:

- [ ] Verificar estado GA de Vercel Workflow DevKit (en 2026-04 está en public beta; confirmar en docs).
- [ ] Habilitar Vercel Blob (private) en el proyecto.
- [ ] Decidir política de retención de runs en WDK (30 días? 90?).
- [ ] Definir si los runs se asocian a un usuario (requiere auth) o siguen siendo stateless por `runId` anónimo.
- [ ] **OIDC + AI Gateway:** WDK + `DurableAgent` dependen del token OIDC de Vercel para autenticarse contra AI Gateway. Antes del primer deploy hay que:
   ```bash
   vercel link            # vincular el repo al proyecto Vercel
   vercel env pull        # traer VERCEL_OIDC_TOKEN a .env.local
   ```
   En CI/prod, el token OIDC se inyecta automáticamente en el runtime de Functions. Esto cambia el patrón actual (`OPENAI_API_KEY` directo) — conservar `OPENAI_API_KEY` como fallback al menos durante la transición.
- [ ] Confirmar que los 10 pipelines financieros no exceden el límite de serialización de WDK (inputs/outputs de steps deben ser plain JSON, Date, Map, Set, etc. — nada de class instances ni funciones). Los orchestrators actuales ya retornan JSON-safe, pero validar.
- [ ] Añadir `@workflow/vitest` + plugin para poder testear los workflows nuevos antes de merge.

## 5. No-objetivos explícitos

- **NO migrar el chat orchestrator** (`src/lib/agents/orchestrator.ts`) a WDK. El chat es interactivo, baja latencia esperada (<30s), y ya funciona bien con SSE directo. WDK es para pipelines largos.
- **NO introducir una base de datos** solo para runs. Blob + el propio storage interno de WDK es suficiente.
- **NO reescribir los agentes** (NIIF Analyst, Strategy Director, Governance, etc.). Solo se envuelven como steps — su lógica interna queda intacta.

---

## 6. Referencias

- [Vercel Workflow DevKit — docs](https://vercel.com/docs/workflow)
- [Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [SSE spec — Last-Event-ID](https://html.spec.whatwg.org/multipage/server-sent-events.html#dom-eventsource-lasteventid)
- Commit de la Ola 1 (parches MVP): ver `git log --grep="Ola 1"` o buscar el mensaje "pipeline checkpoint + fases no-bloqueantes".
- Archivos a tocar en la migración:
  - `src/components/workspace/PipelineWorkspace.tsx` (cliente)
  - `src/app/api/financial-report/route.ts`, `financial-audit/route.ts`, `financial-quality/route.ts` (reemplazar por `/api/pipeline/niif-elite` + `/api/runs/:id`)
  - `src/lib/agents/financial/orchestrator.ts`, `audit/orchestrator.ts`, `quality/agent.ts` (sin cambios, solo se envuelven en steps)
  - `src/lib/agents/financial/workflow.ts` (nuevo)
  - `src/types/platform.ts` (extender `PipelineState` con `runId`)

---

**Criterio de "listo para migrar":**
- UtopIA tiene auth (usuarios identificados, no anónimos).
- Existe un SLA de disponibilidad del pipeline (>99%) que los parches MVP ya no pueden sostener.
- El volumen de reportes/día justifica el costo de WDK (tier de Vercel activa).
- Hay al menos un incidente post-Ola-1 donde un usuario perdió trabajo por causa recuperable con WDK.
