import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConnector, ERP_PROVIDERS } from '@/lib/erp/registry';
import type { ERPProvider, ERPCredentials } from '@/lib/erp/types';
import { serializeCredentials } from '@/lib/erp/credentials';
import { getDb } from '@/lib/db/client';
import { erpCredentials } from '@/lib/db/schema';
import { requireWorkspace } from '@/lib/db/workspace';
import { assertSafeBaseUrl } from '@/lib/erp/validate-base-url';

const connectSchema = z.object({
  provider: z.string(),
  label: z.string().optional(),
  credentials: z.object({
    apiKey: z.string().optional(),
    apiToken: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    companyId: z.string().optional(),
    baseUrl: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    tenantId: z.string().optional(),
    databaseName: z.string().optional(),
  }),
});

// IMPLEMENTED (audit 2026-06-05): credentials persisted via AES-256-GCM vault.
// (keyVersion column queda diferida hasta el rebase de baseline 0005-0010.)
export async function POST(req: Request) {
  try {
    // 1. Guard first — unauthenticated callers get 401 before any input is inspected.
    //    Prevents enumeration of valid ERP provider slugs by anonymous callers.
    const workspace = await requireWorkspace();
    if (!workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = connectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { provider, label, credentials } = parsed.data;

    if (!(provider in ERP_PROVIDERS)) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 },
      );
    }

    // SSRF guard — connectors fetch() this client-supplied URL server-side.
    if (credentials.baseUrl) {
      try {
        assertSafeBaseUrl(credentials.baseUrl);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'baseUrl inválida.' },
          { status: 400 },
        );
      }
    }

    const connector = await getConnector(provider as ERPProvider);
    const creds: ERPCredentials = { provider: provider as ERPProvider, ...credentials };

    const isValid = await connector.testConnection(creds);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Connection failed. Please verify your credentials.' },
        { status: 401 },
      );
    }

    // 2. Serialize credentials (encrypt secrets, separate metadata)
    const { encryptedSecret, metadata } = serializeCredentials(creds);

    // 3. Upsert to erpCredentials table (update if same workspace+provider exists)
    const db = getDb();
    const [savedCred] = await db
      .insert(erpCredentials)
      .values({
        workspaceId: workspace.id,
        provider,
        label: label ?? provider,
        encryptedSecret,
        metadata,
      })
      .onConflictDoUpdate({
        target: [erpCredentials.workspaceId, erpCredentials.provider],
        set: {
          encryptedSecret,
          metadata,
          updatedAt: new Date(),
        },
      })
      .returning({ id: erpCredentials.id });

    // 4. Return credentialId in response
    return NextResponse.json({
      success: true,
      provider,
      providerName: ERP_PROVIDERS[provider as ERPProvider].name,
      message: `Conectado exitosamente a ${ERP_PROVIDERS[provider as ERPProvider].name}`,
      credentialId: savedCred.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[erp-connect] error:', message);
    return NextResponse.json(
      { error: 'No se pudo establecer la conexión con el ERP. Verifique las credenciales y vuelva a intentar.' },
      { status: 502 },
    );
  }
}
