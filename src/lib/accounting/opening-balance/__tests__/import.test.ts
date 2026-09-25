// ingesta-27 / contab-nomina-17: el descuadre del balance de apertura
// bloquea; sólo el redondeo va a 370505 (postable en el PUC sembrado).
import { beforeEach, describe, it, expect, vi } from 'vitest';

const created: Array<{ lines: Array<{ accountId: string; debit: string; credit: string; description?: string | null }> }> = [];
let accounts: Record<string, { id: string; isPostable: boolean }> = {};

vi.mock('@/lib/accounting/chart-of-accounts/queries', () => ({
  getAccount: async (_ws: string, code: string) => accounts[code] ?? null,
}));
vi.mock('@/lib/accounting/double-entry', () => ({
  createEntry: async (input: { lines: Array<{ accountId: string; debit: string; credit: string }> }) => {
    created.push(input);
    const td = input.lines.reduce((s, l) => s + Number(l.debit), 0);
    const tc = input.lines.reduce((s, l) => s + Number(l.credit), 0);
    return {
      entry: { id: 'e1', entryNumber: 1, totalDebit: td.toFixed(2), totalCredit: tc.toFixed(2) },
      lines: input.lines,
    };
  },
}));

import { importOpeningBalance } from '../import';
import { OPENING_ERR, OpeningBalanceError } from '../types';

const BASE = { workspaceId: 'ws', periodId: 'p', entryDate: new Date('2026-01-01T00:00:00Z') };

beforeEach(() => {
  created.length = 0;
  accounts = {
    '11050501': { id: 'acc-caja', isPostable: true },
    '22050101': { id: 'acc-prov', isPostable: true },
    '31050501': { id: 'acc-capital', isPostable: true },
    '3705': { id: 'acc-3705', isPostable: false }, // nivel 3 en el PUC sembrado
    '370505': { id: 'acc-370505', isPostable: true },
  };
});

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(OpeningBalanceError);
    expect((e as OpeningBalanceError).code).toBe(code);
    return e as OpeningBalanceError;
  }
  throw new Error(`se esperaba ${code}`);
}

describe('importOpeningBalance — el descuadre bloquea (ingesta-27)', () => {
  it('una PPE de $400M sin cuenta bloquea (antes se omitía y se cuadraba contra 3705)', async () => {
    const err = await expectCode(
      importOpeningBalance({
        ...BASE,
        lines: [
          { accountCode: '11050501', debitBalance: '100000000.00', creditBalance: '0' },
          { accountCode: '15200101', accountName: 'PPE', debitBalance: '400000000.00', creditBalance: '0' },
          { accountCode: '22050101', debitBalance: '0', creditBalance: '200000000.00' },
          { accountCode: '31050501', debitBalance: '0', creditBalance: '300000000.00' },
        ],
      }),
      OPENING_ERR.UNMAPPED_ACCOUNTS,
    );
    expect((err.details as { unmappedValue: string }).unmappedValue).toBe('400000000.00');
    expect(created).toHaveLength(0);
  });

  it('una cuenta agregadora (no postable) con saldo también bloquea', async () => {
    accounts['1105'] = { id: 'acc-1105', isPostable: false };
    await expectCode(
      importOpeningBalance({
        ...BASE,
        lines: [
          { accountCode: '1105', debitBalance: '1000.00', creditBalance: '0' },
          { accountCode: '31050501', debitBalance: '0', creditBalance: '1000.00' },
        ],
      }),
      OPENING_ERR.UNMAPPED_ACCOUNTS,
    );
  });

  it('descuadre mayor al redondeo bloquea con el detalle (no se absorbe en patrimonio)', async () => {
    const err = await expectCode(
      importOpeningBalance({
        ...BASE,
        lines: [
          { accountCode: '11050501', debitBalance: '1000.00', creditBalance: '0' },
          { accountCode: '31050501', debitBalance: '0', creditBalance: '900.00' },
        ],
      }),
      OPENING_ERR.UNBALANCED,
    );
    expect((err.details as { difference: string }).difference).toBe('100.00');
    expect(created).toHaveLength(0);
  });
});

describe('importOpeningBalance — redondeo a 370505 (contab-nomina-17)', () => {
  it('diferencia ≤ $1 va a 370505 (antes 3705 no postable → NO_BALANCING_ACCOUNT)', async () => {
    const res = await importOpeningBalance({
      ...BASE,
      lines: [
        { accountCode: '11050501', debitBalance: '1000.50', creditBalance: '0' },
        { accountCode: '31050501', debitBalance: '0', creditBalance: '1000.00' },
      ],
    });
    const plug = created[0].lines.find((l) => l.accountId === 'acc-370505');
    expect(plug).toMatchObject({ debit: '0', credit: '0.50' });
    expect(res.totalDebit).toBe(res.totalCredit);
  });

  it('sin 370505 postable ni 3705 postable → NO_BALANCING_ACCOUNT', async () => {
    delete accounts['370505'];
    await expectCode(
      importOpeningBalance({
        ...BASE,
        lines: [
          { accountCode: '11050501', debitBalance: '1000.50', creditBalance: '0' },
          { accountCode: '31050501', debitBalance: '0', creditBalance: '1000.00' },
        ],
      }),
      OPENING_ERR.NO_BALANCING_ACCOUNT,
    );
  });

  it('un balance cuadrado se postea sin línea balanceadora', async () => {
    await importOpeningBalance({
      ...BASE,
      lines: [
        { accountCode: '11050501', debitBalance: '1000.00', creditBalance: '0' },
        { accountCode: '31050501', debitBalance: '0', creditBalance: '1000.00' },
      ],
    });
    expect(created[0].lines).toHaveLength(2);
  });
});
