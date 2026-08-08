// ---------------------------------------------------------------------------
// Regresión — gate de sesión en las 13 Server Actions del núcleo contable.
//
// Por qué existe este test: las actions son un canal de mutación tan potente
// como los Route Handlers (crean/postean/reversan asientos, cierran y bloquean
// periodos IRREVERSIBLEMENTE, importan saldos de apertura, tocan el PUC) pero
// nacieron SIN `requireAuthSession()`. Mientras el proyecto siga en fase 1
// (BETTER_AUTH_SECRET ausente) eso es inocuo — el gate es no-op — pero el día
// del flip a fase 2 las 15 rutas costosas quedarían protegidas y estas 13
// actions serían la puerta trasera abierta.
//
// El test tiene DOS piernas, y ambas importan:
//
//   fase 1 (sin BETTER_AUTH_SECRET) → la action NO rechaza y llega a resolver
//     el workspace. Garantiza que este endurecimiento es desplegable HOY sin
//     cambiar el comportamiento observable.
//
//   fase 2 (BETTER_AUTH_SECRET puesto + getSession() → null) → la action
//     rechaza con code 'UNAUTHENTICATED' y NO toca ni el workspace ni el
//     servicio de dominio. Esta pierna FALLA con el código viejo (que llamaría
//     a getOrCreateWorkspace y devolvería ok:true).
//
// Todo el I/O está mockeado: ni DB, ni cookies reales, ni BetterAuth.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declarados antes de importar los módulos bajo prueba.
// ---------------------------------------------------------------------------

// next/headers — requireAuthSession() en fase 2 hace `await headers()`.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

// BetterAuth — controlamos la sesión desde el test sin abrir un pool pg.
let mockSession: unknown = null;
vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: async () => mockSession } },
}));

// next/cache — updateTag / revalidatePath son espías inertes.
vi.mock('next/cache', () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// Workspace — el espía clave: si el gate funciona, NUNCA se llama en fase 2.
const getOrCreateWorkspace = vi.fn(async () => ({ id: 'ws-1' }));
vi.mock('@/lib/db/workspace', () => ({
  getOrCreateWorkspace: () => getOrCreateWorkspace(),
}));

// Servicios de dominio — espías: si el gate funciona, tampoco se llaman.
const createEntry = vi.fn(async () => ({
  entry: { id: 'e1', entryNumber: 1, status: 'draft', periodId: 'p1' },
}));
const postEntry = vi.fn(async () => ({ entry: { periodId: 'p1' } }));
const reverseEntry = vi.fn(async () => ({
  entry: { id: 'e2', entryNumber: 2, periodId: 'p1' },
}));
const voidDraft = vi.fn(async () => undefined);
vi.mock('@/lib/accounting/double-entry', () => ({
  createEntry: (...a: unknown[]) => createEntry(...(a as [])),
  postEntry: (...a: unknown[]) => postEntry(...(a as [])),
  reverseEntry: (...a: unknown[]) => reverseEntry(...(a as [])),
  voidDraft: (...a: unknown[]) => voidDraft(...(a as [])),
}));

const createAccount = vi.fn(async () => ({ id: 'a1' }));
const updateAccount = vi.fn(async () => ({ id: 'a1' }));
const deactivateAccount = vi.fn(async () => ({ id: 'a1' }));
const seedPucForWorkspace = vi.fn(async () => ({
  inserted: 0,
  skipped: 0,
  total: 0,
}));
vi.mock('@/lib/accounting/chart-of-accounts/mutations', () => ({
  AccountValidationError: class extends Error {},
  AccountConflictError: class extends Error {},
  AccountNotFoundError: class extends Error {},
  createAccount: (...a: unknown[]) => createAccount(...(a as [])),
  updateAccount: (...a: unknown[]) => updateAccount(...(a as [])),
  deactivateAccount: (...a: unknown[]) => deactivateAccount(...(a as [])),
  seedPucForWorkspace: (...a: unknown[]) => seedPucForWorkspace(...(a as [])),
}));

const importOpeningBalance = vi.fn(async () => ({ entryId: 'e9' }));
vi.mock('@/lib/accounting/opening-balance/import', () => ({
  importOpeningBalance: (...a: unknown[]) => importOpeningBalance(...(a as [])),
}));

// DB — period-actions usa getDb() directamente (insert + transaction).
const dbInsert = vi.fn();
const dbTransaction = vi.fn();
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({
    insert: (...a: unknown[]) => dbInsert(...(a as [])),
    transaction: (...a: unknown[]) => dbTransaction(...(a as [])),
  }),
}));

// ---------------------------------------------------------------------------
// Imports del código bajo prueba (después de los mocks).
// ---------------------------------------------------------------------------

import {
  createJournalEntryAction,
  postJournalEntryAction,
  reverseJournalEntryAction,
  voidDraftEntryAction,
} from '../journal-actions';
import {
  createPeriodAction,
  closePeriodAction,
  reopenPeriodAction,
  lockPeriodAction,
} from '../period-actions';
import {
  createAccountAction,
  updateAccountAction,
  deactivateAccountAction,
  seedPucAction,
} from '../account-actions';
import { importOpeningBalanceAction } from '../opening-balance-actions';

// ---------------------------------------------------------------------------
// Inventario de las 13 actions con input VÁLIDO (para que la pierna de fase 1
// atraviese Zod y llegue de verdad al servicio).
// ---------------------------------------------------------------------------

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

type ActionResult = { ok: boolean; code?: string };

