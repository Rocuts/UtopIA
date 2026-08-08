// ---------------------------------------------------------------------------
// `persistAgentTelemetry` — registro fire-and-forget del `meta` que
// `callFinancialAgent` produce en cada llamada a un agente LLM.
// ---------------------------------------------------------------------------
//
// ESTADO ANTERIOR (bug corregido): este helper no tenia NI UN caller. El
// docstring afirmaba "se llama desde callFinancialAgent", pero runtime.ts solo
// hacia `opts.onTelemetry?.(meta)` y ninguno de los ~40 agentes proveia el
// callback. Consecuencia: `agent_telemetry` siempre vacia, y las alertas que
// promete docs/TELEMETRY.md (fallback >3% P1, finishReason!=stop >1% P0, costo
// diario >$50 P1) se calculaban sobre cero filas — observabilidad ficticia.
//
// DISENO ACTUAL: la persistencia la dispara `callFinancialAgent` para TODOS los
// agentes (un solo punto de cableado, no 40). `onTelemetry` se conserva como
// canal de UI (evento SSE `agent_telemetry`), no como via de persistencia.
//
// EL PROBLEMA DEL workspaceId: la columna es NOT NULL, pero runtime.ts no
// recibe el tenant. Se resuelve con un contexto AsyncLocalStorage que el route
// handler abre una vez (`runWithTelemetryContext({ workspaceId }, () => ...)`)
// y que atraviesa todo el pipeline sin tocar 40 firmas.
//
// POR QUE EL CONTEXTO Y NO LA COOKIE: el fallback historico era
// `resolveWorkspaceFromRequest()` -> `cookies()`. Ese fallback corre DENTRO del
// callback de la `ReadableStream` SSE y bajo `waitUntil`, donde ya no hay scope
// de request: `cookies()` lanza y el tenant sale `null`. Medido en runtime
// (2026-08) con el pipeline real:
//   [persistAgentTelemetry] sin workspaceId para "niif-analyst-pass1"
// Los 4 route handlers (/niif, /strategy, /governance, /html) ya resolvian el
// workspaceId para `getHechosEmpresaBlock`; ahora ademas abren el contexto
// ANTES de construir el stream, asi que el `AsyncLocalStorage` viaja con las
// continuaciones async del pipeline y llega hasta `callFinancialAgent`.
//
// FILA HUERFANA (degradacion, no descarte): si aun asi no hay tenant, la
// medicion NO se tira. La columna `workspace_id` es NOT NULL + FK, asi que el
// insert es imposible; en su lugar la fila va a un buffer en memoria y a una
// linea de log estructurada (`[agent-telemetry:orphan] {json}`) que el drain de
// Vercel si conserva. Perder la medicion es peor que medirla sin tenant.
//
// Fire-and-forget: cualquier excepcion se loguea y se traga. La telemetria
// NUNCA debe romper el pipeline ni bloquear su return path.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq } from 'drizzle-orm';
import { getDb } from './client';
import { agentTelemetry, reports } from './schema';
import { calculateCostUsdMicros } from './telemetry-pricing';

// ---------------------------------------------------------------------------
// Contexto de request (tenant + reporte)
// ---------------------------------------------------------------------------

export interface TelemetryContext {
  /**
   * Workspace dueno de la llamada. Se admite `null` a proposito: el route
   * handler abre el contexto AUNQUE no haya podido resolver el tenant, para que
   * `reportId` y la marca de huerfana viajen igual y la medicion se registre
   * degradada en vez de desaparecer.
   */
  workspaceId: string | null;
  /** Reporte que disparo el pipeline, si el orchestrator ya creo la fila. */
  reportId?: string | null;
}

const telemetryStore = new AsyncLocalStorage<TelemetryContext>();

/**
 * Abre el contexto de telemetria para todo lo que ocurra dentro de `fn`
 * (incluidas las continuaciones async). Uso tipico en un route handler:
 *
 * ```ts
 * const workspaceId = await getCurrentWorkspaceId();
 * return runWithTelemetryContext({ workspaceId }, () => runNiifPhase(...));
 * ```
 */
export function runWithTelemetryContext<T>(ctx: TelemetryContext, fn: () => T): T {
  return telemetryStore.run(ctx, fn);
}

