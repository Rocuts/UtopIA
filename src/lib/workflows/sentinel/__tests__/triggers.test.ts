import { describe, expect, it } from 'vitest';

import { runT1 } from '../triggers/r1-truth-gap';
import { runT2 } from '../triggers/r2-shield-liquidity';
import { runT3 } from '../triggers/r3-value-anomaly';
import { runT4 } from '../triggers/r4-future-inflection';
import {
  ESCALATE_THRESHOLD_HOURS,
  REEMIT_THRESHOLD_HOURS,
  evaluateEscalation,
} from '../relevance-learning';
import type { SentinelMetrics } from '../types';
import type { SentinelAlertRow } from '@/lib/db/schema-sentinel';

const baseMetrics: SentinelMetrics & { equationGapAmount: number } = {
  equationGapPct: 0,
  equationGapAmount: 0,
  diasAutonomia: 90,
  coberturaFiscal: 1,
  margenBruto: 0.4,
  diasInventario: 60,
  puntoInflexion: null,
  efectivo: 1_000_000_000,
  utilidadNeta: 200_000_000,
  impuestos: 70_000_000,
};

const ctx = { workspaceId: 'ws-1', periodId: 'p-1', empresarioNombre: 'Andreita' };

// ─── T1 ─────────────────────────────────────────────────────────────────────
describe('T1 — Truth Gap', () => {
  it('no dispara cuando gap < 0.01%', () => {
    const out = runT1({ ...baseMetrics, equationGapPct: 0.00005, equationGapAmount: 50_000 }, ctx);
    expect(out.fired).toBe(false);
  });
  it('dispara cuando gap > 0.01%', () => {
    const out = runT1(
      { ...baseMetrics, equationGapPct: 0.02, equationGapAmount: 456_000_000 },
      ctx,
    );
    expect(out.fired).toBe(true);
    expect(out.insight?.severity).toBe('critico');
    expect(out.insight?.subject).toContain('Integridad');
    expect(out.insight?.hallazgo).toContain('Andreita');
    expect(out.insight?.dedupKey).toBe('T1-verdad-ws-1-p-1');
  });
});

// ─── T2 ─────────────────────────────────────────────────────────────────────
describe('T2 — Shield / Liquidity', () => {
  it('no dispara con días=90 y caja > impuestos esperados', () => {
    const out = runT2(baseMetrics, ctx);
    expect(out.fired).toBe(false);
  });
  it('dispara con días=30', () => {
    const out = runT2({ ...baseMetrics, diasAutonomia: 30 }, ctx);
    expect(out.fired).toBe(true);
    expect(out.insight?.pillar).toBe('escudo');
  });
  it('dispara cuando caja < utilidad×35%', () => {
    const out = runT2(
      { ...baseMetrics, efectivo: 5_000_000, utilidadNeta: 1_000_000_000, impuestos: 1_000_000 },
      ctx,
    );
    expect(out.fired).toBe(true);
  });
});

// ─── T3 ─────────────────────────────────────────────────────────────────────
describe('T3 — Value / Anomaly', () => {
  it('no dispara con margen 40% e inventario 60 días', () => {
    expect(runT3(baseMetrics, ctx).fired).toBe(false);
  });
  it('dispara con margen >90%', () => {
    const out = runT3({ ...baseMetrics, margenBruto: 0.95 }, ctx);
    expect(out.fired).toBe(true);
    expect(out.insight?.severity).toBe('advertencia');
  });
  it('dispara con días de inventario >365', () => {
    const out = runT3({ ...baseMetrics, diasInventario: 400 }, ctx);
    expect(out.fired).toBe(true);
  });
});

// ─── T4 ─────────────────────────────────────────────────────────────────────
describe('T4 — Future / Inflection', () => {
  it('no dispara cuando puntoInflexion es null', () => {
    expect(runT4(baseMetrics, ctx).fired).toBe(false);
  });
  it('no dispara cuando puntoInflexion >= 12', () => {
    expect(runT4({ ...baseMetrics, puntoInflexion: 18 }, ctx).fired).toBe(false);
  });
  it('dispara cuando puntoInflexion < 12 con mes/año/trimestre', () => {
    const out = runT4(
      { ...baseMetrics, puntoInflexion: 8 },
      { ...ctx, referenceDate: new Date('2026-05-01T00:00:00Z') },
    );
    expect(out.fired).toBe(true);
    expect(out.insight?.subject).toContain('inflexión');
    expect(out.insight?.subject).toContain('8');
  });
});

// ─── Relevance Learning ────────────────────────────────────────────────────
describe('Relevance Learning — evaluateEscalation', () => {
  function makeAlert(overrides: Partial<SentinelAlertRow> = {}): SentinelAlertRow {
    const now = new Date();
    return {
      id: 'a-1',
      workspaceId: 'ws-1',
      periodId: null,
      pillar: 'verdad',
      triggerCode: 'T1',
      severity: 'critico',
      dedupKey: 'k-1',
      status: 'pending',
      payload: {},
      snoozedUntil: null,
      resolvedAt: null,
      resolvedBy: null,
      escalatedAt: null,
      repeatedCount: 0,
      lastNotifiedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('noop si alert <48h', () => {
    const a = makeAlert({ lastNotifiedAt: new Date(Date.now() - 10 * 3_600_000) });
    expect(evaluateEscalation(a).kind).toBe('noop');
  });

  it('reemit si alert ≥48h y <96h', () => {
    const a = makeAlert({
      severity: 'advertencia',
      lastNotifiedAt: new Date(Date.now() - (REEMIT_THRESHOLD_HOURS + 2) * 3_600_000),
    });
    const action = evaluateEscalation(a);
    expect(action.kind).toBe('reemit');
    if (action.kind === 'reemit') {
      expect(action.newSeverity).toBe('critico');
    }
  });

  it('escalate si alert ≥96h', () => {
    const a = makeAlert({
      lastNotifiedAt: new Date(Date.now() - (ESCALATE_THRESHOLD_HOURS + 2) * 3_600_000),
    });
    const action = evaluateEscalation(a);
    expect(action.kind).toBe('escalate');
  });

  it('resolved/escalated retornan noop sin importar tiempo', () => {
    const a = makeAlert({
      status: 'resolved',
      resolvedAt: new Date(),
      lastNotifiedAt: new Date(Date.now() - 200 * 3_600_000),
    });
    expect(evaluateEscalation(a).kind).toBe('noop');
  });

  it('snoozed expirado → unsnooze', () => {
    const past = new Date(Date.now() - 60_000);
    const a = makeAlert({ status: 'snoozed', snoozedUntil: past });
    expect(evaluateEscalation(a).kind).toBe('unsnooze');
  });

  it('snoozed vigente → noop', () => {
    const future = new Date(Date.now() + 7 * 24 * 3_600_000);
    const a = makeAlert({ status: 'snoozed', snoozedUntil: future });
    expect(evaluateEscalation(a).kind).toBe('noop');
  });
});
