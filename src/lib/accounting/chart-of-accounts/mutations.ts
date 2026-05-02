import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  chartOfAccounts,
  type ChartOfAccountsRow,
  type NewChartOfAccountsRow,
} from '@/lib/db/schema';
import {
  ACCOUNT_CLASSES,
  type AccountClassSummary,
} from './types';
import { countMovementsForAccount, getAccount, getAccountById } from './queries';

// ---------------------------------------------------------------------------
// Mutaciones del PUC.
// ---------------------------------------------------------------------------
// Reglas de integridad enforzadas aquí (no en DB):
//
//  1. `code` debe ser solo dígitos, 1..16 chars.
//  2. `code` debe ser prefijo del padre — el árbol del PUC es estrictamente
//     prefix-encoded ("11" hijo de "1", "1105" hijo de "11", etc.).
//  3. `type` debe coincidir con la clase del primer dígito (clase 1 ⇒ ACTIVO,
//     etc.). Permitimos clase 6 y 7 ambas mapeadas a 'COSTO' (ver
//     `ACCOUNT_CLASSES`).
//  4. `level` se calcula del padre: si parent.level=L, hijo.level=L+1. Si no
//     hay padre, el código debe ser de 1 dígito (clase) y level=1.
//  5. No se puede crear hija si el padre tiene `is_postable=true` (sería un
//     "downgrade" de auxiliar a grupo, contradice la definición). Recomendamos
//     reclasificar o crear una hermana.
//  6. ON CONFLICT (workspace_id, code) lanza `AccountConflictError` (status
//     409 en el handler).
//
// `updateAccount` y `deactivateAccount` chequean movimientos via
// `countMovementsForAccount` antes de permitir cambios.
// ---------------------------------------------------------------------------

const CODE_REGEX = /^\d{1,16}$/;
const CODE_MAX_LEN = 16;

export class AccountValidationError extends Error {
  readonly code = 'VALIDATION';
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'AccountValidationError';
    this.field = field;
  }
}

export class AccountConflictError extends Error {
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'AccountConflictError';
  }
}

export class AccountNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'AccountNotFoundError';
  }
}

export interface CreateAccountInput {
  workspaceId: string;
  /** 1..16 dígitos. Único por workspace. */
  code: string;
  name: string;
  /**
   * Código del padre (no el id, para que el caller pueda crear con un código
   * legible en el front). Si null/undefined ⇒ es una clase (level 1, code de
   * 1 dígito).
   */
  parentCode?: string | null;
  /** Tipo NIIF (debe coincidir con el primer dígito; ver mapping). */
  type:
    | 'ACTIVO'
    | 'PASIVO'
    | 'PATRIMONIO'
    | 'INGRESO'
    | 'GASTO'
    | 'COSTO'
    | 'ORDEN_DEUDORA'
    | 'ORDEN_ACREEDORA';
  /** Solo nivel 4-5 puede ser true. Default false. */
  isPostable?: boolean;
  requiresThirdParty?: boolean;
  requiresCostCenter?: boolean;
  currency?: string;
}

