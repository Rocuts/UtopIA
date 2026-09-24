// ─── Microsoft Dynamics 365 Business Central Connector ───────────────────────
// OAuth 2.0 client credentials via Azure AD. OData v4 API.

import { BaseERPConnector } from '../connector';
import { connectionKey } from '../session-store';
import { resolveERPPeriod } from '../period';
import { buildMovementsTrialBalance } from '../trial-balance-builders';
import { markLeafAccounts } from '../puc';
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

// ─── Dynamics 365 API Response Types ─────────────────────────────────────────

interface AzureADTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface D365ODataResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface D365Account {
  id: string;
  number: string;
  displayName: string;
  category: string;
  subCategory: string;
  blocked: boolean;
  accountType: string;
  directPosting: boolean;
  netChange: number;
}

interface D365GLEntry {
  id: string;
  entryNumber: number;
  postingDate: string;
  documentNumber: string;
  documentType: string;
  accountId: string;
  accountNumber: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
}

interface D365SalesInvoice {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  customerName: string;
  customerNumber: string;
  totalAmountExcludingTax: number;
  totalTaxAmount: number;
  totalAmountIncludingTax: number;
  currencyCode: string;
  status: string;
}

interface D365Customer {
  id: string;
  number: string;
  displayName: string;
  taxRegistrationNumber?: string;
  email?: string;
  phoneNumber?: string;
  city?: string;
}

interface D365Vendor {
  id: string;
  number: string;
  displayName: string;
  taxRegistrationNumber?: string;
  email?: string;
  phoneNumber?: string;
  city?: string;
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

/** Simple sliding-window rate limiter: 600 req/min */
class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 600, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0]!;
      const waitMs = this.windowMs - (now - oldestInWindow) + 50;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

/**
 * Microsoft Dynamics 365 Business Central connector.
 *
 * Auth flow:
 * 1. Obtain OAuth 2.0 token via Azure AD client credentials grant
 * 2. Use Bearer token for all API calls
 * 3. Refresh token when it expires (typically 1 hour)
 *
 * Rate limit: 600 requests/minute (enforced client-side).
 */
