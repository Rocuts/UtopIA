// ---------------------------------------------------------------------------
// Validador legacy (Markdown): PÉRDIDA NETA y negativos "($X)"
// ---------------------------------------------------------------------------
// reportes-export-01 (W3-A): con la paridad de superficies el Markdown rotula
// "PÉRDIDA NETA DEL PERÍODO" cuando el resultado es negativo y encierra los
// negativos entre paréntesis con el signo pesos dentro ("($5.000.000,00)",
// `formatCopFromCents(cents, false)`). El chequeo 'Utilidad Neta' sólo buscaba
// "utilidad neta/del ejercicio" y el extractor leía "($X)" como positivo: una
// pérdida mal reportada no se detectaba y una bien reportada generaba un
// aviso falso. El mismo extractor leía un patrimonio negativo "($X)" como
// positivo y la ecuación interna fallaba en duro.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { parseCopAmount, validateConsolidatedReport } from '../report-validator';

function consolidated(lines: string[]): string {
  return [
    '# PARTE I: NIIF',
    '| Rubro | 2025 |',
    '|---|---:|',
    ...lines,
    '# PARTE II: Estrategia',
    '# PARTE III: Gobernanza',
  ].join('\n');
}

const netWarnings = (warnings: string[]) => warnings.filter((w) => w.startsWith('Utilidad Neta'));

describe('parseCopAmount — negativos entre paréntesis con signo pesos', () => {
  it.each([
    ['($1.234,50)', -1234.5],
    ['$(1.234,50)', -1234.5],
    ['( $ 5.000.000,00 )', -5000000],
    ['(1.234)', -1234],
    ['$1.234,50', 1234.5],
  ])('%s → %d', (raw, expected) => {
    expect(parseCopAmount(raw)).toBe(expected);
  });
});

describe("validateConsolidatedReport — chequeo 'Utilidad Neta' con pérdida", () => {
  const totals = { activo: 100000000, pasivo: 40000000, patrimonio: 60000000, utilidadNeta: -5000000 };

  it('PÉRDIDA NETA con cifra distinta del ancla genera aviso', () => {
    const r = validateConsolidatedReport(
      consolidated(['| PÉRDIDA NETA DEL PERÍODO | ($9.000.000,00) |']),
      totals,
    );
    expect(netWarnings(r.warnings)).toHaveLength(1);
    expect(netWarnings(r.warnings)[0]).toContain('-$9.000.000,00');
  });

  it('PÉRDIDA NETA en paréntesis igual al ancla: sin aviso', () => {
    const r = validateConsolidatedReport(
      consolidated(['| PÉRDIDA NETA DEL PERÍODO | ($5.000.000,00) |']),
      totals,
    );
    expect(netWarnings(r.warnings)).toEqual([]);
  });

  it('PÉRDIDA NETA rotulada con la magnitud positiva se lee negativa', () => {
    const r = validateConsolidatedReport(
      consolidated(['| Pérdida neta del ejercicio | $5.000.000,00 |']),
      totals,
    );
    expect(netWarnings(r.warnings)).toEqual([]);
  });

  it('UTILIDAD NETA "($5.000.000,00)" se lee negativa (sin aviso falso)', () => {
    const r = validateConsolidatedReport(
      consolidated(['| UTILIDAD NETA DEL PERÍODO | ($5.000.000,00) |']),
      totals,
    );
    expect(netWarnings(r.warnings)).toEqual([]);
  });

  it('una utilidad positiva sigue comparándose con su signo', () => {
    const r = validateConsolidatedReport(
      consolidated(['| UTILIDAD NETA DEL PERÍODO | $5.000.000,00 |']),
      totals,
    );
    expect(netWarnings(r.warnings)).toHaveLength(1);
  });
});

describe('validateConsolidatedReport — patrimonio negativo "($X)" en la ecuación interna', () => {
  it('Activo 30 = Pasivo 40 + Patrimonio (10): sin error de ecuación interna', () => {
    const r = validateConsolidatedReport(
      consolidated([
        '| TOTAL ACTIVOS | $30.000.000,00 |',
        '| TOTAL PASIVOS | $40.000.000,00 |',
        '| Total patrimonio | ($10.000.000,00) |',
      ]),
      { activo: 30000000, pasivo: 40000000, patrimonio: -10000000, utilidadNeta: -12000000 },
    );
    expect(r.errors.filter((e) => e.startsWith('Ecuacion contable interna'))).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith('Total Patrimonio'))).toEqual([]);
  });
});
