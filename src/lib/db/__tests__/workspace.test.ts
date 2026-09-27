// ---------------------------------------------------------------------------
// Regresión — resolución de workspace: aislamiento, vida de la cookie y
// determinismo de la selección.
//
// Tres defectos que este test fija:
//
//   (1) `requireWorkspace()` NO filtraba por `user_id IS NULL` en el camino
//       cookie, mientras `getOrCreateWorkspace()` sí. Hoy es casi inocuo (en
//       prod sólo 1 de 52 workspaces tiene user_id), pero el día del flip a
//       auth una cookie vieja alcanzaría un workspace YA reclamado por un
//       usuario autenticado: acceso cruzado de tenant.
//
//   (2) La cookie duraba ~5 años. El valor que lleva ES el bearer del tenant
//       anónimo, así que un robo de cookie equivalía a acceso perpetuo.
//       Ahora: 90 días con renovación deslizante en cada request válido.
//
//   (3) Las queries por `user_id` no tenían ORDER BY. Con `.limit(1)` sobre
//       una tabla sin unicidad garantizada en esa columna, Postgres puede
//       devolver filas distintas entre requests (cambio de plan, VACUUM,
//       índice nuevo) — el usuario "cambiaría de empresa" sin hacer nada.
//
//   (4) La fase la decide `isAuthConfigured()`, como en el proxy y en
//       `requireAuthSession()`: con cualquiera de los nombres de secreto que
//       acepta BetterAuth el tenant sale de la sesión, y sin sesión válida los
//       tres resolutores fallan cerrado, sin leer la cookie anónima.
//
// Todo el I/O está mockeado; el WHERE y el ORDER BY se inspeccionan
// renderizando el SQL de Drizzle con PgDialect.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Cookie jar mockeado
// ---------------------------------------------------------------------------

type SetCall = { name: string; value: string; options: Record<string, unknown> };

let cookieValue: string | undefined;
let setCalls: SetCall[] = [];
let setThrows = false;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  // vi.fn: las pruebas de fase 2 comprueban que el jar ni se abre.
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      cookieValue === undefined ? undefined : { name, value: cookieValue },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      if (setThrows) {
        // Reproduce el error real de Next cuando `cookies().set` se llama
        // desde un Server Component (getOrCreateWorkspace se usa en
        // /workspace/contexto y /workspace/comando).
        throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      }
    },
  })),
}));

// BetterAuth — sesión controlable desde el test (también su fallo).
let mockSession: { user: { id: string } } | null = null;
let sessionLookupThrows = false;
vi.mock('@/lib/auth/config', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        if (sessionLookupThrows) throw new Error('session store unavailable');
        return mockSession;
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// DB mockeada: captura el WHERE y el ORDER BY de cada SELECT.
// ---------------------------------------------------------------------------

type Capture = { where?: unknown; orderBy?: unknown[] };
let captures: Capture[] = [];
let selectRows: unknown[] = [];
const insertReturning = vi.fn(async () => [{ id: 'ws-nuevo' }]);

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeSelectChain() {
  const cap: Capture = {};
  captures.push(cap);
  const chain: any = {
    from: () => chain,
    where: (w: unknown) => {
      cap.where = w;
      return chain;
    },
    orderBy: (...o: unknown[]) => {
      cap.orderBy = o;
      return chain;
    },
    limit: () => Promise.resolve(selectRows),
  };
  return chain;
}

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    select: () => makeSelectChain(),
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
  }),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/config';
import {
  getOrCreateWorkspace,
  requireWorkspace,
  getCurrentWorkspaceId,
  WorkspaceAuthRequiredError,
} from '../workspace';

