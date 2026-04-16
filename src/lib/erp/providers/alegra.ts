// ─── Alegra ERP Connector ─────────────────────────────────────────────────────
// Alegra is a popular Colombian cloud accounting platform.
// Auth: HTTP Basic (email:api_token). Rate limit: 150 req/min.
// Docs: https://developer.alegra.com/

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

const ALEGRA_BASE_URL = 'https://api.alegra.com/api/v1';

// ─── Alegra API response shapes ──────────────────────────────────────────────

interface AlegraAccount {
  id: number;
  name: string;
  code?: string;
  type?: string;
  nature?: string;
  balance?: number;
  parentId?: number;
  status?: string;
}

interface AlegraJournalEntry {
  id: number;
  date: string;
  description?: string;
  reference?: string;
  accounts: AlegraJournalLine[];
}

interface AlegraJournalLine {
  id?: number;
  account: { id: number; name: string; code?: string };
  description?: string;
  debit: number;
  credit: number;
  costCenter?: { id: number; name: string };
}

interface AlegraInvoice {
  id: number;
  numberTemplate?: { fullNumber?: string; number?: number };
  date: string;
  dueDate?: string;
  client?: { id: number; name: string; identification?: string };
  subtotal?: number;
  tax?: number;
  total?: number;
  status?: string;
  stamp?: { cufe?: string };
}

interface AlegraContact {
  id: number;
  name: string;
  identification?: string;
  email?: string;
  phonePrimary?: string;
  address?: { city?: string };
  type?: string[];
}

/**
 * Connector for the Alegra cloud accounting platform.
 *
 * Requires `username` (email) and `apiToken` in credentials.
 * Accounts use Colombian PUC codes natively.
 */
export class AlegraConnector extends BaseERPConnector {
  readonly provider = 'alegra' as const;

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /** Build the Basic auth header from email + API token. */
  private getAuthHeaders(credentials: ERPCredentials): Record<string, string> {
    const email = credentials.username;
    const token = credentials.apiToken;
    if (!email || !token) {
      throw new Error('Alegra credentials require "username" (email) and "apiToken".');
    }
    const encoded = Buffer.from(`${email}:${token}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  private buildUrl(path: string): string {
    return `${ALEGRA_BASE_URL}${path}`;
  }

  // ─── Pagination helper ──────────────────────────────────────────────────

  /**
   * Fetch all pages for a paginated Alegra endpoint.
   * Alegra uses `start` and `limit` query params (max 30 per page).
   */
  private async fetchAllPages<T>(
    path: string,
    credentials: ERPCredentials,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    const limit = 30;
    let start = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qs = new URLSearchParams({ ...params, start: String(start), limit: String(limit) });
      const url = this.buildUrl(`${path}?${qs.toString()}`);
      const page = await this.fetchJSON<T[]>(url, { headers: this.getAuthHeaders(credentials) });

      if (!Array.isArray(page) || page.length === 0) break;
      results.push(...page);
      if (page.length < limit) break;
      start += limit;
    }

    return results;
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test the connection by fetching the first account. */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      const url = this.buildUrl('/accounts?start=0&limit=1');
      await this.fetchJSON<AlegraAccount[]>(url, {
        headers: this.getAuthHeaders(credentials),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the full chart of accounts and normalize to ERPAccount[]. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<AlegraAccount>('/accounts', credentials);
    return raw.map((a) => this.mapAccount(a));
  }

  /**
   * Build a trial balance for the given period by aggregating journal entries.
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

    // Fetch chart of accounts and journal entries in parallel
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

    // Merge aggregation into accounts
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

  /** Fetch journal entries for a date range. */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const raw = await this.fetchAllPages<AlegraJournalEntry>(
      '/journal-entries',
      credentials,
      { start_date: dateFrom, end_date: dateTo },
    );

    return raw.map((e) => {
      const lines: ERPJournalLine[] = (e.accounts ?? []).map((l) => ({
        accountCode: l.account.code ?? String(l.account.id),
        accountName: l.account.name,
        description: l.description,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        costCenter: l.costCenter?.name,
      }));
      return {
        id: String(e.id),
        date: e.date,
        description: e.description ?? '',
        reference: e.reference,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch sales invoices for a date range. */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const raw = await this.fetchAllPages<AlegraInvoice>(
      '/invoices',
      credentials,
      { start_date: dateFrom, end_date: dateTo },
    );

    return raw.map((inv) => ({
      id: String(inv.id),
      number: inv.numberTemplate?.fullNumber ?? String(inv.numberTemplate?.number ?? inv.id),
      date: inv.date,
      dueDate: inv.dueDate,
      type: 'sale' as const,
      contactName: inv.client?.name ?? 'Sin cliente',
      contactNit: inv.client?.identification,
      subtotal: inv.subtotal ?? 0,
      taxTotal: inv.tax ?? 0,
      total: inv.total ?? 0,
      currency: 'COP',
      status: this.mapInvoiceStatus(inv.status),
      cufe: inv.stamp?.cufe,
    }));
  }

  /** Fetch all contacts. */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const raw = await this.fetchAllPages<AlegraContact>('/contacts', credentials);

    return raw.map((c) => ({
      id: String(c.id),
      name: c.name,
      nit: c.identification,
      type: this.mapContactType(c.type),
      email: c.email,
      phone: c.phonePrimary,
      city: c.address?.city,
    }));
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  /** Map an Alegra account to the normalized ERPAccount. */
  private mapAccount(a: AlegraAccount): ERPAccount {
    const code = a.code ?? String(a.id);
    return {
      code,
      name: a.name,
      type: mapPUCType(code),
      pucClass: pucClassFromCode(code),
      balance: a.balance ?? 0,
      debit: 0,
      credit: 0,
      level: accountLevel(code),
      parentCode: a.parentId ? String(a.parentId) : undefined,
      isAuxiliary: code.length >= 6,
    };
  }

  /** Map Alegra invoice status string to ERPInvoice status. */
  private mapInvoiceStatus(
    status?: string,
  ): 'draft' | 'open' | 'paid' | 'overdue' | 'cancelled' {
    switch (status?.toLowerCase()) {
      case 'draft':
      case 'borrador':
        return 'draft';
      case 'paid':
      case 'pagada':
        return 'paid';
      case 'void':
      case 'voided':
      case 'anulada':
        return 'cancelled';
      case 'overdue':
      case 'vencida':
        return 'overdue';
      default:
        return 'open';
    }
  }

  /** Map Alegra contact type array to a single type. */
  private mapContactType(types?: string[]): 'customer' | 'supplier' | 'both' {
    if (!types || types.length === 0) return 'customer';
    const hasClient = types.some((t) => t.toLowerCase() === 'client');
    const hasProvider = types.some((t) => t.toLowerCase() === 'provider');
    if (hasClient && hasProvider) return 'both';
    if (hasProvider) return 'supplier';
    return 'customer';
  }
}

// ─── Shared PUC helpers ──────────────────────────────────────────────────────
// Used across Colombian ERP connectors to derive account type from PUC codes.

/** Derive account type from the first digit of a PUC code. */
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

/** Extract PUC class (first digit) from an account code. */
function pucClassFromCode(code: string): number {
  const n = parseInt(code.charAt(0), 10);
  return isNaN(n) ? 0 : n;
}

/** Determine the hierarchy level from the code length (PUC convention). */
function accountLevel(code: string): number {
  if (code.length <= 1) return 1;
  if (code.length <= 2) return 2;
  if (code.length <= 4) return 3;
  if (code.length <= 6) return 4;
  return 5;
}
