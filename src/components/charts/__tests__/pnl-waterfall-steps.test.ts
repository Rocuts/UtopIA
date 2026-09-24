// IW4 (ratios-kpis-13 / ratios-kpis-04) — Cascada del Centro de Mando.
//   - La barra "Gastos Fin" recibe todo el grupo 53 (financieros,
//     extraordinarios, diversos) y otros grupos de la clase 5 ≠ 51/52/54: se
//     rotula "No operacionales (53)".
//   - El puente separa los ingresos operacionales (41 − 4175) de los no
//     operacionales (42): la cascada los muestra como barra propia y cierra en
//     la utilidad neta.
import { describe, expect, it } from 'vitest';

import { buildPnlWaterfallSteps } from '../PnLWaterfall';

describe('PnLWaterfall — pasos de la cascada', () => {
  it('rotula el grupo 53 como "No operacionales (53)", no "Gastos Fin"', () => {
    const steps = buildPnlWaterfallSteps({
      ingresos: 2_120,
      costos: 1_200,
      gastosOperacionales: 450,
      gastosFinancieros: 30,
      impuestos: 95,
      utilidadNeta: 345,
    });
    const labels = steps.map((s) => s.label);
    expect(labels).toContain('No operacionales (53)');
    expect(labels).not.toContain('Gastos Fin');
    expect(labels).not.toContain('Otros ingresos (42)');
  });

  it('con otros ingresos (42) añade la barra positiva y cierra en la utilidad neta', () => {
    const steps = buildPnlWaterfallSteps({
      ingresos: 1_920,
      otrosIngresos: 200,
      costos: 1_200,
      gastosOperacionales: 450,
      gastosFinancieros: 30,
      impuestos: 95,
    });
    const otros = steps.find((s) => s.label === 'Otros ingresos (42)')!;
    expect(otros.kind).toBe('positive');
    expect(otros.value).toBe(200);
    // Utilidad neta derivada: 1.920 + 200 − 1.200 − 450 − 30 − 95 = 345.
    expect(steps[steps.length - 1]).toMatchObject({ label: 'Utilidad Neta', value: 345 });
    // El escalón de impuestos termina exactamente en la utilidad neta.
    const imp = steps.find((s) => s.label === 'Impuestos')!;
    expect(imp.offset).toBe(345);
  });
});