export class DynamicsConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'dynamics_365';

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Build the BC API base URL for a company */
  private getBaseUrl(credentials: ERPCredentials): string {
    const tenant = credentials.tenantId ?? '';
    const env = 'production';
    const companyId = credentials.companyId ?? '';
    return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${companyId})`;
  }

  /** Rate limiter of THIS connection. */
  private rateLimiterFor(credentials: ERPCredentials): RateLimiter {
    return this.sessions.getOrCreate(
      connectionKey(credentials, 'rate-limit'),
      () => new RateLimiter(600, 60_000),
    );
  }

  /**
   * OAuth 2.0 access token (client credentials) for THESE credentials, cached
   * per connection (provider + credential fingerprint), never per instance.
   */
  private ensureToken(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    return this.sessions.resolve(
      connectionKey(credentials, 'token'),
      async () => {
        const tokenUrl = `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`;
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.clientId ?? '',
          client_secret: credentials.clientSecret ?? '',
          scope: 'https://api.businesscentral.dynamics.com/.default',
        });

        const response = await this.fetchJSON<AzureADTokenResponse>(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        // Expire 60 seconds early to avoid edge-case failures
        return { value: response.access_token, ttlMs: (response.expires_in - 60) * 1000 };
      },
      { forceRefresh: options.forceRefresh },
    );
  }

  /** Make an authenticated, rate-limited request */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<T> {
    const limiter = this.rateLimiterFor(credentials);
    await limiter.waitForSlot();
    const url = `${this.getBaseUrl(credentials)}${path}`;
    const request = (token: string) =>
      this.fetchJSON<T>(url, { headers: { Authorization: `Bearer ${token}` } });

    try {
      return await request(await this.ensureToken(credentials, options));
    } catch (error) {
      // On 401, force token refresh for THIS connection and retry once
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401')) {
        const newToken = await this.ensureToken(credentials, { forceRefresh: true });
        await limiter.waitForSlot();
        return request(newToken);
      }
      throw error;
    }
  }

  /** Fetch all pages from a paginated OData v4 endpoint */
  private async fetchAllPages<T>(
    credentials: ERPCredentials,
    path: string,
  ): Promise<T[]> {
    const results: T[] = [];
    const limiter = this.rateLimiterFor(credentials);
    let currentUrl: string | null = `${this.getBaseUrl(credentials)}${path}`;

    while (currentUrl) {
      await limiter.waitForSlot();
      const token = await this.ensureToken(credentials);
      const page: D365ODataResponse<T> = await this.fetchJSON<D365ODataResponse<T>>(currentUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      results.push(...page.value);
      currentUrl = page['@odata.nextLink'] ?? null;
    }

    return results;
  }

  /**
   * Map Dynamics 365 account category to normalized type.
   * BC categories: Assets, Liabilities, Equity, Income, Expense, Cost of Goods Sold
   */
  private mapAccountType(category: string): ERPAccount['type'] {
    const cat = category.toLowerCase();
    if (cat.includes('asset')) return 'asset';
    if (cat.includes('liabilit')) return 'liability';
    if (cat.includes('equity')) return 'equity';
    if (cat.includes('income') || cat.includes('revenue')) return 'revenue';
    if (cat.includes('cost')) return 'cost';
    if (cat.includes('expense')) return 'expense';
    return 'asset';
  }

  /** Infer PUC class from account number */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  /** Determine account level from account number length */
  private inferLevel(code: string): number {
    const digits = code.replace(/\D/g, '');
    if (digits.length <= 1) return 1;
    if (digits.length <= 2) return 2;
    if (digits.length <= 4) return 3;
    return 4;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection with a fresh token (never a cached one) */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.authenticatedFetch<D365ODataResponse<D365Account>>(
        credentials,
        '/accounts?$top=1',
        { forceRefresh: true },
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const accounts = await this.fetchAllPages<D365Account>(
      credentials,
      '/accounts',
    );

    return markLeafAccounts(
      accounts
        .filter((a) => !a.blocked && Boolean(a.number))
        .map((a) => ({
          code: a.number,
          name: a.displayName,
          type: this.mapAccountType(a.category),
          pucClass: this.inferPUCClass(a.number),
          balance: a.netChange,
          debit: a.netChange > 0 ? a.netChange : 0,
          credit: a.netChange < 0 ? Math.abs(a.netChange) : 0,
          level: this.inferLevel(a.number),
          isAuxiliary: false,
        })),
    );
  }

  /**
   * Local currency of the company (companyInformation.currencyCode). Empty
   * string when it cannot be read, so COP-only consumers fail closed.
   */
  private async getCompanyCurrency(credentials: ERPCredentials): Promise<string> {
    try {
      const info = await this.authenticatedFetch<D365ODataResponse<{ currencyCode?: string }>>(
        credentials,
        '/companyInformation',
      );
      return (info.value?.[0]?.currencyCode ?? '').trim().toUpperCase();
    } catch {
      return '';
    }
  }

  /**
   * Movements of the period aggregated from general ledger entries. No
   * opening balance is read, so the result is flagged `movements_only` and
   * never presented as a trial balance.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);

    const [accounts, currency] = await Promise.all([
      this.getChartOfAccounts(credentials),
      this.getCompanyCurrency(credentials),
    ]);

    const filter = `postingDate ge ${resolved.from} and postingDate le ${resolved.to}`;
    const glEntries = await this.fetchAllPages<D365GLEntry>(
      credentials,
      `/generalLedgerEntries?$filter=${encodeURIComponent(filter)}`,
    );

    return buildMovementsTrialBalance({
      providerName: 'Dynamics 365 Business Central',
      period: resolved,
      chart: accounts,
      lines: glEntries.map((entry) => ({
        accountCode: entry.accountNumber ?? '',
        accountName: entry.description,
        debit: entry.debitAmount ?? 0,
        credit: entry.creditAmount ?? 0,
      })),
      companyName: credentials.companyId ?? '',
      currency,
      warnings: currency ? [] : ['Moneda local de la compañía no determinada.'],
    });
  }

  /** Fetch journal entries (GL entries grouped by document number) for a date range */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const filter = `postingDate ge ${dateFrom} and postingDate le ${dateTo}`;
    const glEntries = await this.fetchAllPages<D365GLEntry>(
      credentials,
      `/generalLedgerEntries?$filter=${encodeURIComponent(filter)}`,
    );

    // Group GL entries by document number to form journal entries
    const grouped = new Map<string, D365GLEntry[]>();
    for (const entry of glEntries) {
      const key = entry.documentNumber;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    return Array.from(grouped.entries()).map(([docNum, entries]) => {
      const lines: ERPJournalLine[] = entries.map((e) => ({
        accountCode: e.accountNumber,
        accountName: e.description,
        debit: e.debitAmount,
        credit: e.creditAmount,
      }));

      return {
        id: docNum,
        date: entries[0]?.postingDate ?? dateFrom,
        description: entries[0]?.description ?? '',
        reference: docNum,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch sales invoices for a date range */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const filter = `invoiceDate ge ${dateFrom} and invoiceDate le ${dateTo}`;
    const invoices = await this.fetchAllPages<D365SalesInvoice>(
      credentials,
      `/salesInvoices?$filter=${encodeURIComponent(filter)}`,
    );

    return invoices.map((inv) => {
      let status: ERPInvoice['status'] = 'open';
      const st = inv.status?.toLowerCase() ?? '';
      if (st.includes('paid') || st.includes('closed')) status = 'paid';
      else if (st.includes('draft')) status = 'draft';
      else if (st.includes('cancel')) status = 'cancelled';
      else if (inv.dueDate && new Date(inv.dueDate) < new Date()) status = 'overdue';

      return {
        id: inv.id,
        number: inv.number,
        date: inv.invoiceDate,
        dueDate: inv.dueDate,
        type: 'sale' as const,
        contactName: inv.customerName,
        contactNit: inv.customerNumber,
        subtotal: inv.totalAmountExcludingTax,
        taxTotal: inv.totalTaxAmount,
        total: inv.totalAmountIncludingTax,
        currency: inv.currencyCode ?? 'COP',
        status,
      };
    });
  }

  /** Fetch customers and vendors as contacts */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const [customers, vendors] = await Promise.all([
      this.fetchAllPages<D365Customer>(credentials, '/customers'),
      this.fetchAllPages<D365Vendor>(credentials, '/vendors'),
    ]);

    const contacts: ERPContact[] = [
      ...customers.map((c) => ({
        id: c.id,
        name: c.displayName,
        nit: c.taxRegistrationNumber ?? undefined,
        type: 'customer' as const,
        email: c.email ?? undefined,
        phone: c.phoneNumber ?? undefined,
        city: c.city ?? undefined,
      })),
      ...vendors.map((v) => ({
        id: v.id,
        name: v.displayName,
        nit: v.taxRegistrationNumber ?? undefined,
        type: 'supplier' as const,
        email: v.email ?? undefined,
        phone: v.phoneNumber ?? undefined,
        city: v.city ?? undefined,
      })),
    ];

    return contacts;
  }
}
