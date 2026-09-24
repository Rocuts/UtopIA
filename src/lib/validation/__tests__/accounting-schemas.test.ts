// contab-nomina-12: montos de asiento con más de 2 decimales se rechazan en la
// frontera HTTP (NUMERIC(20,2) redondearía lo que el validador truncaba).
import { describe, it, expect } from 'vitest';
import { createEntryBodySchema } from '../accounting-schemas';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

function body(debit: string, credit: string) {
  return {
    periodId: PERIOD,
    entryDate: '2026-02-10',
    description: 'prueba',
    lines: [
      { accountId: UUID_A, debit, credit: '0' },
      { accountId: UUID_B, debit: '0', credit },
    ],
  };
}

describe('createEntryBodySchema — montos', () => {
  it('acepta hasta 2 decimales', () => {
    expect(createEntryBodySchema.safeParse(body('100.5', '100.50')).success).toBe(true);
    expect(createEntryBodySchema.safeParse(body('100', '100')).success).toBe(true);
  });

  it('rechaza más de 2 decimales (antes aceptaba hasta 8)', () => {
    expect(createEntryBodySchema.safeParse(body('100.005', '100.00')).success).toBe(false);
    expect(createEntryBodySchema.safeParse(body('1.12345678', '1.12345678')).success).toBe(false);
  });
});
