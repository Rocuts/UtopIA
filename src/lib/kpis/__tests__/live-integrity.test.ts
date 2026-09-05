import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/storage/conversation-history', () => ({ listReports: vi.fn(() => []) }));
import { listReports } from '@/lib/storage/conversation-history';
import { getDashboardKpis, getRegulatoryHealth } from '../live';

describe('Dashboard: no synthetic metrics', () => {
  it('missing sources yield null, never demo amounts, scores or historical curves', async () => {
    for (const kpi of Object.values(await getDashboardKpis())) {
      expect(kpi.value).toBeNull();
      expect(kpi.source).toBe('unavailable');
      expect(kpi.sparkline).toEqual([]);
      expect(kpi.reason).toBeTruthy();
    }
  });
  it('unavailable storage does not invent healthy scores', async () => {
    vi.mocked(listReports).mockImplementationOnce(() => { throw new Error('storage unavailable'); });
    expect((await getRegulatoryHealth()).value).toBeNull();
  });
  it('partial audits do not default missing domains to 90 or favorable', async () => {
    expect((await getRegulatoryHealth([], { updatedAt: '2026-09-05', niifScore: 90 })).value).toBeNull();
  });
  it('complete explicit audit inputs calculate the documented weighted score', async () => {
    const kpi = await getRegulatoryHealth([], {
      updatedAt: '2026-09-01T00:00:00Z', niifScore: 95, taxScore: 92, legalScore: 90,
      findings: { critico: 0, alto: 2, medio: 5 }, opinion: 'favorable',
    });
    expect(kpi.value).toBe(89);
    expect(kpi.source).toBe('report');
    expect(kpi.updatedAt).toBe('2026-09-01T00:00:00Z');
    expect(kpi.sparkline).toEqual([]);
  });
  it('rejects invalid audit scores and preserves a measured zero', async () => {
    const digest = { updatedAt: '2026-09-05', niifScore: 0, taxScore: 0, legalScore: 0,
      findings: { critico: 10, alto: 0, medio: 0 }, opinion: 'desfavorable' as const };
    expect((await getRegulatoryHealth([], digest)).value).toBe(0);
    expect((await getRegulatoryHealth([], { ...digest, taxScore: NaN })).value).toBeNull();
  });
});
