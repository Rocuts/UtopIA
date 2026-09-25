// ─── Alegra ERP Connector ─────────────────────────────────────────────────────
// Alegra is a popular Colombian cloud accounting platform.
// Auth: HTTP Basic (email:api_token). Rate limit: 150 req/min.
// Docs: https://developer.alegra.com/

import { BaseERPConnector } from '../connector';
import { resolveERPPeriod } from '../period';
import { buildMovementsTrialBalance } from '../trial-balance-builders';
import {
  accountLevelFromCode,
  deriveParentCode,
  markLeafAccounts,
  pucClassFromCode,
  pucTypeFromCode,
} from '../puc';
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

  /**
   * Fetch the full chart of accounts and normalize to ERPAccount[]. Accounts
   * without a PUC code are left out: the internal Alegra ID is never used as a
   * code (its first digit would decide the PUC class).
   */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<AlegraAccount>('/accounts', credentials);
    return this.mapChart(raw).accounts;
  }

  /**
   * Movements of the period aggregated from journal entries. Alegra's API
   * does not expose opening or accumulated balances here, so the result is
   * flagged `movements_only` and is never presented as a trial balance.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);

    const [rawAccounts, rawEntries] = await Promise.all([
      this.fetchAllPages<AlegraAccount>('/accounts', credentials),
      this.fetchRawJournalEntries(credentials, resolved.from, resolved.to),
    ]);
    const { accounts, codeById, withoutCode } = this.mapChart(rawAccounts);

    const warnings: string[] = [];
    if (withoutCode > 0) {
      warnings.push(`${withoutCode} cuenta(s) del plan sin código PUC excluidas.`);
    }

    return buildMovementsTrialBalance({
      providerName: 'Alegra',
      period: resolved,
      chart: accounts,
      lines: rawEntries.flatMap((e) =>
        (e.accounts ?? []).map((l) => ({
          accountCode: l.account.code ?? codeById.get(l.account.id) ?? '',
          accountName: l.account.name,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
        })),
      ),
      companyName: '',
      currency: 'COP',
      warnings,
    });
  }

  private fetchRawJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<AlegraJournalEntry[]> {
    return this.fetchAllPages<AlegraJournalEntry>(
      '/journal-entries',
      credentials,
      { start_date: dateFrom, end_date: dateTo },
    );
  }

  /** Fetch journal entries for a date range. */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const raw = await this.fetchRawJournalEntries(credentials, dateFrom, dateTo);

    return raw.map((e) => {
      const lines: ERPJournalLine[] = (e.accounts ?? []).map((l) => ({
        // Sin código PUC queda vacío: el ID interno no es un código contable.
        accountCode: l.account.code ?? '',
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

  /**
   * Map the Alegra chart. Accounts without a PUC code are excluded (and
   * counted); `parentId` is an internal ID, so it is translated to the
   * parent's code instead of being used as a code.
   */
  private mapChart(raw: AlegraAccount[]): {
    accounts: ERPAccount[];
    codeById: Map<number, string>;
    withoutCode: number;
  } {
    const codeById = new Map<number, string>();
    for (const a of raw) {
      const code = a.code?.trim();
      if (code) codeById.set(a.id, code);
    }
    const accounts: ERPAccount[] = [];
    for (const a of raw) {
      const code = codeById.get(a.id);
      if (!code) continue;
      accounts.push({
        code,
        name: a.name,
        type: pucTypeFromCode(code),
        pucClass: pucClassFromCode(code),
        balance: a.balance ?? 0,
        debit: 0,
        credit: 0,
        level: accountLevelFromCode(code),
        parentCode: (a.parentId !== undefined ? codeById.get(a.parentId) : undefined) ?? deriveParentCode(code),
        isAuxiliary: false,
      });
    }
    return { accounts: markLeafAccounts(accounts), codeById, withoutCode: raw.length - accounts.length };
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
