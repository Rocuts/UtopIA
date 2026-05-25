// ---------------------------------------------------------------------------
// Feed unificado de actividad — normaliza múltiples fuentes en un solo stream.
// ---------------------------------------------------------------------------
//
// El visor /admin muestra UN solo timeline que combina:
//   - system_activity_log  (eventos generales — fuente 'activity')
//   - agent_telemetry      (llamadas a agentes IA — fuente 'agent')
//   - notification_log     (despacho de notificaciones — fuente 'notification')
//   - tax_engine_audits    (decisiones del motor tributario — fuente 'tax')
//
// Cada fuente se consulta acotada a una ventana de tiempo (con un tope por
// fuente), se normaliza a `ActivityEvent`, y luego se fusionan, filtran,
// ordenan y paginan en memoria. Para una herramienta admin sobre ventanas
// acotadas esto es suficiente y mantiene el endpoint simple.
//
// Sólo LECTURA. La escritura del log general vive en src/lib/db/activity-log.ts.

import { and, desc, gte, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  agentTelemetry,
  notificationLog,
  systemActivityLog,
  taxEngineAudits,
} from '@/lib/db/schema';
import type { ActivityLevel } from '@/lib/db/activity-log';

export type ActivitySource = 'activity' | 'agent' | 'notification' | 'tax';

export const ALL_SOURCES: ActivitySource[] = [
  'activity',
  'agent',
  'notification',
  'tax',
];

/** Categoría fija que cada fuente derivada aporta (la fuente 'activity' es multi-categoría). */
const SOURCE_FIXED_CATEGORY: Record<Exclude<ActivitySource, 'activity'>, string> =
  {
    agent: 'agent',
    notification: 'notification',
    tax: 'tax',
  };

/** Forma común a la que se normaliza cualquier evento. */
export interface ActivityEvent {
  /** Id estable y único entre fuentes: `${source}:${rowId}`. */
  id: string;
  source: ActivitySource;
  /** Timestamp ISO 8601. */
  ts: string;
  category: string;
  action: string;
  level: ActivityLevel;
  message: string;
  workspaceId: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
}

export interface ActivityQuery {
  hours: number;
  /** Fuentes a incluir. Default: todas. */
  sources?: ActivitySource[];
  /** Filtrar por categoría (sobre el set normalizado). */
  categories?: string[];
  /** Filtrar por severidad. */
  levels?: ActivityLevel[];
  /** Búsqueda de texto libre (message/action/category, case-insensitive). */
  q?: string;
  limit: number;
  offset: number;
}

export interface ActivityResult {
  events: ActivityEvent[];
  /** Total de eventos que matchean el filtro (antes de paginar). */
  total: number;
  windowHours: number;
  stats: {
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
  };
  sourcesQueried: ActivitySource[];
}

/** Tope de filas por fuente para acotar memoria en ventanas grandes. */
const PER_SOURCE_CAP = 3000;

// ---------------------------------------------------------------------------
// Normalizadores por fuente
// ---------------------------------------------------------------------------

function fmtUsd(micros: number | null): string {
  if (!micros) return '$0,00';
  return `$${(micros / 1_000_000).toFixed(2).replace('.', ',')}`;
}

function normalizeAgent(
  row: typeof agentTelemetry.$inferSelect,
): ActivityEvent {
  const unclean = row.finishReason !== null && row.finishReason !== 'stop';
  const level: ActivityLevel = unclean
    ? 'error'
    : row.fallbackUsed
      ? 'warn'
      : 'info';
  const suffix = unclean ? '.unclean' : row.fallbackUsed ? '.fallback' : '';
  return {
    id: `agent:${row.id}`,
    source: 'agent',
    ts: row.createdAt.toISOString(),
    category: 'agent',
    action: `agent.${row.agentName}${suffix}`,
    level,
    message: `${row.agentName} · ${row.modelId} · ${row.elapsedMs}ms · ${fmtUsd(row.costUsdMicros)}`,
    workspaceId: row.workspaceId,
    durationMs: row.elapsedMs,
    metadata: {
      modelId: row.modelId,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cachedInputTokens: row.cachedInputTokens,
      costUsd: fmtUsd(row.costUsdMicros),
      finishReason: row.finishReason,
      fallbackUsed: row.fallbackUsed,
      reportId: row.reportId,
    },
  };
}

function normalizeNotification(
  row: typeof notificationLog.$inferSelect,
): ActivityEvent {
  const level: ActivityLevel =
    row.status === 'failed'
      ? 'error'
      : row.status === 'skipped'
        ? 'warn'
        : 'info';
  return {
    id: `notification:${row.id}`,
    source: 'notification',
    ts: row.sentAt.toISOString(),
    category: 'notification',
    action: `notification.${row.event}.${row.channel}`,
    level,
    message: `${row.event} → ${row.channel} (${row.status})`,
    workspaceId: row.workspaceId,
    durationMs: null,
    metadata: {
      channel: row.channel,
      recipientId: row.recipientId,
      status: row.status,
      attempts: row.attempts,
      providerMessageId: row.providerMessageId,
      errorMessage: row.errorMessage,
    },
  };
}

