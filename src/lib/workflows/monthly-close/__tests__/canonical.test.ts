// canonical.test.ts — Determinismo del payload canónico para el period hash.
// buildCanonicalPayload() es puramente funcional (sin I/O).

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildCanonicalPayload } from '../canonical';
import type { EntryWithLines } from '../canonical';
import type { JournalEntryRow, JournalLineRow } from '@/lib/db/schema';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ZERO_HASH = '0'.repeat(64);

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function makeEntry(overrides: Partial<JournalEntryRow & { lines: JournalLineRow[] }>): EntryWithLines {
  return {
    id: 'entry-1',
    workspaceId: 'ws-1',
    periodId: 'period-1',
    entryNumber: 1,
    entryDate: new Date('2026-01-15T00:00:00.000Z'),
    description: 'Asiento de prueba',
    totalDebit: '1000.00',
    totalCredit: '1000.00',
    status: 'posted',
    sourceType: 'manual',
    sourceId: null,
    sourceRef: null,
    postedAt: new Date('2026-01-15T12:00:00.000Z'),
    postedBy: null,
    reversedBy: null,
    reversalOf: null,
    metadata: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    createdBy: null,
    version: 1,
    lines: [],
    ...overrides,
  } as EntryWithLines;
}

function makeLine(overrides: Partial<JournalLineRow>): JournalLineRow {
  return {
    id: 'line-1',
    journalEntryId: 'entry-1',
    lineNumber: 1,
    accountId: 'acc-a',
    debit: '1000.00',
    credit: '0.00',
    thirdPartyId: null,
    costCenterId: null,
    description: null,
    currency: 'COP',
    exchangeRate: '1',
    functionalDebit: '1000.00',
    functionalCredit: '0.00',
    dimensions: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  } as JournalLineRow;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildCanonicalPayload — determinismo', () => {
  it('0 entries: payload canónico es reproducible y termina con OVERRIDE/PREVIOUS', () => {
    const payload = buildCanonicalPayload([], false, ZERO_HASH);
    expect(payload).toContain('||OVERRIDE=false');
    expect(payload).toContain(`||PREVIOUS=${ZERO_HASH}`);
  });

  it('0 entries: hash es determinístico (sha256 del mismo payload)', () => {
    const payload1 = buildCanonicalPayload([], false, ZERO_HASH);
    const payload2 = buildCanonicalPayload([], false, ZERO_HASH);
    expect(sha256(payload1)).toBe(sha256(payload2));
  });

  it('1 entry con 2 líneas: hash determinístico en llamadas repetidas', () => {
    const lines = [
      makeLine({ id: 'l1', lineNumber: 1, accountId: 'acc-a', debit: '1000.00', credit: '0.00' }),
      makeLine({ id: 'l2', lineNumber: 2, accountId: 'acc-b', debit: '0.00', credit: '1000.00' }),
    ];
    const entry = makeEntry({ lines });

    const p1 = buildCanonicalPayload([entry], false, ZERO_HASH);
    const p2 = buildCanonicalPayload([entry], false, ZERO_HASH);
    expect(sha256(p1)).toBe(sha256(p2));
  });

  it('mismo conjunto de entries en orden distinto → mismo hash (sort por entryNumber)', () => {
    const lineA = [makeLine({ id: 'la1', lineNumber: 1, debit: '500.00', credit: '0.00' })];
    const lineB = [makeLine({ id: 'lb1', lineNumber: 1, debit: '0.00', credit: '500.00' })];

    const entryNum1 = makeEntry({ id: 'e1', entryNumber: 1, lines: lineA });
    const entryNum2 = makeEntry({ id: 'e2', entryNumber: 2, lines: lineB });

    const payloadOrdenado = buildCanonicalPayload([entryNum1, entryNum2], false, ZERO_HASH);
    const payloadDesordenado = buildCanonicalPayload([entryNum2, entryNum1], false, ZERO_HASH);

    expect(sha256(payloadOrdenado)).toBe(sha256(payloadDesordenado));
  });

  it('override=true vs override=false producen hashes distintos', () => {
    const entry = makeEntry({ lines: [makeLine({})] });

    const p1 = buildCanonicalPayload([entry], false, ZERO_HASH);
    const p2 = buildCanonicalPayload([entry], true, ZERO_HASH);
    expect(sha256(p1)).not.toBe(sha256(p2));
  });

  it('previous_hash distinto produce hash distinto (encadenamiento)', () => {
    const entry = makeEntry({ lines: [makeLine({})] });
    const hashA = 'a'.repeat(64);
    const hashB = 'b'.repeat(64);

    const p1 = buildCanonicalPayload([entry], false, hashA);
    const p2 = buildCanonicalPayload([entry], false, hashB);
    expect(sha256(p1)).not.toBe(sha256(p2));
  });

  it('encadenamiento: hash(N) referencia hash(N-1) → cambiar N-1 propaga al N', () => {
    const linesN1 = [makeLine({ id: 'ln1', lineNumber: 1 })];
    const entryN1 = makeEntry({ id: 'e-n1', entryNumber: 1, lines: linesN1 });

    // Hash del período N-1
    const payloadN1 = buildCanonicalPayload([entryN1], false, ZERO_HASH);
    const hashN1 = sha256(payloadN1);

    // Hash del período N referenciando N-1
    const linesN = [makeLine({ id: 'ln-n', lineNumber: 1, accountId: 'acc-nuevo' })];
    const entryN = makeEntry({ id: 'e-n', entryNumber: 1, lines: linesN });
    const payloadN = buildCanonicalPayload([entryN], false, hashN1);
    const hashN = sha256(payloadN);

    // Ahora modificamos N-1 y recalculamos N-1 + N
    const entryN1_modificado = makeEntry({
      id: 'e-n1',
      entryNumber: 1,
      totalDebit: '9999.00',
      totalCredit: '9999.00',
      lines: linesN1,
    });
    const payloadN1_mod = buildCanonicalPayload([entryN1_modificado], false, ZERO_HASH);
    const hashN1_mod = sha256(payloadN1_mod);
    const payloadN_propagado = buildCanonicalPayload([entryN], false, hashN1_mod);
    const hashN_propagado = sha256(payloadN_propagado);

    // El hash de N debe haber cambiado
    expect(hashN_propagado).not.toBe(hashN);
  });

  it('lines dentro de una entry se ordenan por lineNumber (no por orden del array)', () => {
    const lineOrden1 = makeLine({ id: 'l2', lineNumber: 2, accountId: 'acc-b', debit: '0.00', credit: '1000.00' });
    const lineOrden2 = makeLine({ id: 'l1', lineNumber: 1, accountId: 'acc-a', debit: '1000.00', credit: '0.00' });

    const entryDesordenado = makeEntry({ lines: [lineOrden1, lineOrden2] });
    const entryOrdenado = makeEntry({ lines: [lineOrden2, lineOrden1] });

    const p1 = buildCanonicalPayload([entryDesordenado], false, ZERO_HASH);
    const p2 = buildCanonicalPayload([entryOrdenado], false, ZERO_HASH);
    expect(p1).toBe(p2);
  });
});
