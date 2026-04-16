// ─── Odoo Connector ─────────────────────────────────────────────────────────
// JSON-RPC session-based auth. Data access via /web/dataset/call_kw.

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

// ─── Odoo JSON-RPC Types ────────────────────────────────────────────────────

interface OdooRPCResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data: { message: string };
  };
}

interface OdooAuthResult {
  uid: number;
  session_id: string;
  db: string;
  username: string;
  company_id: number;
  partner_id: number;
}

interface OdooAccountRecord {
  id: number;
  code: string;
  name: string;
  internal_type: string;
  internal_group: string;
  user_type_id: [number, string];
  reconcile: boolean;
}

interface OdooMoveRecord {
  id: number;
  name: string;
  date: string;
  ref: string | false;
  move_type: string;
  state: string;
  line_ids: number[];
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  currency_id: [number, string] | false;
  partner_id: [number, string] | false;
  invoice_date: string | false;
  invoice_date_due: string | false;
  payment_state: string;
}

interface OdooMoveLineRecord {
  id: number;
  account_id: [number, string];
  name: string;
  debit: number;
  credit: number;
  balance: number;
  move_id: [number, string];
  partner_id: [number, string] | false;
  analytic_distribution?: Record<string, number>;
  date: string;
}

interface OdooPartnerRecord {
  id: number;
  name: string;
  vat: string | false;
  email: string | false;
  phone: string | false;
  city: string | false;
  customer_rank: number;
  supplier_rank: number;
}

/**
 * Odoo ERP connector via JSON-RPC.
 *
 * Auth flow:
 * 1. POST /web/session/authenticate with db, login, password
 * 2. Server returns session_id cookie — used for subsequent calls
 * 3. Data access via JSON-RPC calls to /web/dataset/call_kw
 *
 * Colombian localization: the `l10n_co` module provides PUC chart of accounts.
 */
