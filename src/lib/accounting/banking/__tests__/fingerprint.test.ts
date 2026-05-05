// fingerprint.test.ts — Idempotencia del hash de transacciones bancarias.
// Todas estas funciones son puras (crypto.createHash) → tests < 10ms cada uno.

import { describe, it, expect } from 'vitest';
import { fingerprintTransaction, sha256Hex } from '../fingerprint';
import type { ParsedBankTransaction } from '../types';

// ── Helper ────────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<ParsedBankTransaction>): ParsedBankTransaction {
  return {
    postedAt: new Date('2026-01-15T00:00:00Z'),
    description: 'Transferencia Bancolombia',
    amountCop: '1000000.00',
    ...overrides,
  };
}

const ACCOUNT_ID = 'acc-001';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fingerprintTransaction — determinismo', () => {
  it('mismo input → mismo hash (idempotencia básica)', () => {
    const tx = makeTx({});
    const h1 = fingerprintTransaction(tx, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('descripción con espacios extra normaliza igual que sin espacios', () => {
    const tx1 = makeTx({ description: 'Pago  servicio   agua' });
    const tx2 = makeTx({ description: 'Pago servicio agua' });
    const h1 = fingerprintTransaction(tx1, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx2, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('descripción con espacios al inicio y al final normaliza igual', () => {
    const tx1 = makeTx({ description: '  Recaudo factura 123  ' });
    const tx2 = makeTx({ description: 'Recaudo factura 123' });
    const h1 = fingerprintTransaction(tx1, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx2, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('misma hora distinto día → hash distinto', () => {
    const tx1 = makeTx({ postedAt: new Date('2026-01-15T10:00:00Z') });
    const tx2 = makeTx({ postedAt: new Date('2026-01-16T10:00:00Z') });
    const h1 = fingerprintTransaction(tx1, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx2, ACCOUNT_ID);
    expect(h1).not.toBe(h2);
  });

  it('mismo monto distinto banco (bankAccountId) → hash distinto', () => {
    const tx = makeTx({});
    const h1 = fingerprintTransaction(tx, 'acc-bancolombia');
    const h2 = fingerprintTransaction(tx, 'acc-davivienda');
    expect(h1).not.toBe(h2);
  });

  it('monto "1000" y "1000.00" producen el mismo hash (normalización a fixed(2))', () => {
    const tx1 = makeTx({ amountCop: '1000' });
    const tx2 = makeTx({ amountCop: '1000.00' });
    const h1 = fingerprintTransaction(tx1, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx2, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });

  it('descripción con caracteres latin-1 / acentos produce hash estable', () => {
    const tx = makeTx({ description: 'Pago nómina empleados año 2026' });
    const h1 = fingerprintTransaction(tx, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx, ACCOUNT_ID);
    // Mismo objeto → mismo hash
    expect(h1).toBe(h2);
    // Hash debe ser 64 caracteres hex
    expect(h1).toHaveLength(64);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('descripción > 80 chars se trunca (no afecta a los primeros 80 chars)', () => {
    const base80 = 'A'.repeat(80);
    const tx1 = makeTx({ description: base80 });
    const tx2 = makeTx({ description: base80 + 'EXTRA_QUE_SE_TRUNCA' });
    const h1 = fingerprintTransaction(tx1, ACCOUNT_ID);
    const h2 = fingerprintTransaction(tx2, ACCOUNT_ID);
    expect(h1).toBe(h2);
  });
});

describe('sha256Hex', () => {
  it('produce string de 64 caracteres hex', () => {
    const h = sha256Hex('test-input');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('string vacío produce hash determinístico conocido', () => {
    const h = sha256Hex('');
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
