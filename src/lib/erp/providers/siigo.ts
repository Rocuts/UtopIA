// ─── Siigo ERP Connector ──────────────────────────────────────────────────────
// Siigo is one of Colombia's largest cloud accounting platforms.
// Auth: Bearer token obtained via sign-in endpoint.
// Docs: https://siigonube.siigo.com/

import { BaseERPConnector } from '../connector';
import { connectionKey } from '../session-store';
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

const SIIGO_BASE_URL = 'https://services.siigo.com/alliances/api';
const SIIGO_SIGN_IN_URL = `${SIIGO_BASE_URL}/siigoapi-users/v1/sign-in`;
/** Tope de páginas por listado: evita un ciclo sin fin si el API ignora `page`. */
const SIIGO_MAX_PAGES = 1000;

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

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /**
   * Authenticate with Siigo and return a Bearer token. The token is cached
   * per connection (provider + credential fingerprint), never per instance.
   */
  private async getToken(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    const userName = credentials.username;
    const accessKey = credentials.apiKey;
    if (!userName || !accessKey) {
      throw new Error('Siigo credentials require "username" and "apiKey" (access key).');
    }

    return this.sessions.resolve(
      connectionKey(credentials, 'token'),
      async () => {
        const response = await this.fetchJSON<SiigoSignInResponse>(SIIGO_SIGN_IN_URL, {
          method: 'POST',
          body: JSON.stringify({ userName, accessKey }),
        });
        return { value: response.access_token, ttlMs: (response.expires_in ?? 0) * 1000 };
      },
      { refreshMarginMs: 60_000, forceRefresh: options.forceRefresh },
    );
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
   *
   * ingesta-22: se cuentan los registros REALMENTE recibidos. Sin
   * `pagination.total_results` se itera hasta una página vacía (antes el total
   * valía 0 y sólo se leía la primera página); con el total, el conteo final
   * debe coincidir o se lanza error: un listado incompleto nunca se usa como si
   * estuviera completo.
   */
  private async fetchAllPages<T>(
    path: string,
    credentials: ERPCredentials,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    const pageSize = 100;
    let expectedTotal: number | null = null;

    const headers = await this.getAuthHeaders(credentials);

    for (let page = 1; ; page++) {
      if (page > SIIGO_MAX_PAGES) {
        throw new Error(
          `Siigo ${path}: más de ${SIIGO_MAX_PAGES} páginas sin terminar la paginación; los datos no se usan.`,
        );
      }
      const qs = new URLSearchParams({
        ...params,
        page: String(page),
        page_size: String(pageSize),
      });
      const url = this.buildUrl(`${path}?${qs.toString()}`);
      const response = await this.fetchJSON<SiigoPaginatedResponse<T>>(url, { headers });
      const total = response.pagination?.total_results;
      if (typeof total === 'number' && Number.isFinite(total)) expectedTotal = total;

      const pageResults = response.results ?? [];
      if (pageResults.length === 0) break;
      results.push(...pageResults);
      if (expectedTotal !== null && results.length >= expectedTotal) break;
    }

    if (expectedTotal !== null && results.length !== expectedTotal) {
      throw new Error(
        `Siigo ${path}: paginación incompleta (${results.length} de ${expectedTotal} registros).`,
      );
    }
    return results;
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by attempting a fresh sign-in (never a cached token). */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getToken(credentials, { forceRefresh: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the full chart of accounts. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<SiigoAccount>('/v1/accounts', credentials);
    return markLeafAccounts(raw.filter((a) => Boolean(a.code)).map((a) => this.mapAccount(a)));
  }

  /**
   * Movements of the period aggregated from journals. The alliances API does
   * not expose opening or accumulated balances, so the result is flagged
   * `movements_only` and is never presented or serialized as a trial balance.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);

    const [accounts, entries] = await Promise.all([
      this.getChartOfAccounts(credentials),
      this.getJournalEntries(credentials, resolved.from, resolved.to),
    ]);

    return buildMovementsTrialBalance({
      providerName: 'Siigo',
      period: resolved,
      chart: accounts,
      lines: entries.flatMap((e) => e.lines),
      companyName: '',
      currency: 'COP',
    });
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
      type: pucTypeFromCode(code),
      pucClass: pucClassFromCode(code),
      balance: 0,
      debit: 0,
      credit: 0,
      level: accountLevelFromCode(code),
      parentCode: code.length > 1 ? deriveParentCode(code) : undefined,
      // Recalculado por jerarquía real en getChartOfAccounts (markLeafAccounts).
      isAuxiliary: false,
    };
  }
}
