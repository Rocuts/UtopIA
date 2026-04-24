// ---------------------------------------------------------------------------
// ERP Adapter — single-tenant facade over one provider + credentials pair
// ---------------------------------------------------------------------------
// Normaliza la API de todos los connectors detras de una superficie coherente
// con periodos tipados y errores clasificables. No cachea (eso vive en
// ERPService). No compone (eso vive en ERPPipeline).
// ---------------------------------------------------------------------------

import { getConnector } from './registry';
import type {
  ERPProvider,
  ERPCredentials,
  ERPTrialBalance,
  ERPJournalEntry,
  ERPInvoice,
  ERPContact,
  ERPAccount,
} from './types';

// ---------------------------------------------------------------------------
// Period spec
// ---------------------------------------------------------------------------

export type PeriodSpec = string | { from: string; to: string };

export interface ResolvedPeriod {
  from: string;
  to: string;
  label: string;
}

// WHY: los connectors toman `period: string` (anio, Q, mes) para trial balance,
// y `dateFrom/dateTo` para invoices/journal_entries. Mantenemos ambos vectores
// coherentes desde una sola PeriodSpec.
export function resolvePeriod(spec: PeriodSpec): ResolvedPeriod {
  if (typeof spec === 'object' && spec !== null) {
    return { from: spec.from, to: spec.to, label: `${spec.from}..${spec.to}` };
  }

  const value = String(spec).trim();

  const monthMatch = value.match(/^(\d{4})-(\d{1,2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    const lastDay = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    return {
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
      label: `${year}-${mm}`,
    };
  }

  const quarterMatch = value.match(/^(\d{4})-Q([1-4])$/i);
  if (quarterMatch) {
    const year = parseInt(quarterMatch[1], 10);
    const quarter = parseInt(quarterMatch[2], 10);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return {
      from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      to: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      label: `${year}-Q${quarter}`,
    };
  }

  const yearMatch = value.match(/^(\d{4})$/);
  if (yearMatch) {
    return {
      from: `${yearMatch[1]}-01-01`,
      to: `${yearMatch[1]}-12-31`,
      label: yearMatch[1],
    };
  }

  // Fallback: tratamos el valor como fecha puntual (ISO) — el caller sabra.
  return { from: value, to: value, label: value };
}

// ---------------------------------------------------------------------------
// Error typing
// ---------------------------------------------------------------------------

export type ERPAdapterErrorCode = 'auth' | 'network' | 'not_supported' | 'unknown';

export class ERPAdapterError extends Error {
  readonly code: ERPAdapterErrorCode;
  readonly provider: ERPProvider;
  readonly operation: string;

  constructor(
    code: ERPAdapterErrorCode,
    provider: ERPProvider,
    operation: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'ERPAdapterError';
    this.code = code;
    this.provider = provider;
    this.operation = operation;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function classifyError(err: unknown): ERPAdapterErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (/(401|403|unauthori[sz]ed|forbidden|invalid.*token|expired)/i.test(lower)) return 'auth';
  if (/(econnref|enotfound|fetch failed|timeout|aborted|network)/i.test(lower)) return 'network';
  if (/(not.*support|not.*implement|unsupported)/i.test(lower)) return 'not_supported';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface ERPAdapterOptions {
  provider: ERPProvider;
  credentials: ERPCredentials;
}

export interface InvoiceFilters {
  period?: PeriodSpec;
  dateFrom?: string;
  dateTo?: string;
}

export class ERPAdapter {
  readonly provider: ERPProvider;
  private readonly credentials: ERPCredentials;

  constructor({ provider, credentials }: ERPAdapterOptions) {
    this.provider = provider;
    // WHY: normalizamos que credentials.provider coincida con provider para
    // que los connectors (que esperan ERPCredentials.provider) no rompan.
    this.credentials = { ...credentials, provider };
  }

  async fetchTrialBalance(period: PeriodSpec): Promise<ERPTrialBalance> {
    const resolved = resolvePeriod(period);
    return this.invoke('fetchTrialBalance', async () => {
      const connector = await getConnector(this.provider);
      return connector.getTrialBalance(this.credentials, resolved.label);
    });
  }

  async fetchInvoices(filters: InvoiceFilters = {}): Promise<ERPInvoice[]> {
    const range = this.rangeFromFilters(filters);
    return this.invoke('fetchInvoices', async () => {
      const connector = await getConnector(this.provider);
      return connector.getInvoices(this.credentials, range.from, range.to);
    });
  }

  async fetchContacts(): Promise<ERPContact[]> {
    return this.invoke('fetchContacts', async () => {
      const connector = await getConnector(this.provider);
      return connector.getContacts(this.credentials);
    });
  }

  async fetchJournalEntries(period: PeriodSpec): Promise<ERPJournalEntry[]> {
    const resolved = resolvePeriod(period);
    return this.invoke('fetchJournalEntries', async () => {
      const connector = await getConnector(this.provider);
      return connector.getJournalEntries(this.credentials, resolved.from, resolved.to);
    });
  }

  async fetchChartOfAccounts(): Promise<ERPAccount[]> {
    return this.invoke('fetchChartOfAccounts', async () => {
      const connector = await getConnector(this.provider);
      return connector.getChartOfAccounts(this.credentials);
    });
  }

  async testConnection(): Promise<boolean> {
    return this.invoke('testConnection', async () => {
      const connector = await getConnector(this.provider);
      return connector.testConnection(this.credentials);
    });
  }

  private rangeFromFilters(filters: InvoiceFilters): ResolvedPeriod {
    if (filters.dateFrom && filters.dateTo) {
      return {
        from: filters.dateFrom,
        to: filters.dateTo,
        label: `${filters.dateFrom}..${filters.dateTo}`,
      };
    }
    if (filters.period) return resolvePeriod(filters.period);
    // Default: anio en curso — consistente con la tool query_erp existente.
    return resolvePeriod(new Date().getFullYear().toString());
  }

  private async invoke<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      throw new ERPAdapterError(code, this.provider, operation, message, { cause: err });
    }
  }
}
