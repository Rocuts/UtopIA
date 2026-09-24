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

import { resolvePeriod, type PeriodSpec, type ResolvedPeriod } from './period';

// ---------------------------------------------------------------------------
// Period spec — la resolución vive en ./period (compartida con los conectores).
// ---------------------------------------------------------------------------

export { resolvePeriod };
export type { PeriodSpec, ResolvedPeriod };


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
