// ─── Siigo ERP Connector ──────────────────────────────────────────────────────
// Siigo is one of Colombia's largest cloud accounting platforms.
// Auth: Bearer token obtained via sign-in endpoint.
// Docs: https://siigonube.siigo.com/

import { BaseERPConnector } from '../connector';
import type {
  ERPCredentials,
  ERPAccount,
  ERPTrialBalance,
  ERPJournalEntry,
  ERPJournalLine,
  ERPInvoice,
  ERPContact,
} from '../types';

const SIIGO_BASE_URL = 'https://services.siigo.com/alliances/api';
const SIIGO_SIGN_IN_URL = `${SIIGO_BASE_URL}/siigoapi-users/v1/sign-in`;

// ─── Siigo API response shapes ──────────────────────────────────────────────

interface SiigoSignInResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SiigoAccount {
  id: number;
  code: string;
  name: string;
  type?: string;
  active?: boolean;
  nature?: string;
  movement_type?: string;
  classification?: string;
}

interface SiigoJournalEntry {
  id: number;
  document?: { id: number };
  date: string;
  description?: string;
  items: SiigoJournalItem[];
}

interface SiigoJournalItem {
  account: { code: string; name: string };
  description?: string;
  debit: number;
  credit: number;
  cost_center?: { code: string; name: string };
  third_party?: { identification: string; full_name: string };
}

interface SiigoInvoice {
  id: number;
  name: string;
  date: string;
  due_date?: string;
  customer?: { identification: string; name: string[] };
  total: number;
  items?: Array<{ price: number; quantity: number }>;
  taxes?: Array<{ id: number; percentage: number; value: number }>;
  stamp?: { cufe?: string };
  metadata?: { prefix?: string };
}

interface SiigoCustomer {
  id: number;
  identification: string;
  name: string[];
  contacts?: Array<{ email?: string; phone?: string }>;
  address?: { city?: { name?: string } };
}

interface SiigoVendor {
  id: number;
  identification: string;
  name: string[];
  contacts?: Array<{ email?: string; phone?: string }>;
  address?: { city?: { name?: string } };
}

interface SiigoPaginatedResponse<T> {
  results: T[];
  pagination?: {
    page: number;
    page_size: number;
    total_results: number;
  };
}

/**
 * Connector for the Siigo cloud accounting platform.
 *
 * Requires `username` and `accessKey` in credentials.
 * Obtains a Bearer token via the sign-in endpoint.
 */
export class SiigoConnector extends BaseERPConnector {
  readonly provider = 'siigo' as const;

  /** In-memory token cache (token + expiry). */
  private cachedToken: { token: string; expiresAt: number } | null = null;

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /**
   * Authenticate with Siigo and return a Bearer token.
   * Caches the token until it expires.
   */
  private async getToken(credentials: ERPCredentials): Promise<string> {
    // Return cached token if still valid (with 60s margin)
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    const userName = credentials.username;
    const accessKey = credentials.apiKey;
    if (!userName || !accessKey) {
      throw new Error('Siigo credentials require "username" and "apiKey" (access key).');
    }

    const response = await this.fetchJSON<SiigoSignInResponse>(SIIGO_SIGN_IN_URL, {
      method: 'POST',
      body: JSON.stringify({ userName, accessKey }),
    });

    this.cachedToken = {
      token: response.access_token,
      expiresAt: Date.now() + response.expires_in * 1000,
    };

    return this.cachedToken.token;
  }

  /** Build auth headers with the Bearer token. */
  private async getAuthHeaders(credentials: ERPCredentials): Promise<Record<string, string>> {
    const token = await this.getToken(credentials);
    return { Authorization: `Bearer ${token}` };
  }

  private buildUrl(path: string): string {
    return `${SIIGO_BASE_URL}${path}`;
  }

  // ─── Pagination helper ──────────────────────────────────────────────────

  /**
   * Fetch all pages from a Siigo paginated endpoint.
   * Siigo uses `page` and `page_size` query params.
   */
  private async fetchAllPages<T>(
    path: string,
    credentials: ERPCredentials,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    const pageSize = 100;
    let page = 1;

    const headers = await this.getAuthHeaders(credentials);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qs = new URLSearchParams({
        ...params,
        page: String(page),
        page_size: String(pageSize),
      });
      const url = this.buildUrl(`${path}?${qs.toString()}`);
      const response = await this.fetchJSON<SiigoPaginatedResponse<T>>(url, { headers });

      if (!response.results || response.results.length === 0) break;
      results.push(...response.results);

      const totalResults = response.pagination?.total_results ?? 0;
      if (results.length >= totalResults) break;
      page++;
    }

