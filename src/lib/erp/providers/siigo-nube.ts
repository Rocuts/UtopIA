// ─── Siigo Nube Colombia — Trial Balance Connector ────────────────────────────
// API base: https://api.siigo.com
// Auth: POST /auth  {username, access_key} → {access_token, expires_in: 86400}
// Trial balance: POST /v1/test-balance-report  {month, year, page, page_size: 100}
// PUC nativo: account.identification ya es codigo PUC colombiano (4-6 digitos).
// Rate limit: 100 req/min prod. 429 → esperar 60s + exponential backoff.
// Idempotency-Key: UTOPIA-TB-<year>-<period> en cada POST.

import { BaseERPConnector } from '../connector';
import { connectionKey } from '../session-store';
import { resolveERPPeriod } from '../period';
import { buildClosingTrialBalance } from '../trial-balance-builders';
import { leafCodes, rawLevelFor } from '../puc';
import { fetchWithSafeRedirects } from '../validate-base-url';
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
/** Tope de páginas: evita un ciclo sin fin si el API ignora `page`. */
const MAX_PAGES = 1000;

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
    // `fetchWithSafeRedirects` en vez de `fetch`: con `redirect: 'follow'` un host
    // permitido podía redirigir a la red interna y el guard de baseUrl, que sólo
    // mira la URL inicial, no volvía a mirar. Aquí cada salto se revalida.
    const res = await fetchWithSafeRedirects(url, init);

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

// ─── Connector ────────────────────────────────────────────────────────────────

export class SiigoNubeConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'siigo';

  private baseUrl(credentials: ERPCredentials): string {
    return (credentials.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  }

  /**
   * Cache key of THIS connection: provider + SHA-256 of every identity and
   * secret field. A request with the same user but another secret, or another
   * tenant/company, never receives a token issued for different credentials.
   */
  private tokenCacheKey(credentials: ERPCredentials): string {
    return connectionKey(credentials, 'token');
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async getAccessToken(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    const key = this.tokenCacheKey(credentials);
    // Token TTL 86400s (24h) — refresh 10 min before expiry
    const cached = options.forceRefresh ? null : this.sessions.get<string>(key, 600_000);
    if (cached) {
      return cached;
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
      // El cuerpo del upstream va SÓLO al log: incrustarlo en el Error lo convertía
      // en un oráculo de lectura sobre cualquier host alcanzable desde la Function.
      const text = await res.text().catch(() => '');
      console.error('[siigo-nube] auth error', {
        status: res.status,
        body: text.slice(0, 300),
      });
      throw new Error(`Siigo Nube auth error ${res.status}`);
    }

    const data = (await res.json()) as SiigoAuthResponse;
    this.sessions.set(key, data.access_token, (data.expires_in ?? 86400) * 1000);

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
    let expectedTotal: number | null = null;

    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) {
        throw new Error(
          `Siigo Nube /v1/test-balance-report: más de ${MAX_PAGES} páginas sin terminar la paginación.`,
        );
      }
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
        // Mismo criterio que en auth: el cuerpo upstream no viaja en el Error.
        const text = await res.text().catch(() => '');
        console.error('[siigo-nube] test-balance-report error', {
          status: res.status,
          body: text.slice(0, 300),
        });
        throw new Error(
          `Siigo Nube /v1/test-balance-report error ${res.status}`,
        );
      }

      const data = (await res.json()) as SiigoTrialBalanceResponse;
      if (typeof data.total_results === 'number' && Number.isFinite(data.total_results)) {
        expectedTotal = data.total_results;
      }
      const pageResults = data.results ?? [];
      if (pageResults.length === 0) break;
      results.push(...pageResults);
      // ingesta-22: se cuentan las filas REALMENTE recibidas. Suponer
      // `page_size = 100` sobreestimaba lo leído cuando el servidor limita el
      // tamaño de página y cortaba páginas en silencio.
      if (expectedTotal !== null && results.length >= expectedTotal) break;
    }

    // Un balance con filas faltantes no cuadra y no se sabe cuáles faltan:
    // error explícito en vez de un balance incompleto.
    if (expectedTotal !== null && results.length !== expectedTotal) {
      throw new Error(
        `Siigo Nube /v1/test-balance-report: paginación incompleta (${results.length} de ${expectedTotal} filas).`,
      );
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

    // Sólo las hojas del informe son transaccionales: un reporte jerárquico
    // con subcuenta y auxiliares no debe sumar ambos niveles.
    const leaves = leafCodes(rows.map((row) => ({ code: row.account.identification })));
    return rows.map((row): RawAccountRow => {
      const isLeaf = leaves.has(row.account.identification);
      return {
        code: row.account.identification,
        name: row.account.name,
        level: rawLevelFor(row.account.identification, isLeaf),
        transactional: isLeaf,
        balancesByPeriod: { [String(year)]: row.final_balance },
      };
    });
  }

  // ─── ERPConnectorInterface implementation ─────────────────────────────────

  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      // Siempre contra el proveedor: nunca se valida con un token en caché.
      await this.getAccessToken(credentials, { forceRefresh: true });
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
    // Informe nativo al mes de corte del periodo pedido (saldo inicial,
    // débitos, créditos y saldo final por cuenta).
    const resolved = resolveERPPeriod(period);
    const year = resolved.cutoffYear;
    const month = resolved.cutoffMonth;
    const idempotencyKey = `UTOPIA-TB-${year}-${String(month).padStart(2, '0')}`;

    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      month,
      year,
      idempotencyKey,
    );

    return buildClosingTrialBalance({
      period: resolved,
      rows: rows.map((row) => ({
        code: row.account.identification,
        name: row.account.name,
        opening: row.initial_balance,
        debit: row.debit,
        credit: row.credit,
        closing: row.final_balance,
      })),
      companyName: '',
      currency: 'COP',
    });
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
