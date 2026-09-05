import { describe, expect, it } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '../trial-balance';
const header = 'codigo,nombre,nivel,transaccional,Saldo 2025';
describe('Monetary input limits and row-count invariance', () => {
  it('blocks unsupported cent precision instead of certifying rounded figures', () => {
    const csv = [header, '110505,Caja,Auxiliar,1,150000000000000.01',
      '310505,Capital,Auxiliar,1,150000000000000.01'].join('\n');
    const snapshot = preprocessTrialBalance(parseTrialBalanceCSV(csv)).primary;
    expect(snapshot.validation.blocking).toBe(true);
    expect(snapshot.validation.reasons.join(' ')).toContain('precisión monetaria');
  });
  it('preserves totals when 10000 auxiliary rows are reordered', () => {
    const rows = Array.from({ length: 10000 }, (_, i) =>
      `110505${String(i).padStart(5, '0')},Caja ${i},Auxiliar,1,0.01`);
    const run = (input: string[]) => preprocessTrialBalance(parseTrialBalanceCSV([header,
      ...input, '310505,Capital,Auxiliar,1,100.00'].join('\n'))).primary;
    const original = run(rows); const reordered = run([...rows].reverse());
    expect(original.controlTotals.cents!.activo).toBe(BigInt(10000));
    expect(reordered.controlTotals.cents).toEqual(original.controlTotals.cents);
  });
});
