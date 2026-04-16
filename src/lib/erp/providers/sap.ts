// ─── SAP Business One Connector ──────────────────────────────────────────────
// Session-based auth via /b1s/v1/Login. OData queries for financial data.

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

// ─── SAP B1 API Response Types ───────────────────────────────────────────────

interface SAPB1LoginResponse {
  SessionId: string;
}

interface SAPB1ODataResponse<T> {
  value: T[];
  'odata.nextLink'?: string;
}

interface SAPB1Account {
  Code: string;
  Name: string;
  Balance: number;
  AccountType: string;
  ActiveAccount: string;
  FatherAccountKey?: string;
  Levels: number;
}

interface SAPB1JournalEntry {
  JdtNum: number;
  RefDate: string;
  Memo: string;
  Reference?: string;
  JournalEntryLines: SAPB1JournalLine[];
}

interface SAPB1JournalLine {
  AccountCode: string;
  ShortName: string;
  Debit: number;
  Credit: number;
  LineMemo?: string;
  CostingCode?: string;
}

interface SAPB1Invoice {
  DocEntry: number;
  DocNum: number;
  DocDate: string;
  DocDueDate: string;
  CardCode: string;
  CardName: string;
  DocTotal: number;
  VatSum: number;
  DocTotalSys: number;
  DocCurrency: string;
  DocumentStatus: string;
  Cancelled: string;
}

interface SAPB1BusinessPartner {
  CardCode: string;
  CardName: string;
  CardType: string;
  FederalTaxID?: string;
  EmailAddress?: string;
  Phone1?: string;
  City?: string;
}

/**
 * SAP Business One Service Layer connector.
 *
 * Auth flow:
 * 1. POST /b1s/v1/Login with UserName, Password, CompanyDB
 * 2. Server returns SessionId — used as a cookie for subsequent requests
 * 3. On 401 responses, re-authenticate and retry once
 */
