// ─── QuickBooks Online Connector ─────────────────────────────────────────────
// OAuth 2.0 with refresh token flow. SQL-like query language for most endpoints.

import { BaseERPConnector } from '../connector';
import type {
  ERPProvider,
  ERPCredentials,
  ERPAccount,
  ERPTrialBalance,
  ERPJournalEntry,
  ERPJournalLine,
  ERPInvoice,
  ERPContact,
} from '../types';

// ─── QBO API Response Types ─────────────────────────────────────────────────

interface QBOTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface QBOQueryResponse<T> {
  QueryResponse: Record<string, T[] | number | undefined> & {
    startPosition?: number;
    maxResults?: number;
    totalCount?: number;
  };
}

interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  AcctNum?: string;
  CurrentBalance: number;
  Active: boolean;
  Classification: string;
}

interface QBOJournalEntry {
  Id: string;
  TxnDate: string;
  DocNumber?: string;
  PrivateNote?: string;
  Line: QBOJournalLine[];
}

interface QBOJournalLine {
  Id: string;
  Description?: string;
  Amount: number;
  DetailType: string;
  JournalEntryLineDetail?: {
    PostingType: 'Debit' | 'Credit';
    AccountRef: { value: string; name: string };
  };
}

interface QBOInvoice {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  CustomerRef: { value: string; name: string };
  TotalAmt: number;
  TxnTaxDetail?: { TotalTax: number };
  CurrencyRef?: { value: string };
  Balance: number;
}

interface QBOCustomer {
  Id: string;
  DisplayName: string;
  PrimaryTaxIdentifier?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: { City?: string };
  Active: boolean;
}

interface QBOVendor {
  Id: string;
  DisplayName: string;
  TaxIdentifier?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: { City?: string };
  Active: boolean;
}

/** QBO report row structure */
interface QBOReportRow {
  ColData?: { value: string }[];
  Rows?: { Row?: QBOReportRow[] };
  type?: string;
  group?: string;
  Summary?: { ColData?: { value: string }[] };
}

interface QBOReport {
  Header: { ReportName: string; StartPeriod: string; EndPeriod: string };
  Columns: { Column: { ColTitle: string }[] };
  Rows: { Row: QBOReportRow[] };
}

/**
 * QuickBooks Online connector.
 *
 * Auth flow:
 * 1. Use stored refresh_token to obtain a new access_token (1-hour TTL)
 * 2. Access token is refreshed automatically before expiry
 * 3. On 401 responses, refresh and retry once
 *
 * Data access: QBO uses a SQL-like query language for entity endpoints
 * and dedicated report endpoints for trial balance, P&L, balance sheet.
 */
