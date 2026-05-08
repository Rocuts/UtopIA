/**
 * ERP integration public surface.
 *
 * Barrel re-export so consumers do:
 *   import { getErpConnector, type ErpProvider } from '@/lib/erp'
 *
 * The concrete connectors live in ./providers/* and are lazy-loaded by
 * `getConnector` (registry.ts) via dynamic import to keep the initial
 * bundle small.
 *
 * `getErpConnector` is an alias for `getConnector` (registry.ts) that
 * matches the import contract expected by the eventing/sync layer.
 */

export { getConnector as getErpConnector } from './registry';
export { ERP_PROVIDERS, getProvidersByCountry } from './registry';
export type { ERPProvider as ErpProvider, ERPCredentials, ERPTrialBalance } from './types';
export { ERPAdapter, resolvePeriod } from './adapter';
export type { PeriodSpec } from './adapter';
export { ERPService } from './service';
export type { ERPServiceConnection, ERPServiceResult } from './service';
export { pullTrialBalanceForPeriod } from './pipeline';
export type { ERPConnectorInterface } from './connector';
