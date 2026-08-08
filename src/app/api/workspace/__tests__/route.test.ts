// ---------------------------------------------------------------------------
// Regresión — /api/workspace NO debe filtrar el UUID del workspace.
//
// En fase 1 el tenant es anónimo y el id del workspace ES el bearer: quien lo
// tenga puede hablarle a la API como si fuera ese workspace. La cookie
// `utopia_workspace_id` es httpOnly justamente para que JS del navegador no lo
// lea... y luego el propio endpoint lo devolvía en el body de la respuesta
// (`NextResponse.json({ workspace: ws })` serializa la fila completa),
// anulando la protección. Cualquier XSS, extensión o log de red lo capturaba.
//
// Ningún consumidor del front lee `workspace.id` (verificado con
// `rg "workspace.id" src/` — todos los usos son server-side, donde el id sale
// de requireWorkspace()/getOrCreateWorkspace(), nunca de este endpoint).
//
// Estos tests FALLAN con el código viejo, que devolvía `ws` sin proyectar.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fase 1: sin BETTER_AUTH_SECRET requireAuthSession() es no-op.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const WS_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  nit: '900.123.456-7',
  name: 'Comercializadora Andina SAS',
  representanteLegalNombre: 'Ana Gómez',
  revisorFiscalNombre: null,
  revisorFiscalTp: null,
  contadorPublicoNombre: null,
  contadorPublicoTp: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  userId: null,
};

vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: async () => WS_ROW,
}));

const returning = vi.fn(async () => [{ ...WS_ROW, name: 'Nuevo nombre' }]);
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({ where: () => ({ returning }) }),
    }),
  }),
}));

import { GET, PATCH } from '../route';

beforeEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
  vi.clearAllMocks();
});

describe('GET /api/workspace', () => {
  it('no expone el id del workspace (es el bearer del tenant)', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspace).toBeDefined();
    expect('id' in body.workspace).toBe(false);
    // Tampoco el userId: identifica la cuenta dueña del tenant.
    expect('userId' in body.workspace).toBe(false);
    // Y el JSON serializado no debe contener el UUID por ningún camino.
    expect(JSON.stringify(body)).not.toContain(WS_ROW.id);
  });

  it('conserva los campos que la UI sí necesita', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.workspace.nit).toBe(WS_ROW.nit);
    expect(body.workspace.name).toBe(WS_ROW.name);
    expect(body.workspace.representanteLegalNombre).toBe('Ana Gómez');
  });
});

describe('PATCH /api/workspace', () => {
  it('tampoco expone el id en la respuesta de actualización', async () => {
    const req = new Request('http://localhost/api/workspace', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Nuevo nombre' }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect('id' in body.workspace).toBe(false);
    expect(JSON.stringify(body)).not.toContain(WS_ROW.id);
    expect(body.workspace.name).toBe('Nuevo nombre');
  });
});
