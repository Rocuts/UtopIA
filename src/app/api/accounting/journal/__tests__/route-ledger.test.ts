// ---------------------------------------------------------------------------
// GET /api/accounting/journal — vista de mayor y parámetro `period`
// ---------------------------------------------------------------------------
// Integración W3-C (hallazgo nuevo de IW5b): LedgerView pide
// `?view=ledger&period=…&account=…` y espera `lines`; la API sólo listaba
// asientos. Además ContabilidadLanding envía `period` y la API leía sólo
// `periodId`, así que el hub listaba asientos de todos los períodos.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listEntries, listLedgerLines } = vi.hoisted(() => ({
  listEntries: vi.fn(),
  listLedgerLines: vi.fn(),
}));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: vi.fn(async () => ({ id: 'ws-1' })),
}));
vi.mock('@/lib/accounting/double-entry', async () => {
  const types = await vi.importActual<typeof import('@/lib/accounting/types')>(
    '@/lib/accounting/types',
  );
  return {
    createEntry: vi.fn(),
    getEntryWithLines: vi.fn(),
    listEntries,
    listLedgerLines,
    LEDGER_MAX_LIMIT: 5000,
    DoubleEntryError: types.DoubleEntryError,
    ERR: types.ERR,
  };
});

import { GET } from '../route';

const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';

const get = (qs: string) => GET(new Request(`http://localhost/api/accounting/journal?${qs}`));

beforeEach(() => {
  listEntries.mockReset();
  listEntries.mockResolvedValue({ entries: [], limit: 10, offset: 0 });
  listLedgerLines.mockReset();
  listLedgerLines.mockResolvedValue({ lines: [], openingBalances: [], truncated: false, limit: 2000 });
});

describe('GET /api/accounting/journal', () => {
  it('lista asientos del período con `period` (ContabilidadLanding) igual que con `periodId`', async () => {
    const r1 = await get(`limit=10&period=${P}`);
    expect(r1.status).toBe(200);
    expect(listEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', periodId: P, limit: 10 }),
    );
    await get(`periodId=${P}`);
    expect(listEntries).toHaveBeenLastCalledWith(expect.objectContaining({ periodId: P }));
  });

  it('view=ledger devuelve `lines` del mayor con los filtros de LedgerView', async () => {
    listLedgerLines.mockResolvedValue({
      lines: [{ id: 'l1', balance: '100.00' }],
      openingBalances: [],
      truncated: false,
      limit: 2000,
    });
    const res = await get(`view=ledger&period=${P}&account=${A}&thirdParty=900&costCenter=ADM`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toEqual([{ id: 'l1', balance: '100.00' }]);
    expect(body.truncated).toBe(false);
    expect(listLedgerLines).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      periodId: P,
      accountId: A,
      thirdParty: '900',
      costCenter: 'ADM',
      limit: undefined,
    });
    expect(listEntries).not.toHaveBeenCalled();
  });

  it('view=ledger sin filtros (período «Todos») no envía cadenas vacías', async () => {
    await get('view=ledger&period=&account=');
    expect(listLedgerLines).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      periodId: undefined,
      accountId: undefined,
      thirdParty: undefined,
      costCenter: undefined,
      limit: undefined,
    });
  });

  it('view=ledger con un período que no es UUID ⇒ 400', async () => {
    const res = await get('view=ledger&period=junio');
    expect(res.status).toBe(400);
    expect(listLedgerLines).not.toHaveBeenCalled();
  });
});
