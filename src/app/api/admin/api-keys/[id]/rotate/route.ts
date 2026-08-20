// ─── POST /api/admin/api-keys/{id}/rotate — rotación con gracia de 7 días ───
// Patrón Stripe: la llave nueva nace con los mismos scopes y la vieja queda
// con expires_at = now()+7d para que el cliente migre sin downtime.

import { NextResponse } from 'next/server';

import { getDb } from '@/lib/db/client';
import { checkAdminToken } from '@/lib/security/admin-auth';
import { isApiKeyPepperConfigured } from '@/lib/api/keys';
import { rotateApiKey } from '@/lib/api/key-service';

export const maxDuration = 15;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = checkAdminToken(req);
  if (denied) return denied;

  if (!isApiKeyPepperConfigured()) {
    return NextResponse.json(
      { error: 'api keys deshabilitadas: UTOPIA_API_KEY_PEPPER no configurado' },
      { status: 503 },
    );
  }

  const { id } = await params;
  try {
    const result = await rotateApiKey(getDb(), id, 'admin-endpoint');
    if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(
      {
        ...result.minted,
        old_key_expires_at: result.oldExpiresAt,
        warning:
          'Guarde el token AHORA (única vez). La llave anterior sigue viva hasta old_key_expires_at.',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[admin/api-keys/rotate] falló:', err);
    return NextResponse.json({ error: 'rotate_failed' }, { status: 500 });
  }
}
