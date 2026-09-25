// ---------------------------------------------------------------------------
// niif-preproceso-32 — la clase 7 (costos de producción u operación) se resta
// íntegra del resultado del periodo (4 − 5 − 6 − 7, la validación de la
// referencia PUC del repo). El PUC la describe como costos "que se acumulan
// para luego trasladar a inventarios y costo de ventas"
// (src/data/tax_docs/puc_pymes_2026.json, clase 7): restarla completa supone
// que todo se trasladó al costo de ventas. El supuesto se revela; las cifras
// no cambian.
// ---------------------------------------------------------------------------
import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSVWithMeta, preprocessTrialBalance } from '../trial-balance';

const base = [
  'codigo,nombre,nivel,Saldo 2025',
  '110505,Caja,Auxiliar,400000',
  '141005,Productos en proceso,Auxiliar,100000',
  '220505,Proveedores,Auxiliar,100000',
  '310505,Capital,Auxiliar,300000',
  '413505,Ventas,Auxiliar,600000',
  '613505,Costo de ventas,Auxiliar,200000',
];
const pp = (lines: string[]) => preprocessTrialBalance(parseTrialBalanceCSVWithMeta(lines.join('\n')).rows).primary;

describe('niif-preproceso-32 — supuesto de traslado de la clase 7', () => {
  it('con clase 7: la utilidad no cambia y la nota revela el supuesto con el monto y los inventarios 1410/1430', () => {
    const s = pp([...base, '710505,Materia prima consumida,Auxiliar,300000']);
    expect(s.controlTotals.utilidadNeta).toBe(100000);
    const nota = s.validation.adjustments.find((a) => /clase 7/.test(a));
    expect(nota).toBeDefined();
    expect(nota).toMatch(/\$300\.000/);
    expect(nota).toMatch(/1410/);
    expect(nota).toMatch(/subestimad/);
    expect(nota).toMatch(/puc_pymes_2026|Decreto 2650/);
  });

  it('sin clase 7: sin nota (no regresión)', () => {
    const s = pp(base);
    expect(s.validation.adjustments.some((a) => /clase 7/.test(a))).toBe(false);
  });
});
