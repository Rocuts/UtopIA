// ─── SAP S/4HANA Cloud Connector ─────────────────────────────────────────────
// OData v2: /sap/opu/odata/sap/C_TRIALBALANCE_CDS/C_TRIALBALANCE
// Auth: OAuth 2.0 Client Credentials.
// Token endpoint (BTP XSUAA): https://<tenant>.authentication.<region>.hana.ondemand.com/oauth/token
// Paginacion: $top=1000&$skip con nextLink server-side preferido.
//
// Nota de mapeo PUC: SAP S/4HANA Cloud usa GL accounts propios del cliente.
// La conversion a PUC colombiano requiere una mappingTable externa.
// Sin tabla, se pasa el GLAccount como code (el motor de preprocessing lo
// clasificara o alertara discrepancia). Para cuentas ya codificadas en PUC el
// connector funciona directamente.

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

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface S4TrialBalanceItem {
  GLAccount: string;
  AccountName: string;
  BalanceAmountInCompanyCodeCurrency: string;
  DebitAmountInCompanyCodeCurrency: string;
  CreditAmountInCompanyCodeCurrency: string;
  FiscalYear: string;
  FiscalPeriod: string;
  CompanyCode: string;
  CompanyCodeCurrency: string;
}

interface S4ODataResponse {
  d: {
    results: S4TrialBalanceItem[];
    __count?: string;
    __next?: string;
  };
}

// ─── Credentials shape expected by this connector ─────────────────────────────
// Caller provides:
//   baseUrl     = "https://<tenant>.s4hana.ondemand.com"
//   clientId    = OAuth client_id (Communication User ID)
//   clientSecret= OAuth client_secret (Communication User password)
//   tenantId    (optional) = BTP subdomain for XSUAA token endpoint override
//   companyId   (optional) = CompanyCode filter

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

    // Transient errors — backoff and retry
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === retries) return res; // last attempt — let caller handle
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : jitter(delayMs * 2 ** attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    return res;
  }
  // Should never reach here given loop bounds, but TypeScript needs a return.
  throw new Error('fetchWithRetry: exceeded max retries');
}

// ─── Cached token shape ────────────────────────────────────────────────────────

interface CachedToken {
  value: string;
  expiresAt: number;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class SAPS4HANAConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'sap_s4hana';

  /** Per-instance token cache so tests don't bleed across connector instances. */
  private readonly tokenCache = new Map<string, CachedToken>();

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private tokenCacheKey(credentials: ERPCredentials): string {
    return `sap_s4hana:${credentials.clientId ?? ''}:${credentials.baseUrl ?? ''}`;
  }

  private tokenEndpoint(credentials: ERPCredentials): string {
    // BTP XSUAA pattern: tenantId holds the BTP subdomain
    if (credentials.tenantId) {
      return `https://${credentials.tenantId}.authentication.eu10.hana.ondemand.com/oauth/token`;
    }
    // Default: embedded XSUAA on the S/4 tenant
    const base = (credentials.baseUrl ?? '').replace(/\/+$/, '');
    return `${base}/sap/bc/sec/oauth2/token`;
  }

  private async getAccessToken(credentials: ERPCredentials): Promise<string> {
    const key = this.tokenCacheKey(credentials);
    const cached = this.tokenCache.get(key);
    // Refresh 5 minutes before expiry
    if (cached && Date.now() < cached.expiresAt - 300_000) {
      return cached.value;
    }

    const endpoint = this.tokenEndpoint(credentials);
    const clientId = credentials.clientId ?? '';
    const clientSecret = credentials.clientSecret ?? '';

    if (!clientId || !clientSecret) {
      throw new Error(
        'SAP S/4HANA: clientId (Communication User) y clientSecret son obligatorios.',
      );
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
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
      throw new Error(`SAP S/4HANA token error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as OAuthTokenResponse;
    this.tokenCache.set(key, {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  }

  // ─── OData fetch helper ────────────────────────────────────────────────────

  private async odataGet(
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
        'X-Request-ID': correlationId,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SAP S/4HANA OData error ${res.status} [${url}]: ${text.slice(0, 300)}`);
    }

    return res;
  }

  // ─── Fetch all pages of trial balance ─────────────────────────────────────

  private async fetchAllTrialBalanceRows(
    credentials: ERPCredentials,
    fiscalYear: string,
    fiscalPeriod: string,
    correlationId: string,
  ): Promise<S4TrialBalanceItem[]> {
    const results: S4TrialBalanceItem[] = [];
    const pageSize = 1000;

    const companyCodeFilter = credentials.companyId
      ? ` and CompanyCode eq '${credentials.companyId}'`
      : '';

    // Build base OData path
    const baseFilter = encodeURIComponent(
      `FiscalYear eq '${fiscalYear}' and FiscalPeriod eq '${fiscalPeriod}'${companyCodeFilter}`,
    );
    let nextPath: string | null =
      `/sap/opu/odata/sap/C_TRIALBALANCE_CDS/C_TRIALBALANCE?$filter=${baseFilter}&$top=${pageSize}&$skip=0&$inlinecount=allpages&$format=json`;

    while (nextPath) {
      const res = await this.odataGet(credentials, nextPath, correlationId);
      const body = (await res.json()) as S4ODataResponse;

      const items = body.d.results ?? [];
      results.push(...items);

      // Server-side nextLink is preferred; fallback to manual $skip
      if (body.d.__next) {
        // __next is the full URL — extract path+query
        try {
          const url = new URL(body.d.__next);
          nextPath = `${url.pathname}${url.search}`;
        } catch {
          nextPath = null;
        }
      } else {
        nextPath = null;
      }
    }

    return results;
  }

