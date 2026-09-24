// ---------------------------------------------------------------------------
// promoteEntries — llamada al motor tributario y cuadre antes de createEntry
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-calc-08 / -10, integración IW5b):
//   · transactionDate era `new Date()`: las ventanas de vigencia de las reglas
//     se evaluaban con la fecha de hoy y no con la del grupo.
//   · la suma diaria del libro pyme (valor pagado/cobrado según el soporte) se
//     enviaba como base gravable sin IVA; ahora va con amountIncludesTax.
//   · las líneas del motor reemplazaban todo el asiento (sin gasto ni caja).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  evaluate: vi.fn(),
  createEntry: vi.fn(),
  entries: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/accounting/double-entry', () => ({ createEntry: m.createEntry }));
vi.mock('@/lib/accounting/tax-engine', () => ({ evaluate: m.evaluate }));
vi.mock('../repository', () => ({
  loadConfirmedEntries: vi.fn(async () => m.entries),
  extractBookId: () => 'book-1',
}));
vi.mock('../account-mapper', () => ({
  resolveCajaAccount: vi.fn(async () => ({ id: 'acc-caja', code: '110505', name: 'Caja', requiresCostCenter: false })),
  mapCategoryToAccount: vi.fn(async () => ({
    pymeEntryId: 'x',
    accountId: 'acc-gasto',
    accountCode: '513505',
    accountName: 'Aseo',
    isExact: true,
    fallbackCode: null,
    requiresCostCenter: false,
  })),
}));

import { promoteEntries } from '../index';

beforeEach(() => {
  process.env.UTOPIA_ENABLE_TAX_ENGINE = 'true';
  m.entries = [
    {
      id: 'e-1',
      bookId: 'book-1',
      entryDate: new Date('2026-03-14T12:00:00Z'),
      description: 'Factura proveedor aseo',
      kind: 'egreso',
      amount: '1190000.00',
      category: 'compras',
      pucHint: '5135',
    },
  ];
  m.createEntry.mockReset().mockResolvedValue({ entry: { id: 'je-1' } });
  m.evaluate.mockReset().mockResolvedValue({
    proposedLines: [
      { baseAmountCop: '1000000.00', taxAmountCop: '190000.00', side: 'debit' },
      { baseAmountCop: '1000000.00', taxAmountCop: '25000.00', side: 'credit' },
    ],
    journalLines: [
      { accountId: 'acc-iva', debit: '190000.00', credit: '0.00' },
      { accountId: 'acc-retefuente', debit: '0.00', credit: '25000.00' },
    ],
    totalPayableCop: '1165000.00',
    matchedRuleIds: ['r1', 'r2'],
    summary: '',
    warnings: [],
  });
});

describe('promoteEntries con motor tributario', () => {
  it('evalúa con la fecha del grupo, el total exacto y amountIncludesTax', async () => {
    await promoteEntries({ workspaceId: 'ws-1', pymeEntryIds: ['e-1'], periodId: 'p-1', applyTaxEngine: true });
    const call = m.evaluate.mock.calls[0][0];
    expect(call.transactionDate.toISOString()).toBe('2026-03-14T12:00:00.000Z');
    expect(call.subtotalCop).toBe('1190000.00');
    expect(call.amountIncludesTax).toBe(true);
  });

  it('crea un asiento con gasto, impuestos y caja neta, cuadrado', async () => {
    const r = await promoteEntries({ workspaceId: 'ws-1', pymeEntryIds: ['e-1'], periodId: 'p-1', applyTaxEngine: true });
    expect(r.skipped).toEqual([]);
    const lines = m.createEntry.mock.calls[0][0].lines as Array<{ accountId: string; debit: string; credit: string }>;
    expect(lines.map((l) => l.accountId)).toEqual(['acc-gasto', 'acc-iva', 'acc-retefuente', 'acc-caja']);
    const cents = (s: string) => Math.round(Number(s) * 100);
    expect(lines.reduce((a, l) => a + cents(l.debit), 0)).toBe(lines.reduce((a, l) => a + cents(l.credit), 0));
  });

  it('si el motor devuelve un conjunto que no cuadra, no llama a createEntry y lo reporta', async () => {
    m.evaluate.mockResolvedValueOnce({
      proposedLines: [{ baseAmountCop: '1000000.00' }],
      journalLines: [{ accountId: 'acc-iva', debit: '190000.00', credit: '0.00' }],
      totalPayableCop: '1100000.00',
      matchedRuleIds: [],
      summary: '',
      warnings: [],
    });
    const r = await promoteEntries({ workspaceId: 'ws-1', pymeEntryIds: ['e-1'], periodId: 'p-1', applyTaxEngine: true });
    expect(m.createEntry).not.toHaveBeenCalled();
    expect(r.skipped[0]?.reason).toMatch(/^unbalanced_entry:/);
  });

  it('sin líneas tributarias usa el asiento simple', async () => {
    m.evaluate.mockResolvedValueOnce({
      proposedLines: [],
      journalLines: [],
      totalPayableCop: '1190000.00',
      matchedRuleIds: [],
      summary: '',
      warnings: [],
    });
    await promoteEntries({ workspaceId: 'ws-1', pymeEntryIds: ['e-1'], periodId: 'p-1', applyTaxEngine: true });
    const lines = m.createEntry.mock.calls[0][0].lines as Array<{ accountId: string; debit: string; credit: string }>;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ accountId: 'acc-caja', credit: '1190000.00' });
  });
});
