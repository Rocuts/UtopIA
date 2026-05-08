// ─── Oracle Fusion ERP Cloud Connector ───────────────────────────────────────
// Endpoint: GET /fscmRestApi/resources/11.13.18.05/ledgerBalances
// Auth: OAuth 2.0 Client Credentials via Oracle IDCS/IAM.
// Token: POST https://<idcs-domain>/oauth2/v1/token
//   Authorization: Basic base64(clientId:clientSecret)
//   body: grant_type=client_credentials&scope=urn:opc:resource:fusion:<podname>:boss/
// Paginacion: ?limit=499&offset=N; response contiene hasMore + totalResults.
// Observabilidad: log X-ORACLE-DMS-ECID del response cuando presente.
// Rate limit: 429 con Retry-After. Token TTL=3600s, renovar a 3300s.

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

// ─── Internal response shapes ─────────────────────────────────────────────────

interface OracleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface OracleLedgerBalance {
  LedgerName: string;
  PeriodName: string;
  Currency: string;
  /** e.g. "01.110505.0000.00000" — segmentos separados por punto */
  DetailAccountCombination: string;
  BeginningBalance: number;
  PeriodActivity: number;
  EndingBalance: number;
  AmountType: string;
}

interface OracleLedgerBalancesResponse {
  items: OracleLedgerBalance[];
  hasMore: boolean;
  totalResults: number;
  offset: number;
  limit: number;
}

// ─── Credentials shape expected by this connector ─────────────────────────────
// Caller provides:
//   baseUrl      = "https://<pod>.oraclecloud.com"  (Fusion ERP host)
//   clientId     = OAuth client_id
//   clientSecret = OAuth client_secret
//   tenantId     = IDCS domain host e.g. "idcs-<hash>.identity.oraclecloud.com"
//   companyId    (optional) = ledger name filter / pod name for scope
//   apiKey       (optional) = natural account segment index (default "4")

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 500;

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
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter
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