    return results;
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by attempting sign-in. */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getToken(credentials);
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the full chart of accounts. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<SiigoAccount>('/v1/accounts', credentials);
    return raw.map((a) => this.mapAccount(a));
  }

  /**
   * Build a trial balance by aggregating journal entries for the period.
   * @param period - ISO month string, e.g. "2026-03"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [year, month] = period.split('-').map(Number);
    const dateFrom = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const dateTo = `${period}-${String(lastDay).padStart(2, '0')}`;

    const [accounts, entries] = await Promise.all([
      this.getChartOfAccounts(credentials),
      this.getJournalEntries(credentials, dateFrom, dateTo),
    ]);

    // Aggregate debits/credits per account code
    const aggregation = new Map<string, { debit: number; credit: number }>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        const existing = aggregation.get(line.accountCode) ?? { debit: 0, credit: 0 };
        existing.debit += line.debit;
        existing.credit += line.credit;
        aggregation.set(line.accountCode, existing);
      }
    }

    const tbAccounts: ERPAccount[] = accounts.map((acct) => {
      const agg = aggregation.get(acct.code);
      return {
        ...acct,
        debit: agg?.debit ?? 0,
        credit: agg?.credit ?? 0,
        balance: (agg?.debit ?? 0) - (agg?.credit ?? 0),
      };
    });

    const totalDebit = tbAccounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = tbAccounts.reduce((s, a) => s + a.credit, 0);

    return {
      period,
      companyName: '',
      currency: 'COP',
      accounts: tbAccounts,
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Fetch journal entries (vouchers) for a date range. */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const raw = await this.fetchAllPages<SiigoJournalEntry>(
      '/v1/journals',
      credentials,
      { start_date: dateFrom, end_date: dateTo },
    );

    return raw.map((e) => {
      const lines: ERPJournalLine[] = (e.items ?? []).map((item) => ({
        accountCode: item.account.code,
        accountName: item.account.name,
        description: item.description,
        debit: item.debit ?? 0,
        credit: item.credit ?? 0,
        costCenter: item.cost_center?.name,
        thirdParty: item.third_party?.full_name,
      }));
      return {
        id: String(e.id),
        date: e.date,
        description: e.description ?? '',
        reference: e.document ? String(e.document.id) : undefined,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch invoices for a date range. */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const raw = await this.fetchAllPages<SiigoInvoice>(
      '/v1/invoices',
      credentials,
      { start_date: dateFrom, end_date: dateTo },
    );

    return raw.map((inv) => {
      const subtotal = inv.items?.reduce((s, i) => s + i.price * i.quantity, 0) ?? 0;
      const taxTotal = inv.taxes?.reduce((s, t) => s + t.value, 0) ?? 0;

      return {
        id: String(inv.id),
        number: inv.name,
        date: inv.date,
        dueDate: inv.due_date,
        type: 'sale' as const,
        contactName: inv.customer?.name?.join(' ') ?? 'Sin cliente',
        contactNit: inv.customer?.identification,
        subtotal,
        taxTotal,
        total: inv.total ?? subtotal + taxTotal,
        currency: 'COP',
        status: 'open' as const,
        cufe: inv.stamp?.cufe,
      };
    });
  }

  /** Fetch contacts (customers + vendors merged). */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const [customers, vendors] = await Promise.all([
      this.fetchAllPages<SiigoCustomer>('/v1/customers', credentials),
      this.fetchAllPages<SiigoVendor>('/v1/vendors', credentials),
    ]);

    const contactMap = new Map<string, ERPContact>();

    for (const c of customers) {
      const nit = c.identification;
      contactMap.set(nit, {
        id: String(c.id),
        name: c.name.join(' '),
        nit,
        type: 'customer',
        email: c.contacts?.[0]?.email,
        phone: c.contacts?.[0]?.phone,
        city: c.address?.city?.name,
      });
    }

    for (const v of vendors) {
      const nit = v.identification;
      const existing = contactMap.get(nit);
      if (existing) {
        existing.type = 'both';
      } else {
        contactMap.set(nit, {
          id: String(v.id),
          name: v.name.join(' '),
          nit,
          type: 'supplier',
          email: v.contacts?.[0]?.email,
          phone: v.contacts?.[0]?.phone,
          city: v.address?.city?.name,
        });
      }
    }

    return Array.from(contactMap.values());
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  /** Map a Siigo account to the normalized ERPAccount. */
  private mapAccount(a: SiigoAccount): ERPAccount {
    const code = a.code;
    return {
      code,
      name: a.name,
      type: mapPUCType(code),
      pucClass: pucClassFromCode(code),
      balance: 0,
      debit: 0,
      credit: 0,
      level: accountLevel(code),
      parentCode: code.length > 1 ? deriveParentCode(code) : undefined,
      isAuxiliary: code.length >= 6,
    };
  }
}

// ─── Shared PUC helpers ──────────────────────────────────────────────────────

function mapPUCType(code: string): ERPAccount['type'] {
  const first = code.charAt(0);
  switch (first) {
    case '1': return 'asset';
    case '2': return 'liability';
    case '3': return 'equity';
    case '4': return 'revenue';
    case '5': return 'cost';
    case '6': return 'expense';
    case '7': return 'cost';
    default: return 'asset';
  }
}

function pucClassFromCode(code: string): number {
  const n = parseInt(code.charAt(0), 10);
  return isNaN(n) ? 0 : n;
}

function accountLevel(code: string): number {
  if (code.length <= 1) return 1;
  if (code.length <= 2) return 2;
  if (code.length <= 4) return 3;
  if (code.length <= 6) return 4;
  return 5;
}

/** Derive the parent PUC code by trimming the last level of digits. */
function deriveParentCode(code: string): string | undefined {
  if (code.length > 6) return code.slice(0, 6);
  if (code.length > 4) return code.slice(0, 4);
  if (code.length > 2) return code.slice(0, 2);
  if (code.length > 1) return code.slice(0, 1);
  return undefined;
}
