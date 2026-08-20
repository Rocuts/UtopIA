// ─── /api/admin/api-keys — emisión, listado y revocación de llaves ──────────
//
// Gate: `x-admin-token` (checkAdminToken, fail-closed 503) — mismo patrón que
// /api/admin/telemetry. El token de la llave viaja UNA sola vez en la
// respuesta del POST; después solo existe su HMAC en la DB.
// Estilo de respuesta: NextResponse.json plano (superficie admin interna,
// consistente con el resto de /api/admin/*; problem+json es para /api/v1).

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/lib/db/client';
import { checkAdminToken } from '@/lib/security/admin-auth';
import { isApiKeyPepperConfigured } from '@/lib/api/keys';
import { API_SCOPES } from '@/lib/api/auth';
import { listApiKeys, mintApiKey, revokeApiKey } from '@/lib/api/key-service';

export const maxDuration = 15;

const CreateKeySchema = z
  .object({
    workspace_id: z.string().uuid().optional(),
    workspace: z
      .object({
        name: z.string().trim().min(1).max(160),
        nit: z.string().trim().min(8).max(24).optional(),
      })
      .optional(),
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.enum(API_SCOPES)).min(1).optional(),
    mode: z.enum(['live', 'test']).optional(),
    /** null explícito = sin expiración; ausente = default 365 días. */
    expires_days: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((v) => Boolean(v.workspace_id) !== Boolean(v.workspace), {
    message: 'Enviar exactamente uno: workspace_id o workspace.',
  });

export async function POST(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;

  if (!isApiKeyPepperConfigured()) {
    return NextResponse.json(
      { error: 'api keys deshabilitadas: UTOPIA_API_KEY_PEPPER no configurado' },
      { status: 503 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = CreateKeySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const minted = await mintApiKey(getDb(), {
      workspaceId: parsed.data.workspace_id,
      workspace: parsed.data.workspace,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      mode: parsed.data.mode,
      expiresDays: parsed.data.expires_days,
      createdBy: 'admin-endpoint',
    });
    return NextResponse.json(
      {
        ...minted,
        warning:
          'Guarde el token AHORA: es la única vez que se muestra. En reposo solo existe su hash.',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[admin/api-keys] mint falló:', err);
    return NextResponse.json({ error: 'mint_failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;

  try {
    return NextResponse.json({ keys: await listApiKeys(getDb()) });
  } catch (err) {
    console.error('[admin/api-keys] list falló:', err);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const denied = checkAdminToken(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const reason = url.searchParams.get('reason') ?? 'admin_revoked';
  if (!id) {
    return NextResponse.json({ error: 'falta ?id=key_…' }, { status: 400 });
  }

  try {
    const revoked = await revokeApiKey(getDb(), id, reason);
    if (!revoked) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ revoked: true });
  } catch (err) {
    console.error('[admin/api-keys] revoke falló:', err);
    return NextResponse.json({ error: 'revoke_failed' }, { status: 500 });
  }
}
