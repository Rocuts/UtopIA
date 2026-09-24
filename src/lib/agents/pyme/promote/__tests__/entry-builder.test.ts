// ---------------------------------------------------------------------------
// entry-builder — asiento del grupo con líneas del motor tributario
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-calc-10, integración IW5b). Cuando el motor
// tributario devolvía líneas, el builder REEMPLAZABA todo el asiento por
// ellas: el asiento quedaba sin la cuenta de gasto/ingreso ni la caja (sólo
// IVA y retenciones, que no cuadran entre sí). Ahora combina línea base +
// líneas de impuesto + contrapartida neta (totalPayableCop) y valida el cuadre
// antes de devolver el input para createEntry.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  buildGroupEntry,
  groupTotalNumeric,
  parseDateKey,
  PromoteUnbalancedError,
} from '../entry-builder';
import type { EntryGroup } from '../types';

const group = (kind: 'ingreso' | 'egreso', amounts: string[]): EntryGroup => ({
  dateKey: '2026-03-14',
  kind,
  entries: amounts.map((amount, i) => ({
    id: `e-${i}`,
    bookId: 'book-1',
    entryDate: new Date('2026-03-14T12:00:00Z'),
    description: `Factura proveedor ${i}`,
    kind,
    amount,
    category: 'compras',
    pucHint: '5135',
  })),
});

const base = {
  periodId: 'p-1',
  workspaceId: 'ws-1',
  bookId: 'book-1',
  cajaAccountId: 'acc-caja',
  primaryAccountId: 'acc-gasto',
  primaryCostCenterId: 'cc-1',
};

function sums(lines: Array<{ debit: string; credit: string }>) {
  const c = (s: string) => Math.round(Number(s) * 100);
  return {
    debit: lines.reduce((a, l) => a + c(l.debit), 0),
    credit: lines.reduce((a, l) => a + c(l.credit), 0),
  };
}

describe('buildGroupEntry — sin motor tributario', () => {
  it('egreso: débito gasto / crédito caja por el total exacto del grupo', () => {
    const { input } = buildGroupEntry({ ...base, group: group('egreso', ['1190000.00', '0.10', '0.20']) });
    expect(input.lines).toHaveLength(2);
    expect(input.lines[0]).toMatchObject({ accountId: 'acc-gasto', debit: '1190000.30', credit: '0.00', costCenterId: 'cc-1' });
    expect(input.lines[1]).toMatchObject({ accountId: 'acc-caja', debit: '0.00', credit: '1190000.30' });
  });

  it('usa la fecha del grupo como fecha del asiento', () => {
    const { input } = buildGroupEntry({ ...base, group: group('egreso', ['100.00']) });
    expect(input.entryDate.toISOString()).toBe('2026-03-14T12:00:00.000Z');
  });
});

describe('buildGroupEntry — con líneas del motor tributario', () => {
  // Compra con IVA incluido: total 1.190.000 → base 1.000.000, IVA 190.000,
  // ReteFuente compras 2,5 % = 25.000 → neto a pagar 1.165.000.
  const taxEngine = {
    baseAmountCop: '1000000.00',
    totalPayableCop: '1165000.00',
    taxLines: [
      { accountId: 'acc-iva', debit: '190000.00', credit: '0.00', description: 'IVA descontable' },
      { accountId: 'acc-retefuente', debit: '0.00', credit: '25000.00', description: 'ReteFuente compras' },
    ],
  };

  it('egreso: combina gasto (base) + IVA + retención + caja por el neto, y cuadra', () => {
    const { input } = buildGroupEntry({ ...base, group: group('egreso', ['1190000.00']), taxEngine });
    const ids = input.lines.map((l) => l.accountId);
    expect(ids).toEqual(['acc-gasto', 'acc-iva', 'acc-retefuente', 'acc-caja']);
    expect(input.lines[0]).toMatchObject({ debit: '1000000.00', credit: '0.00', costCenterId: 'cc-1' });
    expect(input.lines[3]).toMatchObject({ debit: '0.00', credit: '1165000.00' });
    const s = sums(input.lines);
    expect(s.debit).toBe(s.credit);
  });

  it('ingreso: caja por el neto al débito, ingreso (base) e IVA generado al crédito', () => {
    const venta = {
      baseAmountCop: '1000000.00',
      totalPayableCop: '1190000.00',
      taxLines: [{ accountId: 'acc-iva', debit: '0.00', credit: '190000.00' }],
    };
    const { input } = buildGroupEntry({
      ...base,
      primaryAccountId: 'acc-ingreso',
      group: group('ingreso', ['1190000.00']),
      taxEngine: venta,
    });
    expect(input.lines.map((l) => l.accountId)).toEqual(['acc-caja', 'acc-ingreso', 'acc-iva']);
    expect(input.lines[0]).toMatchObject({ debit: '1190000.00', credit: '0.00' });
    expect(input.lines[1]).toMatchObject({ debit: '0.00', credit: '1000000.00' });
    const s = sums(input.lines);
    expect(s.debit).toBe(s.credit);
  });

  it('no devuelve un asiento descuadrado: lanza PromoteUnbalancedError', () => {
    const roto = { ...taxEngine, totalPayableCop: '1100000.00' };
    expect(() => buildGroupEntry({ ...base, group: group('egreso', ['1190000.00']), taxEngine: roto })).toThrow(
      PromoteUnbalancedError,
    );
  });

  it('rechaza una contrapartida no positiva', () => {
    const cero = { ...taxEngine, totalPayableCop: '0.00' };
    expect(() => buildGroupEntry({ ...base, group: group('egreso', ['1190000.00']), taxEngine: cero })).toThrow(
      PromoteUnbalancedError,
    );
  });
});

describe('helpers', () => {
  it('groupTotalNumeric suma en centavos exactos', () => {
    expect(groupTotalNumeric(group('egreso', ['0.10', '0.20', '1000000']))).toBe('1000000.30');
  });

  it('parseDateKey devuelve mediodía UTC del día del grupo', () => {
    expect(parseDateKey('2026-12-31').toISOString()).toBe('2026-12-31T12:00:00.000Z');
  });
});
