// ─── Xero Connector ─────────────────────────────────────────────────────────
// OAuth 2.0 with short-lived access tokens (30 min). Rate limited: 60 req/min.

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

// ─── Xero API Response Types ────────────────────────────────────────────────

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class: string;
  Status: string;
  EnablePaymentsToAccount: boolean;
  ShowInExpenseClaims: boolean;
}

interface XeroManualJournal {
  ManualJournalID: string;
  Date: string;
  Narration: string;
  Status: string;
  JournalLines: XeroJournalLine[];
}

interface XeroJournalLine {
  AccountCode: string;
  AccountID: string;
  Description?: string;
  LineAmount: number;
  TaxAmount?: number;
  AccountName?: string;
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: string; // ACCREC (sale) or ACCPAY (purchase)
  Date: string;
  DueDate: string;
  Contact: { ContactID: string; Name: string };
  SubTotal: number;
  TotalTax: number;
  Total: number;
  CurrencyCode: string;
  Status: string;
  AmountDue: number;
}

interface XeroContact {
  ContactID: string;
  Name: string;
  TaxNumber?: string;
  EmailAddress?: string;
  Phones?: { PhoneType: string; PhoneNumber?: string }[];
  Addresses?: { AddressType: string; City?: string }[];
  IsCustomer: boolean;
  IsSupplier: boolean;
  ContactStatus: string;
}

/** Xero report row */
interface XeroReportRow {
  RowType: string;
  Title?: string;
  Cells?: { Value: string; Attributes?: { Value: string; Id: string }[] }[];
  Rows?: XeroReportRow[];
}

interface XeroReport {
  ReportID: string;
  ReportName: string;
  ReportDate: string;
  Rows: XeroReportRow[];
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

/** Token-bucket rate limiter: 60 calls/minute per tenant */
class XeroRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 60, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestInWindow = this.timestamps[0]!;
      const waitMs = this.windowMs - (now - oldestInWindow) + 100;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

/**
 * Xero accounting connector.
 *
 * Auth flow:
 * 1. Use stored refresh_token to obtain a new access_token (30-min TTL)
 * 2. Every request requires the `xero-tenant-id` header
 * 3. Rate limit: 60 calls/minute per tenant (enforced client-side + 429 handling)
 */
export class XeroConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'xero';

  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private tokenExpiry = 0;
  private rateLimiter = new XeroRateLimiter(60, 60_000);

  private static readonly TOKEN_URL = 'https://identity.xero.com/connect/token';
  private static readonly API_BASE = 'https://api.xero.com/api.xro/2.0';

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Refresh the OAuth 2.0 access token */
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

    const response = await this.fetchJSON<XeroTokenResponse>(
      XeroConnector.TOKEN_URL,
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
    // Expire 30 seconds early (Xero tokens last 30 min)
    this.tokenExpiry = Date.now() + (response.expires_in - 30) * 1000;
    return this.accessToken;
  }

  /**
   * Make an authenticated, rate-limited request.
   * Handles 429 (Too Many Requests) with retry-after.
   */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
    retryCount = 0,
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();
    const token = await this.ensureToken(credentials);
    const tenantId = credentials.tenantId ?? '';
    const url = `${XeroConnector.API_BASE}${path}`;

