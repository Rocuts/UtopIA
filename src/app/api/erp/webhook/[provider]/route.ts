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
 *   4. Fire-and-forget: fetch trial balance via ERPAdapter + persist via
 *      getCachedPreprocessedBalance helpers, then revalidate Next.js tags.
 *   5. Return 202 Accepted immediately (processing is async via waitUntil).
 *
 * maxDuration: 60s — the 202 is immediate; the waitUntil task can use up
 * to the function's max wall time (300s in vercel.ts for ERP webhook).
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { erpCredentials } from '@/lib/db/schema';
import { ERPAdapter } from '@/lib/erp/adapter';
import type { ERPCredentials } from '@/lib/erp/types';
import { loadCredentials } from '@/lib/erp/credentials';
import { getLatestOpenPeriod, getCachedPreprocessedBalance } from '@/lib/cache/preprocessed-balance';

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
// Background sync task
// ---------------------------------------------------------------------------

async function syncTrialBalance(
  workspaceId: string,
  cred: CredentialRow,
): Promise<void> {
  const start = Date.now();

  let credentials: ERPCredentials;
  try {
    credentials = loadCredentials(cred);
  } catch (err) {
    console.error('[erp/webhook] credential decrypt failed', {
      workspaceId: cred.workspaceId,
      provider: cred.provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    // Determine current fiscal period (YYYY-MM)
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const adapter = new ERPAdapter({ provider: credentials.provider, credentials });
    await adapter.fetchTrialBalance(period);

    // Invalidate Next.js cache tags so cached consumers (dashboards, pillars)
    // pick up the fresh data on next render.
    // Next.js 16: two-arg revalidateTag(tag, profile) — 'max' = aggressive
    // revalidation, appropriate for ERP sync events that bring real new data.
    revalidateTag('workspace-balance', 'max');
    revalidateTag(`pillars-${workspaceId}`, 'max');

    // If there is an open accounting period, recompute the preprocessed balance
    // so sentinel / pillar KPI queries reflect the ERP sync.
    const latestPeriod = await getLatestOpenPeriod(workspaceId);
    if (latestPeriod) {
      await getCachedPreprocessedBalance(workspaceId, latestPeriod.id);
    }

    const duration = Date.now() - start;
    console.info(
      `[erp-webhook] sync ok workspaceId=${workspaceId} provider=${cred.provider} duration=${duration}ms`,
    );
  } catch (err) {
    const duration = Date.now() - start;
    console.error(
      `[erp-webhook] sync error workspaceId=${workspaceId} provider=${cred.provider} duration=${duration}ms`,
      err instanceof Error ? err.message : err,
    );
  }
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
  after(async () => {
    await syncTrialBalance(cred.workspaceId, cred);
  });

  return NextResponse.json(
    {
      accepted: true,
      provider,
      message: 'Webhook received. Trial balance sync queued.',
    },
    { status: 202 },
  );
}
