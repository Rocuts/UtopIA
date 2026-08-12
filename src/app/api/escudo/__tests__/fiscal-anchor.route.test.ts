/**
 * Regression: bootstrap del workspace en /api/escudo/fiscal-anchor.
 *
 * Bug: en la primera carga limpia de /workspace/escudo el único fetch que
 * dispara la página es `GET /api/escudo/fiscal-anchor`. Como todavía no existe
 * la cookie `utopia_workspace_id` (la emite el primer endpoint que llama a
 * `getOrCreateWorkspace()`), el GET devolvía 401 `no_workspace` y el POST
 * posterior del pipeline habría perdido el snapshot por la misma razón.
 *
 * Contrato tras el fix:
 *   - GET sin workspace  → 200 estado vacío, SIN crear workspace.
 *   - POST sin workspace → crea/resuelve el workspace y persiste (nunca 401).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declarados antes del import dinámico del route
// ---------------------------------------------------------------------------

let currentWorkspaceId: string | null = null;
const mockGetCurrentWorkspaceId = vi.fn(async () => currentWorkspaceId);
const mockGetOrCreateWorkspace = vi.fn(async () => {
  currentWorkspaceId = 'ws-created';
  return { id: currentWorkspaceId };
});

vi.mock('@/lib/db/workspace', () => ({
  getCurrentWorkspaceId: () => mockGetCurrentWorkspaceId(),
  getOrCreateWorkspace: () => mockGetOrCreateWorkspace(),
}));

vi.mock('@/lib/auth/require-session', () => ({
  requireAuthSession: async () => ({ ok: true }),
}));

// Query builder encadenable: cualquier `.from/.where/.orderBy/.limit` devuelve
// el mismo thenable, que resuelve a `[]` (workspace sin filas previas).
function emptyQuery(): unknown {
  const chain: Record<string, unknown> = {
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
  };
  for (const method of ['from', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain;
  }
  return chain;
}

const mockDb = {
  select: () => emptyQuery(),
  insert: () => ({
    values: () => ({ returning: async () => [{ id: 'report-1' }] }),
  }),
  update: () => ({
    set: () => ({ where: () => ({ returning: async () => [{ id: 'report-1' }] }) }),
  }),
};

vi.mock('@/lib/db/client', () => ({ getDb: () => mockDb }));

vi.mock('@/lib/workflows/sentinel/repository', () => ({
  upsertAlert: vi.fn(async () => undefined),
  findPendingAlertsForWorkspace: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------

const { GET, POST } = await import('../fiscal-anchor/route.js');

const URL_BASE = 'http://localhost/api/escudo/fiscal-anchor';

beforeEach(() => {
  currentWorkspaceId = null;
  mockGetCurrentWorkspaceId.mockClear();
  mockGetOrCreateWorkspace.mockClear();
});

describe('GET /api/escudo/fiscal-anchor sin workspace (primera carga limpia)', () => {
  it('devuelve 200 con el estado vacío en vez de 401 no_workspace', async () => {
    const res = await GET(new Request(URL_BASE));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      hasData: false,
      fiscalSnapshot: null,
      ancora: null,
      alertas: [],
    });
  });

  it('no crea workspace: una lectura nunca emite la cookie de tenant', async () => {
    await GET(new Request(URL_BASE));

    expect(mockGetOrCreateWorkspace).not.toHaveBeenCalled();
  });
});

describe('POST /api/escudo/fiscal-anchor sin workspace', () => {
  // En fase 1 `requireAuthSession()` es un no-op. Si el POST creara el
  // workspace, cualquiera sin cookie podría fabricar tenants y filas `reports`
  // con el cuerpo que quisiera. Una escritura sin dueño se rechaza.
  it('responde 401 y no escribe nada', async () => {
    const res = await POST(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fiscalSnapshot: {
            anchor: { alertas: [] },
            riskScore: { score: 10 },
            period: '2025',
            computedAt: '2026-08-10T00:00:00.000Z',
          },
          company: { name: 'Empresa Test SAS', nit: '900123456-1' },
        }),
      }),
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'no_workspace' });
  });

  it('no crea workspace: una escritura sin dueño no emite la cookie de tenant', async () => {
    await POST(
      new Request(URL_BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fiscalSnapshot: {
            anchor: { alertas: [] },
            riskScore: { score: 10 },
            period: '2025',
            computedAt: '2026-08-10T00:00:00.000Z',
          },
          company: { name: 'Empresa Test SAS', nit: '900123456-1' },
        }),
      }),
    );

    expect(mockGetOrCreateWorkspace).not.toHaveBeenCalled();
  });
});
