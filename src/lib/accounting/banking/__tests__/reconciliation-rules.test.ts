// contab-nomina-09 / -11: reglas puras de conciliación.
import { afterEach, describe, it, expect } from 'vitest';
import {
  isReconciliationBlocking,
  reconciliationFigures,
  reconciliationStatusFor,
} from '../types';

afterEach(() => {
  delete process.env.UTOPIA_BANK_RECON_TOLERANCE_COP;
});

describe('tolerancia de conciliación (contab-nomina-11)', () => {
  it('sin componente relativo: $1.000.000 de diferencia con $1.000 M en libros SÍ bloquea (antes no)', () => {
    expect(isReconciliationBlocking('1000000.00', '1000000000.00')).toBe(true);
  });

  it('por defecto la tolerancia es 0; es configurable en pesos absolutos', () => {
    expect(isReconciliationBlocking('0.01')).toBe(true);
    expect(isReconciliationBlocking('0.00')).toBe(false);
    process.env.UTOPIA_BANK_RECON_TOLERANCE_COP = '1000';
    expect(isReconciliationBlocking('-999.99')).toBe(false);
    expect(isReconciliationBlocking('1000.01')).toBe(true);
  });

  it("'balanced' sólo con diferencia exactamente 0 y sin pendientes", () => {
    process.env.UTOPIA_BANK_RECON_TOLERANCE_COP = '1000';
    expect(reconciliationStatusFor('500.00', 0)).toBe('open');
    expect(reconciliationStatusFor('0.00', 0)).toBe('balanced');
    expect(reconciliationStatusFor('0.00', 2)).toBe('open');
    expect(reconciliationStatusFor(null, 0)).toBe('open');
  });

  it('aritmética exacta en centavos (sin float)', () => {
    expect(reconciliationFigures('9007199254740993.01', '9007199254740993.00').difference).toBe('0.01');
  });
});

describe('sin saldo de extracto → no conciliable (contab-nomina-09)', () => {
  it('no se usa 0 como saldo bancario: diferencia N/D y bloquea', () => {
    const f = reconciliationFigures('6500000.00', null);
    expect(f.difference).toBeNull();
    expect(f.reconcilable).toBe(false);
    expect(f.blocking).toBe(true);
    expect(isReconciliationBlocking(null)).toBe(true);
  });

  it('con extracto: libros − extracto', () => {
    expect(reconciliationFigures('6500000.00', '6500000.00')).toMatchObject({
      difference: '0.00',
      blocking: false,
      reconcilable: true,
    });
  });
});
