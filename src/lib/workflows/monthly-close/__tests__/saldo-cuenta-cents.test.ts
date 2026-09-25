// contab-nomina-25 — el saldo del período de una cuenta se calcula en
// centavos BigInt: la resta en float perdía centavos con montos grandes.
import { describe, expect, it, vi } from 'vitest';

const row = vi.hoisted(() => ({ current: { totalDebit: '0', totalCredit: '0' } }));

vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: async () => [row.current],
  });
  return { getDb: () => chain };
});

import { getAccountPeriodBalance } from '../repository';

describe('getAccountPeriodBalance — MoneyCop', () => {
  it('conserva los centavos con saldos por encima de 2^53 centavos', async () => {
    row.current = { totalDebit: '123456789012345678.91', totalCredit: '0.02' };
    await expect(getAccountPeriodBalance('ws', 'p', 'a')).resolves.toBe('123456789012345678.89');
  });

  it('saldo acreedor con signo y dos decimales', async () => {
    row.current = { totalDebit: '0.10', totalCredit: '0.30' };
    await expect(getAccountPeriodBalance('ws', 'p', 'a')).resolves.toBe('-0.20');
  });
});
