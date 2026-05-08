// ─── Siigo Nube Colombia — Trial Balance Connector ────────────────────────────
// API base: https://api.siigo.com
// Auth: POST /auth  {username, access_key} → {access_token, expires_in: 86400}
// Trial balance: POST /v1/test-balance-report  {month, year, page, page_size: 100}
// PUC nativo: account.identification ya es codigo PUC colombiano (4-6 digitos).
// Rate limit: 100 req/min prod. 429 → esperar 60s + exponential backoff.
// Idempotency-Key: UTOPIA-TB-<year>-<period> en cada POST.

import { BaseERPConnector } from '../connector';
import type {
  ERPProvider,
  ERPCredentials,
  ERPAccount,
  ERPTrialBalance,
  ERPJournalEntry,
  ERPInvoice,
  ERPContact,
} from '../types';
import type { RawAccountRow } from '@/lib/preprocessing/trial-balance';

// ─── Siigo API shapes ─────────────────────────────────────────────────────────

interface SiigoAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SiigoTrialBalanceRow {
  account: {
    identification: string; // PUC code (e.g. "110505")
    name: string;
  };
  initial_balance: number;
  debit: number;
  credit: number;
  final_balance: number;
  cost_center?: string;
}

interface SiigoTrialBalanceResponse {
  page: number;
  page_size: number;
  total_results: number;
  results: SiigoTrialBalanceRow[];
}

// ─── Credentials shape ─────────────────────────────────────────────────────────
// Caller provides:
//   baseUrl    (optional) = default "https://api.siigo.com"
//   username   = cuenta de usuario Siigo
//   apiKey     = access_key de Siigo

const DEFAULT_BASE = 'https://api.siigo.com';
const PARTNER_ID = 'UtopIA-NIIF';
const PAGE_SIZE = 100;

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 1000;

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
  delayMs = INITIAL_DELAY_MS,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === retries) return res;
      // 429 → esperar 60s como especifica Siigo; 5xx → backoff expo
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = res.status === 429
        ? 60_000
        : retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : jitter(delayMs * 2 ** attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    return res;
  }
  throw new Error('fetchWithRetry: exceeded max retries');
}

// ─── Cached token shape ────────────────────────────────────────────────────────

interface CachedToken {
  value: string;
  expiresAt: number;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class SiigoNubeConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'siigo';

  /** Per-instance token cache so tests don't bleed across connector instances. */
  private readonly tokenCache = new Map<string, CachedToken>();

  private baseUrl(credentials: ERPCredentials): string {
    return (credentials.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  }

  private tokenCacheKey(credentials: ERPCredentials): string {
    return `siigo_nube:${credentials.username ?? ''}:${this.baseUrl(credentials)}`;
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async getAccessToken(credentials: ERPCredentials): Promise<string> {
    const key = this.tokenCacheKey(credentials);
    const cached = this.tokenCache.get(key);
    // Token TTL 86400s (24h) — refresh 10 min before expiry
    if (cached && Date.now() < cached.expiresAt - 600_000) {
      return cached.value;
    }

    const username = credentials.username ?? '';
    const accessKey = credentials.apiKey ?? '';

    if (!username || !accessKey) {
      throw new Error('Siigo Nube: username y apiKey (access_key) son obligatorios.');
    }

    const res = await fetchWithRetry(`${this.baseUrl(credentials)}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Partner-Id': PARTNER_ID,
      },
      body: JSON.stringify({ username, access_key: accessKey }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Siigo Nube auth error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as SiigoAuthResponse;
    this.tokenCache.set(key, {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    });

    return data.access_token;
  }

  // ─── Fetch all pages of trial balance ─────────────────────────────────────

  private async fetchAllTrialBalanceRows(
    credentials: ERPCredentials,
    month: number,
    year: number,
    idempotencyKey: string,
    costCenter?: string,
  ): Promise<SiigoTrialBalanceRow[]> {
    const token = await this.getAccessToken(credentials);
    const base = this.baseUrl(credentials);
    const results: SiigoTrialBalanceRow[] = [];
    let page = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const body: Record<string, unknown> = { month, year, page, page_size: PAGE_SIZE };
      if (costCenter) body.cost_center = costCenter;

      const res = await fetchWithRetry(`${base}/v1/test-balance-report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Partner-Id': PARTNER_ID,
          'Idempotency-Key': `${idempotencyKey}-p${page}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Siigo Nube /v1/test-balance-report error ${res.status}: ${text.slice(0, 300)}`,
        );
      }

      const data = (await res.json()) as SiigoTrialBalanceResponse;
      results.push(...(data.results ?? []));

      const fetched = (page - 1) * PAGE_SIZE + (data.results?.length ?? 0);
      if (fetched >= data.total_results || !data.results?.length) break;
      page++;
    }

    return results;
  }

