// ─── ContaPyme ERP Connector ──────────────────────────────────────────────────
// ContaPyme is a Colombian desktop/server ERP with a simple REST API.
// Auth: Session token obtained via GetAuth() endpoint.
// Base URL: configured per installation.

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

// ─── ContaPyme API response shapes ──────────────────────────────────────────

interface ContaPymeAuthResponse {
  token: string;
  empresa?: string;
  nit?: string;
  expires?: number;
}

interface ContaPymeAccount {
  codigo: string;
  nombre: string;
  nivel?: number;
  cuentaPadre?: string;
  naturaleza?: string;
  tipo?: string;
}

interface ContaPymeTrialBalanceItem {
  codigo: string;
  nombre: string;
  saldoAnterior: number;
  debitos: number;
  creditos: number;
  saldoFinal: number;
}

interface ContaPymeTrialBalanceReport {
  empresa: string;
  nit?: string;
  periodo: string;
  cuentas: ContaPymeTrialBalanceItem[];
}

interface ContaPymeAccountingReport {
  cuentas: ContaPymeAccount[];
  movimientos?: ContaPymeTrialBalanceItem[];
}

interface ContaPymeInvoice {
  numero: string;
  fecha: string;
  fechaVencimiento?: string;
  cliente: string;
  nitCliente?: string;
  subtotal: number;
  impuesto: number;
  total: number;
  estado?: string;
}

interface ContaPymeClient {
  codigo: string;
  nombre: string;
  nit?: string;
  tipo?: string;
  email?: string;
  telefono?: string;
  ciudad?: string;
}

/**
 * Connector for the ContaPyme ERP system.
 *
 * Requires `baseUrl`, `username`, and `password` in credentials.
 * Obtains a session token via the GetAuth() endpoint.
 */
export class ContaPymeConnector extends BaseERPConnector {
  readonly provider = 'contapyme' as const;

  /** In-memory token cache. */
  private cachedToken: { token: string; expiresAt: number; empresa: string; nit?: string } | null = null;

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /** Build the base URL from credentials. */
  private getBaseUrl(credentials: ERPCredentials): string {
    if (!credentials.baseUrl) {
      throw new Error('ContaPyme credentials require "baseUrl".');
    }
    return credentials.baseUrl.replace(/\/+$/, '');
  }

  /**
   * Authenticate and obtain a session token.
   * Caches the token until expiry.
   */
  private async getToken(credentials: ERPCredentials): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    const username = credentials.username;
    const password = credentials.password;
    if (!username || !password) {
      throw new Error('ContaPyme credentials require "username" and "password".');
    }

    const baseUrl = this.getBaseUrl(credentials);
    const response = await this.fetchJSON<ContaPymeAuthResponse>(
      `${baseUrl}/GetAuth`,
      {
        method: 'POST',
        body: JSON.stringify({
          usuario: username,
          clave: password,
          empresa: credentials.companyId,
        }),
      },
    );

    if (!response.token) {
      throw new Error('ContaPyme authentication failed: no token returned.');
    }

    this.cachedToken = {
      token: response.token,
      expiresAt: Date.now() + (response.expires ?? 3600) * 1000,
      empresa: response.empresa ?? '',
      nit: response.nit,
    };

