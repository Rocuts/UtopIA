// ─── /api/erp/sync — contrato con la UI (ingesta-18) y periodos (ingesta-17) ──

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: async () => ({ ok: true }) }));
vi.mock('@/lib/db/workspace', () => ({ requireWorkspace: async () => ({ id: 'ws-A' }) }));
vi.mock('@/lib/db/activity-log', () => ({ logApiActivity: async () => {} }));

const vaultRows: Array<Record<string, unknown>> = [];
const whereSpy = vi.fn();
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereSpy(cond);
          return { limit: async () => vaultRows };
        },
      }),
    }),
  }),
}));

vi.mock('@/lib/erp/credentials', () => ({
  loadCredentials: vi.fn((row: { workspaceId: string; provider: string }) => ({
    provider: row.provider,
    username: `vault-user-${row.workspaceId}`,
    apiKey: 'vault-key',
  })),
}));

const connector = {
  getTrialBalance: vi.fn(async (_creds: unknown, period: string) => ({
    period, companyName: '', currency: 'COP', accounts: [], totalDebit: 0, totalCredit: 0,
    generatedAt: '', balanceStatus: 'movements_only', balanceStatusReason: 'sólo movimientos', warnings: [],
  })),
  getChartOfAccounts: vi.fn(async () => []),
  getJournalEntries: vi.fn(async () => []),
  getInvoices: vi.fn(async () => []),
  getContacts: vi.fn(async () => []),
};
vi.mock('@/lib/erp/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/erp/registry')>();
  return { ...original, getConnector: vi.fn(async () => connector) };
});

const { POST } = await import('../route');

function post(body: unknown) {
  return POST(new Request('http://x/api/erp/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vaultRows.length = 0;
  vaultRows.push({ id: 'cred-1', workspaceId: 'ws-A', provider: 'siigo', encryptedSecret: 'x', metadata: {} });
  whereSpy.mockClear();
  for (const fn of Object.values(connector)) fn.mockClear();
});

describe('/api/erp/sync', () => {
  it('acepta el cuerpo de la UI (sin credenciales) y usa las del vault del workspace', async () => {
    const res = await post({ provider: 'siigo', syncTypes: ['trial_balance', 'contacts'], period: '2025' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(connector.getTrialBalance).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'siigo', username: 'vault-user-ws-A' }), '2025');
    expect(connector.getContacts).toHaveBeenCalledTimes(1);
    expect(connector.getInvoices).not.toHaveBeenCalled();
    // Honestidad: la lectura no se guarda ni alimenta informes.
    expect(body.persisted).toBe(false);
    expect(body.data.trialBalance.balanceStatus).toBe('movements_only');
  });

  it('sin credenciales guardadas para el proveedor → 404, sin llamar al ERP', async () => {
    vaultRows.length = 0;
    const res = await post({ provider: 'siigo', syncType: 'trial_balance', period: '2025' });
    expect(res.status).toBe(404);
    expect(connector.getTrialBalance).not.toHaveBeenCalled();
  });

  it.each(['marzo', '2025-13', '2025-Q9'])('periodo %j → 400 sin llamar al ERP', async (period) => {
    const res = await post({ provider: 'siigo', syncType: 'all', period });
    expect(res.status).toBe(400);
    expect(connector.getTrialBalance).not.toHaveBeenCalled();
  });

  it('periodo mensual: facturas y comprobantes con fechas reales (no "2025-06-01-01")', async () => {
    const res = await post({ provider: 'siigo', syncTypes: ['invoices', 'journal_entries'], period: '2025-06' });
    expect(res.status).toBe(200);
    expect(connector.getInvoices).toHaveBeenCalledWith(expect.anything(), '2025-06-01', '2025-06-30');
    expect(connector.getJournalEntries).toHaveBeenCalledWith(expect.anything(), '2025-06-01', '2025-06-30');
  });

  it('sin syncType ni syncTypes → 400', async () => {
    const res = await post({ provider: 'siigo', period: '2025' });
    expect(res.status).toBe(400);
  });
});
