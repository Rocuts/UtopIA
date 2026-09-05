import { describe, expect, it } from 'vitest';
import { makeCoherentNiifReport } from '../__fixtures__/coherent-niif-report';
import { validateNiifReportJson } from '../validators/niif-json-validator';

describe('Financial integrity regressions on main', () => {
  it('rejects a one-cent change in an ECP cell without its row total changing', () => {
    const report = makeCoherentNiifReport();
    report.equityChanges.rows[1].capitalSocial = '300001';
    expect(validateNiifReportJson(report).errors.some(e => e.startsWith('E17.'))).toBe(true);
  });
  it('does not reject valid EBIT equal to net income when source anchors confirm both', () => {
    const report = makeCoherentNiifReport();
    report.incomeStatement.operatingProfitPrimary = '200000000';
    report.incomeStatement.netIncomePrimary = '200000000';
    const result = validateNiifReportJson(report, {
      bindingPrimaryTotalsCents: { operatingProfit: '200000000', netIncome: '200000000' },
    });
    expect(result.errors.filter(e => e.startsWith('E5.'))).toEqual([]);
  });
  it('accepts correctly summed positive and negative ECP cells', () => {
    const report = makeCoherentNiifReport();
    report.equityChanges.rows[1].capitalSocial = '400000';
    report.equityChanges.rows[1].resultadosAcumulados = '-50000';
    expect(validateNiifReportJson(report).errors.filter(e => e.startsWith('E17.'))).toEqual([]);
  });
});