/** Contexto activo, si algun ancestro abrio uno. */
export function getTelemetryContext(): TelemetryContext | undefined {
  return telemetryStore.getStore();
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export interface AgentTelemetryInput {
  /** Si se omite, se toma del contexto AsyncLocalStorage. */
  workspaceId?: string | null;
  reportId?: string | null;
  agentName: string;
  modelId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
  elapsedMs: number;
  finishReason?: string | null;
  fallbackUsed?: boolean;
  firstPassReasoningTokens?: number | null;
  firstPassFinishReason?: string | null;
}

/** Agentes ya reportados como "sin workspace" — evita inundar los logs. */
const missingWorkspaceReported = new Set<string>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza un identificador que va a viajar a una columna `uuid`.
 *
 * Por qué existe: `getCurrentWorkspaceId()` devuelve la cookie
 * `utopia_workspace_id` TAL CUAL en el camino anónimo
 * (src/lib/db/workspace.ts:155 — `requireWorkspace()` sí la valida contra
 * `UUID_V4_RE` en la línea 159, `getCurrentWorkspaceId()` no). Un valor corrupto
 * llegaría al `INSERT` y Postgres abortaría con `invalid input syntax for type
 * uuid` — la fila se perdería igual, pero con un error opaco. Filtrando aquí,
 * el caso cae en la vía degradada con una razón legible.
 */
export function asTelemetryUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

/**
 * Último recurso cuando no hay contexto explícito: resolver el tenant desde el
 * request activo (sesión BetterAuth o cookie `utopia_workspace_id`).
 *
 * Es best-effort a propósito — `cookies()` lanza si se llama fuera del scope de
 * request (p.ej. dentro del callback de un ReadableStream SSE), y en ese caso
 * simplemente no medimos. La función que consulta es de SOLO LECTURA: no crea
 * workspaces, así que la telemetría nunca puede alterar el estado del tenant.
 */
async function resolveWorkspaceFromRequest(): Promise<string | null> {
  try {
    const { getCurrentWorkspaceId } = await import('./workspace');
    return asTelemetryUuid(await getCurrentWorkspaceId());
  } catch {
    return null;
  }
}

/**
 * Valida que un `reportId` propuesto por el cliente exista Y pertenezca al
 * workspace de la corrida, antes de meterlo en el contexto de telemetría.
 *
 * Modo de fallo que previene: `agent_telemetry.report_id` es una FK a
 * `reports.id`. Un id inexistente hace que Postgres rechace el INSERT por
 * violación de FK — y como la telemetría es fire-and-forget, el resultado sería
 * perder las ~40 mediciones de toda la corrida en silencio. Un id existente
 * pero de OTRO tenant contaminaría la agregación de `/api/admin/telemetry`.
 *
 * Devuelve `null` ante cualquier duda (sin DB, sin tenant, id ajeno, error de
 * consulta): quedarse sin `reportId` degrada la trazabilidad, nunca la fila.
 */
export async function resolveOwnedReportId(
  candidate: unknown,
  workspaceId: string | null,
): Promise<string | null> {
  const id = asTelemetryUuid(candidate);
  if (!id || !workspaceId || !process.env.DATABASE_URL) return null;
  try {
    const db = getDb();
    const found = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.workspaceId, workspaceId)))
      .limit(1);
    return found[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filas huérfanas — la medición sin tenant NO se descarta
// ---------------------------------------------------------------------------

export type OrphanTelemetryReason = 'sin-workspace' | 'workspace-no-uuid';

export interface OrphanTelemetryRecord {
  reason: OrphanTelemetryReason;
  at: string;
  row: AgentTelemetryInput;
}

/**
 * Buffer acotado en memoria de las mediciones que no pudieron ir a la tabla.
 *
 * Es deliberadamente pequeño y volátil: su función es diagnóstico dentro de la
 * misma instancia (y aserciones en tests), no almacenamiento. El registro
 * durable de cada huérfana es la línea `[agent-telemetry:orphan]` del log, que
 * el drain sí retiene. Se acota para que un pipeline mal cableado no convierta
 * la telemetría en una fuga de memoria.
 */
const ORPHAN_BUFFER_MAX = 200;
const orphanRows: OrphanTelemetryRecord[] = [];

function recordOrphanTelemetry(reason: OrphanTelemetryReason, row: AgentTelemetryInput): void {
  if (orphanRows.length >= ORPHAN_BUFFER_MAX) orphanRows.shift();
  orphanRows.push({ reason, at: new Date().toISOString(), row });

  // Una línea por medición perdida, en JSON: es lo único que sobrevive a la
  // eviction de la instancia, así que debe ser reconstruible desde el drain.
  // NO se deduplica — deduplicar mediciones sería volver a perderlas.
  console.warn(`[agent-telemetry:orphan] ${JSON.stringify({ reason, ...row })}`);

  // El consejo de remediación sí se deduplica por agente: es texto para humanos
  // y repetirlo 40 veces por corrida solo entierra el resto del log.
  if (!missingWorkspaceReported.has(row.agentName)) {
    missingWorkspaceReported.add(row.agentName);
    console.warn(
      `[persistAgentTelemetry] sin workspaceId para "${row.agentName}" (${reason}) — ` +
        `fila registrada como huérfana, no insertada. ` +
        `Envuelve el pipeline en runWithTelemetryContext({ workspaceId }) desde el route handler.`,
    );
  }
}

/** Mediciones que quedaron sin tenant en esta instancia (diagnóstico + tests). */
export function getOrphanTelemetryRows(): readonly OrphanTelemetryRecord[] {
  return orphanRows;
}

/**
 * Persiste la telemetria de UNA llamada a `callFinancialAgent`.
 *
 * Fire-and-forget: nunca lanza. Devuelve `true` si la fila se inserto, `false`
 * si se omitio (sin workspace, sin DB configurada o error de insert) — el valor
 * existe para los tests; el caller de produccion la invoca con `void`.
 */
export async function persistAgentTelemetry(row: AgentTelemetryInput): Promise<boolean> {
  try {
    // Sin DATABASE_URL (tests unitarios, build) no hay nada que escribir.
    if (!process.env.DATABASE_URL) return false;

    // Precedencia: argumento explícito > contexto del route handler > cookie.
    // La cookie es el último recurso justamente porque dentro del stream SSE ya
    // no hay scope de request y `cookies()` lanza.
    const ctx = getTelemetryContext();
    const raw = row.workspaceId ?? ctx?.workspaceId ?? (await resolveWorkspaceFromRequest());

    if (!raw) {
      recordOrphanTelemetry('sin-workspace', row);
      return false;
    }
    const workspaceId = asTelemetryUuid(raw);
    if (!workspaceId) {
      // Cookie forjada/corrupta: sin este filtro el INSERT moriría con
      // `invalid input syntax for type uuid` y la medición se perdería igual.
      recordOrphanTelemetry('workspace-no-uuid', row);
      return false;
    }

    const costUsdMicros = calculateCostUsdMicros({
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
      cachedInputTokens: row.cachedInputTokens ?? 0,
    });

    const db = getDb();
    await db.insert(agentTelemetry).values({
      workspaceId,
      reportId: row.reportId ?? ctx?.reportId ?? null,
      agentName: row.agentName,
      modelId: row.modelId,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      reasoningTokens: row.reasoningTokens ?? null,
      cachedInputTokens: row.cachedInputTokens ?? null,
      // `null` (no 0) cuando no conocemos la tarifa del modelo — ver
      // telemetry-pricing.ts.
      costUsdMicros,
      elapsedMs: Math.max(0, Math.round(row.elapsedMs)),
      finishReason: row.finishReason ?? null,
      fallbackUsed: row.fallbackUsed ?? false,
      firstPassReasoningTokens: row.firstPassReasoningTokens ?? null,
      firstPassFinishReason: row.firstPassFinishReason ?? null,
    });
    return true;
  } catch (err) {
    // Fire-and-forget — telemetria no debe romper el pipeline.
    console.error('[persistAgentTelemetry] insert failed:', err);
    return false;
  }
}

/** Solo para tests: limpia la deduplicacion de logs y el buffer de huerfanas. */
export function __resetTelemetryLogDedupeForTests(): void {
  missingWorkspaceReported.clear();
  orphanRows.length = 0;
}