    return this.cachedToken.token;
  }

  /** Build auth headers with the session token. */
  private async getAuthHeaders(credentials: ERPCredentials): Promise<Record<string, string>> {
    const token = await this.getToken(credentials);
    return { Authorization: `Token ${token}` };
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by attempting authentication. */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getToken(credentials);
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts from the accounting report endpoint. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const baseUrl = this.getBaseUrl(credentials);
    const headers = await this.getAuthHeaders(credentials);

    const report = await this.fetchJSON<ContaPymeAccountingReport>(
      `${baseUrl}/Informes/Contabilidad`,
      { headers },
    );

    return (report.cuentas ?? []).map((a) => this.mapAccount(a));
  }

  /**
   * Fetch the trial balance from the accounting report endpoint.
   * ContaPyme provides trial balance data through its accounting reports.
   * @param period - ISO month string, e.g. "2026-03"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const baseUrl = this.getBaseUrl(credentials);
    const headers = await this.getAuthHeaders(credentials);

    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    const qs = new URLSearchParams({
      periodo: period,
      fechaInicio: `${period}-01`,
      fechaFin: `${period}-${String(lastDay).padStart(2, '0')}`,
    });

    const report = await this.fetchJSON<ContaPymeTrialBalanceReport>(
      `${baseUrl}/Informes/Contabilidad/BalanceComprobacion?${qs.toString()}`,
      { headers },
    );

    const accounts: ERPAccount[] = (report.cuentas ?? []).map((item) => ({
      code: item.codigo,
      name: item.nombre,
      type: mapPUCType(item.codigo),
      pucClass: pucClassFromCode(item.codigo),
      balance: item.saldoFinal,
      debit: item.debitos,
      credit: item.creditos,
      level: accountLevel(item.codigo),
      parentCode: deriveParentCode(item.codigo),
      isAuxiliary: item.codigo.length >= 6,
    }));

    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

    return {
      period,
      companyName: report.empresa ?? this.cachedToken?.empresa ?? '',
      companyNit: this.cachedToken?.nit,
      currency: 'COP',
      accounts,
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Fetch journal entries.
   * ContaPyme has limited journal entry retrieval; uses accounting reports.
   */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const baseUrl = this.getBaseUrl(credentials);
    const headers = await this.getAuthHeaders(credentials);

    const qs = new URLSearchParams({
      fechaInicio: dateFrom,
      fechaFin: dateTo,
    });

    // ContaPyme exposes movements through accounting reports
    const report = await this.fetchJSON<ContaPymeAccountingReport>(
      `${baseUrl}/Informes/Contabilidad/Movimientos?${qs.toString()}`,
      { headers },
    );

    if (!report.movimientos || report.movimientos.length === 0) {
      return [];
    }

    // ContaPyme groups movements by account; we flatten them into a single entry per period
    const lines: ERPJournalLine[] = report.movimientos.map((m) => ({
      accountCode: m.codigo,
      accountName: m.nombre,
      debit: m.debitos,
      credit: m.creditos,
    }));

    return [
      {
        id: `${dateFrom}_${dateTo}`,
        date: dateFrom,
        description: `Movimientos del periodo ${dateFrom} al ${dateTo}`,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      },
    ];
  }

  /** Fetch invoices from the invoicing endpoint. */
  async getInvoices(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPInvoice[]> {
    const baseUrl = this.getBaseUrl(credentials);
    const headers = await this.getAuthHeaders(credentials);

    const qs = new URLSearchParams({
      fechaInicio: dateFrom,
      fechaFin: dateTo,
    });

    const raw = await this.fetchJSON<ContaPymeInvoice[]>(
      `${baseUrl}/Facturacion?${qs.toString()}`,
      { headers },
    );

    return (raw ?? []).map((inv) => ({
      id: inv.numero,
      number: inv.numero,
      date: inv.fecha,
      dueDate: inv.fechaVencimiento,
      type: 'sale' as const,
      contactName: inv.cliente,
      contactNit: inv.nitCliente,
      subtotal: inv.subtotal ?? 0,
      taxTotal: inv.impuesto ?? 0,
      total: inv.total ?? 0,
      currency: 'COP',
      status: this.mapInvoiceStatus(inv.estado),
    }));
  }

  /** Fetch contacts (clients) from the clients endpoint. */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const baseUrl = this.getBaseUrl(credentials);
    const headers = await this.getAuthHeaders(credentials);

    const raw = await this.fetchJSON<ContaPymeClient[]>(
      `${baseUrl}/Clientes`,
      { headers },
    );

    return (raw ?? []).map((c) => ({
      id: c.codigo,
      name: c.nombre,
      nit: c.nit,
      type: this.mapClientType(c.tipo),
      email: c.email,
      phone: c.telefono,
      city: c.ciudad,
    }));
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  private mapAccount(a: ContaPymeAccount): ERPAccount {
    return {
      code: a.codigo,
      name: a.nombre,
      type: mapPUCType(a.codigo),
      pucClass: pucClassFromCode(a.codigo),
      balance: 0,
      debit: 0,
      credit: 0,
      level: a.nivel ?? accountLevel(a.codigo),
      parentCode: a.cuentaPadre ?? deriveParentCode(a.codigo),
      isAuxiliary: a.codigo.length >= 6,
    };
  }

  private mapInvoiceStatus(
    status?: string,
  ): 'draft' | 'open' | 'paid' | 'overdue' | 'cancelled' {
    switch (status?.toLowerCase()) {
      case 'borrador':
        return 'draft';
      case 'pagada':
      case 'cancelada':
        return 'paid';
      case 'anulada':
        return 'cancelled';
      case 'vencida':
        return 'overdue';
      default:
        return 'open';
    }
  }

  private mapClientType(tipo?: string): 'customer' | 'supplier' | 'both' {
    switch (tipo?.toLowerCase()) {
      case 'proveedor':
        return 'supplier';
      case 'ambos':
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