export class OdooConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'odoo';

  private sessionId: string | null = null;
  private uid: number | null = null;
  private rpcId = 0;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Resolve the Odoo server base URL from credentials */
  private getBaseUrl(credentials: ERPCredentials): string {
    return (credentials.baseUrl ?? 'https://localhost:8069').replace(/\/+$/, '');
  }

  /** Generate an incrementing JSON-RPC request ID */
  private nextId(): number {
    return ++this.rpcId;
  }

  /** Authenticate and obtain a session */
  private async login(credentials: ERPCredentials): Promise<void> {
    const url = `${this.getBaseUrl(credentials)}/web/session/authenticate`;
    const body = {
      jsonrpc: '2.0',
      id: this.nextId(),
      params: {
        db: credentials.databaseName ?? '',
        login: credentials.username ?? '',
        password: credentials.password ?? '',
      },
    };

    const result = await this.fetchJSON<OdooRPCResponse<OdooAuthResult>>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (result.error) {
      throw new Error(`Odoo auth error: ${result.error.data?.message ?? result.error.message}`);
    }

    if (!result.result?.uid) {
      throw new Error('Odoo authentication failed: invalid credentials');
    }

    this.uid = result.result.uid;
    this.sessionId = result.result.session_id;
  }

  /** Execute a JSON-RPC call to Odoo with session auth */
  private async rpcCall<T>(
    credentials: ERPCredentials,
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.sessionId) {
      await this.login(credentials);
    }

    const url = `${this.getBaseUrl(credentials)}/web/dataset/call_kw`;
    const body = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'call',
      params: {
        model,
        method,
        args,
        kwargs: {
          context: { lang: 'es_CO', tz: 'America/Bogota' },
          ...kwargs,
        },
      },
    };

    try {
      const result = await this.fetchJSON<OdooRPCResponse<T>>(url, {
        method: 'POST',
        headers: {
          Cookie: `session_id=${this.sessionId}`,
        },
        body: JSON.stringify(body),
      });

      if (result.error) {
        throw new Error(`Odoo RPC error: ${result.error.data?.message ?? result.error.message}`);
      }

      return result.result as T;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // Session expired — re-authenticate and retry once
      if (msg.includes('401') || msg.includes('session_expired') || msg.includes('Session')) {
        this.sessionId = null;
        await this.login(credentials);

        const retryResult = await this.fetchJSON<OdooRPCResponse<T>>(url, {
          method: 'POST',
          headers: {
            Cookie: `session_id=${this.sessionId}`,
          },
          body: JSON.stringify(body),
        });

        if (retryResult.error) {
          throw new Error(`Odoo RPC error: ${retryResult.error.data?.message ?? retryResult.error.message}`);
        }

        return retryResult.result as T;
      }
      throw error;
    }
  }

  /**
   * search_read helper — paginated read with domain filter.
   * Fetches all records matching the domain in batches.
   */
  private async searchRead<T>(
    credentials: ERPCredentials,
    model: string,
    domain: unknown[],
    fields: string[],
    limit = 500,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.rpcCall<T[]>(
        credentials,
        model,
        'search_read',
        [domain],
        { fields, limit, offset, order: 'id asc' },
      );

      results.push(...batch);

      if (batch.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    return results;
  }

  /**
   * Map Odoo account internal_group to normalized type.
   * Odoo groups: asset, liability, equity, income, expense (+ off_balance)
   * Colombian PUC class 6 = cost of goods sold, class 7 = production costs
   */
  private mapAccountType(internalGroup: string, code: string): ERPAccount['type'] {
    // Check Colombian PUC classes first
    const firstDigit = code.charAt(0);
    if (firstDigit === '6' || firstDigit === '7') return 'cost';

    const group = internalGroup.toLowerCase();
    if (group === 'asset') return 'asset';
    if (group === 'liability') return 'liability';
    if (group === 'equity') return 'equity';
    if (group === 'income') return 'revenue';
    if (group === 'expense') return 'expense';
    return 'asset';
  }

  /** Infer PUC class from account code (Colombian chart of accounts) */
  private inferPUCClass(code: string): number | undefined {
    const first = parseInt(code.charAt(0), 10);
    return isNaN(first) ? undefined : first;
  }

  /** Determine account level from PUC code length */
  private inferLevel(code: string): number {
    const digits = code.replace(/\D/g, '');
    if (digits.length <= 1) return 1;
    if (digits.length <= 2) return 2;
    if (digits.length <= 4) return 3;
    if (digits.length <= 6) return 4;
    return 5;
  }

  // ─── Interface Implementation ────────────────────────────────────────────

  /** Test connection by authenticating */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.login(credentials);
      return this.uid !== null && this.uid > 0;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const accounts = await this.searchRead<OdooAccountRecord>(
      credentials,
      'account.account',
      [['deprecated', '=', false]],
      ['code', 'name', 'internal_type', 'internal_group', 'user_type_id', 'reconcile'],
    );

    return accounts.map((a) => ({
      code: a.code,
      name: a.name,
      type: this.mapAccountType(a.internal_group, a.code),
      pucClass: this.inferPUCClass(a.code),
      balance: 0,
      debit: 0,
      credit: 0,
      level: this.inferLevel(a.code),
      parentCode: a.code.length > 2 ? a.code.slice(0, -2) : undefined,
      isAuxiliary: this.inferLevel(a.code) >= 4,
    }));
  }

  /**
   * Fetch trial balance by aggregating account.move.line records for the period.
   * Groups by account and sums debit/credit.
   */
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

    // Also build a map by account ID (Odoo uses integer IDs internally)
    const accountById = new Map<number, ERPAccount>();
    const accountRecords = await this.searchRead<OdooAccountRecord>(
      credentials,
      'account.account',
      [['deprecated', '=', false]],
      ['code', 'name'],
    );
    for (const rec of accountRecords) {
      const mapped = accountMap.get(rec.code);
      if (mapped) accountById.set(rec.id, mapped);
    }

    // Fetch all move lines for the period
    const moveLines = await this.searchRead<OdooMoveLineRecord>(
      credentials,
      'account.move.line',
      [
        ['date', '>=', startDate],
        ['date', '<=', endDate],
        ['parent_state', '=', 'posted'],
      ],
      ['account_id', 'debit', 'credit', 'balance'],
    );

    // Aggregate by account
    const aggregated = new Map<string, { name: string; debit: number; credit: number }>();
    for (const line of moveLines) {
      const accountId = line.account_id[0];
      const accountName = line.account_id[1];
      const acct = accountById.get(accountId);
      const code = acct?.code ?? String(accountId);

      const existing = aggregated.get(code) ?? { name: accountName, debit: 0, credit: 0 };
      existing.debit += line.debit;
      existing.credit += line.credit;
      aggregated.set(code, existing);
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
        name: acct?.name ?? totals.name,
        type: acct?.type ?? this.mapAccountType('asset', code),
        pucClass: this.inferPUCClass(code),
        balance,
        debit: totals.debit,
        credit: totals.credit,
        level: acct?.level ?? this.inferLevel(code),
        parentCode: acct?.parentCode,
        isAuxiliary: acct?.isAuxiliary ?? this.inferLevel(code) >= 4,
      });
    }

    return {
      period,
      companyName: credentials.companyId ?? 'Odoo Company',
      currency: 'COP',
      accounts: tbAccounts.sort((a, b) => a.code.localeCompare(b.code)),
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Fetch journal entries (account.move with their lines) for a date range */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    // Fetch posted journal entries
    const moves = await this.searchRead<OdooMoveRecord>(
      credentials,
      'account.move',
      [
        ['date', '>=', dateFrom],
        ['date', '<=', dateTo],
        ['state', '=', 'posted'],
        ['move_type', '=', 'entry'],
      ],
      ['name', 'date', 'ref', 'line_ids'],
    );

    // Collect all line IDs
    const allLineIds = moves.flatMap((m) => m.line_ids);

    if (allLineIds.length === 0) return [];

    // Fetch all move lines in one call
    const moveLines = await this.searchRead<OdooMoveLineRecord>(
      credentials,
      'account.move.line',
      [['id', 'in', allLineIds]],
      ['account_id', 'name', 'debit', 'credit', 'move_id', 'analytic_distribution'],
    );

    // Group lines by move ID
    const linesByMove = new Map<number, OdooMoveLineRecord[]>();
    for (const line of moveLines) {
      const moveId = line.move_id[0];
      const group = linesByMove.get(moveId) ?? [];
      group.push(line);
      linesByMove.set(moveId, group);
    }

    return moves.map((m) => {
      const rawLines = linesByMove.get(m.id) ?? [];
      const lines: ERPJournalLine[] = rawLines.map((l) => ({
        accountCode: l.account_id[1].split(' ')[0] ?? String(l.account_id[0]),
        accountName: l.account_id[1],
        description: l.name || undefined,
        debit: l.debit,
        credit: l.credit,
      }));

      return {
        id: String(m.id),
        date: m.date,
        description: m.name,
        reference: m.ref || undefined,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /** Fetch invoices (sale and purchase) for a date range */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const moves = await this.searchRead<OdooMoveRecord>(
      credentials,
      'account.move',
      [
        ['invoice_date', '>=', dateFrom],
        ['invoice_date', '<=', dateTo],
        ['move_type', 'in', ['out_invoice', 'in_invoice']],
        ['state', '=', 'posted'],
      ],
      [
        'name', 'date', 'ref', 'move_type', 'state',
        'amount_total', 'amount_untaxed', 'amount_tax',
        'currency_id', 'partner_id', 'invoice_date',
        'invoice_date_due', 'payment_state',
      ],
    );

    return moves.map((m) => {
      let status: ERPInvoice['status'] = 'open';
      if (m.payment_state === 'paid' || m.payment_state === 'in_payment') {
        status = 'paid';
      } else if (m.state === 'cancel') {
        status = 'cancelled';
      } else if (m.state === 'draft') {
        status = 'draft';
      } else if (m.invoice_date_due && new Date(m.invoice_date_due) < new Date()) {
        status = 'overdue';
      }

      const partnerName = m.partner_id ? m.partner_id[1] : 'Unknown';
      const partnerId = m.partner_id ? String(m.partner_id[0]) : '';
      const currency = m.currency_id ? m.currency_id[1] : 'COP';

      return {
        id: String(m.id),
        number: m.name,
        date: (m.invoice_date as string) || m.date,
        dueDate: m.invoice_date_due || undefined,
        type: m.move_type === 'out_invoice' ? 'sale' as const : 'purchase' as const,
        contactName: partnerName,
        contactNit: partnerId,
        subtotal: m.amount_untaxed,
        taxTotal: m.amount_tax,
        total: m.amount_total,
        currency,
        status,
      };
    });
  }

  /** Fetch contacts (res.partner) */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const partners = await this.searchRead<OdooPartnerRecord>(
      credentials,
      'res.partner',
      [
        ['active', '=', true],
        ['is_company', '=', true],
        '|',
        ['customer_rank', '>', 0],
        ['supplier_rank', '>', 0],
      ],
      ['name', 'vat', 'email', 'phone', 'city', 'customer_rank', 'supplier_rank'],
    );

    return partners.map((p) => {
      let type: ERPContact['type'] = 'customer';
      if (p.customer_rank > 0 && p.supplier_rank > 0) type = 'both';
      else if (p.supplier_rank > 0) type = 'supplier';

      return {
        id: String(p.id),
        name: p.name,
        nit: p.vat || undefined,
        type,
        email: p.email || undefined,
        phone: p.phone || undefined,
        city: p.city || undefined,
      };
    });
  }
}
