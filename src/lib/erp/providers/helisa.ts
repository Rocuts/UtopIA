// ─── Helisa ERP Connector ─────────────────────────────────────────────────────
// Helisa is a Colombian on-premise/cloud ERP with HMAC-signed API requests.
// Auth: HMAC signature per request. Base URL configured per installation.
// Docs: Helisa Kansas Web Services API.

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

// ─── Helisa API response shapes ─────────────────────────────────────────────

interface HelisaAccount {
  codigo: string;
  nombre: string;
  naturaleza?: string;
  nivel?: number;
  cuentaPadre?: string;
  estado?: string;
}

interface HelisaBalanceItem {
  codigo: string;
  nombre: string;
  debitos: number;
  creditos: number;
  saldo: number;
}

interface HelisaBalanceSheet {
  empresa?: string;
  nit?: string;
  items: HelisaBalanceItem[];
}

interface HelisaIncomeStatement {
  empresa?: string;
  items: HelisaBalanceItem[];
}

interface HelisaThirdParty {
  codigo: string;
  nombre: string;
  nit?: string;
  email?: string;
  telefono?: string;
  ciudad?: string;
  tipo?: string;
}

interface HelisaDocument {
  numero: number;
  fecha: string;
  descripcion?: string;
  referencia?: string;
  detalles: HelisaDocumentLine[];
}

interface HelisaDocumentLine {
  codigoCuenta: string;
  nombreCuenta: string;
  descripcion?: string;
  debito: number;
  credito: number;
  centroCosto?: string;
  tercero?: string;
}

/**
 * Connector for the Helisa ERP system.
 *
 * Requires `baseUrl`, `apiKey` (HMAC key), `companyId`, and optionally `username`.
 * Each API request is signed with an HMAC signature.
 */
export class HelisaConnector extends BaseERPConnector {
  readonly provider = 'helisa' as const;

  // ─── Auth & signing ─────────────────────────────────────────────────────

  /**
   * Build the base URL from credentials.
   * Helisa installations have per-tenant URLs (e.g., https://{server}/KansasWS/).
   */
  private getBaseUrl(credentials: ERPCredentials): string {
    if (!credentials.baseUrl) {
      throw new Error('Helisa credentials require "baseUrl" (e.g., https://server/KansasWS/).');
    }
    return credentials.baseUrl.replace(/\/+$/, '');
  }

