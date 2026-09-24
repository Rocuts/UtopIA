// ---------------------------------------------------------------------------
// Bloque Âncora NIIF — F03 con la misma lista blanca que el Âncora Fiscal
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (tributario-modulos-01): el cálculo alternativo de F03 en
// build-ancora.ts sumaba todo 1355 + 1805. Con 135510 (anticipo ICA), 135530
// (impuestos descontables) y 180505 (obras de arte) el crédito de renta se
// inflaba y F04 se volvía un «saldo a favor» ficticio.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildNiifAncora } from '../build-ancora';
import { buildFiscalAnchor } from '../../escudo-survival/fiscal-anchor';

const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
111005,Bancos cuenta corriente,Auxiliar,1,142000000
130505,Clientes nacionales,Auxiliar,1,260000000
135515,Retencion en la fuente,Auxiliar,1,20000000
135510,Anticipo de impuestos de industria y comercio,Auxiliar,1,15000000
135530,Impuestos descontables,Auxiliar,1,30000000
180505,Obras de arte,Auxiliar,1,5000000
143505,Mercancias no fabricadas por la empresa,Auxiliar,1,160000000
220505,Proveedores nacionales,Auxiliar,1,310000000
240805,Impuesto sobre las ventas por pagar,Auxiliar,1,44000000
240405,Impuesto de renta y complementarios,Auxiliar,1,30000000
310505,Capital suscrito y pagado,Auxiliar,1,150000000
330505,Reserva legal,Auxiliar,1,26000000
360505,Utilidad o perdida del ejercicio,Auxiliar,1,70000000
370505,Resultados de ejercicios anteriores,Auxiliar,1,20000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
529505,Gastos de venta comisiones,Auxiliar,1,222000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;

describe('buildNiifAncora — F03 sólo crédito de renta', () => {
  const pre = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
  const ancora = buildNiifAncora(pre, { name: 'PYME SAS', nit: '900123456-1' } as never);

  it('F03 = 135515 (20M); excluye 135510, 135530 y 180505', () => {
    expect(ancora.ccvFiscal.F03).toBe('2000000000');
  });

  it('coincide con el F03 del Âncora Fiscal (una sola composición)', () => {
    const fiscal = buildFiscalAnchor({
      preprocessed: pre,
      company: { name: 'PYME SAS', nit: '900123456-1' },
      hoy: new Date('2026-09-23T12:00:00Z'),
    });
    expect(ancora.ccvFiscal.F03).toBe(fiscal.f03);
  });
});
