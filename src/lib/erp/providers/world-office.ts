// ─── World Office ERP Connector ───────────────────────────────────────────────
// World Office is a Colombian cloud accounting / ERP platform.
// Auth: JWT Bearer token. Rate limit: 500 req/s.
// Base URL: https://{tenant}.worldoffice.cloud/api/

import { BaseERPConnector } from '../connector';
import { assertSafeTenantUrl } from '../validate-base-url';
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

// ─── World Office API response shapes ───────────────────────────────────────

interface WOAccount {
  Id: number;
  Codigo: string;
  Nombre: string;
  Tipo?: string;
  Nivel?: number;
  CuentaPadre?: string;
  Naturaleza?: string;
  Estado?: string;
  EsAuxiliar?: boolean;
}

interface WOComprobante {
  Id: number;
  Numero: number;
  Fecha: string;
  Descripcion?: string;
  Referencia?: string;
  Detalles: WOComprobanteLine[];
}

interface WOComprobanteLine {
  CuentaCodigo: string;
  CuentaNombre: string;
  Descripcion?: string;
  Debito: number;
  Credito: number;
  CentroCosto?: string;
  Tercero?: string;
}

interface WOFactura {
  Id: number;
  Numero: string;
  Prefijo?: string;
  Fecha: string;
  FechaVencimiento?: string;
  TerceroNombre: string;
  TerceroNit?: string;
  Subtotal: number;
  TotalImpuesto: number;
  Total: number;
  Estado?: string;
  Cufe?: string;
}

interface WOTercero {
  Id: number;
  Nombre: string;
  Nit?: string;
  TipoTercero?: string;
  Email?: string;
  Telefono?: string;
  Ciudad?: string;
}

interface WOPaginatedResponse<T> {
  Data: T[];
  Total: number;
  Page: number;
  PageSize: number;
}

/**
 * Connector for the World Office cloud ERP platform.
 *
 * Requires `tenantId` and `accessToken` (JWT) in credentials.
 * Tenant determines the subdomain.
 */
export class WorldOfficeConnector extends BaseERPConnector {
  readonly provider = 'world_office' as const;

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /**
   * Build the tenant-specific base URL.
   * World Office uses subdomains: https://{tenant}.worldoffice.cloud/api/
   */
  private getBaseUrl(credentials: ERPCredentials): string {
    if (credentials.baseUrl) {
      return credentials.baseUrl.replace(/\/+$/, '');
    }
    const tenant = credentials.tenantId;
    if (!tenant) {
      throw new Error('World Office credentials require "tenantId" or "baseUrl".');
    }
    // El tenant viene del cliente y es la AUTORIDAD de la URL: con `/` o `@`
    // el parser WHATWG resuelve el host a donde quiera el atacante y el resto
    // cae en el path. La rama de baseUrl ya la cubre el guard del handler.
    const base = `https://${tenant}.worldoffice.cloud/api`;
    assertSafeTenantUrl(tenant, base, 'World Office');
    return base;
  }

  /** Build auth headers with the JWT token. */
  private getAuthHeaders(credentials: ERPCredentials): Record<string, string> {
    const token = credentials.accessToken;
    if (!token) {
      throw new Error('World Office credentials require "accessToken" (JWT token).');
    }
    return { Authorization: `Bearer ${token}` };
  }

  private buildUrl(credentials: ERPCredentials, path: string): string {
    return `${this.getBaseUrl(credentials)}${path}`;
  }

  // ─── Pagination helper ──────────────────────────────────────────────────

  /**
   * Fetch all pages from a World Office paginated endpoint.
   * Uses Page and PageSize query params.
   */
  private async fetchAllPages<T>(
    credentials: ERPCredentials,
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    const pageSize = 100;
    let page = 1;

    const headers = this.getAuthHeaders(credentials);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const qs = new URLSearchParams({
        ...params,
        Page: String(page),
        PageSize: String(pageSize),
      });
      const url = this.buildUrl(credentials, `${path}?${qs.toString()}`);
      const response = await this.fetchJSON<WOPaginatedResponse<T>>(url, { headers });

      if (!response.Data || response.Data.length === 0) break;
      results.push(...response.Data);

      if (results.length >= response.Total) break;
      page++;
    }