function normalizeTax(
  row: typeof taxEngineAudits.$inferSelect,
): ActivityEvent {
  const rules = Array.isArray(row.matchedRuleIds) ? row.matchedRuleIds.length : 0;
  const hasOverride = Boolean(row.overrideReason);
  return {
    id: `tax:${row.id}`,
    source: 'tax',
    ts: row.createdAt.toISOString(),
    category: 'tax',
    action: hasOverride ? 'tax-engine.classify.overridden' : 'tax-engine.classify',
    level: hasOverride ? 'warn' : 'info',
    message: `Clasificación fiscal · ${rules} regla(s)${hasOverride ? ' · override manual' : ''}`,
    workspaceId: row.workspaceId,
    durationMs: null,
    metadata: {
      matchedRuleIds: row.matchedRuleIds,
      journalEntryId: row.journalEntryId,
      overrideReason: row.overrideReason,
    },
  };
}

function normalizeActivity(
  row: typeof systemActivityLog.$inferSelect,
): ActivityEvent {
  return {
    id: `activity:${row.id}`,
    source: 'activity',
    ts: row.createdAt.toISOString(),
    category: row.category,
    action: row.action,
    level: (row.level as ActivityLevel) ?? 'info',
    message: row.message,
    workspaceId: row.workspaceId,
    durationMs: row.durationMs,
    metadata: {
      ...(row.metadata ?? {}),
      ...(row.statusCode != null ? { statusCode: row.statusCode } : {}),
      ...(row.method ? { method: row.method } : {}),
      ...(row.path ? { path: row.path } : {}),
      ...(row.resourceType ? { resourceType: row.resourceType } : {}),
      ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      ...(row.userId ? { userId: row.userId } : {}),
      ...(row.ip ? { ip: row.ip } : {}),
      ...(row.requestId ? { requestId: row.requestId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Selección de fuentes según filtros
// ---------------------------------------------------------------------------

function resolveSources(query: ActivityQuery): ActivitySource[] {
  let sources = query.sources?.length ? query.sources : ALL_SOURCES;
  // Si hay filtro de categoría, descartar fuentes derivadas cuya categoría fija
  // no esté pedida. La fuente 'activity' siempre se mantiene (es multi-categoría).
  if (query.categories?.length) {
    const cats = new Set(query.categories);
    sources = sources.filter((s) => {
      if (s === 'activity') return true;
      return cats.has(SOURCE_FIXED_CATEGORY[s]);
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Query principal
// ---------------------------------------------------------------------------

export async function queryActivityFeed(
  query: ActivityQuery,
): Promise<ActivityResult> {
  const db = getDb();
  const cutoff = new Date(Date.now() - query.hours * 3_600_000);
  const sources = resolveSources(query);

  const collected: ActivityEvent[] = [];

  // -- system_activity_log -------------------------------------------------
  if (sources.includes('activity')) {
    const conds = [gte(systemActivityLog.createdAt, cutoff)];
    if (query.categories?.length) {
      conds.push(inArray(systemActivityLog.category, query.categories));
    }
    if (query.levels?.length) {
      conds.push(inArray(systemActivityLog.level, query.levels));
    }
    const rows = await db
      .select()
      .from(systemActivityLog)
      .where(and(...conds))
      .orderBy(desc(systemActivityLog.createdAt))
      .limit(PER_SOURCE_CAP);
    for (const r of rows) collected.push(normalizeActivity(r));
  }

  // -- agent_telemetry -----------------------------------------------------
  if (sources.includes('agent')) {
    const rows = await db
      .select()
      .from(agentTelemetry)
      .where(gte(agentTelemetry.createdAt, cutoff))
      .orderBy(desc(agentTelemetry.createdAt))
      .limit(PER_SOURCE_CAP);
    for (const r of rows) collected.push(normalizeAgent(r));
  }

  // -- notification_log ----------------------------------------------------
  if (sources.includes('notification')) {
    const rows = await db
      .select()
      .from(notificationLog)
      .where(gte(notificationLog.sentAt, cutoff))
      .orderBy(desc(notificationLog.sentAt))
      .limit(PER_SOURCE_CAP);
    for (const r of rows) collected.push(normalizeNotification(r));
  }

  // -- tax_engine_audits ---------------------------------------------------
  if (sources.includes('tax')) {
    const rows = await db
      .select()
      .from(taxEngineAudits)
      .where(gte(taxEngineAudits.createdAt, cutoff))
      .orderBy(desc(taxEngineAudits.createdAt))
      .limit(PER_SOURCE_CAP);
    for (const r of rows) collected.push(normalizeTax(r));
  }

  // -- Filtros finales (level/category/q sobre el set normalizado) ----------
  const levelSet = query.levels?.length ? new Set(query.levels) : null;
  const catSet = query.categories?.length ? new Set(query.categories) : null;
  const needle = query.q?.trim().toLowerCase() ?? '';

  const filtered = collected.filter((e) => {
    if (levelSet && !levelSet.has(e.level)) return false;
    if (catSet && !catSet.has(e.category)) return false;
    if (needle) {
      const hay = `${e.message} ${e.action} ${e.category}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // Orden global por tiempo descendente.
  filtered.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  // -- Stats (sobre el set filtrado, antes de paginar) ----------------------
  const byLevel: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const e of filtered) {
    byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  }

  const total = filtered.length;
  const events = filtered.slice(query.offset, query.offset + query.limit);

  return {
    events,
    total,
    windowHours: query.hours,
    stats: { byLevel, byCategory },
    sourcesQueried: sources,
  };
}
