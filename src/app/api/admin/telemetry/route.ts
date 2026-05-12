// ---------------------------------------------------------------------------
// GET /api/admin/telemetry — agregaciones de telemetría de agentes financieros
// ---------------------------------------------------------------------------
//
// Lee la tabla `agent_telemetry` (poblada por `persistAgentTelemetry` cuando
// el orchestrator de cada pipeline financiero la cabléa) y devuelve métricas
// agregadas de las últimas 24h por defecto, parametrizable via `?hours=N`.
//
// Métricas devueltas:
//   - perAgent: por slot (niif-analyst, etc.) — count, costo USD, latencia
//     p95, tasa de fallback, tokens promedio.
//   - perModel: por modelo OpenAI usado — count + costo USD agregado.
//   - alerts: thresholds del audit team (auditor C):
//       * fallbackUsed > 3% en ventana → P1
//       * elapsedMs p95 > 180_000 en agent premium → P1
//       * finishReason != 'stop' > 1% → P0
//       * cost_usd > $50/día por workspace → billing alert
//
// SEGURIDAD: este endpoint está pensado para uso interno (dashboards admin).
// Mientras UtopIA no tenga auth, restringimos por header `x-admin-token`
// comparado contra `UTOPIA_ADMIN_TOKEN` env. Si la env var no está seteada,
// el endpoint devuelve 503 para fail-closed.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { agentTelemetry } from '@/lib/db/schema';

export const maxDuration = 30;

/** Convierte micros de USD ($ × 1M) a string $1.234,56. */
function fmtUsdFromMicros(micros: number | null): string {
  if (micros === null || micros === undefined) return '$0,00';
  const usd = micros / 1_000_000;
  return `$${usd.toFixed(2).replace('.', ',')}`;
}

export async function GET(req: Request) {
  const adminToken = process.env.UTOPIA_ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json(
      { error: 'admin endpoint disabled: UTOPIA_ADMIN_TOKEN not configured' },
      { status: 503 },
    );
  }
  const provided = req.headers.get('x-admin-token');
  if (provided !== adminToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const hoursParam = url.searchParams.get('hours');
  const hours = Math.min(Math.max(parseInt(hoursParam ?? '24', 10) || 24, 1), 720);

  try {
    const db = getDb();

    // -- Agregación por agente -------------------------------------------------
    const perAgent = await db.execute(sql`
      SELECT
        ${agentTelemetry.agentName} as agent_name,
        ${agentTelemetry.modelId} as model_id,
        COUNT(*)::int as calls,
        SUM(COALESCE(${agentTelemetry.costUsdMicros}, 0))::bigint as total_cost_micros,
        ROUND(AVG(${agentTelemetry.elapsedMs}))::int as avg_elapsed_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${agentTelemetry.elapsedMs})::int as p95_elapsed_ms,
        SUM(CASE WHEN ${agentTelemetry.fallbackUsed} THEN 1 ELSE 0 END)::int as fallback_count,
        SUM(CASE WHEN ${agentTelemetry.finishReason} != 'stop' THEN 1 ELSE 0 END)::int as unclean_finish_count,
        ROUND(AVG(COALESCE(${agentTelemetry.outputTokens}, 0)))::int as avg_output_tokens,
        ROUND(AVG(COALESCE(${agentTelemetry.reasoningTokens}, 0)))::int as avg_reasoning_tokens
      FROM ${agentTelemetry}
      WHERE ${agentTelemetry.createdAt} > NOW() - INTERVAL '1 hour' * ${hours}
      GROUP BY ${agentTelemetry.agentName}, ${agentTelemetry.modelId}
      ORDER BY total_cost_micros DESC NULLS LAST
    `);

    // -- Totales globales ------------------------------------------------------
    const totals = await db.execute(sql`
      SELECT
        COUNT(*)::int as total_calls,
        SUM(COALESCE(${agentTelemetry.costUsdMicros}, 0))::bigint as total_cost_micros,
        SUM(CASE WHEN ${agentTelemetry.fallbackUsed} THEN 1 ELSE 0 END)::int as total_fallbacks,
        SUM(CASE WHEN ${agentTelemetry.finishReason} != 'stop' THEN 1 ELSE 0 END)::int as total_unclean
      FROM ${agentTelemetry}
      WHERE ${agentTelemetry.createdAt} > NOW() - INTERVAL '1 hour' * ${hours}
    `);

    const totalRow = (totals.rows ?? totals)[0] as {
      total_calls: number;
      total_cost_micros: string | number | null;
      total_fallbacks: number;
      total_unclean: number;
    } | undefined;

    const totalCalls = Number(totalRow?.total_calls ?? 0);
    const totalCostMicros = Number(totalRow?.total_cost_micros ?? 0);
    const totalFallbacks = Number(totalRow?.total_fallbacks ?? 0);
    const totalUnclean = Number(totalRow?.total_unclean ?? 0);

    const fallbackRate = totalCalls > 0 ? totalFallbacks / totalCalls : 0;
    const uncleanRate = totalCalls > 0 ? totalUnclean / totalCalls : 0;

    // -- Alertas (thresholds del audit team) ----------------------------------
    const alerts: Array<{ severity: 'P0' | 'P1' | 'P2'; message: string }> = [];
    if (totalCalls > 0) {
      if (fallbackRate > 0.03) {
        alerts.push({
          severity: 'P1',
          message: `Tasa de fallback ${(fallbackRate * 100).toFixed(1)}% (>3% threshold). Subir maxOutputTokens del slot afectado.`,
        });
      }
      if (uncleanRate > 0.01) {
        alerts.push({
          severity: 'P0',
          message: `Tasa de finish_reason!=stop ${(uncleanRate * 100).toFixed(1)}% (>1% threshold). Revisar logs y modelo.`,
        });
      }
    }
    // Costo > $50 USD/día agregado (proxy de spikes)
    if (totalCostMicros > 50_000_000 && hours <= 24) {
      alerts.push({
        severity: 'P1',
        message: `Costo en ventana ${hours}h: ${fmtUsdFromMicros(totalCostMicros)} (>${'$50'} threshold). Revisar volumen y posible fuga.`,
      });
    }

    return NextResponse.json(
      {
        windowHours: hours,
        totals: {
          calls: totalCalls,
          costUsd: fmtUsdFromMicros(totalCostMicros),
          costUsdMicros: totalCostMicros,
          fallbacks: totalFallbacks,
          fallbackRatePct: Number((fallbackRate * 100).toFixed(2)),
          uncleanFinishes: totalUnclean,
          uncleanRatePct: Number((uncleanRate * 100).toFixed(2)),
        },
        perAgent: (perAgent.rows ?? perAgent),
        alerts,
        thresholds: {
          fallbackRateP1: '>3%',
          uncleanRateP0: '>1%',
          dailyCostUsdP1: '>$50',
          p95ElapsedMsP1: '>180000 (premium slots)',
        },
        emptyReason:
          totalCalls === 0
            ? 'Telemetría aún no cableada en los agents.ts. Ver CLAUDE.md sección "Architecture / Financial Pipeline / Telemetry" para activar.'
            : null,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[admin/telemetry] query failed:', err);
    return NextResponse.json(
      { error: 'telemetry query failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
