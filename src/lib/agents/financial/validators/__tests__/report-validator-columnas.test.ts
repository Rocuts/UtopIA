// ---------------------------------------------------------------------------
// Validador legacy (Markdown): columna del periodo actual y "PERÍODO"
// ---------------------------------------------------------------------------
// Hallazgo niif-contrato-16 (auditoría 2026-09): extractHeadlineTotal leía la
// ÚLTIMA cifra de la fila —la columna comparativa en un balance de dos
// columnas— y la regla 4b emitía un error duro falso "ECP ↔ Balance". La
// regla 4c buscaba "periodo" sin tilde y el renderer imprime "PERÍODO", así
// que nunca corría.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { validateConsolidatedReport } from '../report-validator';

const totals = { activo: 100000000, pasivo: 40000000, patrimonio: 60000000, utilidadNeta: 20000000 };

function consolidated(extra: string[]): string {
  return [
    '# PARTE I: NIIF',
    '| Rubro | 2025 | 2024 |',
    '|---|---:|---:|',
    '| TOTAL ACTIVOS | $100.000.000,00 | $80.000.000,00 |',
    '| TOTAL PASIVOS | $40.000.000,00 | $35.000.000,00 |',
    '| Total patrimonio | $60.000.000,00 | $45.000.000,00 |',
    ...extra,
    '# PARTE II: Estrategia',
    '# PARTE III: Gobernanza',
  ].join('\n');
}

describe('validateConsolidatedReport — columnas y rótulos (niif-contrato-16)', () => {
  it('no compara el saldo final del ECP 2025 contra el patrimonio 2024 (sin falso error)', () => {
    const md = consolidated([
      '| Movimiento | Total |',
      '|---|---:|',
      '| Saldo final del patrimonio | $60.000.000,00 |',
    ]);
    const r = validateConsolidatedReport(md, totals);
    expect(r.errors.filter((e) => e.startsWith('ECP ↔ Balance'))).toEqual([]);
  });

  it('sí detecta un saldo final del ECP distinto del patrimonio del periodo actual', () => {
    const md = consolidated([
      '| Movimiento | Total |',
      '|---|---:|',
      '| Saldo final del período | $61.000.000,00 |',
    ]);
    const r = validateConsolidatedReport(md, totals);
    expect(r.errors.some((e) => e.startsWith('ECP ↔ Balance'))).toBe(true);
  });

  it('la regla EFE ↔ Caja corre con el rótulo "PERÍODO" que imprime el renderer', () => {
    const md = consolidated([
      '| EFECTIVO AL FINAL DEL PERÍODO | $17.000.000,00 | $10.000.000,00 |',
    ]);
    const r = validateConsolidatedReport(md, { ...totals, efectivoCuenta11: 22000000 });
    expect(r.errors.some((e) => e.startsWith('EFE ↔ Caja'))).toBe(true);
  });
});