  // ─── Map S4 rows → ERPAccount ──────────────────────────────────────────────

  private mapToERPAccount(
    row: S4TrialBalanceItem,
    pucMappingTable?: Record<string, string>,
  ): ERPAccount {
    const pucCode = pucMappingTable?.[row.GLAccount] ?? row.GLAccount;
    const debit = parseFloat(row.DebitAmountInCompanyCodeCurrency) || 0;
    const credit = parseFloat(row.CreditAmountInCompanyCodeCurrency) || 0;
    const balance = parseFloat(row.BalanceAmountInCompanyCodeCurrency) || debit - credit;

    return {
      code: pucCode,
      name: row.AccountName,
      type: inferTypeFromPUC(pucCode),
      pucClass: parseInt(pucCode.charAt(0), 10) || undefined,
      balance,
      debit,
      credit,
      level: accountLevel(pucCode),
      isAuxiliary: pucCode.length >= 6,
    };
  }

  // ─── RawAccountRow bridge ──────────────────────────────────────────────────

  /**
   * Fetch trial balance directly as RawAccountRow[] — compatible con
   * preprocessTrialBalance / parseTrialBalanceCSV.
   *
   * @param credentials  - ERP credentials (clientId, clientSecret, baseUrl, etc.)
   * @param fiscalYear   - e.g. "2025"
   * @param fiscalPeriod - e.g. "012" (periodo SAP — 3 digits, 012 = diciembre)
   * @param pucMappingTable - Tabla GL Account → codigo PUC (client-specific)
   */
  async fetchRawAccountRows(
    credentials: ERPCredentials,
    fiscalYear: string,
    fiscalPeriod: string,
    pucMappingTable?: Record<string, string>,
  ): Promise<RawAccountRow[]> {
    const correlationId = crypto.randomUUID();
    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      fiscalYear,
      fiscalPeriod,
      correlationId,
    );

    return rows.map((row): RawAccountRow => {
      const pucCode = pucMappingTable?.[row.GLAccount] ?? row.GLAccount;
      const balance = parseFloat(row.BalanceAmountInCompanyCodeCurrency) || 0;
      return {
        code: pucCode,
        name: row.AccountName,
        level: 'Auxiliar',
        transactional: true,
        balancesByPeriod: { [fiscalYear]: balance },
      };
    });
  }

  // ─── ERPConnectorInterface implementation ──────────────────────────────────

  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getAccessToken(credentials);
      return true;
    } catch {
      return false;
    }
  }

  async getChartOfAccounts(_credentials: ERPCredentials): Promise<ERPAccount[]> {
    // S/4HANA Cloud: GL accounts viven en MDG; no hay endpoint simple de CoA
    // en la CDS trial balance. Se retorna vacío — usar fetchRawAccountRows.
    throw new Error(
      'SAP S/4HANA: getChartOfAccounts no esta disponible en este conector. Use fetchRawAccountRows con fiscalYear/fiscalPeriod.',
    );
  }

  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    // period format esperado por ERPAdapter: "2025-12"
    const [fiscalYear, fiscalMonthRaw] = period.split('-');
    const fiscalMonth = parseInt(fiscalMonthRaw ?? '12', 10);
    // SAP FiscalPeriod es 3 chars zero-padded: "012"
    const fiscalPeriod = String(fiscalMonth).padStart(3, '0');
    const correlationId = crypto.randomUUID();

    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      fiscalYear,
      fiscalPeriod,
      correlationId,
    );

    const accounts = rows.map((r) => this.mapToERPAccount(r));
    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

    return {
      period,
      companyName: credentials.companyId ?? 'SAP S/4HANA Company',
      currency: rows[0]?.CompanyCodeCurrency ?? 'COP',
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
      'SAP S/4HANA: getJournalEntries no implementado en este conector. Use el servicio C_JournalEntryItem_CDS directamente.',
    );
  }

  async getInvoices(
    _credentials: ERPCredentials,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ERPInvoice[]> {
    throw new Error(
      'SAP S/4HANA: getInvoices no implementado en este conector. Use el servicio API_BILLING_DOCUMENT_SRV.',
    );
  }

  async getContacts(_credentials: ERPCredentials): Promise<ERPContact[]> {
    throw new Error(
      'SAP S/4HANA: getContacts no implementado en este conector. Use el servicio BusinessPartner_CDS.',
    );
  }
}

// ─── PUC helpers (compartidos) ────────────────────────────────────────────────

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
