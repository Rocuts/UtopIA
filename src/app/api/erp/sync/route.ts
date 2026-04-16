import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getConnector, ERP_PROVIDERS } from '@/lib/erp/registry';
import type { ERPProvider, ERPCredentials, ERPSyncResult } from '@/lib/erp/types';

export const maxDuration = 120;

const syncSchema = z.object({
  provider: z.string(),
  credentials: z.record(z.string(), z.string().optional()),
  syncType: z.enum(['trial_balance', 'journal_entries', 'invoices', 'contacts', 'chart_of_accounts', 'all']),
  period: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function POST(req: Request) {
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

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync error';
    return NextResponse.json(
      {
        success: false,
        error: message,
        syncedAt: new Date().toISOString(),
        recordCount: 0,
      },
      { status: 500 },
    );
  }
}
