// ---------------------------------------------------------------------------
// Sentinel Workflow — orquestador durable (Vercel WDK).
// ---------------------------------------------------------------------------
// Patrón idéntico al WS5 monthly-close:
//   - 'use workflow' a nivel del orquestador.
//   - 'use step' en cada step que toca DB / I/O.
// ---------------------------------------------------------------------------

import 'server-only';

import { getDb } from '@/lib/db/client';
import { aggregatePillars } from '@/lib/pillars/service';
import type { PillarsResult } from '@/lib/pillars/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { sendInsightAlert } from '@/lib/notifications/sentinel-insight';

import { runT1 } from './triggers/r1-truth-gap';
import { runT2 } from './triggers/r2-shield-liquidity';
import { runT3 } from './triggers/r3-value-anomaly';
import { runT4 } from './triggers/r4-future-inflection';
import { evaluateEscalation } from './relevance-learning';
import * as repo from './repository';
import type {
  SentinelEvaluation,
  SentinelInput,
  SentinelMetrics,
  SentinelRunReport,
  TriggerCode,
  TriggerEvaluation,
} from './types';

// ---------------------------------------------------------------------------
// Step 1: cargar snapshot + pillars + métricas derivadas.
// ---------------------------------------------------------------------------

interface SentinelLoadResult {
  pillars: PillarsResult;
  metrics: SentinelMetrics & { equationGapAmount: number };
  empresarioNombre?: string;
  language: 'es' | 'en';
}

async function loadSentinelData(
  input: SentinelInput,
  preprocessed: PreprocessedBalance | null,
): Promise<SentinelLoadResult | null> {
  'use step';

  if (!preprocessed) return null;

  const snapshot = preprocessed.primary;
  const comparative = preprocessed.comparative;

  const pillars = aggregatePillars({
    snapshot,
    comparative: comparative ?? undefined,
  });

  const ct = snapshot.controlTotals;
  const equationGapAmount = ct.activo - (ct.pasivo + ct.patrimonio);
  const equationGapPct = ct.activo > 0 ? Math.abs(equationGapAmount) / ct.activo : 0;

  // Días de autonomía y cobertura fiscal vienen del pilar Escudo.
  const escudoKpis = pillars.escudo.kpis;
  const diasAutonomia =
    (escudoKpis.find((k) => k.key === 'dias_autonomia')?.value as number | null) ?? null;
  const coberturaFiscal =
    (escudoKpis.find((k) => k.key === 'cobertura_fiscal')?.value as number | null) ?? null;

  // Punto de inflexión viene del pilar Futuro.
  const futuroKpis = pillars.futuro.kpis;
  const puntoInflexion =
    (futuroKpis.find((k) => k.key === 'punto_inflexion')?.value as number | null) ?? null;

  // Margen bruto e inventario aproximados desde control totals (no-NIIF).
  // Margen bruto = 1 − costos/ingresos. PUC clase 6 = costos.
  const costosClase6 = snapshot.classes.find((c) => c.code === 6)?.auxiliaryTotal ?? 0;
  const margenBruto = ct.ingresos > 0 ? 1 - costosClase6 / ct.ingresos : null;

  const inventario = snapshot.classes.find((c) => c.code === 1)?.accounts.filter((a) => a.code.startsWith('14')).reduce((s, a) => s + a.balance, 0) ?? 0;
  const costoDiario = costosClase6 / 365;
  const diasInventario = costoDiario > 0 ? inventario / costoDiario : null;

  const metrics: SentinelLoadResult['metrics'] = {
    equationGapPct,
    equationGapAmount,
    diasAutonomia,
    coberturaFiscal,
    margenBruto,
    diasInventario,
    puntoInflexion,
    efectivo: ct.efectivoCuenta11,
    utilidadNeta: ct.utilidadNeta,
    impuestos: ct.impuestosCuenta24,
  };

  return {
    pillars,
    metrics,
    language: 'es',
  };
}

// ---------------------------------------------------------------------------
// Step 2: ejecutar 4 triggers (puros, no DB).
// ---------------------------------------------------------------------------