const dialect = new PgDialect();
function sqlText(fragment: unknown): string {
  return dialect.sqlToQuery(fragment as SQL).sql.toLowerCase();
}
function sqlParams(fragment: unknown): unknown[] {
  return dialect.sqlToQuery(fragment as SQL).params;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const WS_ROW = { id: VALID_UUID, name: 'ACME SAS', userId: null };
const NOVENTA_DIAS = 60 * 60 * 24 * 90;

// Los nombres que acepta `isAuthConfigured()` (src/lib/auth/enabled.ts).
const SECRET_NAMES = ['BETTER_AUTH_SECRET', 'AUTH_SECRET', 'BETTER_AUTH_SECRETS'] as const;

/** Fase 1 por defecto, aunque el entorno del desarrollador exporte un secreto. */
function stubPhase(secretName: (typeof SECRET_NAMES)[number] | null, value = 'secreto-de-test') {
  for (const name of SECRET_NAMES) vi.stubEnv(name, '');
  if (secretName) vi.stubEnv(secretName, value);
}

const getSession = vi.mocked(auth.api.getSession);
const cookiesFn = vi.mocked(cookies);

beforeEach(() => {
  vi.clearAllMocks();
  captures = [];
  setCalls = [];
  selectRows = [];
  cookieValue = undefined;
  setThrows = false;
  mockSession = null;
  sessionLookupThrows = false;
  stubPhase(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// (1) Aislamiento: el camino cookie nunca alcanza un workspace reclamado.
// ---------------------------------------------------------------------------

describe('requireWorkspace() — camino cookie', () => {
  it('filtra por user_id IS NULL igual que getOrCreateWorkspace()', async () => {
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];

    const ws = await requireWorkspace();

    expect(ws).toEqual(WS_ROW);
    expect(captures).toHaveLength(1);
    const where = sqlText(captures[0].where);
    expect(where).toContain('"id" =');
    expect(where).toContain('is null');
  });

  it('sigue rechazando cookies con formato no-UUIDv4 sin tocar la DB', async () => {
    cookieValue = 'no-soy-un-uuid';
    const ws = await requireWorkspace();
    expect(ws).toBeNull();
    expect(captures).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Vida de la cookie: 90 días + renovación deslizante.
// ---------------------------------------------------------------------------

describe('cookie utopia_workspace_id', () => {
  it('se crea con maxAge de 90 días, no de años', async () => {
    selectRows = [];
    await getOrCreateWorkspace();

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].options.maxAge).toBe(NOVENTA_DIAS);
    expect(setCalls[0].options.httpOnly).toBe(true);
    expect(setCalls[0].options.sameSite).toBe('lax');
  });

  it('se renueva en cada resolución válida (ventana deslizante)', async () => {
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];

    const ws = await getOrCreateWorkspace();

    expect(ws).toEqual(WS_ROW);
    // Sin renovación, una sesión activa expiraría a los 90 días exactos aunque
    // el usuario entre a diario. Con ella, los 90 días son de INACTIVIDAD.
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].value).toBe(VALID_UUID);
    expect(setCalls[0].options.maxAge).toBe(NOVENTA_DIAS);
  });

  it('la renovación no rompe cuando se llama desde un Server Component', async () => {
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];
    setThrows = true;

    const ws = await getOrCreateWorkspace();

    // Se intentó renovar…
    expect(setCalls).toHaveLength(1);
    // …y el error de "cookies read-only" no se propaga al render.
    expect(ws).toEqual(WS_ROW);
  });
});

// ---------------------------------------------------------------------------
// (3) Determinismo: ORDER BY created_at ASC en las búsquedas por user_id.
// ---------------------------------------------------------------------------

describe('selección determinista por user_id', () => {
  beforeEach(() => {
    stubPhase('BETTER_AUTH_SECRET');
    mockSession = { user: { id: 'u-1' } };
  });

  const casos: Array<[string, () => Promise<unknown>]> = [
    ['getOrCreateWorkspace', () => getOrCreateWorkspace()],
    ['requireWorkspace', () => requireWorkspace()],
    ['getCurrentWorkspaceId', () => getCurrentWorkspaceId()],
  ];

  for (const [nombre, run] of casos) {
    it(`${nombre}() ordena por created_at ASC`, async () => {
      selectRows = [WS_ROW];
      await run();

      expect(captures).toHaveLength(1);
      expect(captures[0].orderBy).toBeDefined();
      const order = (captures[0].orderBy ?? []).map(sqlText).join(' ');
      expect(order).toContain('created_at');
    });
  }
});

// ---------------------------------------------------------------------------
// (4) Contrato de fases: la misma fuente que el proxy y requireAuthSession().
// ---------------------------------------------------------------------------

const RESOLVERS: Array<[string, () => Promise<unknown>]> = [
  ['getOrCreateWorkspace', () => getOrCreateWorkspace()],
  ['requireWorkspace', () => requireWorkspace()],
  ['getCurrentWorkspaceId', () => getCurrentWorkspaceId()],
];

const SESSION_ROW = { id: '22222222-2222-4222-8222-222222222222', name: 'Cuenta', userId: 'u-1' };

describe.each(SECRET_NAMES)('fase 2 con %s — sesión válida', (secretName) => {
  beforeEach(() => {
    stubPhase(secretName);
    mockSession = { user: { id: 'u-1' } };
    // La cookie anónima apunta a OTRO workspace: no debe consultarse.
    cookieValue = VALID_UUID;
  });

  it.each(RESOLVERS)('%s() resuelve por user_id de la sesión, sin abrir la cookie', async (_n, run) => {
    selectRows = [SESSION_ROW];

    const result = await run();

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(cookiesFn).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(0);
    expect(captures).toHaveLength(1);
    // El mock de la DB ignora el WHERE: se afirma sobre la consulta, no sobre la fila.
    const where = sqlText(captures[0].where);
    expect(where).toContain('"user_id" =');
    expect(where).not.toContain('is null');
    expect(sqlParams(captures[0].where)).toEqual(['u-1']);
    expect(result === SESSION_ROW || result === SESSION_ROW.id).toBe(true);
  });
});

describe.each(SECRET_NAMES)('fase 2 con %s — sin sesión falla cerrado', (secretName) => {
  beforeEach(() => {
    stubPhase(secretName);
    mockSession = null;
    // Una cookie anónima válida y sin reclamar: en fase 1 se resolvería.
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];
  });

  it('requireWorkspace() devuelve null sin consultar la cookie ni la DB', async () => {
    expect(await requireWorkspace()).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(cookiesFn).not.toHaveBeenCalled();
    expect(captures).toHaveLength(0);
  });

  it('getCurrentWorkspaceId() devuelve null sin consultar la cookie ni la DB', async () => {
    expect(await getCurrentWorkspaceId()).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(cookiesFn).not.toHaveBeenCalled();
    expect(captures).toHaveLength(0);
  });

  it('getOrCreateWorkspace() lanza WorkspaceAuthRequiredError sin leer, crear ni fijar cookie', async () => {
    const err = await getOrCreateWorkspace().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorkspaceAuthRequiredError);
    // Tres rutas devuelven err.message en su 500: el texto es contrato.
    expect((err as Error).message).toBe('Authentication required.');
    expect(cookiesFn).not.toHaveBeenCalled();
    expect(captures).toHaveLength(0);
    expect(insertReturning).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(0);
  });
});

