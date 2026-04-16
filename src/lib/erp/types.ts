// ─── ERP Integration Types ────────────────────────────────────────────────────

export type ERPProvider =
  | 'alegra'
  | 'siigo'
  | 'helisa'
  | 'world_office'
  | 'contapyme'
  | 'sap_b1'
  | 'dynamics_365'
  | 'quickbooks'
  | 'xero'
  | 'odoo';

export interface ERPProviderInfo {
  id: ERPProvider;
  name: string;
  country: 'colombia' | 'international';
  logo?: string;
  authType: 'basic' | 'bearer' | 'oauth2' | 'hmac' | 'session' | 'jsonrpc';
  baseUrl: string;
  docsUrl: string;
  supportsPUC: boolean;
  supportsDIAN: boolean;
  capabilities: ERPCapability[];
}

export type ERPCapability =
  | 'chart_of_accounts'
  | 'journal_entries'
  | 'trial_balance'
  | 'balance_sheet'
  | 'income_statement'
  | 'invoices'
  | 'contacts'
  | 'products'
  | 'bank_accounts'
  | 'payments'
  | 'cost_centers'
  | 'taxes'
  | 'webhooks';

export interface ERPCredentials {
  provider: ERPProvider;
  // Generic fields — each provider uses a subset
  apiKey?: string;
  apiToken?: string;
  username?: string;
  password?: string;
  companyId?: string;
  baseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  databaseName?: string;
}

export interface ERPConnection {
  id: string;
  provider: ERPProvider;
  companyName: string;
  companyNit?: string;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  lastSync?: string;
  error?: string;
  createdAt: string;
}

// ─── Normalized Financial Data ────────────────────────────────────────────────
// All connectors normalize ERP data into these shared types.

export interface ERPAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cost';
  pucClass?: number;
  balance: number;
  debit: number;
  credit: number;
  level: number;
  parentCode?: string;
  isAuxiliary: boolean;
}

export interface ERPTrialBalance {
  period: string;
  companyName: string;
  companyNit?: string;
  currency: string;
  accounts: ERPAccount[];
  totalDebit: number;
  totalCredit: number;
  generatedAt: string;
}

export interface ERPJournalEntry {
  id: string;
  date: string;
  description: string;
  reference?: string;
  lines: ERPJournalLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface ERPJournalLine {
  accountCode: string;
  accountName: string;
  description?: string;
  debit: number;
  credit: number;
  costCenter?: string;
  thirdParty?: string;
}

export interface ERPInvoice {
  id: string;
  number: string;
  date: string;
  dueDate?: string;
  type: 'sale' | 'purchase';
  contactName: string;
  contactNit?: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'overdue' | 'cancelled';
  cufe?: string;
}

export interface ERPContact {
  id: string;
  name: string;
  nit?: string;
  type: 'customer' | 'supplier' | 'both';
  email?: string;
  phone?: string;
  city?: string;
}

// ─── Sync Result ──────────────────────────────────────────────────────────────

export interface ERPSyncResult {
  provider: ERPProvider;
  success: boolean;
  data?: {
    trialBalance?: ERPTrialBalance;
    journalEntries?: ERPJournalEntry[];
    invoices?: ERPInvoice[];
    contacts?: ERPContact[];
    chartOfAccounts?: ERPAccount[];
  };
  error?: string;
  syncedAt: string;
  recordCount: number;
}