  /**
   * Compute HMAC-SHA256 signature for request parameters.
   * Helisa signs the pipe-concatenated parameter string.
   */
  private async computeHMAC(key: string, data: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const msgData = encoder.encode(data);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build a signed URL for a Helisa API call.
   * Parameters are pipe-concatenated and HMAC-signed.
   */
  private async buildSignedUrl(
    credentials: ERPCredentials,
    path: string,
    params: Record<string, string> = {},
  ): Promise<string> {
    const hmacKey = credentials.apiKey;
    if (!hmacKey) {
      throw new Error('Helisa credentials require "apiKey" (HMAC signing key).');
    }

    const companyId = credentials.companyId ?? '';
    const allParams = { empresa: companyId, ...params };

    // Pipe-concatenate all parameter values for signing
    const dataToSign = Object.values(allParams).join('|');
    const sign = await this.computeHMAC(hmacKey, dataToSign);

    const qs = new URLSearchParams({ ...allParams, sign });
    const baseUrl = this.getBaseUrl(credentials);
    return `${baseUrl}${path}?${qs.toString()}`;
  }

  // ─── Interface implementation ────────────────────────────────────────────

  /** Test connection by fetching account list. */
  async testConnection(credentials: ERPCredentials): Promise<boolean> {
    try {
      const url = await this.buildSignedUrl(credentials, '/get/accountList');
      await this.fetchJSON<HelisaAccount[]>(url);
      return true;
    } catch {
      return false;
    }
  }

  /** Fetch the chart of accounts. */
  async getChartOfAccounts(credentials: ERPCredentials): Promise<ERPAccount[]> {
    const url = await this.buildSignedUrl(credentials, '/get/accountList');
    const raw = await this.fetchJSON<HelisaAccount[]>(url);

    return (raw ?? []).map((a) => this.mapAccount(a));
  }

  /**
   * Build a trial balance by combining balanceSheet + incomeStatement.
   * @param period - ISO month string, e.g. "2026-03"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    const periodParams = {
      anio: String(year),
      mes: String(month),
      fechaCorte: `${period}-${String(lastDay).padStart(2, '0')}`,
    };

    const [bsUrl, isUrl] = await Promise.all([
      this.buildSignedUrl(credentials, '/summary/balanceSheet', periodParams),
      this.buildSignedUrl(credentials, '/summary/incomeStatement', periodParams),
    ]);

    const [balanceSheet, incomeStatement] = await Promise.all([
      this.fetchJSON<HelisaBalanceSheet>(bsUrl),
      this.fetchJSON<HelisaIncomeStatement>(isUrl),
    ]);

    // Merge items from both reports
    const allItems = [
      ...(balanceSheet.items ?? []),
      ...(incomeStatement.items ?? []),
    ];

    const accounts: ERPAccount[] = allItems.map((item) => ({
      code: item.codigo,
      name: item.nombre,
      type: mapPUCType(item.codigo),
      pucClass: pucClassFromCode(item.codigo),
      balance: item.saldo,
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
      companyName: balanceSheet.empresa ?? '',
      companyNit: balanceSheet.nit,
      currency: 'COP',
      accounts,
      totalDebit,
      totalCredit,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Fetch journal entries via the document endpoint.
   * Helisa uses POST /set/document for creation and GET for retrieval.
   * We use the retrieval mode with date filters.
   */
  async getJournalEntries(
    credentials: ERPCredentials,
    dateFrom: string,
    dateTo: string,
  ): Promise<ERPJournalEntry[]> {
    const url = await this.buildSignedUrl(credentials, '/get/documents', {
      fechaInicio: dateFrom,
      fechaFin: dateTo,
    });
    const raw = await this.fetchJSON<HelisaDocument[]>(url);

    return (raw ?? []).map((doc) => {
      const lines: ERPJournalLine[] = (doc.detalles ?? []).map((d) => ({
        accountCode: d.codigoCuenta,
        accountName: d.nombreCuenta,
        description: d.descripcion,
        debit: d.debito ?? 0,
        credit: d.credito ?? 0,
        costCenter: d.centroCosto,
        thirdParty: d.tercero,
      }));

      return {
        id: String(doc.numero),
        date: doc.fecha,
        description: doc.descripcion ?? '',
        reference: doc.referencia,
        lines,
        totalDebit: lines.reduce((s, l) => s + l.debit, 0),
        totalCredit: lines.reduce((s, l) => s + l.credit, 0),
      };
    });
  }

  /**
   * Helisa does not have a dedicated invoices endpoint.
   * Return an empty array -- invoices are embedded in journal entries.
   */
  async getInvoices(
    _credentials: ERPCredentials,
    _dateFrom: string,
    _dateTo: string,
  ): Promise<ERPInvoice[]> {
    // Helisa manages invoices as accounting documents (comprobantes).
    // A dedicated invoice list is not available through the Kansas WS API.
    return [];
  }

  /** Fetch contacts (third parties). */
  async getContacts(credentials: ERPCredentials): Promise<ERPContact[]> {
    const url = await this.buildSignedUrl(credentials, '/get/thirdParty2_0');
    const raw = await this.fetchJSON<HelisaThirdParty[]>(url);

    return (raw ?? []).map((tp) => ({
      id: tp.codigo,
      name: tp.nombre,
      nit: tp.nit,
      type: this.mapThirdPartyType(tp.tipo),
      email: tp.email,
      phone: tp.telefono,
      city: tp.ciudad,
    }));
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  private mapAccount(a: HelisaAccount): ERPAccount {
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

  private mapThirdPartyType(tipo?: string): 'customer' | 'supplier' | 'both' {
    switch (tipo?.toLowerCase()) {
      case 'cliente':
        return 'customer';
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
