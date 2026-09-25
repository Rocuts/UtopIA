import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getConnector, ERP_PROVIDERS } from '@/lib/erp/registry';
import type { ERPProvider, ERPCredentials, ERPSyncResult } from '@/lib/erp/types';
import { logApiActivity } from '@/lib/db/activity-log';
import { requireWorkspace } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { erpCredentials as erpCredentialsTable } from '@/lib/db/schema';
import { loadCredentials } from '@/lib/erp/credentials';
import { assertSafeBaseUrl } from '@/lib/erp/validate-base-url';
import { resolveERPPeriod, ERPPeriodError, type ResolvedERPPeriod } from '@/lib/erp/period';
import { requireAuthSession } from '@/lib/auth/require-session';

export const maxDuration = 120;

const SYNC_TYPES = ['trial_balance', 'journal_entries', 'invoices', 'contacts', 'chart_of_accounts', 'all'] as const;
type SyncType = (typeof SYNC_TYPES)[number];

const syncSchema = z.object({
  provider: z.string(),
  // Opcional: sin credenciales en el cuerpo se usan las del vault del
  // workspace del solicitante (flujo de la UI, que nunca reenvía secretos).
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
  }).optional(),
  syncType: z.enum(SYNC_TYPES).optional(),
  syncTypes: z.array(z.enum(SYNC_TYPES)).min(1).optional(),
  period: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).refine((b) => b.syncType !== undefined || b.syncTypes !== undefined, {
  message: 'syncType o syncTypes es obligatorio.',
  path: ['syncType'],
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

    const { provider, credentials, period, dateFrom, dateTo } = parsed.data;
    const requested = new Set<SyncType>(parsed.data.syncTypes ?? [parsed.data.syncType as SyncType]);
    const wants = (type: Exclude<SyncType, 'all'>) => requested.has(type) || requested.has('all');
    const syncLabel = [...requested].join('+');

    if (!(provider in ERP_PROVIDERS)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    // Periodo validado ANTES de llamar al ERP (año, trimestre, mes o rango).
    let resolved: ResolvedERPPeriod;
    try {
      resolved = resolveERPPeriod(
        dateFrom && dateTo ? `${dateFrom}..${dateTo}` : period || new Date().getFullYear().toString(),
      );
    } catch (err) {
      if (err instanceof ERPPeriodError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let creds: ERPCredentials;
    if (credentials) {
      creds = { provider: provider as ERPProvider, ...credentials } as ERPCredentials;
    } else {
      // Credenciales del vault, siempre del workspace del solicitante.
      const [row] = await getDb()
        .select()
        .from(erpCredentialsTable)
        .where(
          and(
            eq(erpCredentialsTable.workspaceId, workspace.id),
            eq(erpCredentialsTable.provider, provider),
          ),
        )
        .limit(1);
      if (!row) {
        return NextResponse.json(
          { error: 'No hay credenciales guardadas para este ERP. Conéctelo de nuevo.' },
          { status: 404 },
        );
      }
      creds = { ...loadCredentials(row), provider: provider as ERPProvider };
    }

    // SSRF guard — connectors fetch() this URL server-side.
    if (creds.baseUrl) {
      try {
        assertSafeBaseUrl(creds.baseUrl);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'baseUrl inválida.' },
          { status: 400 },
        );
      }
    }

    const connector = await getConnector(provider as ERPProvider);

    const result: ERPSyncResult & { persisted: false; period: string } = {
      provider: provider as ERPProvider,
      success: true,
      data: {},
      syncedAt: new Date().toISOString(),
      recordCount: 0,
      // Honestidad: la lectura NO se guarda ni alimenta informes todavía.
      persisted: false,
      period: resolved.label,
    };

    if (wants('trial_balance')) {
      const tb = await connector.getTrialBalance(creds, resolved.label);
      result.data!.trialBalance = tb;
      result.recordCount += tb.accounts.length;
    }

    if (wants('chart_of_accounts')) {
      const accounts = await connector.getChartOfAccounts(creds);
      result.data!.chartOfAccounts = accounts;
      result.recordCount += accounts.length;
    }

    if (wants('journal_entries')) {
      const entries = await connector.getJournalEntries(creds, resolved.from, resolved.to);
      result.data!.journalEntries = entries;
      result.recordCount += entries.length;
    }

    if (wants('invoices')) {
      const invoices = await connector.getInvoices(creds, resolved.from, resolved.to);
      result.data!.invoices = invoices;
      result.recordCount += invoices.length;
    }

    if (wants('contacts')) {
      const contacts = await connector.getContacts(creds);
      result.data!.contacts = contacts;
      result.recordCount += contacts.length;
    }

    void logApiActivity(req, {
      category: 'erp',
      action: `erp.sync.${syncLabel}`,
      level: 'info',
      message: `Lectura ${provider} (${syncLabel}, ${resolved.label}): ${result.recordCount} registros (no persistidos)`,
      durationMs: Date.now() - startedAt,
      statusCode: 200,
      resourceType: 'erp_sync',
      resourceId: provider,
      metadata: {
        provider,
        syncType: syncLabel,
        period: resolved.label,
        recordCount: result.recordCount,
        persisted: false,
        trialBalanceStatus: result.data!.trialBalance?.balanceStatus ?? null,
      },
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
