# Telemetry & Observability — Financial Pipelines

Every call to `callFinancialAgent` (`src/lib/agents/financial/agents/runtime.ts`) returns a `meta` object with `inputTokens`, `outputTokens`, `reasoningTokens`, `cachedInputTokens`, `elapsedMs`, `fallbackUsed`, `firstPassReasoningTokens`, `firstPassFinishReason`.

## Persisting telemetry

To persist to Postgres (`agent_telemetry` table), pass the optional `onTelemetry` callback:

```ts
import { callFinancialAgent } from '../agents/runtime';
import { persistAgentTelemetry } from '@/lib/db/telemetry';
import { MODEL_IDS } from '@/lib/config/models';

const { json, meta } = await callFinancialAgent({
  // ...existing options...
  onTelemetry: (m) => {
    void persistAgentTelemetry({
      workspaceId,                          // del cookie httpOnly utopia_workspace_id
      reportId: reportRowId ?? null,        // si el orchestrator ya creó la row
      agentName: m.agentName,
      modelId: MODEL_IDS.FINANCIAL_PIPELINE_PREMIUM, // o el que corresponda
      inputTokens: m.inputTokens ?? null,
      outputTokens: m.outputTokens ?? null,
      reasoningTokens: m.reasoningTokens ?? null,
      cachedInputTokens: m.cachedInputTokens ?? null,
      elapsedMs: m.elapsedMs,
      finishReason: m.finishReason,
      fallbackUsed: m.fallbackUsed,
      firstPassReasoningTokens: m.firstPassReasoningTokens ?? null,
      firstPassFinishReason: m.firstPassFinishReason ?? null,
    });
  },
});
```

El callback es **fire-and-forget**: errores de DB se loggean pero no rompen el pipeline. Para activar telemetría en un nuevo agent, propagar `workspaceId` (y opcionalmente `reportId`) desde el route handler a través del orchestrator.

Helpers:
- `src/lib/db/telemetry.ts` — insert
- `src/lib/db/telemetry-pricing.ts` — cálculo de costo en micros USD con pricing oficial OpenAI 2026-05-12

## Inspeccionar telemetría agregada

```bash
curl -H "x-admin-token: $UTOPIA_ADMIN_TOKEN" https://utopia.example.com/api/admin/telemetry
```

(Últimas 24h por default, `?hours=N` para extender.) Devuelve:
- **Totales**: calls, costo USD, fallback rate, unclean finish rate.
- **`perAgent`**: desglose por agente (niif-analyst-pass1/2/3, strategy-director, governance-specialist, html-editor, etc.).
- **`alerts`**: activadas según los thresholds del audit team.

## Alert thresholds

| Threshold | Severity | Significado |
|---|---|---|
| fallback > 3% | P1 | El reasoning model agota budget con frecuencia — revisar `maxOutputTokens` del slot |
| finishReason != stop > 1% | P0 | Outputs truncados llegando a producción — investigar inmediato |
| daily cost > $50 | P1 | Quema de presupuesto — revisar reasoning_effort por slot |

Requiere `UTOPIA_ADMIN_TOKEN` env var; sin ella, el endpoint responde 503 (fail-closed).
