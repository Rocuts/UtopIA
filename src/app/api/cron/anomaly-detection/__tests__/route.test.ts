// IW4 (auditoria-calidad-19) — El cron forense sólo notificaba con score < 70
// o anomalías altas. Un escaneo PARCIAL (reglas que no se pudieron evaluar)
// sin anomalías tiene score 100 y pasaba en silencio como "limpio". Debe
// notificar la cobertura parcial y reportarla en el resumen.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.hoisted(() => vi.fn(async () => ({ sent: 1 })));
const scan = vi.hoisted(() => ({ result: null as unknown }));

vi.mock('@/lib/security/cron-auth', () => ({ checkCronAuth: () => null }));
vi.mock('@/lib/notifications/dispatch', () => ({ dispatch }));
vi.mock('@/lib/agents/financial/audit/forensic', () => ({
  runForensicScan: vi.fn(async () => scan.result),
}));
vi.mock('@/lib/db/schema', () => ({
  workspaces: { __t: 'workspaces' },
  accountingPeriods: { __t: 'periods' },
  reports: { __t: 'reports' },
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), desc: () => ({}), or: () => ({}) }));
vi.mock('@/lib/db/client', () => {
  const rowsFor = (t: { __t: string }) =>
    t.__t === 'workspaces'
      ? [{ id: 'ws-1', name: 'Empresa' }]
      : t.__t === 'periods'
        ? [{ id: 'p-1', year: 2026, month: 8, status: 'open' }]
        : [];
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      then: (resolve: (v: unknown[]) => void) => resolve(rows),
    });
    return q;
  };
  const db = {
    select: () => ({ from: (t: { __t: string }) => query(rowsFor(t)) }),
    insert: () => ({ values: async () => undefined }),
  };
  return { getDb: () => db };
});

import { GET } from '../route';
import type { NextRequest } from 'next/server';

function result(overrides: Record<string, unknown>) {
  return {
    workspaceId: 'ws-1',
    periodId: 'p-1',
    scanStartedAt: new Date('2026-09-01T00:00:00Z'),
    scanDurationMs: 5,
    totalAnomalies: 0,
    bySeverity: { low: 0, medium: 0, high: 0 },
    score: 100,
    anomalies: [],
    warnings: [],
    rulesEvaluated: ['numeration_gap'],
    rulesFailed: [],
    coverage: 'completa',
    ...overrides,
  };
}

beforeEach(() => {
  dispatch.mockClear();
  process.env.UTOPIA_ENABLE_ANOMALY_DETECTION = 'true';
  process.env.UTOPIA_ENABLE_NOTIFICATIONS = 'true';
});

const req = new Request('https://x/api/cron/anomaly-detection') as unknown as NextRequest;

describe('cron anomaly-detection — cobertura parcial', () => {
  it('escaneo parcial sin anomalías (score 100) notifica la cobertura y la reporta', async () => {
    scan.result = result({ coverage: 'parcial', rulesFailed: ['benford_violation', 'weekend_posting'] });
    const res = await GET(req);
    const body = (await res.json()) as {
      summary: Array<{ coverage?: string; rulesFailed?: string[]; action: string }>;
    };
    expect(body.summary[0]).toMatchObject({
      action: 'scanned',
      coverage: 'parcial',
      rulesFailed: ['benford_violation', 'weekend_posting'],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const payload = (dispatch.mock.calls[0] as unknown as [{ payload: { description: string; anomalyKind: string } }])[0].payload;
    expect(payload.anomalyKind).toBe('cobertura_parcial');
    expect(payload.description).toMatch(/parcial/);
    expect(payload.description).toMatch(/benford_violation/);
  });

  it('escaneo completo y limpio no notifica', async () => {
    scan.result = result({});
    await GET(req);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
