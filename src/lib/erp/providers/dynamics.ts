// ─── Microsoft Dynamics 365 Business Central Connector ───────────────────────
// OAuth 2.0 client credentials via Azure AD. OData v4 API.

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

  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private rateLimiter = new RateLimiter(600, 60_000);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Build the BC API base URL for a company */
  private getBaseUrl(credentials: ERPCredentials): string {
    const tenant = credentials.tenantId ?? '';
    const env = 'production';
    const companyId = credentials.companyId ?? '';
    return `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${env}/api/v2.0/companies(${companyId})`;
  }

  /** Obtain or refresh the OAuth 2.0 access token */
  private async ensureToken(credentials: ERPCredentials): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

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

    this.accessToken = response.access_token;
    // Expire 60 seconds early to avoid edge-case failures
    this.tokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
    return this.accessToken;
  }

  /** Make an authenticated, rate-limited request */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();
    const token = await this.ensureToken(credentials);
    const url = `${this.getBaseUrl(credentials)}${path}`;

    try {
      return await this.fetchJSON<T>(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      // On 401, force token refresh and retry once
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401')) {
        this.accessToken = null;
        this.tokenExpiry = 0;
        const newToken = await this.ensureToken(credentials);
        await this.rateLimiter.waitForSlot();
        return this.fetchJSON<T>(url, {
          headers: { Authorization: `Bearer ${newToken}` },
        });
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
    let currentUrl: string | null = `${this.getBaseUrl(credentials)}${path}`;

    while (currentUrl) {
      await this.rateLimiter.waitForSlot();
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

  /** Test connection by fetching a single account */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.authenticatedFetch<D365ODataResponse<D365Account>>(
        credentials,
        '/accounts?$top=1',
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

    return accounts
      .filter((a) => !a.blocked)
      .map((a) => ({
        code: a.number,
        name: a.displayName,
        type: this.mapAccountType(a.category),
        pucClass: this.inferPUCClass(a.number),
        balance: a.netChange,
        debit: a.netChange > 0 ? a.netChange : 0,
        credit: a.netChange < 0 ? Math.abs(a.netChange) : 0,
        level: this.inferLevel(a.number),
        isAuxiliary: this.inferLevel(a.number) >= 4,
      }));
  }

  /** Fetch trial balance by aggregating GL entries for the given period (YYYY-MM) */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [year, month] = period.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Fetch chart of accounts for metadata
    const accounts = await this.getChartOfAccounts(credentials);
    const accountMap = new Map(accounts.map((a) => [a.code, a]));

    // Fetch GL entries filtered by period
    const filter = `postingDate ge ${startDate} and postingDate le ${endDate}`;
    const glEntries = await this.fetchAllPages<D365GLEntry>(
      credentials,
      `/generalLedgerEntries?$filter=${encodeURIComponent(filter)}`,
    );

    // Aggregate by account number
    const aggregated = new Map<string, { debit: number; credit: number }>();
    for (const entry of glEntries) {
      const existing = aggregated.get(entry.accountNumber) ?? { debit: 0, credit: 0 };
      existing.debit += entry.debitAmount;
      existing.credit += entry.creditAmount;
      aggregated.set(entry.accountNumber, existing);
    }

    // Build trial balance
    const tbAccounts: ERPAccount[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const [code, totals] of aggregated) {
      const acct = accountMap.get(code);
      const balance = totals.debit - totals.credit;
      totalDebit += totals.debit;
      totalCredit += totals.credit;

      tbAccounts.push({
        code,
        name: acct?.name ?? code,
        type: acct?.type ?? 'asset',
        pucClass: this.inferPUCClass(code),
        balance,
        debit: totals.debit,
        credit: totals.credit,
        level: acct?.level ?? this.inferLevel(code),
        parentCode: acct?.parentCode,
        isAuxiliary: acct?.isAuxiliary ?? false,
      });
    }

    return {
      period,
      companyName: credentials.companyId ?? 'D365 Company',
      currency: 'COP',
      accounts: tbAccounts.sort((a, b) => a.code.localeCompare(b.code)),
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
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
