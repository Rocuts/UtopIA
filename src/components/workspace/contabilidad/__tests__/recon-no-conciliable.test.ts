// Auditoría 2026-09 (contab-nomina-09, integración IW5b). Sin extracto del
// período la cuenta no es conciliable: bankBalanceCop = null, differenceCop =
// 'N/D' (RECON_NOT_AVAILABLE), reconcilable = false y `reason`. La vista debía
// decirlo («No conciliable — sin extracto del período» + motivo) y tratar 'N/D'
// como bloqueante; antes pintaba 'N/D' como número y el color salía de NaN.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { RECON_NOT_AVAILABLE } from '@/lib/accounting/banking/types';
import { dict } from '@/lib/i18n/dictionaries';
import { diffColor, isNotReconcilable } from '../recon-display';

describe('conciliación no conciliable', () => {
  it('detecta N/D por reconcilable=false, por differenceCop o por saldo de extracto nulo', () => {
    expect(isNotReconcilable({ reconcilable: false, differenceCop: RECON_NOT_AVAILABLE, bankBalanceCop: null })).toBe(true);
    expect(isNotReconcilable({ reconcilable: undefined, differenceCop: RECON_NOT_AVAILABLE, bankBalanceCop: '10.00' })).toBe(true);
    expect(isNotReconcilable({ reconcilable: true, differenceCop: '0.00', bankBalanceCop: null })).toBe(true);
    expect(isNotReconcilable({ reconcilable: true, differenceCop: '0.00', bankBalanceCop: '100.00' })).toBe(false);
  });

  it('diffColor trata N/D como bloqueante y no como diferencia cero', () => {
    expect(diffColor(false, RECON_NOT_AVAILABLE)).toBe('text-red-400');
    expect(diffColor(true, '0.00')).toBe('text-emerald-400');
    expect(diffColor(true, '1500.00')).toBe('text-red-400');
    expect(diffColor(false, '0.50')).toBe('text-amber-400');
  });

  it('ReconciliationView muestra el rótulo y el motivo con los helpers', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/workspace/contabilidad/ReconciliationView.tsx'),
      'utf8',
    );
    expect(src).toMatch(/from '\.\/recon-display'/);
    expect(src).toMatch(/isNotReconcilable\(status\)/);
    expect(src).toMatch(/rt\.notReconcilable/);
    expect(src).toMatch(/status\.reason/);
    expect(src).not.toMatch(/function diffColor\(/);
  });

  it('el rótulo existe en es y en', () => {
    expect(dict.es.accounting.reconciliation.notReconcilable).toBe('No conciliable — sin extracto del período');
    expect(dict.en.accounting.reconciliation.notReconcilable).toMatch(/Not reconcilable/);
  });
});
