// validate.test.ts — Partida doble: validator de balance en BigInt-centavos.
// Cubre: balance feliz, descuadres, restricciones de línea, reversals, precisión.

import { describe, it, expect } from 'vitest';
import { validateBalance, buildReversalLines } from '../validate';
import { DoubleEntryError, ERR } from '../../types';
import type { JournalLineInput } from '../../types';

// ── Helpers de fábrica ────────────────────────────────────────────────────────

function debitLine(accountId: string, amount: string): JournalLineInput {
  return { accountId, debit: amount, credit: '0' };
}

function creditLine(accountId: string, amount: string): JournalLineInput {
  return { accountId, debit: '0', credit: amount };
}

// ── Casos felices ─────────────────────────────────────────────────────────────

describe('validateBalance — casos felices', () => {
  it('2 líneas balanceadas pasan validación', () => {
    const result = validateBalance([
      debitLine('acc-gasto', '1000000.00'),
      creditLine('acc-cxp', '1000000.00'),
    ]);
    expect(result.totalDebit).toBe('1000000.00');
    expect(result.totalCredit).toBe('1000000.00');
  });

  it('5 líneas balanceadas (publicidad con IVA + RTF + ICA + CxP) pasan', () => {
    // Gasto base 1.000.000 → IVA 190.000, RTF 40.000, ICA 11.000
    // CxP = 1.000.000 + 190.000 - 40.000 - 11.000 = 1.139.000
    const lines: JournalLineInput[] = [
      debitLine('acc-gasto', '1000000.00'),   // gasto publicidad
      debitLine('acc-iva-desc', '190000.00'), // IVA descontable
      creditLine('acc-rtf', '40000.00'),      // ReteFuente
      creditLine('acc-ica', '11000.00'),      // ICA
      creditLine('acc-cxp', '1139000.00'),    // CxP neta
    ];
    const result = validateBalance(lines);
    expect(result.totalDebit).toBe('1190000.00');
    expect(result.totalCredit).toBe('1190000.00');
  });

  it('montos con 1 decimal se normalizan correctamente a 2 decimales', () => {
    const result = validateBalance([
      debitLine('acc-a', '1000.5'),
      creditLine('acc-b', '1000.5'),
    ]);
    expect(result.totalDebit).toBe('1000.50');
    expect(result.totalCredit).toBe('1000.50');
  });

  it('strings con 3 decimales se truncan a 2 (no redondean)', () => {
    // "1234.567" → 123456 centavos (trunca el 7)
    // "1234.563" → 123456 centavos (trunca el 3)
    // Ambas truncan igual → balance exacto
    const result = validateBalance([
      debitLine('acc-a', '1234.567'),
      creditLine('acc-b', '1234.563'),
    ]);
    // 1234.56 === 1234.56 → balance
    expect(result.totalDebit).toBe('1234.56');
    expect(result.totalCredit).toBe('1234.56');
  });

  it('suma BigInt exacta: 0.10 + 0.20 === 0.30 sin error de flotante', () => {
    // IEEE-754: 0.1 + 0.2 = 0.30000000000000004 → falla con Number.
    // Con BigInt centavos: 10 + 20 = 30 → exacto.
    const result = validateBalance([
      debitLine('acc-a', '0.10'),
      debitLine('acc-a', '0.20'),
      creditLine('acc-b', '0.30'),
    ]);
    expect(result.totalDebit).toBe('0.30');
    expect(result.totalCredit).toBe('0.30');
  });

  it('montos enteros sin punto decimal son aceptados', () => {
    const result = validateBalance([
      debitLine('acc-a', '500'),
      creditLine('acc-b', '500'),
    ]);
    expect(result.totalDebit).toBe('500.00');
    expect(result.totalCredit).toBe('500.00');
  });
});

// ── Casos de error: desbalance ────────────────────────────────────────────────

