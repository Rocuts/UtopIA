// ─── ERP Provider Registry ────────────────────────────────────────────────────
// Central registry of all available ERP connectors and their metadata.

import type { ERPProvider, ERPProviderInfo } from './types';
import type { BaseERPConnector } from './connector';

// ─── Provider Metadata ────────────────────────────────────────────────────────

export const ERP_PROVIDERS: Record<ERPProvider, ERPProviderInfo> = {
  alegra: {
    id: 'alegra',
    name: 'Alegra',
    country: 'colombia',
    authType: 'basic',
    baseUrl: 'https://api.alegra.com/api/v1',
    docsUrl: 'https://developer.alegra.com/',
    supportsPUC: true,
    supportsDIAN: true,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts', 'bank_accounts', 'payments', 'cost_centers', 'taxes', 'webhooks'],
  },
  siigo: {
    id: 'siigo',
    name: 'Siigo',
    country: 'colombia',
    authType: 'bearer',
    baseUrl: 'https://services.siigo.com/alliances/api',
    docsUrl: 'https://developers.siigo.com/docs/siigoapi/',
    supportsPUC: true,
    supportsDIAN: true,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts', 'products'],
  },
  helisa: {
    id: 'helisa',
    name: 'Helisa',
    country: 'colombia',
    authType: 'hmac',
    baseUrl: '',
    docsUrl: 'https://helisa.com/api/',
    supportsPUC: true,
    supportsDIAN: true,
    capabilities: ['chart_of_accounts', 'trial_balance', 'balance_sheet', 'income_statement', 'contacts', 'journal_entries'],
  },
  world_office: {
    id: 'world_office',
    name: 'World Office',
    country: 'colombia',
    authType: 'bearer',
    baseUrl: '',
    docsUrl: 'https://developer.worldoffice.cloud/',
    supportsPUC: true,
    supportsDIAN: true,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts'],
  },
  contapyme: {
    id: 'contapyme',
    name: 'ContaPyme',
    country: 'colombia',
    authType: 'bearer',
    baseUrl: '',
    docsUrl: 'https://www.contapyme.com/info-api/',
    supportsPUC: true,
    supportsDIAN: true,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts'],
  },
  sap_b1: {
    id: 'sap_b1',
    name: 'SAP Business One',
    country: 'international',
    authType: 'session',
    baseUrl: '',
    docsUrl: 'https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html',
    supportsPUC: false,
    supportsDIAN: false,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts', 'products'],
  },
  dynamics_365: {
    id: 'dynamics_365',
    name: 'Microsoft Dynamics 365',
    country: 'international',
    authType: 'oauth2',
    baseUrl: 'https://api.businesscentral.dynamics.com/v2.0/',
    docsUrl: 'https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/',
    supportsPUC: false,
    supportsDIAN: false,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts'],
  },
  quickbooks: {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    country: 'international',
    authType: 'oauth2',
    baseUrl: 'https://quickbooks.api.intuit.com/v3/',
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/trialbalance',
    supportsPUC: false,
    supportsDIAN: false,
    capabilities: ['chart_of_accounts', 'trial_balance', 'balance_sheet', 'income_statement', 'journal_entries', 'invoices', 'contacts', 'webhooks'],
  },
  xero: {
    id: 'xero',
    name: 'Xero',
    country: 'international',
    authType: 'oauth2',
    baseUrl: 'https://api.xero.com/api.xro/2.0/',
    docsUrl: 'https://developer.xero.com/documentation/api/accounting/overview',
    supportsPUC: false,
    supportsDIAN: false,
    capabilities: ['chart_of_accounts', 'trial_balance', 'journal_entries', 'invoices', 'contacts', 'webhooks'],
  },
  odoo: {
    id: 'odoo',
    name: 'Odoo',
    country: 'international',
    authType: 'jsonrpc',
    baseUrl: '',
    docsUrl: 'https://www.odoo.com/documentation/19.0/developer/reference/external_api.html',
    supportsPUC: true,
    supportsDIAN: false,
    capabilities: ['chart_of_accounts', 'journal_entries', 'invoices', 'contacts', 'products'],
  },
};

// ─── Connector Factory ────────────────────────────────────────────────────────

const connectorCache = new Map<ERPProvider, BaseERPConnector>();

export async function getConnector(provider: ERPProvider): Promise<BaseERPConnector> {
  if (connectorCache.has(provider)) {
    return connectorCache.get(provider)!;
  }

  let connector: BaseERPConnector;

  switch (provider) {
    case 'alegra': {
      const { AlegraConnector } = await import('./providers/alegra');
      connector = new AlegraConnector();
      break;
    }
    case 'siigo': {
      const { SiigoConnector } = await import('./providers/siigo');
      connector = new SiigoConnector();
      break;
    }
    case 'helisa': {
      const { HelisaConnector } = await import('./providers/helisa');
      connector = new HelisaConnector();
      break;
    }
    case 'world_office': {
      const { WorldOfficeConnector } = await import('./providers/world-office');
      connector = new WorldOfficeConnector();
      break;
    }
    case 'contapyme': {
      const { ContaPymeConnector } = await import('./providers/contapyme');
      connector = new ContaPymeConnector();
      break;
    }
    case 'sap_b1': {
      const { SAPConnector } = await import('./providers/sap');
      connector = new SAPConnector();
      break;
    }
    case 'dynamics_365': {
      const { DynamicsConnector } = await import('./providers/dynamics');
      connector = new DynamicsConnector();
      break;
    }
    case 'quickbooks': {
      const { QuickBooksConnector } = await import('./providers/quickbooks');
      connector = new QuickBooksConnector();
      break;
    }
    case 'xero': {
      const { XeroConnector } = await import('./providers/xero');
      connector = new XeroConnector();
      break;
    }
    case 'odoo': {
      const { OdooConnector } = await import('./providers/odoo');
      connector = new OdooConnector();
      break;
    }
    default:
      throw new Error(`Unknown ERP provider: ${provider}`);
  }

  connectorCache.set(provider, connector);
  return connector;
}

/** List all providers grouped by country */
export function getProvidersByCountry() {
  const colombian = Object.values(ERP_PROVIDERS).filter(p => p.country === 'colombia');
  const international = Object.values(ERP_PROVIDERS).filter(p => p.country === 'international');
  return { colombian, international };
}