// `setup` ajusta el fixture de DB cuando la action exige un estado previo
// concreto (lockPeriodAction sólo acepta periodos ya cerrados).
const ACTIONS: Array<{
  name: string;
  run: () => Promise<ActionResult>;
  setup?: () => void;
}> = [
  {
    name: 'createJournalEntryAction',
    run: () =>
      createJournalEntryAction({
        periodId: UUID,
        entryDate: '2026-01-31',
        description: 'Asiento de prueba',
        lines: [
          { accountId: UUID, debit: '1000', credit: '0' },
          { accountId: UUID2, debit: '0', credit: '1000' },
        ],
      }) as Promise<ActionResult>,
  },
  {
    name: 'postJournalEntryAction',
    run: () => postJournalEntryAction(UUID) as Promise<ActionResult>,
  },
  {
    name: 'reverseJournalEntryAction',
    run: () =>
      reverseJournalEntryAction({
        originalEntryId: UUID,
        reason: 'error de digitación',
      }) as Promise<ActionResult>,
  },
  {
    name: 'voidDraftEntryAction',
    run: () => voidDraftEntryAction(UUID) as Promise<ActionResult>,
  },
  {
    name: 'createPeriodAction',
    run: () =>
      createPeriodAction({ year: 2026, month: 1 }) as Promise<ActionResult>,
  },
  {
    name: 'closePeriodAction',
    run: () => closePeriodAction(UUID) as Promise<ActionResult>,
  },
  {
    name: 'reopenPeriodAction',
    run: () => reopenPeriodAction(UUID) as Promise<ActionResult>,
  },
  {
    name: 'lockPeriodAction',
    run: () => lockPeriodAction(UUID) as Promise<ActionResult>,
    setup: () => {
      periodStatus = 'closed';
    },
  },
  {
    name: 'createAccountAction',
    run: () =>
      createAccountAction({
        code: '1105',
        name: 'Caja general',
        type: 'ACTIVO',
      }) as Promise<ActionResult>,
  },
  {
    name: 'updateAccountAction',
    run: () =>
      updateAccountAction(UUID, { name: 'Caja' }) as Promise<ActionResult>,
  },
  {
    name: 'deactivateAccountAction',
    run: () => deactivateAccountAction(UUID) as Promise<ActionResult>,
  },
  { name: 'seedPucAction', run: () => seedPucAction() as Promise<ActionResult> },
  {
    name: 'importOpeningBalanceAction',
    run: () =>
      importOpeningBalanceAction({
        periodId: UUID,
        entryDate: '2026-01-01',
        lines: [
          { accountCode: '1105', debitBalance: '1000', creditBalance: '0' },
        ],
      }) as Promise<ActionResult>,
  },
];

// ---------------------------------------------------------------------------
// Fixtures de DB para period-actions (fase 1 debe poder completar).
// ---------------------------------------------------------------------------

let periodStatus: 'open' | 'closed' | 'locked' = 'open';

function periodRow() {
  return {
    id: UUID,
    year: 2026,
    month: 1,
    status: periodStatus,
    workspaceId: 'ws-1',
  };
}

function wireDbHappyPath() {
  dbInsert.mockImplementation(() => ({
    values: () => ({ returning: async () => [periodRow()] }),
  }));
  dbTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({ for: async () => [periodRow()] }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({ returning: async () => [periodRow()] }),
          }),
        }),
      }),
  );
}

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = null;
  periodStatus = 'open';
  wireDbHappyPath();
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});

// ---------------------------------------------------------------------------
// Cobertura del inventario: si alguien agrega una action nueva y no la mete
// aquí, este test no la protege — por eso fijamos el conteo esperado.
// ---------------------------------------------------------------------------

describe('inventario de Server Actions contables', () => {
  it('cubre las 13 actions exportadas por el barrel', () => {
    expect(ACTIONS).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// FASE 2 — el gate rechaza. Esta pierna FALLA con el código sin gate.
// ---------------------------------------------------------------------------

describe('fase 2 (BETTER_AUTH_SECRET puesto, sin sesión válida)', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-para-fase-2';
    mockSession = null;
  });

  for (const { name, run, setup } of ACTIONS) {
    it(`${name} rechaza con UNAUTHENTICATED y no muta nada`, async () => {
      setup?.();
      const result = await run();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');

      // El gate corre ANTES de resolver tenant y antes del servicio: un caller
      // sin sesión no debe poder crear un workspace ni tocar el dominio.
      expect(getOrCreateWorkspace).not.toHaveBeenCalled();
      expect(createEntry).not.toHaveBeenCalled();
      expect(postEntry).not.toHaveBeenCalled();
      expect(reverseEntry).not.toHaveBeenCalled();
      expect(voidDraft).not.toHaveBeenCalled();
      expect(createAccount).not.toHaveBeenCalled();
      expect(updateAccount).not.toHaveBeenCalled();
      expect(deactivateAccount).not.toHaveBeenCalled();
      expect(seedPucForWorkspace).not.toHaveBeenCalled();
      expect(importOpeningBalance).not.toHaveBeenCalled();
      expect(dbInsert).not.toHaveBeenCalled();
      expect(dbTransaction).not.toHaveBeenCalled();
    });
  }

  it('con sesión válida deja pasar (el gate mira la sesión, no el secret)', async () => {
    mockSession = { user: { id: 'u-1' } };
    const result = await seedPucAction();
    expect(result.ok).toBe(true);
    expect(getOrCreateWorkspace).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// FASE 1 — hoy: no-op. Garantiza despliegue sin cambio de comportamiento.
// ---------------------------------------------------------------------------

describe('fase 1 (sin BETTER_AUTH_SECRET) — comportamiento intacto', () => {
  beforeEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
  });

  for (const { name, run, setup } of ACTIONS) {
    it(`${name} NO rechaza y resuelve el workspace como hoy`, async () => {
      setup?.();
      const result = await run();

      expect(result.code).not.toBe('UNAUTHENTICATED');
      expect(getOrCreateWorkspace).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });
  }
});
