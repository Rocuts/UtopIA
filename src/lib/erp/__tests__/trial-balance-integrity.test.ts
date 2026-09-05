import { describe, expect, it, vi } from 'vitest';
import { trialBalanceToCSV, trialBalanceToRawRows } from '../trial-balance-serialization';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import type { ERPTrialBalance } from '../types';
vi.mock('../adapter', () => ({
  resolvePeriod: (period: string) => ({ label: period }),
  ERPAdapter: class {
    constructor(private config: { credentials: { companyId: string } }) {}
    async fetchTrialBalance() { return { companyName: this.config.credentials.companyId }; }
  },
}));
import { ERPService, type ERPServiceConnection } from '../service';
const balance = (period = '2025'): ERPTrialBalance => ({
  period, currency: 'COP', companyName: 'Prueba SAS', totalDebit: 100, totalCredit: 100,
  generatedAt: '2026-09-05T00:00:00Z', accounts: [{
    code: '110505', name: 'Caja, "principal"\nBogotá', type: 'asset', pucClass: 1,
    balance: 123.45, debit: 123.45, credit: 0, level: 6, isAuxiliary: true,
  }],
});
describe('ERP data integrity', () => {
  it.each(['2025', '2026-01', '2026-Q2', '2026-01-01..2026-02-28'])('preserves period %s through CSV and direct rows', period => {
    const tb = balance(period);
    const csvRows = parseTrialBalanceCSV(trialBalanceToCSV(tb));
    const directRows = trialBalanceToRawRows(tb);
    expect(csvRows).toHaveLength(1);
    expect(csvRows[0].balancesByPeriod).toEqual(directRows[0].balancesByPeriod);
    expect(csvRows[0].name).toContain('Caja,');
    expect(preprocessTrialBalance(csvRows).primary.period).toBe(period);
  });
  it('rejects foreign currency instead of treating it as COP', () => {
    expect(() => trialBalanceToCSV({ ...balance(), currency: 'USD' })).toThrow(/conversión/);
    expect(() => trialBalanceToRawRows({ ...balance(), currency: 'EUR' })).toThrow(/conversión/);
  });
  it('rejects non-finite balances and unsafe monetary magnitudes', () => {
    for (const amount of [NaN, Infinity, 150000000000000.01]) {
      const tb = balance(); tb.accounts[0].balance = amount;
      expect(() => trialBalanceToCSV(tb)).toThrow(/precisión/);
    }
  });
  it('does not return another company cached under the same ERP provider', async () => {
    const connection = (id: string): ERPServiceConnection => ({ id, provider: 'siigo',
      companyName: id, status: 'connected', createdAt: '2026-09-05',
      credentials: { provider: 'siigo', companyId: id } });
    const a = connection('company-A'); const b = connection('company-B');
    const service = new ERPService([a, b]);
    expect((await service.fetchTrialBalance('2025')).data?.companyName).toBe('company-A');
    a.status = 'disconnected';
    expect((await service.fetchTrialBalance('2025')).data?.companyName).toBe('company-B');
  });
});
