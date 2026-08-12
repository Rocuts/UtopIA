// ---------------------------------------------------------------------------
// Tasa Mínima de Tributación (TMT / TTD) — Art. 240 par. 6 E.T.
// ---------------------------------------------------------------------------
// Auditoría fiscal 2026-08 (superficie 2, defecto c). El cálculo del impuesto
// adicional cuantizaba la brecha contra el umbral del 15% a DÉCIMAS de punto
// porcentual —la misma resolución que ya trae F09—, de modo que el redondeo
// caía encima del dato en vez de por debajo:
//
//   F09 = 14,94%  →  brecha real 0,06 pp, redondeada a 0,1 pp
//                    entregaba $2.228.496,79 donde la norma da $1.337.098,07
//                    (66,7% de sobreestimación).
//   F09 = 14,96%  →  brecha real 0,04 pp, redondeada a 0 pp
//                    entregaba $0,00 donde la norma da $891.398,72
//                    (el impuesto adicional desaparecía).
//
// Norma: Art. 240 par. 6 E.T., adicionado por el Art. 10 de la Ley 2277/2022,
// declarado EXEQUIBLE por la Sentencia C-219 de 2024. Si TTD < 15%,
// IA = (UD × 15%) − ID, equivalente a (15% − TTD) × UD.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildAlertaTasaMinima } from '../tools/ccv-calculator';
import type { FiscalAnchorBlock } from '../../fiscal-anchor/types';

/** UAI del balance real Grupo Empresarial 2 Tres SAS 2025: $2.228.496.789,73. */
const UAI_CENTS = '222849678973';

function anchorConF09(f09: number, f01: string = UAI_CENTS): FiscalAnchorBlock {
  return {
    f01,
    f02: '0',
    f03: '0',
    f04: '0',
    f05: '0',
    f06: '0',
    f07: '0',
    f08: '0',
    f09,
    f10: 0,
    calendarioDian: {
      nit: '901714014-6',
      ultimoDigito: 4,
      periodo: '2025',
      vencimientos: [],
      alertaAnticipacionDias: 15,
    },
    alertas: [],
    fuente: { periodo: '2025', balanceHash: 'test' },
  };
}

describe('buildAlertaTasaMinima — impuesto adicional Art. 240 par. 6 E.T.', () => {
  it('F09 = 14,94% → $1.337.098,07 (antes $2.228.496,79)', () => {
    const a = buildAlertaTasaMinima(anchorConF09(14.94));
    expect(a.aplica).toBe(true);
    expect(a.impuestoAdicionalEstimado).toBe('133709807');
    expect(a.brechaPp).toBeCloseTo(0.06, 6);
  });

  it('F09 = 14,96% → $891.398,72 (antes $0,00)', () => {
    const a = buildAlertaTasaMinima(anchorConF09(14.96));
    expect(a.aplica).toBe(true);
    expect(a.impuestoAdicionalEstimado).toBe('89139872');
  });

  it('brechas de una décima exacta no se mueven (sin regresión)', () => {
    expect(buildAlertaTasaMinima(anchorConF09(14.9)).impuestoAdicionalEstimado).toBe(
      '222849679',
    );
    expect(buildAlertaTasaMinima(anchorConF09(10)).impuestoAdicionalEstimado).toBe(
      '11142483949',
    );
  });

  it('F09 ≥ 15% → no aplica y el adicional es cero', () => {
    const a = buildAlertaTasaMinima(anchorConF09(15));
    expect(a.aplica).toBe(false);
    expect(a.impuestoAdicionalEstimado).toBe('0');
    expect(a.brechaPp).toBe(0);
  });

  it('UAI ≤ 0 → no aplica (par. 6 excluye utilidad depurada ≤ 0)', () => {
    const a = buildAlertaTasaMinima(anchorConF09(0, '0'));
    expect(a.aplica).toBe(false);
    expect(a.impuestoAdicionalEstimado).toBe('0');
  });

  it('la brecha declarada y el dinero cuentan la misma historia', () => {
    // brechaPp × UAI debe reproducir el adicional al centavo.
    const a = buildAlertaTasaMinima(anchorConF09(14.94));
    const esperado =
      (BigInt(UAI_CENTS) * BigInt(Math.round(a.brechaPp * 10_000))) / BigInt(1_000_000);
    expect(BigInt(a.impuestoAdicionalEstimado) - esperado <= BigInt(1)).toBe(true);
  });
});
