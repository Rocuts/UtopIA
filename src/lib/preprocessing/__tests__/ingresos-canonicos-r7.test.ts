// ---------------------------------------------------------------------------
// recalculo-final2-05 — R7 (costo presunto), el informe de validación y el
// Doctor de Datos leían `controlTotals.ingresos`: la Σ firmada de la clase 4,
// que suma la devolución 4175 como ingreso cuando el ERP la exporta con el
// signo de su naturaleza (débito, +). El mismo balance disparaba o no la
// advertencia 'alto' y publicaba 'Ingresos' distintos según la exportación.
// Base canónica: ingresos operacionales netos (grupo 41 − 4175) para el margen
// bruto, e ingresos netos (clase 4 neta de 4175) como base de la utilidad neta.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { executeRepairTool } from '@/lib/agents/repair/tools';
import { buildRepairSystemPrompt } from '@/lib/agents/repair/prompt';
import type { RecheckValidationOutput } from '@/lib/agents/repair/types';
import { parseUploadedTrialBalanceText } from '../raw-data';
import { preprocessTrialBalance } from '../trial-balance';

const M = (m: number) => String(m * 1_000_000);
// Ventas 1.000, devoluciones 100 → ingresos netos 900; costo 150 → margen bruto
// real 83,3 % (< 85 %). Inventario 600 (> 50 % de 900). 3605 = 700.
const ROWS: Array<[string, string, number]> = [
  ['110505', 'Caja', 400],
  ['143505', 'Mercancias', 600],
  ['310505', 'Capital', 300],
  ['360505', 'Utilidad del ejercicio', 700],
  ['413505', 'Ventas', 1000],
  ['417505', 'Devoluciones en ventas', 100],
  ['510506', 'Sueldos', 50],
  ['613505', 'Costo de ventas', 150],
];
const NATURAL = ['codigo,nombre,nivel,Saldo 2025', ...ROWS.map((r) => `${r[0]},${r[1]},Auxiliar,${M(r[2])}`)].join('\n');
const DEBITO_CREDITO = [
  'codigo,nombre,nivel,Saldo debito 2025,Saldo credito 2025',
  ...ROWS.map((r) => {
    const debito = '1567'.includes(r[0][0]) || r[0].startsWith('4175');
    return `${r[0]},${r[1]},Auxiliar,${debito ? M(r[2]) : '0'},${debito ? '0' : M(r[2])}`;
  }),
].join('\n');

const pp = (csv: string) => preprocessTrialBalance(parseUploadedTrialBalanceText(csv).rows);

describe('recalculo-final2-05 — ingresos canónicos en R7, informe de validación y Doctor', () => {
  it('las dos exportaciones tienen los mismos ingresos netos (control)', () => {
    const a = pp(NATURAL).primary.controlTotals.cents!;
    const b = pp(DEBITO_CREDITO).primary.controlTotals.cents!;
    expect(a.ingresosNetos).toBe(BigInt(90_000_000_000));
    expect(b.ingresosNetos).toBe(a.ingresosNetos);
  });

  it.each([
    { exportacion: 'natural', csv: NATURAL },
    { exportacion: 'débito/crédito', csv: DEBITO_CREDITO },
  ])('$exportacion: R7 no se dispara con margen bruto 83,3 % sobre ingresos operacionales netos', ({ csv }) => {
    const s = pp(csv).primary;
    expect((s.curator?.findings ?? []).filter((f) => f.code === 'CUR-R7')).toEqual([]);
    expect(s.presumedCostWarning).toBeUndefined();
  });

  it('R7 se dispara con la base neta cuando el margen sobre ingresos netos supera 85 %', () => {
    // Costo 100 → margen 88,9 % sobre 900 (y 90,9 % sobre la Σ firmada 1.100).
    const csv = NATURAL.replace(`613505,Costo de ventas,Auxiliar,${M(150)}`, `613505,Costo de ventas,Auxiliar,${M(100)}`).replace(
      `360505,Utilidad del ejercicio,Auxiliar,${M(700)}`,
      `360505,Utilidad del ejercicio,Auxiliar,${M(750)}`,
    ).replace(`110505,Caja,Auxiliar,${M(400)}`, `110505,Caja,Auxiliar,${M(450)}`);
    const s = pp(csv).primary;
    const r7 = (s.curator?.findings ?? []).find((f) => f.code === 'CUR-R7');
    expect(r7?.description).toContain('88.9%');
    expect(r7?.description).toContain('Ingresos operacionales netos $900.000.000');
    expect(s.presumedCostWarning?.presumedCogsCop).toBe(540_000_000);
  });

  it('el informe de validación publica los mismos ingresos en las dos exportaciones', () => {
    const lineas = (csv: string) => pp(csv).validationReport.split('\n').filter((l) => /\*\*Ingresos/.test(l));
    const natural = lineas(NATURAL);
    expect(natural.join('\n')).toContain('$900.000.000');
    expect(natural.join('\n')).not.toContain('1.100.000.000');
    expect(lineas(DEBITO_CREDITO)).toEqual(natural);
  });

  it('Doctor de Datos: prompt y recheck_validation con los ingresos canónicos', async () => {
    for (const csv of [NATURAL, DEBITO_CREDITO]) {
      const pre = pp(csv);
      const prompt = buildRepairSystemPrompt(
        { language: 'es', companyName: 'Demo', period: '2025', rawCsv: csv } as never,
        pre,
      );
      const ingresos = prompt.split('\n').filter((l) => /^- Ingresos/.test(l));
      expect(ingresos.join('\n')).toContain('900.000.000');
      expect(ingresos.join('\n')).not.toContain('1.100.000.000');
      const out = (await executeRepairTool('recheck_validation', {}, {
        preprocessed: pre,
        language: 'es',
        adjustments: [],
      })) as RecheckValidationOutput;
      expect(out.controlTotals.ingresos).toBe(900_000_000);
      expect(out.controlTotals.ingresos - out.controlTotals.gastos).toBe(out.controlTotals.utilidadNeta);
    }
  });
});