function evaluateTriggers(
  data: SentinelLoadResult,
  ctx: { workspaceId: string; periodId?: string | null },
): Record<TriggerCode, TriggerEvaluation> {
  const triggerCtx = {
    workspaceId: ctx.workspaceId,
    periodId: ctx.periodId,
    language: data.language,
    empresarioNombre: data.empresarioNombre,
  };
  const errors: Record<string, string> = {};
  const result: Record<TriggerCode, TriggerEvaluation> = {
    T1: { fired: false },
    T2: { fired: false },
    T3: { fired: false },
    T4: { fired: false },
  };

  try {
    result.T1 = runT1(data.metrics, triggerCtx);
  } catch (err) {
    errors.T1 = err instanceof Error ? err.message : String(err);
  }
  try {
    result.T2 = runT2(data.metrics, triggerCtx);
  } catch (err) {
    errors.T2 = err instanceof Error ? err.message : String(err);
  }
  try {
    result.T3 = runT3(data.metrics, triggerCtx);
  } catch (err) {
    errors.T3 = err instanceof Error ? err.message : String(err);
  }
  try {
    result.T4 = runT4(data.metrics, triggerCtx);
  } catch (err) {
    errors.T4 = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 3: persistir + notificar.
// ---------------------------------------------------------------------------

async function persistAndNotify(
  evaluation: SentinelEvaluation,
  options: { workspaceId: string; periodId?: string | null; recipient?: string; dryRun?: boolean },
): Promise<{ upserted: string[]; reemitted: string[]; escalated: string[] }> {
  'use step';

  const db = getDb();
  const upserted: string[] = [];
  const reemitted: string[] = [];
  const escalated: string[] = [];

  // 3a. Upsertear cada Insight disparado.
  for (const code of ['T1', 'T2', 'T3', 'T4'] as TriggerCode[]) {
    const trig = evaluation.triggers[code];
    if (!trig.fired || !trig.insight) continue;
    const { row, isNew } = await repo.upsertAlert(db, trig.insight, {
      workspaceId: options.workspaceId,
      periodId: options.periodId,
    });
    upserted.push(row.dedupKey);

    // Email al recipient si es nuevo o si el escalation lo amerita.
    if (isNew && options.recipient) {
      await sendInsightAlert(trig.insight, {
        recipient: options.recipient,
        language: trig.insight.language,
        dryRun: options.dryRun,
      });
    }
  }

  // 3b. Revisar alerts pending existentes para escalation.
  const pending = await repo.findPendingAlertsForWorkspace(db, options.workspaceId);
  const now = new Date();
  for (const alert of pending) {
    const action = evaluateEscalation(alert, now);
    if (action.kind === 'noop') continue;
    if (action.kind === 'unsnooze') {
      await repo.unsnoozeAlert(db, alert.id);
      continue;
    }
    if (action.kind === 'reemit') {
      await repo.bumpReemitted(db, alert.id, action.newSeverity);
      reemitted.push(alert.dedupKey);
      if (options.recipient) {
        const insight = alert.payload as unknown as Parameters<typeof sendInsightAlert>[0];
        await sendInsightAlert(
          { ...insight, tone: 'escalated', severity: action.newSeverity ?? alert.severity },
          { recipient: options.recipient, dryRun: options.dryRun },
        );
      }
    } else if (action.kind === 'escalate') {
      await repo.markEscalated(db, alert.id, action.newSeverity);
      escalated.push(alert.dedupKey);
      if (options.recipient) {
        const insight = alert.payload as unknown as Parameters<typeof sendInsightAlert>[0];
        await sendInsightAlert(
          { ...insight, tone: 'critical', severity: 'critico' },
          { recipient: options.recipient, dryRun: options.dryRun },
        );
      }
    }
  }

  return { upserted, reemitted, escalated };
}

// ---------------------------------------------------------------------------
// Workflow principal — durable.
// ---------------------------------------------------------------------------

export async function runSentinelCheck(
  input: SentinelInput,
  preprocessed: PreprocessedBalance | null,
): Promise<SentinelRunReport> {
  'use workflow';

  const data = await loadSentinelData(input, preprocessed);
  if (!data) {
    return {
      workspaceId: input.workspaceId,
      periodId: input.periodId,
      triggers: {
        T1: { fired: false },
        T2: { fired: false },
        T3: { fired: false },
        T4: { fired: false },
      },
      pillars: {
        escudo: { pillarId: 'escudo', healthScore: 0, status: 'critical', kpis: [], alerts: [], generatedAt: new Date().toISOString() },
        valor: { pillarId: 'valor', healthScore: 0, status: 'critical', kpis: [], alerts: [], generatedAt: new Date().toISOString() },
        verdad: { pillarId: 'verdad', healthScore: 0, status: 'critical', kpis: [], alerts: [], generatedAt: new Date().toISOString() },
        futuro: { pillarId: 'futuro', healthScore: 0, status: 'critical', kpis: [], alerts: [], generatedAt: new Date().toISOString() },
        overallScore: 0,
        overallStatus: 'critical',
        generatedAt: new Date().toISOString(),
      },
      generatedAt: new Date().toISOString(),
      upsertedAlerts: [],
      reemittedAlerts: [],
      escalatedAlerts: [],
      errors: { load: 'no_preprocessed_data' },
    };
  }

  const triggers = evaluateTriggers(data, {
    workspaceId: input.workspaceId,
    periodId: input.periodId,
  });

  const evaluation: SentinelEvaluation = {
    workspaceId: input.workspaceId,
    periodId: input.periodId,
    triggers,
    pillars: data.pillars,
    generatedAt: new Date().toISOString(),
  };

  const persistResult = await persistAndNotify(evaluation, {
    workspaceId: input.workspaceId,
    periodId: input.periodId,
    recipient: input.recipient,
    dryRun: input.dryRun,
  });

  return {
    ...evaluation,
    upsertedAlerts: persistResult.upserted,
    reemittedAlerts: persistResult.reemitted,
    escalatedAlerts: persistResult.escalated,
    errors: {},
  };
}

// Pure-function variant for tests (no I/O, no DB).
export function evaluateTriggersForTest(
  data: SentinelLoadResult,
  ctx: { workspaceId: string; periodId?: string | null },
) {
  return evaluateTriggers(data, ctx);
}