export class SAPConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'sap_b1';

  /** Active session ID, cached between calls */
  private sessionId: string | null = null;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Resolve the Service Layer base URL from credentials */
  private getBaseUrl(credentials: ERPCredentials): string {
    const base = credentials.baseUrl ?? 'https://localhost:50000';
    return `${base.replace(/\/+$/, '')}/b1s/v1`;
  }

  /** Authenticate and store the SessionId */
  private async login(credentials: ERPCredentials): Promise<string> {
    const url = `${this.getBaseUrl(credentials)}/Login`;
    const body = {
      UserName: credentials.username,
      Password: credentials.password,
      CompanyDB: credentials.databaseName ?? credentials.companyId,
    };

    const result = await this.fetchJSON<SAPB1LoginResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    this.sessionId = result.SessionId;
    return this.sessionId;
  }

  /** Make an authenticated request with automatic session refresh on 401 */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    if (!this.sessionId) {
      await this.login(credentials);
    }

    const url = `${this.getBaseUrl(credentials)}${path}`;
    const headers: Record<string, string> = {
      Cookie: `B1SESSION=${this.sessionId}`,
      ...((options.headers as Record<string, string>) ?? {}),
    };

    try {
      return await this.fetchJSON<T>(url, { ...options, headers });
    } catch (error) {
      // Retry once on 401 — session may have expired
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401')) {
        await this.login(credentials);
        headers.Cookie = `B1SESSION=${this.sessionId}`;
        return this.fetchJSON<T>(url, { ...options, headers });
      }
      throw error;
    }
  }

  /** Fetch all pages of an OData collection */
  private async fetchAllPages<T>(
    credentials: ERPCredentials,
    path: string,
  ): Promise<T[]> {
    const results: T[] = [];
    let currentPath = path;

    while (currentPath) {
      const response = await this.authenticatedFetch<SAPB1ODataResponse<T>>(
        credentials,
        currentPath,
      );
      results.push(...response.value);

      if (response['odata.nextLink']) {
        // nextLink is typically a relative path like "ChartOfAccounts?$skip=20"
        const next = response['odata.nextLink'];
        currentPath = next.startsWith('/') ? next : `/${next}`;
      } else {
        break;
      }
    }

    return results;
  }

  /**
   * Map SAP B1 AccountType to normalized type.
   * SAP types: at_Expenses, at_Revenues, at_Other (assets/liabilities/equity)
   */
  private mapAccountType(sapType: string, code: string): ERPAccount['type'] {
    switch (sapType) {
      case 'at_Expenses':
        return code.startsWith('7') ? 'cost' : 'expense';
      case 'at_Revenues':
        return 'revenue';
      default: {
        // Infer from PUC class (Colombian chart of accounts) by first digit
        const first = code.charAt(0);
        if (first === '1') return 'asset';
        if (first === '2') return 'liability';
        if (first === '3') return 'equity';
        if (first === '4') return 'revenue';
        if (first === '5') return 'expense';
        if (first === '6') return 'cost';
        if (first === '7') return 'cost';
        return 'asset';
      }
    }
  }

  /** Infer PUC class from account code */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection by attempting a login */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.login(credentials);
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const accounts = await this.fetchAllPages<SAPB1Account>(
      credentials,
      '/ChartOfAccounts?$select=Code,Name,Balance,AccountType,ActiveAccount,FatherAccountKey,Levels',
    );

    return accounts
      .filter((a) => a.ActiveAccount === 'tYES')
      .map((a) => ({
        code: a.Code,
        name: a.Name,
        type: this.mapAccountType(a.AccountType, a.Code),
        pucClass: this.inferPUCClass(a.Code),
        balance: a.Balance,
        debit: a.Balance > 0 ? a.Balance : 0,
        credit: a.Balance < 0 ? Math.abs(a.Balance) : 0,
        level: a.Levels,
        parentCode: a.FatherAccountKey ?? undefined,
        isAuxiliary: a.Levels >= 4,
      }));
  }

  /** Fetch trial balance by aggregating journal entries for the given period (YYYY-MM) */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    // period format: "2025-12" → derive start/end dates
    const [year, month] = period.split('-').map(Number);
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Get chart of accounts for names/types
    const accounts = await this.getChartOfAccounts(credentials);
    const accountMap = new Map(accounts.map((a) => [a.code, a]));

    // Get journal entries for the period
    const filter = `RefDate ge '${startDate}' and RefDate le '${endDate}'`;
    const entries = await this.fetchAllPages<SAPB1JournalEntry>(
      credentials,
      `/JournalEntries?$filter=${encodeURIComponent(filter)}`,
    );

    // Aggregate debits/credits by account
    const aggregated = new Map<string, { debit: number; credit: number }>();
    for (const entry of entries) {
      for (const line of entry.JournalEntryLines ?? []) {
        const existing = aggregated.get(line.AccountCode) ?? { debit: 0, credit: 0 };
        existing.debit += line.Debit;
        existing.credit += line.Credit;
        aggregated.set(line.AccountCode, existing);
      }
    }

    // Build trial balance accounts
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
        level: acct?.level ?? 1,
        parentCode: acct?.parentCode,
        isAuxiliary: acct?.isAuxiliary ?? false,
      });
    }

    return {
      period,
      companyName: credentials.companyId ?? 'SAP B1 Company',
      currency: 'COP',
      accounts: tbAccounts.sort((a, b) => a.code.localeCompare(b.code)),
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
    const filter = `RefDate ge '${dateFrom}' and RefDate le '${dateTo}'`;
    const entries = await this.fetchAllPages<SAPB1JournalEntry>(
      credentials,
      `/JournalEntries?$filter=${encodeURIComponent(filter)}`,
    );

    return entries.map((e) => {
      const lines: ERPJournalLine[] = (e.JournalEntryLines ?? []).map((l) => ({
        accountCode: l.AccountCode,
        accountName: l.ShortName,
        description: l.LineMemo ?? undefined,
        debit: l.Debit,
        credit: l.Credit,
        costCenter: l.CostingCode ?? undefined,
      }));

      return {
        id: String(e.JdtNum),
        date: e.RefDate,
        description: e.Memo,
        reference: e.Reference ?? undefined,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch A/R and A/P invoices for a date range */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const filter = `DocDate ge '${dateFrom}' and DocDate le '${dateTo}'`;
    const encodedFilter = encodeURIComponent(filter);

    const [arInvoices, apInvoices] = await Promise.all([
      this.fetchAllPages<SAPB1Invoice>(
        credentials,
        `/Invoices?$filter=${encodedFilter}`,
      ),
      this.fetchAllPages<SAPB1Invoice>(
        credentials,
        `/PurchaseInvoices?$filter=${encodedFilter}`,
      ),
    ]);

    const mapInvoice = (inv: SAPB1Invoice, type: 'sale' | 'purchase'): ERPInvoice => {
      let status: ERPInvoice['status'] = 'open';
      if (inv.Cancelled === 'tYES') status = 'cancelled';
      else if (inv.DocumentStatus === 'bost_Close') status = 'paid';
      else if (inv.DocumentStatus === 'bost_Open') {
        const due = new Date(inv.DocDueDate);
        status = due < new Date() ? 'overdue' : 'open';
      }

      return {
        id: String(inv.DocEntry),
        number: String(inv.DocNum),
        date: inv.DocDate,
        dueDate: inv.DocDueDate,
        type,
        contactName: inv.CardName,
        contactNit: inv.CardCode,
        subtotal: inv.DocTotal - inv.VatSum,
        taxTotal: inv.VatSum,
        total: inv.DocTotal,
        currency: inv.DocCurrency ?? 'COP',
        status,
      };
    };

    return [
      ...arInvoices.map((i) => mapInvoice(i, 'sale')),
      ...apInvoices.map((i) => mapInvoice(i, 'purchase')),
    ];
  }

  /** Fetch business partners */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const partners = await this.fetchAllPages<SAPB1BusinessPartner>(
      credentials,
      '/BusinessPartners?$select=CardCode,CardName,CardType,FederalTaxID,EmailAddress,Phone1,City',
    );

    return partners.map((p) => ({
      id: p.CardCode,
      name: p.CardName,
      nit: p.FederalTaxID ?? undefined,
      type: p.CardType === 'cCustomer' ? 'customer' : p.CardType === 'cSupplier' ? 'supplier' : 'both',
      email: p.EmailAddress ?? undefined,
      phone: p.Phone1 ?? undefined,
      city: p.City ?? undefined,
    }));
  }
}
