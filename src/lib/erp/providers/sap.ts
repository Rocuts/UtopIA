// ─── SAP Business One Connector ──────────────────────────────────────────────
// Session-based auth via /b1s/v1/Login. OData queries for financial data.

import { BaseERPConnector } from '../connector';
import { connectionKey } from '../session-store';
import { resolveERPPeriod } from '../period';
import { buildMovementsTrialBalance } from '../trial-balance-builders';
import { markLeafAccounts, pucTypeFromCode } from '../puc';
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
  /** Minutes. */
  SessionTimeout?: number;
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

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Resolve the Service Layer base URL from credentials */
  private getBaseUrl(credentials: ERPCredentials): string {
    const base = credentials.baseUrl ?? 'https://localhost:50000';
    return `${base.replace(/\/+$/, '')}/b1s/v1`;
  }

  /**
   * Service Layer session (B1SESSION) for THESE credentials. Cached per
   * connection (provider + credential fingerprint), never per instance.
   */
  private getSessionId(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    return this.sessions.resolve(
      connectionKey(credentials, 'session'),
      async () => {
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
        if (!result.SessionId) {
          throw new Error('SAP B1 authentication failed: no SessionId returned.');
        }
        // SessionTimeout llega en minutos (30 por defecto en Service Layer).
        return { value: result.SessionId, ttlMs: (result.SessionTimeout ?? 30) * 60_000 };
      },
      { refreshMarginMs: 60_000, forceRefresh: options.forceRefresh },
    );
  }

  /** Make an authenticated request with automatic session refresh on 401 */
  private async authenticatedFetch<T>(
    credentials: ERPCredentials,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.getBaseUrl(credentials)}${path}`;
    const request = (sessionId: string) =>
      this.fetchJSON<T>(url, {
        ...options,
        headers: {
          Cookie: `B1SESSION=${sessionId}`,
          ...((options.headers as Record<string, string>) ?? {}),
        },
      });

    try {
      return await request(await this.getSessionId(credentials));
    } catch (error) {
      // Retry once on 401 — session may have expired
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401')) {
        return request(await this.getSessionId(credentials, { forceRefresh: true }));
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
      default:
        // Infer from PUC class (Colombian chart of accounts) by first digit
        return pucTypeFromCode(code);
    }
  }

  /** Infer PUC class from account code */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection by attempting a fresh login (never a cached session) */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getSessionId(credentials, { forceRefresh: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the chart of accounts. `Balance` is the CURRENT balance of the
   * account (not the balance at a period end), so it is exposed only as
   * chart metadata and never as a period trial balance.
   */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const accounts = await this.fetchAllPages<SAPB1Account>(
      credentials,
      '/ChartOfAccounts?$select=Code,Name,Balance,AccountType,ActiveAccount,FatherAccountKey,Levels',
    );

    return markLeafAccounts(
      accounts
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
          isAuxiliary: false,
        })),
    );
  }

  /**
   * Local currency of the company database (AdminInfo.LocalCurrency). Empty
   * string when it cannot be read, so COP-only consumers fail closed instead
   * of treating foreign-currency figures as pesos.
   */
  private async getLocalCurrency(credentials: ERPCredentials): Promise<string> {
    try {
      const info = await this.authenticatedFetch<{ LocalCurrency?: string }>(
        credentials,
        '/CompanyService_GetAdminInfo',
        { method: 'POST' },
      );
      return (info.LocalCurrency ?? '').trim().toUpperCase();
    } catch {
      return '';
    }
  }

  /**
   * Movements of the period aggregated from journal entries. The Service
   * Layer calls used here give no opening balance for the period, so the
   * result is flagged `movements_only` and never presented as a trial balance.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);

    const [accounts, currency] = await Promise.all([
      this.getChartOfAccounts(credentials),
      this.getLocalCurrency(credentials),
    ]);

    const filter = `RefDate ge '${resolved.from}' and RefDate le '${resolved.to}'`;
    const entries = await this.fetchAllPages<SAPB1JournalEntry>(
      credentials,
      `/JournalEntries?$filter=${encodeURIComponent(filter)}`,
    );

    return buildMovementsTrialBalance({
      providerName: 'SAP Business One',
      period: resolved,
      chart: accounts,
      lines: entries.flatMap((e) =>
        (e.JournalEntryLines ?? []).map((l) => ({
          accountCode: l.AccountCode ?? '',
          accountName: l.ShortName,
          debit: l.Debit ?? 0,
          credit: l.Credit ?? 0,
        })),
      ),
      companyName: credentials.companyId ?? credentials.databaseName ?? '',
      currency,
      warnings: currency ? [] : ['Moneda local de la compañía no determinada.'],
    });
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
