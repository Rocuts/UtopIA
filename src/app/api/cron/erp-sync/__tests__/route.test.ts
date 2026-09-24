// ---------------------------------------------------------------------------
// GET /api/cron/erp-sync — no reporta «ok» sin persistencia
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (ingesta-18, integración IW5b). El cron leía el balance del
// ERP con `adapter.fetchTrialBalance`, descartaba el resultado, revalidaba las
// caches del workspace/pilares, recalculaba el balance preprocesado y
// registraba «ok»: gastaba cuota del ERP y declaraba una sincronización que no
// guardaba nada. Mismo cambio que el webhook (WP11): hasta que exista la ruta
// ERP → balance persistido, el estado honesto es `not_persisted`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  fetchTrialBalance: vi.fn(),
  revalidateTag: vi.fn(),
  getLatestOpenPeriod: vi.fn(),
  getCachedPreprocessedBalance: vi.fn(),
  loadCredentials: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({ from: async () => mocks.rows }),
  }),
}));
vi.mock('@/lib/erp/adapter', () => ({
  ERPAdapter: vi.fn().mockImplementation(() => ({ fetchTrialBalance: mocks.fetchTrialBalance })),
}));
vi.mock('@/lib/erp/credentials', () => ({ loadCredentials: mocks.loadCredentials }));
vi.mock('@/lib/cache/preprocessed-balance', () => ({
  getLatestOpenPeriod: mocks.getLatestOpenPeriod,
  getCachedPreprocessedBalance: mocks.getCachedPreprocessedBalance,
}));

import { GET } from '../route';

function cronReq(): Request {
  return new Request('http://localhost/api/cron/erp-sync', {
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret';
  mocks.rows = [
    { workspaceId: 'ws-a', provider: 'alegra', metadata: {} },
    { workspaceId: 'ws-b', provider: 'siigo', metadata: { enabled: false } },
  ];
  mocks.fetchTrialBalance.mockReset().mockResolvedValue({ accounts: [] });
  mocks.revalidateTag.mockReset();
  mocks.getLatestOpenPeriod.mockReset().mockResolvedValue({ id: 'p-1' });
  mocks.getCachedPreprocessedBalance.mockReset().mockResolvedValue(null);
  mocks.loadCredentials.mockReset().mockReturnValue({ provider: 'alegra', apiKey: 'x' });
});

describe('cron erp-sync — sin persistencia no hay «ok»', () => {
  it('no lee el ERP, no revalida caches ni recalcula el balance', async () => {
    const res = await GET(cronReq());
    expect(res.status).toBe(200);
    expect(mocks.fetchTrialBalance).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.getLatestOpenPeriod).not.toHaveBeenCalled();
    expect(mocks.getCachedPreprocessedBalance).not.toHaveBeenCalled();
  });

  it('responde status not_persisted con contadores (sin identificadores de workspace)', async () => {
    const body = await (await GET(cronReq())).json();
    expect(body.status).toBe('not_persisted');
    expect(body.processed).toBe(1);
    expect(body.notPersisted).toBe(1);
    expect(body.errors).toBe(0);
    expect(JSON.stringify(body)).not.toContain('ws-a');
    expect(body).not.toHaveProperty('synced');
  });

  it('una credencial que no se puede descifrar cuenta como error, no como pendiente', async () => {
    mocks.loadCredentials.mockImplementation(() => {
      throw new Error('bad key');
    });
    const body = await (await GET(cronReq())).json();
    expect(body.errors).toBe(1);
    expect(body.notPersisted).toBe(0);
  });

  it('sigue exigiendo el secreto del cron', async () => {
    const res = await GET(new Request('http://localhost/api/cron/erp-sync'));
    expect(res.status).toBe(401);
  });
});
