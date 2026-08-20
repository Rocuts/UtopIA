// ---------------------------------------------------------------------------
// Emisión y gestión de llaves — compartido por /api/admin/api-keys y el CLI
// scripts/create-api-key.ts. El token completo existe SOLO en el valor de
// retorno de mintApiKey / rotateApiKey: jamás se persiste ni se loggea.
// ---------------------------------------------------------------------------

import { desc, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { apiKeys, workspaces, type ApiKeyRow } from '@/lib/db/schema';

import { API_SCOPES } from './auth';
import { newTypeId, parseTypeId, typeIdFrom, ID_PREFIXES } from './ids';
import {
  generateApiKeyToken,
  hashApiKeyToken,
  CURRENT_PEPPER_VERSION,
  type ApiKeyMode,
} from './keys';

type DbClient = ReturnType<typeof getDb>;

const ROTATION_GRACE_MS = 7 * 24 * 3_600_000; // patrón Stripe: 7 días de convivencia

export interface MintApiKeyInput {
  workspaceId?: string;
  /** Crea el workspace si no se pasa workspaceId. */
  workspace?: { name: string; nit?: string };
  name: string;
  scopes?: string[];
  mode?: ApiKeyMode;
  expiresDays?: number | null;
  createdBy?: string;
  rotatedFromKeyId?: string;
}

export interface MintedApiKey {
  /** ÚNICA aparición del token en claro. */
  token: string;
  id: string;
  workspaceId: string;
  prefix: string;
  last4: string;
  scopes: string[];
  expiresAt: string | null;
}

export async function mintApiKey(db: DbClient, input: MintApiKeyInput): Promise<MintedApiKey> {
  let workspaceId = input.workspaceId ?? null;
  if (!workspaceId) {
    if (!input.workspace?.name) {
      throw new Error('mintApiKey: se requiere workspaceId o workspace.name');
    }
    const created = await db
      .insert(workspaces)
      .values({ name: input.workspace.name, nit: input.workspace.nit ?? null })
      .returning({ id: workspaces.id });
    workspaceId = created[0].id;
  }

  const scopes = input.scopes && input.scopes.length > 0 ? input.scopes : [...API_SCOPES];
  const invalid = scopes.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (invalid.length > 0) {
    throw new Error(`mintApiKey: scopes inválidos: ${invalid.join(', ')}`);
  }

  const generated = generateApiKeyToken(input.mode ?? 'live');
  const { uuid } = newTypeId(ID_PREFIXES.apiKey);
  // Default recomendado: +365 días (NIST: expiración por decisión explícita).
  const expiresAt =
    input.expiresDays === null
      ? null
      : new Date(Date.now() + (input.expiresDays ?? 365) * 24 * 3_600_000);

  await db.insert(apiKeys).values({
    id: uuid,
    workspaceId,
    name: input.name,
    keyHash: hashApiKeyToken(generated.token),
    pepperVersion: CURRENT_PEPPER_VERSION,
    prefix: generated.prefix,
    last4: generated.last4,
    scopes,
    expiresAt,
    createdBy: input.createdBy ?? null,
    rotatedFromKeyId: input.rotatedFromKeyId ?? null,
  });

  return {
    token: generated.token,
    id: typeIdFrom(ID_PREFIXES.apiKey, uuid),
    workspaceId,
    prefix: generated.prefix,
    last4: generated.last4,
    scopes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

function keyStatus(row: ApiKeyRow): 'active' | 'revoked' | 'expired' {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'active';
}

/** Proyección admin (allowlist): jamás el hash. */
export function serializeApiKeyForAdmin(row: ApiKeyRow): Record<string, unknown> {
  return {
    id: typeIdFrom(ID_PREFIXES.apiKey, row.id),
    name: row.name,
    workspace_id: row.workspaceId,
    key_preview: `${row.prefix}…${row.last4}`,
    scopes: row.scopes,
    status: keyStatus(row),
    rate_limits: { read_rpm: row.rpmRead, write_rpm: row.rpmWrite },
    last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listApiKeys(db: DbClient): Promise<Record<string, unknown>[]> {
  const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)).limit(200);
  return rows.map(serializeApiKeyForAdmin);
}

export async function revokeApiKey(
  db: DbClient,
  publicId: string,
  reason: string,
): Promise<boolean> {
  const uuid = resolveKeyUuid(publicId);
  if (!uuid) return false;
  const updated = await db
    .update(apiKeys)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(eq(apiKeys.id, uuid))
    .returning({ id: apiKeys.id });
  return updated.length > 0;
}

export async function rotateApiKey(
  db: DbClient,
  publicId: string,
  createdBy?: string,
): Promise<{ minted: MintedApiKey; oldExpiresAt: string } | null> {
  const uuid = resolveKeyUuid(publicId);
  if (!uuid) return null;
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, uuid)).limit(1);
  const old = rows[0];
  if (!old || old.revokedAt) return null;

  const minted = await mintApiKey(db, {
    workspaceId: old.workspaceId,
    name: old.name,
    scopes: old.scopes,
    mode: old.prefix.includes('_test_') ? 'test' : 'live',
    createdBy,
    rotatedFromKeyId: old.id,
  });

  // La vieja convive 7 días (o menos si ya expiraba antes).
  const grace = new Date(Date.now() + ROTATION_GRACE_MS);
  const oldExpiresAt =
    old.expiresAt && old.expiresAt.getTime() < grace.getTime() ? old.expiresAt : grace;
  await db.update(apiKeys).set({ expiresAt: oldExpiresAt }).where(eq(apiKeys.id, old.id));

  return { minted, oldExpiresAt: oldExpiresAt.toISOString() };
}

/** Acepta el id público key_… o el uuid crudo (comodidad admin/CLI). */
function resolveKeyUuid(publicId: string): string | null {
  const fromTypeId = parseTypeId(ID_PREFIXES.apiKey, publicId);
  if (fromTypeId) return fromTypeId;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(publicId)
    ? publicId
    : null;
}
