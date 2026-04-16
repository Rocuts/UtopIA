import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConnector, ERP_PROVIDERS } from '@/lib/erp/registry';
import type { ERPProvider, ERPCredentials } from '@/lib/erp/types';

const connectSchema = z.object({
  provider: z.string(),
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = connectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { provider, credentials } = parsed.data;

    if (!(provider in ERP_PROVIDERS)) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 },
      );
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

    return NextResponse.json({
      success: true,
      provider,
      providerName: ERP_PROVIDERS[provider as ERPProvider].name,
      message: `Conectado exitosamente a ${ERP_PROVIDERS[provider as ERPProvider].name}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
