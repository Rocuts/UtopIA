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
import { connectionKey } from '../session-store';
import { resolveERPPeriod } from '../period';
import { buildClosingTrialBalance } from '../trial-balance-builders';
import {
  accountLevelFromCode,
  leafCodes,
  pucClassFromCode,
  pucTypeFromCode,
  rawLevelFor,
} from '../puc';
import {
  assertSafeTenantUrl,
  fetchWithSafeRedirects,
} from '../validate-base-url';
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
    // Las redirecciones se validan salto a salto: un host permitido que
    // conteste `302 Location: http://10.x.y.z:8080/...` anularía el guard.
    const res = await fetchWithSafeRedirects(url, init);

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

// ─── Connector ────────────────────────────────────────────────────────────────

export class SAPS4HANAConnector extends BaseERPConnector {
  readonly provider: ERPProvider = 'sap_s4hana';

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Cache key of THIS connection: provider + SHA-256 of every identity and
   * secret field. A request with the same user but another secret, or another
   * tenant/company, never receives a token issued for different credentials.
   */
  private tokenCacheKey(credentials: ERPCredentials): string {
    return connectionKey(credentials, 'token');
  }

  private tokenEndpoint(credentials: ERPCredentials): string {
    // BTP XSUAA pattern: tenantId holds the BTP subdomain
    if (credentials.tenantId) {
      // El subdominio viene del cliente y se interpola como AUTORIDAD: un valor
      // con `@` o `/` reescribe el host hacia la red interna sin pasar nunca
      // por el guard de baseUrl, que inspecciona otro campo.
      const endpoint = `https://${credentials.tenantId}.authentication.eu10.hana.ondemand.com/oauth/token`;
      assertSafeTenantUrl(credentials.tenantId, endpoint, 'SAP S/4HANA');
      return endpoint;
    }
    // Default: embedded XSUAA on the S/4 tenant (baseUrl ya pasó por el guard)
    const base = (credentials.baseUrl ?? '').replace(/\/+$/, '');
    return `${base}/sap/bc/sec/oauth2/token`;
  }

  private async getAccessToken(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    const key = this.tokenCacheKey(credentials);
    // Refresh 5 minutes before expiry
    const cached = options.forceRefresh ? null : this.sessions.get<string>(key, 300_000);
    if (cached) {
      return cached;
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
      // El cuerpo del upstream sólo al log: dentro del Error terminaba en el
      // JSON que /api/erp/sync devuelve al cliente.
      const text = await res.text().catch(() => '');
      console.error(
        `[sap_s4hana] token error ${res.status}: ${text.slice(0, 300)}`,
      );
      throw new Error(`SAP S/4HANA token error ${res.status}.`);
    }

    const data = (await res.json()) as OAuthTokenResponse;
    this.sessions.set(key, data.access_token, data.expires_in * 1000);

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
      // Ni el cuerpo ni la URL destino salen en el Error: la URL sola ya es un
      // oráculo de qué host se alcanzó. Ambos quedan en el log del servidor.
      const text = await res.text().catch(() => '');
      console.error(
        `[sap_s4hana] OData error ${res.status} [${url}]: ${text.slice(0, 300)}`,
      );
      throw new Error(`SAP S/4HANA OData error ${res.status}.`);
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
      type: pucTypeFromCode(pucCode),
      pucClass: pucClassFromCode(pucCode) || undefined,
      balance,
      debit,
      credit,
      level: accountLevelFromCode(pucCode),
      // Recalculado por jerarquía real en buildClosingTrialBalance.
      isAuxiliary: false,
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

    const codes = rows.map((row) => pucMappingTable?.[row.GLAccount] ?? row.GLAccount);
    const leaves = leafCodes(codes.map((code) => ({ code })));
    return rows.map((row, i): RawAccountRow => {
      const pucCode = codes[i];
      const balance = parseFloat(row.BalanceAmountInCompanyCodeCurrency) || 0;
      const isLeaf = leaves.has(pucCode);
      return {
        code: pucCode,
        name: row.AccountName,
        level: rawLevelFor(pucCode, isLeaf),
        transactional: isLeaf,
        balancesByPeriod: { [fiscalYear]: balance },
      };
    });
  }

  // ─── ERPConnectorInterface implementation ──────────────────────────────────

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
    // FiscalPeriod del mes de corte del periodo pedido ("012" = diciembre).
    const resolved = resolveERPPeriod(period);
    const fiscalYear = String(resolved.cutoffYear);
    const fiscalPeriod = String(resolved.cutoffMonth).padStart(3, '0');
    const correlationId = crypto.randomUUID();

    const rows = await this.fetchAllTrialBalanceRows(
      credentials,
      fiscalYear,
      fiscalPeriod,
      correlationId,
    );

    return buildClosingTrialBalance({
      period: resolved,
      rows: rows.map((r) => {
        const account = this.mapToERPAccount(r);
        return {
          code: account.code,
          name: account.name,
          debit: account.debit,
          credit: account.credit,
          closing: account.balance,
        };
      }),
      companyName: credentials.companyId ?? 'SAP S/4HANA Company',
      // Moneda de la sociedad según el propio informe; vacía si no llega.
      currency: rows[0]?.CompanyCodeCurrency ?? '',
    });
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
