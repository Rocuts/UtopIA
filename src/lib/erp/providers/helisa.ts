// ─── Helisa ERP Connector ─────────────────────────────────────────────────────
// Helisa is a Colombian on-premise/cloud ERP with HMAC-signed API requests.
// Auth: HMAC signature per request. Base URL configured per installation.
// Docs: Helisa Kansas Web Services API.

import { BaseERPConnector } from '../connector';
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

    return markLeafAccounts(
      (raw ?? []).filter((a) => Boolean(a.codigo)).map((a) => this.mapAccount(a)),
    );
  }

  /**
   * Build a trial balance by combining balanceSheet + incomeStatement (closing
   * balances at the cutoff date). Leaves are decided by the real hierarchy of
   * the report: a summary that lists 110505 together with 11050501/11050502
   * must not add the parent and its children.
   * @param period - "AAAA", "AAAA-MM", "AAAA-Qn" or "AAAA-MM-DD..AAAA-MM-DD"
   */
  async getTrialBalance(
    credentials: ERPCredentials,
    period: string,
  ): Promise<ERPTrialBalance> {
    const resolved = resolveERPPeriod(period);

    const periodParams = {
      anio: String(resolved.cutoffYear),
      mes: String(resolved.cutoffMonth),
      fechaCorte: resolved.to,
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

    return buildClosingTrialBalance({
      period: resolved,
      rows: allItems.map((item) => ({
        code: item.codigo,
        name: item.nombre,
        debit: item.debitos,
        credit: item.creditos,
        closing: item.saldo,
      })),
      companyName: balanceSheet.empresa ?? '',
      companyNit: balanceSheet.nit,
      currency: 'COP',
    });
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