describe('validateBalance — desbalance', () => {
  it('descuadre por 1 centavo rechaza con ERR.UNBALANCED', () => {
    expect(() =>
      validateBalance([
        debitLine('acc-a', '1000.01'),
        creditLine('acc-b', '1000.00'),
      ]),
    ).toThrow(DoubleEntryError);

    try {
      validateBalance([
        debitLine('acc-a', '1000.01'),
        creditLine('acc-b', '1000.00'),
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(DoubleEntryError);
      expect((e as DoubleEntryError).code).toBe(ERR.UNBALANCED);
    }
  });

  it('descuadre grande incluye detalle en el error', () => {
    try {
      validateBalance([
        debitLine('acc-a', '5000000.00'),
        creditLine('acc-b', '4000000.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(DoubleEntryError);
      expect((e as DoubleEntryError).code).toBe(ERR.UNBALANCED);
      const details = (e as DoubleEntryError).details as { totalDebit: string; totalCredit: string };
      expect(details.totalDebit).toBe('5000000.00');
      expect(details.totalCredit).toBe('4000000.00');
    }
  });
});

// ── Casos de error: líneas inválidas ─────────────────────────────────────────

describe('validateBalance — líneas inválidas', () => {
  it('solo 1 línea rechaza con ERR.INVALID_LINES', () => {
    expect(() =>
      validateBalance([debitLine('acc-a', '100.00')]),
    ).toThrow(DoubleEntryError);

    try {
      validateBalance([debitLine('acc-a', '100.00')]);
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('array vacío rechaza con ERR.INVALID_LINES', () => {
    try {
      validateBalance([]);
    } catch (e) {
      expect(e).toBeInstanceOf(DoubleEntryError);
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('línea con débito Y crédito > 0 rechaza con ERR.INVALID_LINES', () => {
    try {
      validateBalance([
        { accountId: 'acc-a', debit: '100.00', credit: '100.00' },
        creditLine('acc-b', '100.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('línea con débito Y crédito ambos = 0 rechaza con ERR.INVALID_LINES', () => {
    try {
      validateBalance([
        { accountId: 'acc-a', debit: '0', credit: '0' },
        creditLine('acc-b', '100.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('monto negativo rechaza con ERR.INVALID_LINES', () => {
    try {
      validateBalance([
        { accountId: 'acc-a', debit: '-100.00', credit: '0' },
        creditLine('acc-b', '100.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('monto con signo positivo explícito rechaza', () => {
    try {
      validateBalance([
        { accountId: 'acc-a', debit: '+100.00', credit: '0' },
        creditLine('acc-b', '100.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });

  it('accountId vacío rechaza con ERR.INVALID_LINES', () => {
    try {
      validateBalance([
        { accountId: '', debit: '100.00', credit: '0' },
        creditLine('acc-b', '100.00'),
      ]);
      expect.fail('Debería haber lanzado');
    } catch (e) {
      expect((e as DoubleEntryError).code).toBe(ERR.INVALID_LINES);
    }
  });
});

// ── buildReversalLines ────────────────────────────────────────────────────────

describe('buildReversalLines', () => {
  it('invierte débito↔crédito y conserva accountId', () => {
    const original: JournalLineInput[] = [
      { accountId: 'acc-gasto', debit: '1000.00', credit: '0', thirdPartyId: 'prov-1', costCenterId: 'cc-ventas' },
      { accountId: 'acc-cxp', debit: '0', credit: '1000.00', thirdPartyId: 'prov-1', costCenterId: null },
    ];
    const reversed = buildReversalLines(original);
    expect(reversed).toHaveLength(2);

    // Primera línea era débito → ahora crédito
    expect(reversed[0].accountId).toBe('acc-gasto');
    expect(reversed[0].debit).toBe('0');
    expect(reversed[0].credit).toBe('1000.00');
    expect(reversed[0].thirdPartyId).toBe('prov-1');
    expect(reversed[0].costCenterId).toBe('cc-ventas');

    // Segunda línea era crédito → ahora débito
    expect(reversed[1].accountId).toBe('acc-cxp');
    expect(reversed[1].debit).toBe('1000.00');
    expect(reversed[1].credit).toBe('0');
  });

  it('prefija descripción con "REVERSO: " cuando existe', () => {
    const original: JournalLineInput[] = [
      { accountId: 'acc-a', debit: '500.00', credit: '0', description: 'Pago proveedor' },
      { accountId: 'acc-b', debit: '0', credit: '500.00', description: null },
    ];
    const reversed = buildReversalLines(original);
    expect(reversed[0].description).toBe('REVERSO: Pago proveedor');
    expect(reversed[1].description).toBe('REVERSO');
  });

  it('las líneas revertidas son balanceadas si las originales lo eran', () => {
    const original: JournalLineInput[] = [
      { accountId: 'acc-a', debit: '250.00', credit: '0' },
      { accountId: 'acc-b', debit: '750.00', credit: '0' },
      { accountId: 'acc-c', debit: '0', credit: '1000.00' },
    ];
    const reversed = buildReversalLines(original);
    // Debería balancear sin lanzar
    expect(() => validateBalance(reversed)).not.toThrow();
  });
});
