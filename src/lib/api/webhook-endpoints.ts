// ---------------------------------------------------------------------------
// Servicio webhook-endpoints del API v1 (CRUD + ETag para If-Match).
//
// El secreto whsec_ se muestra completo SOLO al crear; en reposo va cifrado
// con el vault. El ETag es fuerte y cambia con updated_at — el PATCH exige
// If-Match (428 sin header, 412 si no coincide: RFC 9110 §13 + RFC 6585).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { apiWebhookEndpoints, type ApiWebhookEndpointRow } from '@/lib/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/security/vault';

import { newTypeId, parseTypeId, typeIdFrom, ID_PREFIXES } from './ids';
import { encodeCursor, type CursorPosition } from './pagination';
import type { ProblemValidationError } from './problems';
import { zodIssuesToErrors } from './problems';
import {
  WebhookEndpointCreateSchema,
  WebhookEndpointUpdateSchema,
} from './schemas';
import { generateWebhookSecret, validateWebhookUrl } from './webhooks';

type DbClient = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Serialización + ETag
// ---------------------------------------------------------------------------

export function endpointEtag(row: Pick<ApiWebhookEndpointRow, 'id' | 'updatedAt'>): string {
  const hash = createHash('sha256')
    .update(`${row.id}:${row.updatedAt.getTime()}`)
    .digest('hex')
    .slice(0, 16);
  return `"whe-${hash}"`;
}

export function serializeWebhookEndpoint(
  row: ApiWebhookEndpointRow,
  opts: { secret?: string; secretPreview?: string } = {},
): Record<string, unknown> {
  return {
    id: typeIdFrom(ID_PREFIXES.webhookEndpoint, row.id),
    object: 'webhook_endpoint',
    url: row.url,
    description: row.description,
    events: row.events,
    status: row.status,
    ...(opts.secret ? { secret: opts.secret } : {}),
    ...(opts.secretPreview ? { secret_preview: opts.secretPreview } : {}),
    created_at: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type CreateEndpointResult =
  | { status: 201; body: Record<string, unknown> }
  | { status: 400 | 422; problem: 'validation_failed'; errors: ProblemValidationError[] };

export async function createWebhookEndpoint(
  db: DbClient,
  workspaceId: string,
  body: unknown,
): Promise<CreateEndpointResult> {
  const parsed = WebhookEndpointCreateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, problem: 'validation_failed', errors: zodIssuesToErrors(parsed.error) };
  }

  const urlCheck = validateWebhookUrl(parsed.data.url);
  if (!urlCheck.ok) {
    return {
      status: 422,
      problem: 'validation_failed',
      errors: [{ detail: urlCheck.reason, pointer: '/url' }],
    };
  }

  const secret = generateWebhookSecret();
  const { uuid } = newTypeId(ID_PREFIXES.webhookEndpoint);
  const inserted = await db
    .insert(apiWebhookEndpoints)
    .values({
      id: uuid,
      workspaceId,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      events: [...parsed.data.events],
      secretEncrypted: encryptSecret(secret),
    })
    .returning();

  return { status: 201, body: serializeWebhookEndpoint(inserted[0], { secret }) };
}

export async function findWebhookEndpoint(
  db: DbClient,
  workspaceId: string,
  publicId: string,
): Promise<ApiWebhookEndpointRow | null> {
  const uuid = parseTypeId(ID_PREFIXES.webhookEndpoint, publicId);
  if (!uuid) return null;
  const rows = await db
    .select()
    .from(apiWebhookEndpoints)
    .where(
      and(eq(apiWebhookEndpoints.id, uuid), eq(apiWebhookEndpoints.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Preview del secreto para el GET de detalle: 'whsec_…' + últimos 4. */
export function secretPreviewOf(row: ApiWebhookEndpointRow): string {
  try {
    const secret = decryptSecret(row.secretEncrypted);
    return `whsec_…${secret.slice(-4)}`;
  } catch {
    return 'whsec_…????';
  }
}

export async function listWebhookEndpoints(
  db: DbClient,
  workspaceId: string,
  page: { limit: number; cursor: CursorPosition | null },
): Promise<{ data: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null }> {
  const where = page.cursor
    ? and(
        eq(apiWebhookEndpoints.workspaceId, workspaceId),
        or(
          lt(apiWebhookEndpoints.createdAt, page.cursor.createdAt),
          and(
            eq(apiWebhookEndpoints.createdAt, page.cursor.createdAt),
            lt(apiWebhookEndpoints.id, page.cursor.id),
          ),
        ),
      )
    : eq(apiWebhookEndpoints.workspaceId, workspaceId);

  const rows = await db
    .select()
    .from(apiWebhookEndpoints)
    .where(where)
    .orderBy(desc(apiWebhookEndpoints.createdAt), desc(apiWebhookEndpoints.id))
    .limit(page.limit + 1);

  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    data: pageRows.map((r) => serializeWebhookEndpoint(r)),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export type UpdateEndpointResult =
  | { status: 200; row: ApiWebhookEndpointRow }
  | { status: 400 | 422; problem: 'validation_failed'; errors: ProblemValidationError[] }
  | { status: 404 | 412 | 428 };

export async function updateWebhookEndpoint(
  db: DbClient,
  workspaceId: string,
  publicId: string,
  body: unknown,
  ifMatch: string | null,
): Promise<UpdateEndpointResult> {
  const row = await findWebhookEndpoint(db, workspaceId, publicId);
  if (!row) return { status: 404 };
  if (!ifMatch) return { status: 428 };
  if (ifMatch !== endpointEtag(row)) return { status: 412 };

  const parsed = WebhookEndpointUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, problem: 'validation_failed', errors: zodIssuesToErrors(parsed.error) };
  }

  if (parsed.data.url) {
    const urlCheck = validateWebhookUrl(parsed.data.url);
    if (!urlCheck.ok) {
      return {
        status: 422,
        problem: 'validation_failed',
        errors: [{ detail: urlCheck.reason, pointer: '/url' }],
      };
    }
  }

  const updated = await db
    .update(apiWebhookEndpoints)
    .set({
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.events !== undefined ? { events: [...parsed.data.events] } : {}),
      ...(parsed.data.status !== undefined
        ? {
            status: parsed.data.status,
            // Rehabilitar limpia el estado de fallo/desactivación.
            ...(parsed.data.status === 'enabled'
              ? { disabledAt: null, firstFailingAt: null }
              : {}),
          }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(apiWebhookEndpoints.id, row.id))
    .returning();

  return { status: 200, row: updated[0] };
}

export async function deleteWebhookEndpoint(
  db: DbClient,
  workspaceId: string,
  publicId: string,
): Promise<boolean> {
  const uuid = parseTypeId(ID_PREFIXES.webhookEndpoint, publicId);
  if (!uuid) return false;
  const deleted = await db
    .delete(apiWebhookEndpoints)
    .where(
      and(eq(apiWebhookEndpoints.id, uuid), eq(apiWebhookEndpoints.workspaceId, workspaceId)),
    )
    .returning({ id: apiWebhookEndpoints.id });
  return deleted.length > 0;
}
