# Wave 3 — Split arquitectónico /api/financial-report (2026-05-13)

Para evitar timeouts acumulados en Vercel Pro+Fluid Compute (limite 800s/función), el pipeline NIIF→Strategy→Governance se distribuyó en 3 endpoints independientes, cada uno con su propio `maxDuration=800`.

## Endpoints actuales

- `POST /api/financial-report/niif` — NIIF Analyst (3 passes chunked) → emite SSE `niif_phase` con `{ niif, context: { bindingTotals, preprocessed, company } }`
- `POST /api/financial-report/strategy` — Strategy Director → input `{ niifResult, bindingTotals, preprocessed, company, language, instructions }`, emite `strategy_phase`
- `POST /api/financial-report/governance` — Governance Specialist → input `{ niifResult, strategyResult, ... }`, emite `governance_phase`
- `POST /api/financial-report` (legacy) — `@deprecated`. Sigue funcionando como composer monolítico (para `/export` y consumers no-críticos), pero con el riesgo de timeout acumulado.
- `POST /api/financial-audit` y `POST /api/financial-quality` — ya eran endpoints independientes; sin cambios.

## Orquestación en frontend

`PipelineWorkspace.tsx` llama los 3 nuevos endpoints secuencialmente con checkpoint a localStorage entre cada uno:
1. Checkpoint 1 post-NIIF: si Strategy o Governance falla, el reporte NIIF parcial se persiste y el usuario puede reintentar sólo la fase fallida sin perder 3-5 min de trabajo.
2. Checkpoint 2 post-Governance: reporte completo persistido antes de Phase 2 (Audit) y Phase 3 (Quality) opcionales.

## Sub-orchestrators reutilizables

En `src/lib/agents/financial/orchestrator.ts`:
- `prepareFinancialContext(input)` — Stage 0: ERP pull + preprocess + adjustments + bindingTotals + Elite ctx.
- `runNiifPhase(ctx, onProgress)` — invoca NIIF Analyst chunked.
- `runStrategyPhase(input, onProgress)` — invoca Strategy Director.
- `runGovernancePhase(input, onProgress)` — invoca Governance.
- `orchestrateFinancialReport(input)` — composer legacy que llama los 3 en orden (backward compat).

## Modelo

Desde 2026-05-13, `MODELS.FINANCIAL_PIPELINE` apunta a **gpt-5.5 premium** por default (antes era gpt-5.4-mini). Esto elimina el bug `finish_reason=length` por construcción (128K output ceiling) y baja la latencia por pass ~19-34%. Costo ~6x más en output. Override a mini via `OPENAI_MODEL_FINANCIAL=gpt-5.4-mini` si requiere rebaja temporal.

## Runtime helper resiliente (`callFinancialAgent`)

Detecta el caso de output vacío (sea `finishReason='length'` o `finishReason='stop'` con output null por AI SDK v6 `NoOutputGeneratedError`) y auto-fallback a `effort='low'` antes de propagar el error. Esto cubre el escenario donde el reasoning model agota su budget interno aunque no marque `finishReason='length'`.

## Runbook — cuando rompa

1. `/api/admin/telemetry?hours=1` → identificar qué fase fallida (perAgent muestra niif-analyst-pass{1,2,3}, strategy-director, governance-specialist por separado).
2. Si timeout sigue ocurriendo en una fase específica → ese endpoint individual está corriendo >800s; investigar si gpt-5.5 está caliente o si el balance es excepcionalmente complejo.
3. Si "network error" persiste pese al split → verificar plan Vercel + Fluid Compute realmente habilitado (no sólo declarado).
4. Reversibilidad: cada commit Wave 3 es revertible individualmente (`0c2ffa1` F1 backend, `cdc7ca4` F2 frontend, `e585661` F3 tests). El composer `orchestrateFinancialReport` sigue funcionando como fallback si el frontend orquestación se rompe.
