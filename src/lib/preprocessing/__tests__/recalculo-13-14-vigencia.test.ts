// ---------------------------------------------------------------------------
// Verificación de vigencia (fase 2, P4): recalculo-13 y recalculo-14 quedaron
// corregidos por la separación del grupo 42 (niif-preproceso-24 /
// ratios-kpis-04) y por R12 sobre ingresos netos (recalculo-final-05). Estas
// pruebas fijan el comportamiento corregido.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseTrialBalanceCSVWithMeta, preprocessTrialBalance } from '../trial-balance';

const pp = (csv: string) => preprocessTrialBalance(parseTrialBalanceCSVWithMeta(csv).rows).primary;

describe('recalculo-13 — el grupo 42 (no operacionales) queda fuera del EBIT y del margen operativo', () => {
  const base = [
    'codigo,nombre,nivel,Saldo 2025',
    '110505,Caja,Auxiliar,1450000000',
    '310505,Capital,Auxiliar,1000000000',
    '413505,Ventas,Auxiliar,1240000000',
    '613505,Costo de ventas,Auxiliar,600000000',
    '510506,Sueldos,Auxiliar,190000000',
  ];

  it('+$100M en 421005 sube la utilidad neta pero no el EBIT ni el margen operativo', () => {
    const sin = pp(base.join('\n')).controlTotals;
    const con = pp(
      [...base.slice(0, 1), '110505,Caja,Auxiliar,1550000000', ...base.slice(2), '421005,Intereses,Auxiliar,100000000'].join(
        '\n',
      ),
    ).controlTotals;
    expect(con.utilidadNeta).toBe(sin.utilidadNeta + 100_000_000);
    expect(con.ebit).toBe(sin.ebit);
    expect(con.ebit).toBe(450_000_000);
    expect(con.margenOperativo).toBe(sin.margenOperativo);
  });
});

describe('recalculo-14 — R12 usa la utilidad neta de devoluciones (misma cifra que controlTotals)', () => {
  it('natural.csv (4175 con la misma polaridad): utilidad transitoria $190M, no $290M', () => {
    const csv = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/preprocessing/__fixtures__/devoluciones-4175/natural.csv'),
      'utf8',
    );
    const s = pp(csv);
    expect(s.controlTotals.utilidadNeta).toBe(190_000_000);
    expect(s.closingDetectorAudit?.utilidadTransitoriaCop).toBe(190_000_000);
  });
});