describe('fase 2 — la lectura de la sesión falla', () => {
  it.each([
    ['BETTER_AUTH_SECRET', 'secreto-de-test'],
    // Mal formado para la rotación: BetterAuth lanza al leer la sesión.
    ['BETTER_AUTH_SECRETS', 'malformado'],
  ] as const)('con %s: los tres resolutores fallan cerrado', async (secretName, value) => {
    stubPhase(secretName, value);
    sessionLookupThrows = true;
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];

    expect(await requireWorkspace()).toBeNull();
    expect(await getCurrentWorkspaceId()).toBeNull();
    await expect(getOrCreateWorkspace()).rejects.toBeInstanceOf(WorkspaceAuthRequiredError);

    expect(getSession).toHaveBeenCalledTimes(3);
    expect(cookiesFn).not.toHaveBeenCalled();
    expect(captures).toHaveLength(0);
    expect(insertReturning).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(0);
  });
});

describe('fase 1 — sin ningún secreto', () => {
  it.each(RESOLVERS)('%s() no consulta la sesión y sigue el camino cookie', async (_n, run) => {
    cookieValue = VALID_UUID;
    selectRows = [WS_ROW];
    // Aunque hubiera una sesión, en fase 1 no se lee.
    mockSession = { user: { id: 'u-1' } };

    const result = await run();

    expect(getSession).not.toHaveBeenCalled();
    expect(cookiesFn).toHaveBeenCalledTimes(1);
    expect(captures).toHaveLength(1);
    const where = sqlText(captures[0].where);
    expect(where).toContain('"id" =');
    expect(where).toContain('is null');
    expect(result === WS_ROW || result === WS_ROW.id).toBe(true);
  });

  it('getOrCreateWorkspace() sin cookie crea el workspace anónimo y fija la cookie', async () => {
    selectRows = [];

    const ws = await getOrCreateWorkspace();

    expect(ws).toEqual({ id: 'ws-nuevo' });
    expect(insertReturning).toHaveBeenCalledTimes(1);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].value).toBe('ws-nuevo');
    expect(getSession).not.toHaveBeenCalled();
  });
});