    try {
      return await this.fetchJSON<T>(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'xero-tenant-id': tenantId,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';

      // Handle 429 — rate limited by Xero, back off and retry
      if (msg.includes('429') && retryCount < 3) {
        const retryAfterMs = (retryCount + 1) * 5_000;
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        return this.authenticatedFetch<T>(credentials, path, retryCount + 1);
      }

      // Handle 401 — token expired, refresh and retry
      if (msg.includes('401') && retryCount < 1) {
        this.accessToken = null;
        this.tokenExpiry = 0;
        return this.authenticatedFetch<T>(credentials, path, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Map Xero account Class/Type to normalized type.
   * Xero classes: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
   */
  private mapAccountType(xeroClass: string, xeroType: string): ERPAccount['type'] {
    const cls = xeroClass.toUpperCase();
    if (cls === 'ASSET') return 'asset';
    if (cls === 'LIABILITY') return 'liability';
    if (cls === 'EQUITY') return 'equity';
    if (cls === 'REVENUE') return 'revenue';
    if (cls === 'EXPENSE') {
      return xeroType.toUpperCase().includes('DIRECTCOSTS') ? 'cost' : 'expense';
    }
    return 'asset';
  }

  /** Infer PUC class from account code */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  /** Determine account level from code length */
  private inferLevel(code: string): number {
    const digits = code.replace(/\D/g, '');
    if (digits.length <= 1) return 1;
    if (digits.length <= 2) return 2;
    if (digits.length <= 4) return 3;
    return 4;
  }

  /** Parse Xero trial balance report into account entries */
  private parseTrialBalanceReport(report: XeroReport): ERPAccount[] {
    const accounts: ERPAccount[] = [];

    for (const section of report.Rows ?? []) {
      if (section.RowType !== 'Section' || !section.Rows) continue;

      for (const row of section.Rows) {
        if (row.RowType !== 'Row' || !row.Cells || row.Cells.length < 3) continue;

        const accountName = row.Cells[0]?.Value ?? '';
        const debitStr = row.Cells[1]?.Value ?? '0';
        const creditStr = row.Cells[2]?.Value ?? '0';

        // Extract account ID from attributes if present
        const accountId = row.Cells[0]?.Attributes?.[0]?.Value ?? '';

        if (accountName && !accountName.toLowerCase().includes('total')) {
          const debit = parseFloat(debitStr.replace(/,/g, '')) || 0;
          const credit = parseFloat(creditStr.replace(/,/g, '')) || 0;

          accounts.push({
            code: accountId || accountName.split(' ')[0] || accountName,
            name: accountName,
            type: 'asset', // Will be enriched from chart of accounts
            balance: debit - credit,
            debit,
            credit,
            level: 4,
            isAuxiliary: true,
          });
        }
      }
    }

    return accounts;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection by fetching the organisation endpoint */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.authenticatedFetch<{ Accounts: XeroAccount[] }>(
        credentials,
        '/Accounts?where=Status=="ACTIVE"&page=1',
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const response = await this.authenticatedFetch<{ Accounts: XeroAccount[] }>(
      credentials,
      '/Accounts',
    );

    return (response.Accounts ?? [])
      .filter((a) => a.Status === 'ACTIVE')
      .map((a) => ({
        code: a.Code || a.AccountID,
        name: a.Name,
        type: this.mapAccountType(a.Class, a.Type),
        pucClass: this.inferPUCClass(a.Code || ''),
        balance: 0,
        debit: 0,
        credit: 0,
        level: this.inferLevel(a.Code || ''),
        isAuxiliary: true,
      }));
  }

  /**
   * Fetch trial balance using Xero's native report endpoint.
   * Enriches with chart of accounts types.
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Fetch chart of accounts for type metadata
    const chartOfAccounts = await this.getChartOfAccounts(credentials);
    const accountTypeMap = new Map(
      chartOfAccounts.map((a) => [a.code, { type: a.type, name: a.name }]),
    );

    // Fetch the native trial balance report
    const report = await this.authenticatedFetch<{ Reports: XeroReport[] }>(
      credentials,
      `/Reports/TrialBalance?date=${endDate}`,
    );

    const reportData = report.Reports?.[0];
    if (!reportData) {
      return {
        period,
        companyName: 'Xero Company',
        currency: 'USD',
        accounts: [],
        totalDebit: 0,
        totalCredit: 0,
        generatedAt: new Date().toISOString(),
      };
    }

    const accounts = this.parseTrialBalanceReport(reportData);

    // Enrich with account type from chart of accounts
    for (const acct of accounts) {
      const match = accountTypeMap.get(acct.code);
      if (match) {
        acct.type = match.type;
        if (!acct.name || acct.name === acct.code) {
          acct.name = match.name;
        }
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
      companyName: credentials.companyId ?? 'Xero Company',
      currency: 'USD',
      accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)),
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Fetch manual journal entries for a date range */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    // Xero filters use a specific format with DateTimeOffset
    const filter = `Date >= DateTime(${dateFrom.replace(/-/g, ',')}) AND Date <= DateTime(${dateTo.replace(/-/g, ',')})`;
    const response = await this.authenticatedFetch<{ ManualJournals: XeroManualJournal[] }>(
      credentials,
      `/ManualJournals?where=${encodeURIComponent(filter)}`,
    );

    return (response.ManualJournals ?? []).map((j) => {
      const lines: ERPJournalLine[] = (j.JournalLines ?? []).map((l) => ({
        accountCode: l.AccountCode,
        accountName: l.AccountName ?? l.AccountCode,
        description: l.Description ?? undefined,
        debit: l.LineAmount > 0 ? l.LineAmount : 0,
        credit: l.LineAmount < 0 ? Math.abs(l.LineAmount) : 0,
      }));

      return {
        id: j.ManualJournalID,
        date: j.Date,
        description: j.Narration,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch invoices (A/R and A/P) for a date range */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const filter = `Date >= DateTime(${dateFrom.replace(/-/g, ',')}) AND Date <= DateTime(${dateTo.replace(/-/g, ',')})`;
    const response = await this.authenticatedFetch<{ Invoices: XeroInvoice[] }>(
      credentials,
      `/Invoices?where=${encodeURIComponent(filter)}`,
    );

    return (response.Invoices ?? []).map((inv) => {
      let status: ERPInvoice['status'] = 'open';
      const st = inv.Status.toUpperCase();
      if (st === 'PAID') status = 'paid';
      else if (st === 'DRAFT') status = 'draft';
      else if (st === 'VOIDED' || st === 'DELETED') status = 'cancelled';
      else if (st === 'AUTHORISED' && inv.AmountDue > 0) {
        status = inv.DueDate && new Date(inv.DueDate) < new Date() ? 'overdue' : 'open';
      }

      return {
        id: inv.InvoiceID,
        number: inv.InvoiceNumber,
        date: inv.Date,
        dueDate: inv.DueDate,
        type: inv.Type === 'ACCREC' ? 'sale' as const : 'purchase' as const,
        contactName: inv.Contact.Name,
        contactNit: inv.Contact.ContactID,
        subtotal: inv.SubTotal,
        taxTotal: inv.TotalTax,
        total: inv.Total,
        currency: inv.CurrencyCode ?? 'USD',
        status,
      };
    });
  }

  /** Fetch contacts */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const response = await this.authenticatedFetch<{ Contacts: XeroContact[] }>(
      credentials,
      '/Contacts?where=ContactStatus=="ACTIVE"',
    );

    return (response.Contacts ?? []).map((c) => {
      let type: ERPContact['type'] = 'customer';
      if (c.IsCustomer && c.IsSupplier) type = 'both';
      else if (c.IsSupplier) type = 'supplier';

      const phone = c.Phones?.find((p) => p.PhoneNumber)?.PhoneNumber ?? undefined;
      const city = c.Addresses?.find((a) => a.City)?.City ?? undefined;

      return {
        id: c.ContactID,
        name: c.Name,
        nit: c.TaxNumber ?? undefined,
        type,
        email: c.EmailAddress ?? undefined,
        phone,
        city,
      };
    });
  }
}
