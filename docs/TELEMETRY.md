# Telemetry & Observability — Financial Pipelines

Cada llamada a `callFinancialAgent` (`src/lib/agents/financial/agents/runtime.ts`) devuelve un `meta` con `inputTokens`, `outputTokens`, `reasoningTokens`, `cachedInputTokens`, `elapsedMs`, `fallbackUsed`, `firstPassReasoningTokens`, `firstPassFinishReason`.

## Cómo se persiste (cableado real)

La fila de `agent_telemetry` la escribe **el runtime**, no cada agente. `callFinancialAgent` llama a `persistAgentTelemetry` en su return path para las ~40 llamadas LLM del pipeline: un único punto de cableado.

`onTelemetry` **no** es el canal de persistencia. Es un callback de UI (el agente lo usa para emitir el evento SSE `agent_telemetry`); históricamente la documentación decía lo contrario y como ningún agente lo cableaba, `agent_telemetry` quedaba vacía.

### El tenant viaja por contexto, no por la cookie

`agent_telemetry.workspace_id` es `NOT NULL`, pero el runtime no recibe el tenant en su firma. Lo resuelve un `AsyncLocalStorage` que **abre el route handler**:

```ts
// src/app/api/financial-report/<fase>/route.ts
const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;

// El contexto lleva el valor CRUDO: quien clasifica el modo de fallo
// (`workspace-no-uuid` vs `sin-workspace`) es `persistAgentTelemetry`.
// La consulta de propiedad sí usa el uuid validado — mandar un no-uuid a una
// comparación contra una columna `uuid` aborta la query.
const telemetryWorkspaceId = asTelemetryUuid(workspaceId);
const telemetryCtx: TelemetryContext = {
  workspaceId: workspaceId ?? null,
  reportId: await resolveOwnedReportId(body.reportId, telemetryWorkspaceId),
};

return runWithTelemetryContext(telemetryCtx, () => handleStreaming({ ... }));
```

**Por qué el route y no el pipeline.** El fallback histórico era leer `cookies()` desde `persistAgentTelemetry`. Esa lectura ocurre dentro del callback de la `ReadableStream` SSE y bajo `waitUntil`, donde Next ya no expone el scope del request: `cookies()` lanza, el tenant sale `null` y la fila se descartaba. Medido en runtime con el pipeline real (2026-08):

```
[persistAgentTelemetry] sin workspaceId para "niif-analyst-pass1" — fila omitida.
```

El handler sí está en el scope del request, así que fija el tenant antes de construir el stream. El `start` de la `ReadableStream` se invoca durante su construcción, de modo que el pipeline entero y sus continuaciones async heredan el contexto.

Los cuatro endpoints lo abren: `/api/financial-report/{niif,strategy,governance,html}`. Regresión: `src/app/api/financial-report/__tests__/telemetry-context.route.test.ts`.

### `reportId`

El contexto acepta un `reportId` opcional para que la medición no quede huérfana del reporte que la generó. Se toma del body y pasa por `resolveOwnedReportId(candidate, workspaceId)`, que sólo lo acepta si **existe** y **pertenece al workspace** de la corrida. Motivo: `report_id` es FK a `reports.id`; un id inexistente haría que Postgres rechace el INSERT y —al ser fire-and-forget— se perderían en silencio las ~40 mediciones de la corrida. Ante cualquier duda devuelve `null`: se degrada la trazabilidad, nunca la fila.

> Hoy el pipeline financiero **no crea** una fila en `reports`, así que en la práctica el `reportId` llega `null` salvo que el cliente envíe uno propio. Cuando el orchestrator empiece a crear el reporte, basta con enviarlo en el body.

### Mediciones sin tenant: se degradan, no se descartan

Si aun así no hay workspace (o el valor no es un uuid), la fila **no se tira**. Como la columna es `NOT NULL` + FK el INSERT es imposible, así que la medición va a:

- un buffer acotado en memoria — `getOrphanTelemetryRows()`, diagnóstico de la instancia; y
- una línea de log estructurada, **una por medición** (sin deduplicar):

```
[agent-telemetry:orphan] {"reason":"sin-workspace","agentName":"niif-analyst-pass1","modelId":"gpt-5.6-sol","elapsedMs":1234,...}
```

Esa línea es lo único que sobrevive a la eviction de la instancia, y es JSON reconstruible desde el drain. El consejo de remediación para humanos sí se deduplica por agente.

`reason` ∈ `sin-workspace` | `workspace-no-uuid`. El segundo cubre la cookie `utopia_workspace_id` forjada o corrupta: `getCurrentWorkspaceId()` la devuelve tal cual en el camino anónimo, y sin el filtro el INSERT moriría con `invalid input syntax for type uuid`.

**Pendiente** (requiere migración): hacer `agent_telemetry.workspace_id` nullable + columna `orphan` para persistir estas filas en la tabla en vez de sólo en el log.

Helpers:
- `src/lib/db/telemetry.ts` — contexto, insert, vía degradada
- `src/lib/db/telemetry-pricing.ts` — costo en micros USD con pricing oficial OpenAI 2026-05-12

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
