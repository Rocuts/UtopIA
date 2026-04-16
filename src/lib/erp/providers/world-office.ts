// ─── World Office ERP Connector ───────────────────────────────────────────────
// World Office is a Colombian cloud accounting / ERP platform.
// Auth: JWT Bearer token. Rate limit: 500 req/s.
// Base URL: https://{tenant}.worldoffice.cloud/api/

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
    return `https://${tenant}.worldoffice.cloud/api`;
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

  /** Fetch the chart of accounts. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const raw = await this.fetchAllPages<WOAccount>(
      credentials,
      '/Contabilidad/PlanCuentas',
    );
    return raw.map((a) => this.mapAccount(a));
  }

  /**
   * Build a trial balance by aggregating journal entries for the period.
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
      type: mapPUCType(a.Codigo),
      pucClass: pucClassFromCode(a.Codigo),
      balance: 0,
      debit: 0,
      credit: 0,
      level: a.Nivel ?? accountLevel(a.Codigo),
      parentCode: a.CuentaPadre ?? deriveParentCode(a.Codigo),
      isAuxiliary: a.EsAuxiliar ?? a.Codigo.length >= 6,
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

// ─── Shared PUC helpers ──────────────────────────────────────────────────────

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

function pucClassFromCode(code: string): number {
  const n = parseInt(code.charAt(0), 10);
  return isNaN(n) ? 0 : n;
}

function accountLevel(code: string): number {
  if (code.length <= 1) return 1;
  if (code.length <= 2) return 2;
  if (code.length <= 4) return 3;
  if (code.length <= 6) return 4;
  return 5;
}

function deriveParentCode(code: string): string | undefined {
  if (code.length > 6) return code.slice(0, 6);
  if (code.length > 4) return code.slice(0, 4);
  if (code.length > 2) return code.slice(0, 2);
  if (code.length > 1) return code.slice(0, 1);
  return undefined;
}