export class QuickBooksConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'quickbooks';

  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private tokenExpiry = 0;

  private static readonly TOKEN_URL =
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  private static readonly API_BASE = 'https://quickbooks.api.intuit.com/v3/company';

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Build the company-scoped API base URL */
  private getBaseUrl(credentials: ERPCredentials): string {
    return `${QuickBooksConnector.API_BASE}/${credentials.companyId}`;
  }

  /** Refresh the OAuth 2.0 access token using the refresh token */
  private async ensureToken(credentials: ERPCredentials): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const refreshToken = this.refreshTokenValue ?? credentials.refreshToken ?? '';
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const authHeader = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
    ).toString('base64');

    const response = await this.fetchJSON<QBOTokenResponse>(
      QuickBooksConnector.TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${authHeader}`,
        },
        body: body.toString(),
      },
    );

    this.accessToken = response.access_token;
    this.refreshTokenValue = response.refresh_token;
    // Expire 60 seconds early
    this.tokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
    return this.accessToken;
  }

  /** Make an authenticated request with automatic token refresh on 401 */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
  ): Promise<T> {
    const token = await this.ensureToken(credentials);
    const url = `${this.getBaseUrl(credentials)}${path}`;

    try {
      return await this.fetchJSON<T>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401')) {
        this.accessToken = null;
        this.tokenExpiry = 0;
        const newToken = await this.ensureToken(credentials);
        return this.fetchJSON<T>(url, {
          headers: {
            Authorization: `Bearer ${newToken}`,
            Accept: 'application/json',
          },
        });
      }
      throw error;
    }
  }

  /**
   * Execute a QBO query with automatic pagination.
   * QBO paginates with STARTPOSITION and MAXRESULTS (max 1000).
   */
  private async queryAll<T>(
    credentials: ERPCredentials,
    entityName: string,
    baseQuery: string,
    pageSize = 1000,
  ): Promise<T[]> {
    const results: T[] = [];
    let startPosition = 1;
    let hasMore = true;

    while (hasMore) {
      const paginatedQuery = `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
      const encoded = encodeURIComponent(paginatedQuery);
      const response = await this.authenticatedFetch<QBOQueryResponse<T>>(
        credentials,
        `/query?query=${encoded}`,
      );

      const items = (response.QueryResponse[entityName] as T[] | undefined) ?? [];
      results.push(...items);

      if (items.length < pageSize) {
        hasMore = false;
      } else {
        startPosition += pageSize;
      }
    }

    return results;
  }

  /**
   * Map QBO Classification to normalized account type.
   * QBO classifications: Asset, Liability, Equity, Revenue, Expense
   */
  private mapAccountType(classification: string, accountType: string): ERPAccount['type'] {
    const cls = classification.toLowerCase();
    if (cls === 'asset') return 'asset';
    if (cls === 'liability') return 'liability';
    if (cls === 'equity') return 'equity';
    if (cls === 'revenue') return 'revenue';
    if (cls === 'expense') {
      return accountType.toLowerCase().includes('cost') ? 'cost' : 'expense';
    }
    return 'asset';
  }

  /** Infer PUC class from account number */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  /** Parse a QBO report into trial balance rows */
  private parseTrialBalanceReport(report: QBOReport): ERPAccount[] {
    const accounts: ERPAccount[] = [];

    const processRow = (row: QBOReportRow): void => {
      if (row.ColData && row.ColData.length >= 3) {
        const accountStr = row.ColData[0]?.value ?? '';
        const debitStr = row.ColData[1]?.value ?? '0';
        const creditStr = row.ColData[2]?.value ?? '0';

        if (accountStr && accountStr !== '' && !accountStr.toLowerCase().includes('total')) {
          const debit = parseFloat(debitStr.replace(/,/g, '')) || 0;
          const credit = parseFloat(creditStr.replace(/,/g, '')) || 0;

          accounts.push({
            code: accountStr.split(' ')[0] ?? accountStr,
            name: accountStr,
            type: 'asset', // Will be enriched if chart of accounts is available
            balance: debit - credit,
            debit,
            credit,
            level: 4,
            isAuxiliary: true,
          });
        }
      }

      // Recurse into nested rows
      if (row.Rows?.Row) {
        for (const nested of row.Rows.Row) {
          processRow(nested);
        }
      }
    };

    for (const row of report.Rows?.Row ?? []) {
      processRow(row);
    }

    return accounts;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection by querying a single account */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.authenticatedFetch<QBOQueryResponse<QBOAccount>>(
        credentials,
        `/query?query=${encodeURIComponent('SELECT Id FROM Account MAXRESULTS 1')}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const accounts = await this.queryAll<QBOAccount>(
      credentials,
      'Account',
      'SELECT * FROM Account',
    );

    return accounts
      .filter((a) => a.Active)
      .map((a) => ({
        code: a.AcctNum ?? a.Id,
        name: a.Name,
        type: this.mapAccountType(a.Classification, a.AccountType),
        pucClass: this.inferPUCClass(a.AcctNum ?? a.Id),
        balance: a.CurrentBalance,
        debit: a.CurrentBalance > 0 ? a.CurrentBalance : 0,
        credit: a.CurrentBalance < 0 ? Math.abs(a.CurrentBalance) : 0,
        level: 4,
        isAuxiliary: true,
      }));
  }

  /**
   * Fetch trial balance using QBO's native TrialBalance report endpoint.
   * This gives us pre-aggregated data without manual GL entry aggregation.
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [year, month] = period.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Fetch chart of accounts for type metadata
    const chartOfAccounts = await this.getChartOfAccounts(credentials);
    const accountTypeMap = new Map(chartOfAccounts.map((a) => [a.name, a.type]));

    // Fetch the native trial balance report
    const report = await this.authenticatedFetch<QBOReport>(
      credentials,
      `/reports/TrialBalance?start_date=${startDate}&end_date=${endDate}`,
    );

    const accounts = this.parseTrialBalanceReport(report);

    // Enrich with account type from chart of accounts
    for (const acct of accounts) {
      const matchedType = accountTypeMap.get(acct.name);
      if (matchedType) {
        acct.type = matchedType;
      }
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const a of accounts) {
      totalDebit += a.debit;
      totalCredit += a.credit;
    }

    return {
      period,
      companyName: credentials.companyId ?? 'QuickBooks Company',
      currency: 'USD',
      accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)),
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Fetch journal entries for a date range */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const entries = await this.queryAll<QBOJournalEntry>(
      credentials,
      'JournalEntry',
      `SELECT * FROM JournalEntry WHERE TxnDate >= '${dateFrom}' AND TxnDate <= '${dateTo}'`,
    );

    return entries.map((e) => {
      const lines: ERPJournalLine[] = (e.Line ?? [])
        .filter((l) => l.JournalEntryLineDetail)
        .map((l) => {
          const detail = l.JournalEntryLineDetail!;
          const isDebit = detail.PostingType === 'Debit';
          return {
            accountCode: detail.AccountRef.value,
            accountName: detail.AccountRef.name,
            description: l.Description ?? undefined,
            debit: isDebit ? l.Amount : 0,
            credit: isDebit ? 0 : l.Amount,
          };
        });

      return {
        id: e.Id,
        date: e.TxnDate,
        description: e.PrivateNote ?? '',
        reference: e.DocNumber ?? undefined,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch invoices for a date range */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const invoices = await this.queryAll<QBOInvoice>(
      credentials,
      'Invoice',
      `SELECT * FROM Invoice WHERE TxnDate >= '${dateFrom}' AND TxnDate <= '${dateTo}'`,
    );

    return invoices.map((inv) => {
      const taxTotal = inv.TxnTaxDetail?.TotalTax ?? 0;
      let status: ERPInvoice['status'] = 'open';
      if (inv.Balance === 0) status = 'paid';
      else if (inv.DueDate && new Date(inv.DueDate) < new Date()) status = 'overdue';

      return {
        id: inv.Id,
        number: inv.DocNumber ?? inv.Id,
        date: inv.TxnDate,
        dueDate: inv.DueDate ?? undefined,
        type: 'sale' as const,
        contactName: inv.CustomerRef.name,
        contactNit: inv.CustomerRef.value,
        subtotal: inv.TotalAmt - taxTotal,
        taxTotal,
        total: inv.TotalAmt,
        currency: inv.CurrencyRef?.value ?? 'USD',
        status,
      };
    });
  }

  /** Fetch customers and vendors as contacts */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const [customers, vendors] = await Promise.all([
      this.queryAll<QBOCustomer>(credentials, 'Customer', 'SELECT * FROM Customer'),
      this.queryAll<QBOVendor>(credentials, 'Vendor', 'SELECT * FROM Vendor'),
    ]);

    return [
      ...customers
        .filter((c) => c.Active)
        .map((c) => ({
          id: c.Id,
          name: c.DisplayName,
          nit: c.PrimaryTaxIdentifier ?? undefined,
          type: 'customer' as const,
          email: c.PrimaryEmailAddr?.Address ?? undefined,
          phone: c.PrimaryPhone?.FreeFormNumber ?? undefined,
          city: c.BillAddr?.City ?? undefined,
        })),
      ...vendors
        .filter((v) => v.Active)
        .map((v) => ({
          id: v.Id,
          name: v.DisplayName,
          nit: v.TaxIdentifier ?? undefined,
          type: 'supplier' as const,
          email: v.PrimaryEmailAddr?.Address ?? undefined,
          phone: v.PrimaryPhone?.FreeFormNumber ?? undefined,
          city: v.BillAddr?.City ?? undefined,
        })),
    ];
  }
}
