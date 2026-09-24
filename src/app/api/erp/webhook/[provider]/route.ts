/**
 * POST /api/erp/webhook/[provider]
 *
 * Generic webhook receiver for ERP push notifications.
 * Supports SAP (S/4HANA CloudEvents), Oracle Fusion (CloudEvents) and
 * Siigo (topic + data envelope).
 *
 * Security model:
 *   - Header `X-Webhook-Token` is validated against `erp_credentials.webhookSecret`
 *     stored in the DB for the matching workspace+provider pair.
 *   - The endpoint is in the CSRF_ALLOWLIST (src/proxy.ts) because external
 *     ERP servers don't send an `Origin` header. Rate limiting still applies.
 *
 * Flow:
 *   1. Validate X-Webhook-Token — 401 on mismatch/missing.
 *   2. Parse + Zod-validate the provider-specific payload.
 *   3. Resolve workspace from credentials row.
 *   4. Record the event. The ERP → persisted balance import is not wired
 *      yet, so nothing is fetched, persisted or revalidated (and nothing is
 *      logged as "sync ok").
 *   5. Return 202 Accepted with `persisted: false`.
 *
 * maxDuration: 60s — the 202 is immediate; the waitUntil task can use up
 * to the function's max wall time (300s in vercel.ts for ERP webhook).
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { erpCredentials } from '@/lib/db/schema';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Payload schemas — provider-specific
// ---------------------------------------------------------------------------

/**
 * CloudEvents envelope (SAP S/4HANA + Oracle Fusion).
 * https://cloudevents.io/
 */
const CloudEventsSchema = z.object({
  specversion: z.string(),
  type: z.string().min(1),
  source: z.string().min(1),
  id: z.string().min(1),
  time: z.string().optional(),
  datacontenttype: z.string().optional(),
  // Zod v4: z.record requires (keyType, valueType)
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Siigo webhook envelope (topic + data).
 * https://developers.siigo.com/docs/webhooks/
 */
const SiigoWebhookSchema = z.object({
  topic: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.string().optional(),
  company_id: z.string().optional(),
});

type ValidProvider = 'sap_b1' | 'sap_s4hana' | 'oracle_fusion' | 'siigo' | 'alegra' | 'xero' | 'quickbooks';

const VALID_PROVIDERS = new Set<string>([
  'sap_b1', 'sap_s4hana', 'oracle_fusion', 'siigo', 'alegra', 'xero', 'quickbooks',
]);

function isValidProvider(p: string): p is ValidProvider {
  return VALID_PROVIDERS.has(p);
}

function parsePayload(provider: ValidProvider, body: unknown): { ok: true } | { ok: false; error: string } {
  // Siigo uses its own envelope; everything else is CloudEvents
  if (provider === 'siigo') {
    const result = SiigoWebhookSchema.safeParse(body);
    if (!result.success) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  }

  const result = CloudEventsSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type CredentialRow = typeof erpCredentials.$inferSelect;

async function findCredentialByToken(
  provider: string,
  token: string,
): Promise<CredentialRow | null> {
  const db = getDb();
  // `webhookSecret` lives in the `metadata` JSONB column until a dedicated
  // column is added in a future migration. We fetch by provider and filter
  // in JS (the table is small — one row per workspace+provider).
  const rows = await db
    .select()
    .from(erpCredentials)
    .where(eq(erpCredentials.provider, provider));

  // FIX (audit E2): comparación timing-safe del token. El comparador `===`
  // de strings JS sale temprano en el primer byte distinto, lo que permite
  // timing-attacks para enumerar tokens válidos byte por byte. Usamos
  // `crypto.timingSafeEqual` con buffers de igual longitud (padding si
  // las longitudes difieren para evitar leak por length-comparison early-exit).
  const tokenBuf = Buffer.from(token);
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.webhookSecret !== 'string') continue;
    const secretBuf = Buffer.from(meta.webhookSecret);
    // timingSafeEqual requiere mismo length; igualamos longitudes con padding
    // antes de comparar para no leakar la longitud del secret.
    const maxLen = Math.max(tokenBuf.length, secretBuf.length);
    const a = Buffer.alloc(maxLen);
    const b = Buffer.alloc(maxLen);
    tokenBuf.copy(a);
    secretBuf.copy(b);
    if (
      tokenBuf.length === secretBuf.length &&
      timingSafeEqual(a, b)
    ) {
      return row;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------
// La ruta ERP → balance persistido → informes todavía no existe: leer el
// balance aquí y descartarlo gastaba cuota del ERP y, peor, registraba
// "sync ok" y revalidaba caches como si hubiera datos nuevos. Hasta que la
// importación persista, el webhook sólo registra el evento de forma honesta:
// sin lectura del ERP, sin revalidación y sin recalcular balances.

function recordWebhookEvent(workspaceId: string, cred: CredentialRow): void {
  console.info(
    `[erp-webhook] event received workspaceId=${workspaceId} provider=${cred.provider} ` +
      'status=not_persisted (ERP import is not wired to persistence yet)',
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: rawProvider } = await params;

  // 1. Validate provider slug
  if (!isValidProvider(rawProvider)) {
    return NextResponse.json(
      { error: `Unknown ERP provider: ${rawProvider}` },
      { status: 400 },
    );
  }
  const provider = rawProvider as ValidProvider;

  // Auth: X-Webhook-Token validated below via timingSafeEqual — correct for M2M callbacks.
  // DO NOT add requireWorkspace() here: external ERP servers have no browser cookie.

  // 2. Validate webhook token
  const token = req.headers.get('x-webhook-token');
  if (!token) {
    return NextResponse.json({ error: 'Missing X-Webhook-Token header' }, { status: 401 });
  }

  const cred = await findCredentialByToken(provider, token);
  if (!cred) {
    return NextResponse.json({ error: 'Invalid webhook token' }, { status: 401 });
  }

  // 3. Parse + validate payload
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseResult = parsePayload(provider, body);
  if (!parseResult.ok) {
    return NextResponse.json(
      { error: `Payload validation failed: ${parseResult.error}` },
      { status: 400 },
    );
  }

  // 4. Fire-and-forget sync via `after` (Next.js 15+).
  //    202 is returned immediately; the sync task runs after the response
  //    is sent, within the function's remaining max duration.
  after(() => {
    recordWebhookEvent(cred.workspaceId, cred);
  });

  return NextResponse.json(
    {
      accepted: true,
      provider,
      persisted: false,
      message: 'Webhook received. ERP data import is not persisted yet; no balances were updated.',
    },
    { status: 202 },
  );
}