export class OracleFusionConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'oracle_fusion';

  /** Per-instance token cache so tests don't bleed across connector instances. */
  private readonly tokenCache = new Map<string, CachedToken>();

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private tokenCacheKey(credentials: ERPCredentials): string {
    return `oracle_fusion:${credentials.clientId ?? ''}:${credentials.tenantId ?? ''}`;
  }

  private tokenEndpoint(credentials: ERPCredentials): string {
    const domain = credentials.tenantId ?? '';
    if (!domain) {
      throw new Error(
        'Oracle Fusion: tenantId es obligatorio (dominio IDCS, e.g. "idcs-<hash>.identity.oraclecloud.com").',
      );
    }
    return `https://${domain}/oauth2/v1/token`;
  }

  private buildScope(credentials: ERPCredentials): string {
    // Pod name viene en companyId o se omite (Oracle acepta scope sin pod en alg. configs)
    const pod = credentials.companyId ?? '';
    return pod
      ? `urn:opc:resource:fusion:${pod}:boss/`
      : 'urn:opc:resource:fusion:boss/';
  }

  async getAccessToken(credentials: ERPCredentials): Promise<string> {
    const key = this.tokenCacheKey(credentials);
    const cached = this.tokenCache.get(key);
    // Refrescar 5 minutos antes de expirar (token TTL=3600s → refrescar a 3300s)
    if (cached && Date.now() < cached.expiresAt - 300_000) {
      return cached.value;
    }

    const endpoint = this.tokenEndpoint(credentials);
    const clientId = credentials.clientId ?? '';
    const clientSecret = credentials.clientSecret ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Oracle Fusion: clientId y clientSecret son obligatorios.');
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: this.buildScope(credentials),
    });

    const res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Oracle Fusion token error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as OracleTokenResponse;
    this.tokenCache.set(key, {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  }

  // ─── REST helper ───────────────────────────────────────────────────────────

  private async oracleGet(
    credentials: ERPCredentials,
    path: string,
    correlationId: string,
  ): Promise<Response> {
    const token = await this.getAccessToken(credentials);
    const base = (credentials.baseUrl ?? '').replace(/\/+$/, '');
    const url = `${base}${path}`;

    const res = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Oracle-Client-Identifier': correlationId,
      },
    });

    // Log Oracle observability header when present
    const ecid = res.headers.get('X-ORACLE-DMS-ECID');
    if (ecid) {
      console.info(`[oracle_fusion] correlationId=${correlationId} ecid=${ecid}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Oracle Fusion API error ${res.status} [${url}]: ${text.slice(0, 300)}`);
    }

    return res;
  }

  // ─── Extract natural account from DetailAccountCombination ───────────────

  /**
   * Oracle account combination format: segments separated by "." or "-".
   * The natural account segment index is configurable (default=4, 0-based=3).
   * Stored in credentials.apiKey as a string integer (e.g. "3").
   */
  private extractNaturalAccount(
    combination: string,
    naturalSegmentIndex: number,
  ): string {
    // Split on both "." and "-"
    const segments = combination.split(/[.\-]/);
    return segments[naturalSegmentIndex]?.trim() ?? combination;
  }

  private naturalSegmentIndex(credentials: ERPCredentials): number {
    const raw = credentials.apiKey;
    if (!raw) return 3; // default: 4th segment (0-indexed = 3)
    const n = parseInt(raw, 10);
    return isNaN(n) ? 3 : n;
  }

  // ─── Fetch all pages ──────────────────────────────────────────────────────

  private async fetchAllLedgerBalances(
    credentials: ERPCredentials,
    periodName: string,
    correlationId: string,
  ): Promise<OracleLedgerBalance[]> {
    const results: OracleLedgerBalance[] = [];
    const pageSize = 499;
    let offset = 0;

    const ledgerFilter = credentials.companyId
      ? `&q=LedgerName=${encodeURIComponent(credentials.companyId)};PeriodName=${encodeURIComponent(periodName)}`
      : `&q=PeriodName=${encodeURIComponent(periodName)}`;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const path =
        `/fscmRestApi/resources/11.13.18.05/ledgerBalances?finder=AccountBalanceFinder${ledgerFilter}&limit=${pageSize}&offset=${offset}`;
      const res = await this.oracleGet(credentials, path, correlationId);
      const body = (await res.json()) as OracleLedgerBalancesResponse;

      results.push(...(body.items ?? []));

      if (!body.hasMore) break;
      offset += pageSize;
    }

    return results;
  }

  // ─── RawAccountRow bridge ─────────────────────────────────────────────────

  /**
   * Fetch trial balance directly as RawAccountRow[].
   *
   * @param credentials  - ERP credentials
   * @param periodName   - Oracle period name, e.g. "Dec-25" or "Jan-26"
   * @param fiscalYear   - used as balancesByPeriod key, e.g. "2025"
   * @param pucMappingTable - Optional GL natural account → PUC code mapping
   */
  async fetchRawAccountRows(
    credentials: ERPCredentials,
    periodName: string,
    fiscalYear: string,
    pucMappingTable?: Record<string, string>,
  ): Promise<RawAccountRow[]> {
    const correlationId = crypto.randomUUID();
    const segIdx = this.naturalSegmentIndex(credentials);
    const rows = await this.fetchAllLedgerBalances(credentials, periodName, correlationId);

    return rows.map((row): RawAccountRow => {
      const naturalAccount = this.extractNaturalAccount(row.DetailAccountCombination, segIdx);
      const pucCode = pucMappingTable?.[naturalAccount] ?? naturalAccount;
      return {
        code: pucCode,
        name: row.DetailAccountCombination,
        level: 'Auxiliar',
        transactional: true,
        balancesByPeriod: { [fiscalYear]: row.EndingBalance },
      };
    });
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
      'Oracle Fusion: getChartOfAccounts no implementado. Use fetchRawAccountRows con periodName.',
    );
  }

  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    // period: "2025-12" → derive Oracle period name "Dec-25"
    const correlationId = crypto.randomUUID();
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr ?? '12', 10);
    const oraclePeriod = formatOraclePeriod(year, month);
    const segIdx = this.naturalSegmentIndex(credentials);

    const rows = await this.fetchAllLedgerBalances(credentials, oraclePeriod, correlationId);

    const accounts: ERPAccount[] = rows.map((row) => {
      const naturalAccount = this.extractNaturalAccount(row.DetailAccountCombination, segIdx);
      const debit = row.PeriodActivity > 0 ? row.PeriodActivity : 0;
      const credit = row.PeriodActivity < 0 ? Math.abs(row.PeriodActivity) : 0;

      return {
        code: naturalAccount,
        name: row.DetailAccountCombination,
        type: inferTypeFromPUC(naturalAccount),
        pucClass: parseInt(naturalAccount.charAt(0), 10) || undefined,
        balance: row.EndingBalance,
        debit,
        credit,
        level: accountLevel(naturalAccount),
        isAuxiliary: naturalAccount.replace(/\D/g, '').length >= 6,
      };
    });

    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

    return {
      period,
      companyName: credentials.companyId ?? 'Oracle Fusion Ledger',
      currency: rows[0]?.Currency ?? 'COP',
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
      'Oracle Fusion: getJournalEntries no implementado. Use el endpoint /fscmRestApi/resources/11.13.18.05/journalEntries.',
    );
  }

  async getInvoices(
    _credentials: ERPCredentials,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ERPInvoice[]> {
    throw new Error(
      'Oracle Fusion: getInvoices no implementado. Use el endpoint /fscmRestApi/resources/11.13.18.05/invoices.',
    );
  }

  async getContacts(_credentials: ERPCredentials): Promise<ERPContact[]> {
    throw new Error(
      'Oracle Fusion: getContacts no implementado. Use el endpoint /fscmRestApi/resources/11.13.18.05/suppliers.',
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Oracle period name format: "Dec-25", "Jan-26" */
function formatOraclePeriod(year: number, month: number): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[month - 1] ?? 'Dec';
  const yearShort = String(year).slice(-2);
  return `${monthName}-${yearShort}`;
}

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
  const digits = code.replace(/\D/g, '');
  if (digits.length <= 1) return 1;
  if (digits.length <= 2) return 2;
  if (digits.length <= 4) return 3;
  if (digits.length <= 6) return 4;
  return 5;
}
