// ─── Abstract ERP Connector ───────────────────────────────────────────────────
// All provider connectors implement this interface.

import type {
  ERPProvider,
  ERPCredentials,
  ERPTrialBalance,
  ERPJournalEntry,
  ERPInvoice,
  ERPContact,
  ERPAccount,
} from './types';

export interface ERPConnectorInterface {
  readonly provider: ERPProvider;

  /** Test the connection with given credentials. Returns true if valid. */
  testConnection(credentials: ERPCredentials): Promise<boolean>;

  /** Fetch the chart of accounts */
  getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]>;

  /** Fetch the trial balance for a given period */
  getTrialBalance(credentials: ERPCredentials, period: string): Promise<ERPTrialBalance>;

  /** Fetch journal entries for a date range */
  getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]>;

  /** Fetch invoices for a date range */
  getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]>;

  /** Fetch contacts */
  getContacts(credentials: ERPCredentials): Promise<ERPContact[]>;
}

/**
 * Base class with common HTTP utilities for ERP connectors.
 */
export abstract class BaseERPConnector implements ERPConnectorInterface {
  abstract readonly provider: ERPProvider;

  abstract testConnection(credentials: ERPCredentials): Promise<boolean>;
  abstract getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]>;
  abstract getTrialBalance(credentials: ERPCredentials, period: string): Promise<ERPTrialBalance>;
  abstract getJournalEntries(credentials: ERPCredentials, dateFrom: string, dateTo: string): Promise<ERPJournalEntry[]>;
  abstract getInvoices(credentials: ERPCredentials, dateFrom: string, dateTo: string): Promise<ERPInvoice[]>;
  abstract getContacts(credentials: ERPCredentials): Promise<ERPContact[]>;

  protected async fetchJSON<T>(
    url: string,
    options: RequestInit = {},
    timeout = 30_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `ERP API error ${response.status}: ${response.statusText}. ${errorBody.slice(0, 200)}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Convert ERP trial balance to CSV format for the NIIF pipeline */
  trialBalanceToCSV(tb: ERPTrialBalance): string {
    const header = 'codigo,cuenta,debitos,creditos,saldo';
    const rows = tb.accounts
      .filter(a => a.isAuxiliary)
      .map(a => `${a.code},${a.name.replace(/,/g, ';')},${a.debit},${a.credit},${a.balance}`);
    return [header, ...rows].join('\n');
  }
}
