// ---------------------------------------------------------------------------
// ERP Service — multi-connection orchestration with request-scoped cache
// ---------------------------------------------------------------------------
// Capa sobre ERPAdapter que selecciona la conexion primaria, intenta fallback
// sobre todas las conexiones disponibles (tryAll) y memoiza resultados dentro
// de una sola request para evitar golpear dos veces la misma API del ERP.
// ---------------------------------------------------------------------------

import { ERPAdapter, resolvePeriod, type PeriodSpec } from './adapter';
import type {
  ERPConnection,
  ERPCredentials,
  ERPTrialBalance,
  ERPInvoice,
  ERPContact,
  ERPJournalEntry,
  ERPAccount,
} from './types';

// ---------------------------------------------------------------------------
// Input type — ERPConnection + credentials emparejados por el caller.
// Se mantiene separado para no acoplar el tipo `ERPConnection` original.
// ---------------------------------------------------------------------------

export interface ERPServiceConnection extends ERPConnection {
  credentials: ERPCredentials;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface ERPServiceResult<T> {
  data: T | null;
  source: { provider: string; connectedAt: string } | null;
  warnings: string[];
}

export type ERPOperation =
  | 'trial_balance'
  | 'invoices'
  | 'contacts'
  | 'journal_entries'
  | 'chart_of_accounts';

export interface ERPStatus {
  provider: string;
  companyName: string;
  status: ERPConnection['status'];
  lastSync?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ERPService {
  private readonly connections: ERPServiceConnection[];
  private readonly adapters = new Map<string, ERPAdapter>();
  private readonly cache = new Map<string, unknown>();

  constructor(connections: ERPServiceConnection[]) {
    // WHY: filtramos por `connected` al pickPrimary, pero conservamos todas
    // las conexiones aqui para permitir tryAll sobre estados transitorios.
    this.connections = [...connections];
  }

  pickPrimary(): ERPServiceConnection | null {
    const connected = this.connections.find((c) => c.status === 'connected');
    if (connected) return connected;
    return this.connections[0] ?? null;
  }

  getStatus(): ERPStatus[] {
    return this.connections.map((c) => ({
      provider: c.provider,
      companyName: c.companyName,
      status: c.status,
      lastSync: c.lastSync,
    }));
  }

  async fetchTrialBalance(period: PeriodSpec): Promise<ERPServiceResult<ERPTrialBalance>> {
    const label = resolvePeriod(period).label;
    return this.runOnPrimary('trial_balance', label, (adapter) => adapter.fetchTrialBalance(period));
  }

  async fetchInvoices(period: PeriodSpec): Promise<ERPServiceResult<ERPInvoice[]>> {
    const label = resolvePeriod(period).label;
    return this.runOnPrimary('invoices', label, (adapter) => adapter.fetchInvoices({ period }));
  }

  async fetchContacts(): Promise<ERPServiceResult<ERPContact[]>> {
    return this.runOnPrimary('contacts', 'all', (adapter) => adapter.fetchContacts());
  }

  async fetchJournalEntries(period: PeriodSpec): Promise<ERPServiceResult<ERPJournalEntry[]>> {
    const label = resolvePeriod(period).label;
    return this.runOnPrimary('journal_entries', label, (adapter) =>
      adapter.fetchJournalEntries(period),
    );
  }

  async fetchChartOfAccounts(): Promise<ERPServiceResult<ERPAccount[]>> {
    return this.runOnPrimary('chart_of_accounts', 'all', (adapter) =>
      adapter.fetchChartOfAccounts(),
    );
  }

  /**
   * Intenta `op` sobre TODAS las conexiones en orden (primaria primero).
   * La primera que responda con exito gana. Los errores se acumulan como
   * warnings. Util para cuando no sabemos cual ERP tiene el dato.
   */
  async tryAll<T>(
    op: ERPOperation,
    fn: (adapter: ERPAdapter) => Promise<T>,
    periodLabel = 'all',
  ): Promise<ERPServiceResult<T>> {
    const warnings: string[] = [];
    const ordered = this.orderedByPrimary();

    if (ordered.length === 0) {
      return {
        data: null,
        source: null,
        warnings: ['No hay conexiones ERP configuradas.'],
      };
    }

    for (const conn of ordered) {
      const cacheKey = `${conn.provider}:${op}:${periodLabel}`;
      const cached = this.cache.get(cacheKey) as T | undefined;
      if (cached !== undefined) {
        return {
          data: cached,
          source: { provider: conn.provider, connectedAt: conn.createdAt },
          warnings,
        };
      }

      try {
        const adapter = this.getAdapter(conn);
        const data = await fn(adapter);
        this.cache.set(cacheKey, data);
        return {
          data,
          source: { provider: conn.provider, connectedAt: conn.createdAt },
          warnings,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${conn.provider}: ${msg}`);
      }
    }

    return { data: null, source: null, warnings };
  }

  private async runOnPrimary<T>(
    op: ERPOperation,
    periodLabel: string,
    fn: (adapter: ERPAdapter) => Promise<T>,
  ): Promise<ERPServiceResult<T>> {
    const primary = this.pickPrimary();
    if (!primary) {
      return {
        data: null,
        source: null,
        warnings: ['No hay conexion ERP primaria disponible.'],
      };
    }

    const cacheKey = `${primary.provider}:${op}:${periodLabel}`;
    const cached = this.cache.get(cacheKey) as T | undefined;
    if (cached !== undefined) {
      return {
        data: cached,
        source: { provider: primary.provider, connectedAt: primary.createdAt },
        warnings: [],
      };
    }

    try {
      const adapter = this.getAdapter(primary);
      const data = await fn(adapter);
      this.cache.set(cacheKey, data);
      return {
        data,
        source: { provider: primary.provider, connectedAt: primary.createdAt },
        warnings: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        data: null,
        source: null,
        warnings: [`${primary.provider}: ${msg}`],
      };
    }
  }

  private getAdapter(conn: ERPServiceConnection): ERPAdapter {
    if (!this.adapters.has(conn.id)) {
      this.adapters.set(
        conn.id,
        new ERPAdapter({ provider: conn.provider, credentials: conn.credentials }),
      );
    }
    return this.adapters.get(conn.id)!;
  }

  private orderedByPrimary(): ERPServiceConnection[] {
    const primary = this.pickPrimary();
    if (!primary) return [];
    const rest = this.connections.filter((c) => c.id !== primary.id);
    return [primary, ...rest];
  }
}