  // ─── RawAccountRow bridge ─────────────────────────────────────────────────

  /**
   * Fetch trial balance as RawAccountRow[] — compatible con preprocessTrialBalance.
   * PUC nativo: account.identification = codigo PUC (sin transformacion).
   *
   * @param credentials - ERP credentials (username, apiKey, baseUrl?)
   * @param month       - numero de mes 1-12
   * @param year        - anio e.g. 2025
   * @param costCenter  - opcional: filtro por centro de costo
   */
  async fetchRawAccountRows(
    credentials: ERPCredentials,
    month: number,
    year: number,
    costCenter?: string,
  ): Promise<RawAccountRow[]> {
    const idempotencyKey = `UTOPIA-TB-${year}-${String(month).padStart(2, '0')}`;
    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      month,
      year,
      idempotencyKey,
      costCenter,
    );

    return rows.map((row): RawAccountRow => ({
      code: row.account.identification,
      name: row.account.name,
      level: 'Auxiliar',
      transactional: true,
      balancesByPeriod: { [String(year)]: row.final_balance },
    }));
  }

  // ─── ERPConnectorInterface implementation ─────────────────────────────────

  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getAccessToken(credentials);
      return true;
    } catch {
      return false;
    }
  }

  async getChartOfAccounts(_credentials: ERPCredentials): Promise<ERPAccount[]> {
    throw new Error(
      'Siigo Nube: getChartOfAccounts usa POST /v1/test-balance-report. Use fetchRawAccountRows.',
    );
  }

  /**
   * Fetch trial balance via the official Siigo /v1/test-balance-report endpoint.
   * @param period - "YYYY-MM" e.g. "2025-12"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr ?? '12', 10);
    const idempotencyKey = `UTOPIA-TB-${year}-${String(month).padStart(2, '0')}`;

    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      month,
      year,
      idempotencyKey,
    );

    const accounts: ERPAccount[] = rows.map((row) => {
      const code = row.account.identification;
      return {
        code,
        name: row.account.name,
        type: inferTypeFromPUC(code),
        pucClass: parseInt(code.charAt(0), 10) || undefined,
        balance: row.final_balance,
        debit: row.debit,
        credit: row.credit,
        level: accountLevel(code),
        isAuxiliary: code.length >= 6,
      };
    });

    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

    return {
      period,
      companyName: '',
      currency: 'COP',
      accounts,
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  async getJournalEntries(
    _credentials: ERPCredentials,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    throw new Error(
      'Siigo Nube: getJournalEntries no implementado en este conector. Use el SiigoConnector de alliances/api.',
    );
  }

  async getInvoices(
    _credentials: ERPCredentials,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ERPInvoice[]> {
    throw new Error(
      'Siigo Nube: getInvoices no implementado en este conector. Use el SiigoConnector de alliances/api.',
    );
  }

  async getContacts(_credentials: ERPCredentials): Promise<ERPContact[]> {
    throw new Error(
      'Siigo Nube: getContacts no implementado en este conector. Use el SiigoConnector de alliances/api.',
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferTypeFromPUC(code: string): ERPAccount['type'] {
  switch (code.charAt(0)) {
    case '1': return 'asset';
    case '2': return 'liability';
    case '3': return 'equity';
    case '4': return 'revenue';
    case '5': return 'expense';
    case '6': return 'cost';
    case '7': return 'cost';
    default: return 'asset';
  }
}

function accountLevel(code: string): number {
  if (code.length <= 1) return 1;
  if (code.length <= 2) return 2;
  if (code.length <= 4) return 3;
  if (code.length <= 6) return 4;
  return 5;
}