    return results;
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by fetching first page of accounts. */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      const url = this.buildUrl(
        credentials,
        '/Contabilidad/PlanCuentas?Page=1&PageSize=1',
      );
      await this.fetchJSON<WOPaginatedResponse<WOAccount>>(url, {
        headers: this.getAuthHeaders(credentials),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the chart of accounts. `isAuxiliary` uses the native `EsAuxiliar`
   * flag when World Office sends it; otherwise the real hierarchy decides
   * (an account is a leaf when no other account descends from it).
   */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<WOAccount>(
      credentials,
      '/Contabilidad/PlanCuentas',
    );
    const withCode = raw.filter((a) => Boolean(a.Codigo));
    const byHierarchy = markLeafAccounts(withCode.map((a) => this.mapAccount(a)));
    return byHierarchy.map((acct, i) => ({
      ...acct,
      isAuxiliary: withCode[i].EsAuxiliar ?? acct.isAuxiliary,
    }));
  }

  /**
   * Movements of the period aggregated from comprobantes. The API used here
   * does not expose opening or accumulated balances, so the result is flagged
   * `movements_only` and is never presented as a trial balance.
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
      providerName: 'World Office',
      period: resolved,
      chart: accounts,
      lines: entries.flatMap((e) => e.lines),
      companyName: '',
      currency: 'COP',
    });
  }

  /** Fetch journal entries (comprobantes) for a date range. */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const raw = await this.fetchAllPages<WOComprobante>(
      credentials,
      '/Contabilidad/Comprobantes',
      { FechaInicio: dateFrom, FechaFin: dateTo },
    );

    return raw.map((comp) => {
      const lines: ERPJournalLine[] = (comp.Detalles ?? []).map((d) => ({
        accountCode: d.CuentaCodigo,
        accountName: d.CuentaNombre,
        description: d.Descripcion,
        debit: d.Debito ?? 0,
        credit: d.Credito ?? 0,
        costCenter: d.CentroCosto,
        thirdParty: d.Tercero,
      }));

      return {
        id: String(comp.Id),
        date: comp.Fecha,
        description: comp.Descripcion ?? '',
        reference: comp.Referencia ?? String(comp.Numero),
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
    const raw = await this.fetchAllPages<WOFactura>(
      credentials,
      '/Ventas/Facturas',
      { FechaInicio: dateFrom, FechaFin: dateTo },
    );

    return raw.map((f) => ({
      id: String(f.Id),
      number: f.Prefijo ? `${f.Prefijo}-${f.Numero}` : f.Numero,
      date: f.Fecha,
      dueDate: f.FechaVencimiento,
      type: 'sale' as const,
      contactName: f.TerceroNombre,
      contactNit: f.TerceroNit,
      subtotal: f.Subtotal ?? 0,
      taxTotal: f.TotalImpuesto ?? 0,
      total: f.Total ?? 0,
      currency: 'COP',
      status: this.mapInvoiceStatus(f.Estado),
      cufe: f.Cufe,
    }));
  }

  /** Fetch all contacts (terceros). */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const raw = await this.fetchAllPages<WOTercero>(credentials, '/Terceros');

    return raw.map((t) => ({
      id: String(t.Id),
      name: t.Nombre,
      nit: t.Nit,
      type: this.mapTerceroType(t.TipoTercero),
      email: t.Email,
      phone: t.Telefono,
      city: t.Ciudad,
    }));
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  private mapAccount(a: WOAccount): ERPAccount {
    return {
      code: a.Codigo,
      name: a.Nombre,
      type: pucTypeFromCode(a.Codigo),
      pucClass: pucClassFromCode(a.Codigo),
      balance: 0,
      debit: 0,
      credit: 0,
      level: a.Nivel ?? accountLevelFromCode(a.Codigo),
      parentCode: a.CuentaPadre ?? deriveParentCode(a.Codigo),
      isAuxiliary: false,
    };
  }

  private mapInvoiceStatus(
    status?: string,
  ): 'draft' | 'open' | 'paid' | 'overdue' | 'cancelled' {
    switch (status?.toLowerCase()) {
      case 'borrador':
        return 'draft';
      case 'pagada':
        return 'paid';
      case 'anulada':
        return 'cancelled';
      case 'vencida':
        return 'overdue';
      default:
        return 'open';
    }
  }

  private mapTerceroType(tipo?: string): 'customer' | 'supplier' | 'both' {
    switch (tipo?.toLowerCase()) {
      case 'cliente':
        return 'customer';
      case 'proveedor':
        return 'supplier';
      case 'ambos':
      case 'cliente/proveedor':
        return 'both';
      default:
        return 'customer';
    }
  }
}
