// ─── ContaPyme ERP Connector ──────────────────────────────────────────────────
// ContaPyme is a Colombian desktop/server ERP with a simple REST API.
// Auth: Session token obtained via GetAuth() endpoint.
// Base URL: configured per installation.

import { BaseERPConnector } from '../connector';
import { connectionKey } from '../session-store';
import { resolveERPPeriod } from '../period';
import { buildClosingTrialBalance } from '../trial-balance-builders';
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

// ─── ContaPyme API response shapes ──────────────────────────────────────────

interface ContaPymeAuthResponse {
  token: string;
  empresa?: string;
  nit?: string;
  expires?: number;
}

interface ContaPymeSession {
  token: string;
  empresa: string;
  nit?: string;
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

  // ─── Auth helpers ────────────────────────────────────────────────────────

  /** Build the base URL from credentials. */
  private getBaseUrl(credentials: ERPCredentials): string {
    if (!credentials.baseUrl) {
      throw new Error('ContaPyme credentials require "baseUrl".');
    }
    return credentials.baseUrl.replace(/\/+$/, '');
  }

  /**
   * Authenticate and obtain a session (token + company identity). Cached per
   * connection (provider + credential fingerprint), never per instance, so the
   * company name/NIT always belong to the credentials being served.
   */
  private async getSession(
    credentials: ERPCredentials,
    options: { forceRefresh?: boolean } = {},
  ): Promise<ContaPymeSession> {
    const username = credentials.username;
    const password = credentials.password;
    if (!username || !password) {
      throw new Error('ContaPyme credentials require "username" and "password".');
    }
    const baseUrl = this.getBaseUrl(credentials);

    return this.sessions.resolve<ContaPymeSession>(
      connectionKey(credentials, 'session'),
      async () => {
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

        return {
          value: { token: response.token, empresa: response.empresa ?? '', nit: response.nit },
          ttlMs: (response.expires ?? 3600) * 1000,
        };
      },
      { refreshMarginMs: 60_000, forceRefresh: options.forceRefresh },
    );
  }

  /** Build auth headers with the session token. */
  private async getAuthHeaders(credentials: ERPCredentials): Promise<Record<string, string>> {
    const { token } = await this.getSession(credentials);
    return { Authorization: `Token ${token}` };
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by attempting a fresh authentication (never a cached token). */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      await this.getSession(credentials, { forceRefresh: true });
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

    return markLeafAccounts(
      (report.cuentas ?? []).filter((a) => Boolean(a.codigo)).map((a) => this.mapAccount(a)),
    );
  }

  /**
   * Fetch the trial balance (BalanceComprobacion): opening balance, debits,
   * credits and closing balance per account for the requested range. Leaves
   * are decided by the real hierarchy of the report and every account is
   * checked for closing = opening + debits − credits.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);
    const baseUrl = this.getBaseUrl(credentials);
    const session = await this.getSession(credentials);
    const headers = { Authorization: `Token ${session.token}` };

    const qs = new URLSearchParams({
      periodo: resolved.label,
      fechaInicio: resolved.from,
      fechaFin: resolved.to,
    });

    const report = await this.fetchJSON<ContaPymeTrialBalanceReport>(
      `${baseUrl}/Informes/Contabilidad/BalanceComprobacion?${qs.toString()}`,
      { headers },
    );

    return buildClosingTrialBalance({
      period: resolved,
      rows: (report.cuentas ?? []).map((item) => ({
        code: item.codigo,
        name: item.nombre,
        opening: item.saldoAnterior,
        debit: item.debitos,
        credit: item.creditos,
        closing: item.saldoFinal,
      })),
      // La identidad de la empresa sale del informe o de la sesión de ESTAS
      // credenciales; nunca de un token de otra conexión.
      companyName: report.empresa ?? session.empresa ?? '',
      companyNit: report.nit ?? session.nit,
      currency: 'COP',
    });
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
      type: pucTypeFromCode(a.codigo),
      pucClass: pucClassFromCode(a.codigo),
      balance: 0,
      debit: 0,
      credit: 0,
      level: a.nivel ?? accountLevelFromCode(a.codigo),
      parentCode: a.cuentaPadre ?? deriveParentCode(a.codigo),
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