export interface UpdateAccountInput {
  name?: string;
  requiresThirdParty?: boolean;
  requiresCostCenter?: boolean;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function assertCodeFormat(code: string) {
  if (!CODE_REGEX.test(code)) {
    throw new AccountValidationError(
      `Código inválido "${code}": debe tener entre 1 y ${CODE_MAX_LEN} dígitos numéricos.`,
      'code',
    );
  }
}

function assertCodeMatchesType(code: string, type: string): AccountClassSummary {
  const firstDigit = code.charAt(0);
  const summary = ACCOUNT_CLASSES.find((c) => c.code === firstDigit);
  if (!summary) {
    throw new AccountValidationError(
      `Código "${code}" inválido: el primer dígito (${firstDigit}) no corresponde a ninguna clase del PUC.`,
      'code',
    );
  }
  if (summary.type !== type) {
    throw new AccountValidationError(
      `Tipo "${type}" inconsistente con el código "${code}" (clase ${firstDigit} ⇒ ${summary.type}).`,
      'type',
    );
  }
  return summary;
}

function assertParentPrefix(code: string, parentCode: string) {
  if (!code.startsWith(parentCode)) {
    throw new AccountValidationError(
      `Código "${code}" debe empezar con el código del padre "${parentCode}".`,
      'code',
    );
  }
  if (code.length <= parentCode.length) {
    throw new AccountValidationError(
      `Código hijo "${code}" debe ser estrictamente más largo que el del padre "${parentCode}".`,
      'code',
    );
  }
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export async function createAccount(
  input: CreateAccountInput,
): Promise<ChartOfAccountsRow> {
  assertCodeFormat(input.code);
  assertCodeMatchesType(input.code, input.type);

  const db = getDb();

  // Resolver padre (si aplica) y calcular level.
  let parentId: string | null = null;
  let level: number;

  if (input.parentCode) {
    assertCodeFormat(input.parentCode);
    assertParentPrefix(input.code, input.parentCode);
    const parent = await getAccount(input.workspaceId, input.parentCode);
    if (!parent) {
      throw new AccountValidationError(
        `Cuenta padre con código "${input.parentCode}" no existe en este workspace.`,
        'parentCode',
      );
    }
    if (parent.type !== input.type) {
      throw new AccountValidationError(
        `Tipo "${input.type}" no coincide con el del padre "${parent.type}".`,
        'type',
      );
    }
    if (parent.level >= 5) {
      throw new AccountValidationError(
        `La cuenta padre "${input.parentCode}" ya está en nivel ${parent.level} (máx 5). No se puede crear hija.`,
        'parentCode',
      );
    }
    if (parent.isPostable) {
      // Convertir un auxiliar (postable) en grupo crearía inconsistencias en
      // journal_lines (que apuntan a él como hoja). Es regla blanda: si el
      // padre todavía no tiene movimientos, podríamos permitirlo despostándolo
      // primero — pero lo dejamos prohibido para que el caller sea explícito.
      throw new AccountValidationError(
        `La cuenta padre "${input.parentCode}" es postable (auxiliar). No se puede crear hija sin reclasificarla primero.`,
        'parentCode',
      );
    }
    parentId = parent.id;
    level = parent.level + 1;
  } else {
    // Sin padre ⇒ debe ser clase (1 dígito, level 1).
    if (input.code.length !== 1) {
      throw new AccountValidationError(
        `Código "${input.code}" no es de clase (1 dígito); requiere parentCode.`,
        'parentCode',
      );
    }
    level = 1;
  }

  const row: NewChartOfAccountsRow = {
    workspaceId: input.workspaceId,
    code: input.code,
    name: input.name.trim(),
    type: input.type,
    parentId,
    level,
    isPostable: input.isPostable ?? false,
    currency: (input.currency ?? 'COP').toUpperCase(),
    requiresThirdParty: input.requiresThirdParty ?? false,
    requiresCostCenter: input.requiresCostCenter ?? false,
    active: true,
  };

  try {
    const [created] = await db
      .insert(chartOfAccounts)
      .values(row)
      .returning();
    return created;
  } catch (err) {
    // Postgres unique violation (`coa_ws_code_uniq`).
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('coa_ws_code_uniq') || msg.includes('duplicate key')) {
      throw new AccountConflictError(
        `Ya existe una cuenta con el código "${input.code}" en este workspace.`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

export async function updateAccount(
  workspaceId: string,
  id: string,
  patch: UpdateAccountInput,
): Promise<ChartOfAccountsRow> {
  const existing = await getAccountById(workspaceId, id);
  if (!existing) {
    throw new AccountNotFoundError(`Cuenta ${id} no encontrada.`);
  }

  // Si se intenta desactivar (active=false), validar que no tenga movimientos.
  if (patch.active === false && existing.active) {
    const moves = await countMovementsForAccount(workspaceId, id);
    if (moves > 0) {
      throw new AccountConflictError(
        `No se puede desactivar la cuenta "${existing.code}": tiene ${moves} movimiento(s) registrado(s).`,
      );
    }
  }

  const update: Partial<NewChartOfAccountsRow> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.requiresThirdParty !== undefined)
    update.requiresThirdParty = patch.requiresThirdParty;
  if (patch.requiresCostCenter !== undefined)
    update.requiresCostCenter = patch.requiresCostCenter;
  if (patch.active !== undefined) update.active = patch.active;

  if (Object.keys(update).length === 0) {
    return existing; // no-op idempotente
  }

  const db = getDb();
  const [updated] = await db
    .update(chartOfAccounts)
    .set(update)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.id, id),
      ),
    )
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// DEACTIVATE (soft-delete)
// ---------------------------------------------------------------------------

/**
 * Desactiva (active=false). NO borra físicamente — los `journal_lines` que
 * referencian cuentas históricas deben seguir resolviéndose. Lanza
 * `AccountConflictError` si la cuenta tiene movimientos.
 */
export async function deactivateAccount(
  workspaceId: string,
  id: string,
): Promise<ChartOfAccountsRow> {
  return updateAccount(workspaceId, id, { active: false });
}

// ---------------------------------------------------------------------------
// SEED del PUC PYMES (Decreto 2706/2012 + 2420/2015 Anexo 2)
// ---------------------------------------------------------------------------
//
// El catálogo canónico vive en `src/lib/db/seeds/puc-pyme-colombia.ts` (Agente
// 1.A). Lo importamos por path relativo a `@/`. La función es idempotente:
// usa ON CONFLICT (workspace_id, code) DO NOTHING en cada batch, así que
// llamarla 2 veces no duplica filas. Devuelve métricas (inserted/skipped)
// para que el handler las propague al cliente.
//
// Ordenamiento: insertamos por `level` ascendente — primero las 9 clases
// (level 1), después grupos (2), cuentas (3), subcuentas (4), auxiliares (5).
// Esto resuelve `parentId` correctamente: cuando insertamos un grupo, el
// padre clase YA existe.
//
// Resolución de `parentId`: el seed de 1.A define cada entry con `parentCode`
// (string). Aquí lo mapeamos a UUID consultando las filas insertadas en pasos
// anteriores. Mantenemos un Map<code, id> in-memory por workspace para no
// hacer N queries.
//
// Implementado con `db.transaction()` para atomicidad — si una fila falla
// (no debería), revertimos todo y el workspace queda sin PUC parcial.

export interface SeedPucEntry {
  code: string;
  name: string;
  parentCode: string | null;
  type:
    | 'ACTIVO'
    | 'PASIVO'
    | 'PATRIMONIO'
    | 'INGRESO'
    | 'GASTO'
    | 'COSTO'
    | 'ORDEN_DEUDORA'
    | 'ORDEN_ACREEDORA';
  level: 1 | 2 | 3 | 4 | 5;
  isPostable?: boolean;
  requiresThirdParty?: boolean;
  requiresCostCenter?: boolean;
}

export interface SeedPucResult {
  inserted: number;
  skipped: number;
  total: number;
}

/**
 * Carga lazy del catálogo del seed (Agente 1.A). Se separa en función para
 * que typecheck no falle si el archivo aún no existe en su rama y para
 * permitir mocking en tests futuros.
 *
 * El seed expone `PUC_PYME_COLOMBIA: SeedPucEntry[]` como default o named
 * export. Aceptamos ambos.
 */
async function loadPucCatalog(): Promise<SeedPucEntry[]> {
  // dynamic import para que el bundler no lo intente si el archivo no existe.
  const mod = (await import('@/lib/db/seeds/puc-pyme-colombia').catch(
    () => null,
  )) as
    | { PUC_PYME_COLOMBIA?: SeedPucEntry[]; default?: SeedPucEntry[] }
    | null;
  if (!mod) {
    throw new Error(
      "Catálogo PUC PYMES no encontrado en '@/lib/db/seeds/puc-pyme-colombia.ts'. " +
        'Ejecutar Agente 1.A primero (Ola 1).',
    );
  }
  const catalog = mod.PUC_PYME_COLOMBIA ?? mod.default;
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error(
      'puc-pyme-colombia.ts no exporta `PUC_PYME_COLOMBIA: SeedPucEntry[]` válido.',
    );
  }
  return catalog;
}

/**
 * Inserta el PUC PYMES para `workspaceId`. Idempotente: ON CONFLICT
 * (workspace_id, code) DO NOTHING. Devuelve `inserted` / `skipped` /
 * `total` para que el handler los reporte.
 */
export async function seedPucForWorkspace(
  workspaceId: string,
): Promise<SeedPucResult> {
  const catalog = await loadPucCatalog();
  const total = catalog.length;
  if (total === 0) return { inserted: 0, skipped: 0, total: 0 };

  // Validamos catálogo antes de tocar DB. Errores aquí son bugs del seed,
  // no del request — fallamos rápido para que Agente 1.A los corrija.
  const seen = new Set<string>();
  for (const e of catalog) {
    if (!CODE_REGEX.test(e.code)) {
      throw new Error(`Seed PUC inválido: code "${e.code}" no es numérico.`);
    }
    if (seen.has(e.code)) {
      throw new Error(`Seed PUC duplicado: code "${e.code}" aparece 2+ veces.`);
    }
    seen.add(e.code);
  }

  const db = getDb();

  // Ordenamos por level ASC, luego por code ASC. Garantiza que el parent
  // siempre exista antes que el hijo dentro del mismo nivel.
  const sorted = [...catalog].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.code.localeCompare(b.code);
  });

  let inserted = 0;
  let skipped = 0;

  // Una sola transacción para que si algo falla a la mitad, no queden 9
  // clases sin grupos.
  await db.transaction(async (tx) => {
    // Map code → id reconstruido sobre la marcha. Empezamos rellenando con
    // las filas YA presentes (idempotencia: si el seed corrió antes con
    // otro subset, queremos resolver parentId contra esas filas también).
    const existing = await tx
      .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.workspaceId, workspaceId));
    const codeToId = new Map<string, string>(
      existing.map((r) => [r.code, r.id]),
    );

    for (const entry of sorted) {
      // Resolvemos parentId desde el map.
      let parentId: string | null = null;
      if (entry.parentCode) {
        const pid = codeToId.get(entry.parentCode);
        if (!pid) {
          // El parent no estaba ni en BD ni en lo que hemos insertado en
          // este pase. El catálogo está mal ordenado o tiene un parentCode
          // huérfano. Abortamos — la TX revertirá todo.
          throw new Error(
            `Seed PUC: parentCode "${entry.parentCode}" no resoluble para hijo "${entry.code}".`,
          );
        }
        parentId = pid;
      }

      const values = {
        workspaceId,
        code: entry.code,
        name: entry.name,
        type: entry.type,
        parentId,
        level: entry.level,
        isPostable: entry.isPostable ?? entry.level >= 4,
        currency: 'COP',
        requiresThirdParty: entry.requiresThirdParty ?? false,
        requiresCostCenter: entry.requiresCostCenter ?? false,
        active: true,
      } satisfies NewChartOfAccountsRow;

      // ON CONFLICT DO NOTHING + RETURNING id. Si la fila ya existía,
      // RETURNING no devuelve nada y consultamos por code para mantener
      // el map actualizado.
      const result = await tx
        .insert(chartOfAccounts)
        .values(values)
        .onConflictDoNothing({
          target: [chartOfAccounts.workspaceId, chartOfAccounts.code],
        })
        .returning({ id: chartOfAccounts.id, code: chartOfAccounts.code });

      if (result.length > 0) {
        inserted++;
        codeToId.set(result[0].code, result[0].id);
      } else {
        skipped++;
        // El existing map ya tiene este code (rellenado al inicio del TX).
      }
    }
  });

  return { inserted, skipped, total };
}

/**
 * Drop-and-reseed. NO usado por la API pública — sólo por scripts de
 * mantenimiento. Falla si hay journal_lines que referencien al PUC del
 * workspace (regla: nunca borrar PUC con movimientos).
 */
export async function resetPucForWorkspace(
  workspaceId: string,
): Promise<SeedPucResult> {
  const db = getDb();
  // Counter de movimientos sobre cualquier cuenta del workspace.
  const movements = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM journal_lines jl
    JOIN chart_of_accounts coa ON coa.id = jl.account_id
    WHERE coa.workspace_id = ${workspaceId}::uuid
  `);
  const n = Number(
    (movements.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
  );
  if (n > 0) {
    throw new AccountConflictError(
      `No se puede reiniciar el PUC: ${n} movimientos referencian cuentas existentes.`,
    );
  }
  await db
    .delete(chartOfAccounts)
    .where(eq(chartOfAccounts.workspaceId, workspaceId));
  return seedPucForWorkspace(workspaceId);
}
