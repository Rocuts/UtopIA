import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConnector, ERP_PROVIDERS } from '@/lib/erp/registry';
import type { ERPProvider, ERPCredentials, ERPSyncResult } from '@/lib/erp/types';
import { logApiActivity } from '@/lib/db/activity-log';
import { requireWorkspace } from '@/lib/db/workspace';
import { assertSafeBaseUrl } from '@/lib/erp/validate-base-url';
import { requireAuthSession } from '@/lib/auth/require-session';

export const maxDuration = 120;

const syncSchema = z.object({
  provider: z.string(),
  // Objeto explícito, no `z.record`: con claves libres el cliente podía colar
  // campos que los conectores interpolan en la URL (tenantId) sin que ningún
  // guard los mirara. Misma forma que /api/erp/connect.
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
  syncType: z.enum(['trial_balance', 'journal_entries', 'invoices', 'contacts', 'chart_of_accounts', 'all']),
  period: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const workspace = await requireWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const body = await req.json();
    const parsed = syncSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { provider, credentials, syncType, period, dateFrom, dateTo } = parsed.data;

    if (!(provider in ERP_PROVIDERS)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
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
    const creds: ERPCredentials = { provider: provider as ERPProvider, ...credentials } as ERPCredentials;

    const result: ERPSyncResult = {
      provider: provider as ERPProvider,
      success: true,
      data: {},
      syncedAt: new Date().toISOString(),
      recordCount: 0,
    };

    const effectivePeriod = period || new Date().getFullYear().toString();
    const effectiveDateFrom = dateFrom || `${effectivePeriod}-01-01`;
    const effectiveDateTo = dateTo || `${effectivePeriod}-12-31`;

    if (syncType === 'trial_balance' || syncType === 'all') {
      const tb = await connector.getTrialBalance(creds, effectivePeriod);
      result.data!.trialBalance = tb;
      result.recordCount += tb.accounts.length;
    }

    if (syncType === 'chart_of_accounts' || syncType === 'all') {
      const accounts = await connector.getChartOfAccounts(creds);
      result.data!.chartOfAccounts = accounts;
      result.recordCount += accounts.length;
    }

    if (syncType === 'journal_entries' || syncType === 'all') {
      const entries = await connector.getJournalEntries(creds, effectiveDateFrom, effectiveDateTo);
      result.data!.journalEntries = entries;
      result.recordCount += entries.length;
    }

    if (syncType === 'invoices' || syncType === 'all') {
      const invoices = await connector.getInvoices(creds, effectiveDateFrom, effectiveDateTo);
      result.data!.invoices = invoices;
      result.recordCount += invoices.length;
    }

    if (syncType === 'contacts' || syncType === 'all') {
      const contacts = await connector.getContacts(creds);
      result.data!.contacts = contacts;
      result.recordCount += contacts.length;
    }

    void logApiActivity(req, {
      category: 'erp',
      action: `erp.sync.${syncType}`,
      level: 'info',
      message: `Sync ${provider} (${syncType}): ${result.recordCount} registros`,
      durationMs: Date.now() - startedAt,
      statusCode: 200,
      resourceType: 'erp_sync',
      resourceId: provider,
      metadata: { provider, syncType, recordCount: result.recordCount },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync error';
    // El mensaje crudo arrastraba el status, la URL destino y hasta 300 bytes
    // del cuerpo del upstream: devolverlo convertía cualquier SSRF en una
    // primitiva de lectura. El detalle queda en el log del servidor y en el
    // activity log, correlacionado por requestId. Mismo patrón que
    // /api/erp/connect.
    const requestId = crypto.randomUUID();
    console.error(`[erp-sync] requestId=${requestId}:`, message);
    void logApiActivity(req, {
      category: 'erp',
      action: 'erp.sync.failed',
      level: 'error',
      message: `Error en sync ERP: ${message}`,
      durationMs: Date.now() - startedAt,
      statusCode: 500,
      resourceType: 'erp_sync',
      metadata: { error: message, requestId },
    });
    return NextResponse.json(
      {
        success: false,
        error:
          'No se pudo completar la sincronización con el ERP. Verifique las credenciales y vuelva a intentar.',
        requestId,
        syncedAt: new Date().toISOString(),
        recordCount: 0,
      },
      { status: 500 },
    );
  }
}
