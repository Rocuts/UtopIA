// ---------------------------------------------------------------------------
// Revisión adversarial de F-preproceso (ICU-03 × recalculo-final2-01).
//
// Con la fecha del encabezado (ICU-03) aparecen etiquetas AAAA-MM en balances
// de saldo inicial / final que antes quedaban en el año. Tres regresiones:
//  1. "Saldo anterior | Saldo a 30/06/2025": la apertura sin año se rotulaba
//     "current_anterior" (el año base sólo miraba etiquetas AAAA) y, como las
//     etiquetas sin fecha se ordenan al final, la APERTURA pasaba a ser el
//     periodo primario del informe.
//  2. "Saldo inicial 01/06/2025 | Saldo final 30/06/2025": la apertura quedaba
//     en "2025" (= diciembre) y también pasaba a ser el primario.
//  3. Un corte anterior del MISMO ejercicio ("Saldo a 30/11/2025 | Saldo a
//     31/12/2025", o la apertura "Saldo inicial 30/11/2025") disparaba CUR-R12
//     "P&G acumulado": el P&G del año corrido a esa fecha nunca está en el
//     patrimonio y no es un ejercicio anterior sin cerrar.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { parseUploadedTrialBalanceText } from '../raw-data';
import { parseTrialBalanceCSVWithMeta, preprocessTrialBalance } from '../trial-balance';

// Balance mensual honesto: apertura con el P&G del año corrido (sin cierre,
// año en curso), final con un mes más de movimientos. 3705 = ejercicio
// anterior ya cerrado. A = P + K + resultado en ambas columnas.
const FILAS: Array<[string, string, number, number]> = [
  ['11050501', 'Caja', 600_000_000, 630_000_000],
  ['15200101', 'Equipo', 500_000_000, 500_000_000],
  ['22050101', 'Proveedores', 300_000_000, 300_000_000],
  ['31050501', 'Capital', 400_000_000, 400_000_000],
  ['37050501', 'Utilidades acumuladas', 100_000_000, 100_000_000],
  ['41350501', 'Ventas', 1_100_000_000, 1_200_000_000],
  ['61350501', 'Costo de ventas', 600_000_000, 650_000_000],
  ['51050601', 'Sueldos', 200_000_000, 220_000_000],
];
const csv = (apertura: string, cierre: string) =>
  [`codigo,nombre,${apertura},${cierre}`, ...FILAS.map(([c, n, a, b]) => `${c},${n},${a},${b}`)].join('\n');
const leer = (texto: string) => {
  const parsed = parseUploadedTrialBalanceText(texto);
  return preprocessTrialBalance(parsed.rows, { openingPeriods: parsed.openingPeriods });
};
const cur12 = (pp: ReturnType<typeof preprocessTrialBalance>) =>
  (pp.primary.validation.curatorBlockingReasons ?? []).filter((r) => r.startsWith('[CUR-R12]'));

describe('fecha del encabezado con columna de apertura (revisión F-preproceso)', () => {
  it.each(['Saldo a 30/06/2025', 'Saldo junio 2025', 'Saldo 2025-06'])(
    '"Saldo anterior | %s": el primario es el cierre 2025-06, nunca la apertura',
    (cierre) => {
      const meta = parseTrialBalanceCSVWithMeta(csv('Saldo anterior', cierre));
      expect(meta.balanceColumns.map((c) => c.period)).toEqual(['2024', '2025-06']);
      const pp = leer(csv('Saldo anterior', cierre));
      expect(pp.primary.period).toBe('2025-06');
      expect(pp.primary.saldosDeApertura).not.toBe(true);
      expect(pp.primary.controlTotals.utilidadNeta).toBe(330_000_000);
      expect(pp.comparative?.saldosDeApertura).toBe(true);
      expect(cur12(pp)).toEqual([]);
    },
  );

  it('"Saldo inicial 01/06/2025 | Saldo final 30/06/2025": apertura = cierre de mayo (2025-05), primario 2025-06', () => {
    const meta = parseTrialBalanceCSVWithMeta(csv('Saldo inicial 01/06/2025', 'Saldo final 30/06/2025'));
    expect(meta.balanceColumns.map((c) => c.period)).toEqual(['2025-05', '2025-06']);
    const pp = leer(csv('Saldo inicial 01/06/2025', 'Saldo final 30/06/2025'));
    expect(pp.primary.period).toBe('2025-06');
    expect(pp.primary.controlTotals.utilidadNeta).toBe(330_000_000);
    expect(cur12(pp)).toEqual([]);
  });

  it('"Saldo inicial 2025 | Saldo final 30/06/2025": la apertura del año es el cierre 2024 y el primario el corte', () => {
    const meta = parseTrialBalanceCSVWithMeta(csv('Saldo inicial 2025', 'Saldo final 30/06/2025'));
    expect(meta.balanceColumns.map((c) => c.period)).toEqual(['2024', '2025-06']);
    expect(leer(csv('Saldo inicial 2025', 'Saldo final 30/06/2025')).primary.period).toBe('2025-06');
  });

  it.each([
    ['Saldo inicial junio 2025', 'Saldo final junio 2025', ['2025-05', '2025-06']],
    ['Saldo inicial diciembre 2025', 'Saldo final diciembre 2025', ['2025-11', '2025']],
  ])('apertura y cierre con el mismo mes ("%s | %s"): la apertura es el mes anterior, sin colisión', (a, b, esperado) => {
    const meta = parseTrialBalanceCSVWithMeta(csv(a, b));
    expect(meta.balanceColumns.map((c) => c.period)).toEqual(esperado);
    const pp = leer(csv(a, b));
    expect(pp.primary.period).toBe(esperado[1]);
    expect(pp.primary.validation.reasons.some((r) => /mismo periodo/.test(r))).toBe(false);
    expect(cur12(pp).some((r) => /ACUMULAD/.test(r))).toBe(false);
  });

  it.each([
    ['Saldo a 30/11/2025', 'Saldo a 31/12/2025'],
    ['Saldo inicial 30/11/2025', 'Saldo final 31/12/2025'],
    ['Saldo inicial 01/12/2025', 'Saldo final 31/12/2025'],
  ])('corte anterior del mismo ejercicio ("%s | %s"): sin CUR-R12 de P&G acumulado', (a, b) => {
    const pp = leer(csv(a, b));
    expect(pp.primary.period).toBe('2025');
    expect(pp.comparative?.period).toBe('2025-11');
    expect(pp.primary.closingDetectorAudit?.pygAcumulado).toBeUndefined();
    expect(cur12(pp).some((r) => /ACUMULAD/.test(r))).toBe(false);
  });

  it('control: la apertura del ejercicio sin cerrar sigue bloqueando (recalculo-final2-01)', () => {
    const pp = leer(csv('Saldo inicial 2025', 'Saldo final 2025'));
    expect(pp.comparative?.period).toBe('2024');
    expect(pp.primary.closingDetectorAudit?.pygAcumulado?.utilidadMovimientoRaw).toBe('30000000.00');
    const [motivo] = cur12(pp).filter((r) => /ACUMULAD/.test(r));
    expect(motivo).toContain('$30.000.000,00');
    // La salida para un balance mensual no depende de rotular el periodo con el mes.
    expect(motivo).toMatch(/1 de enero/);
  });
});
