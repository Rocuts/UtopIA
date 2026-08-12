// ---------------------------------------------------------------------------
// L3.7 — F03 anclado al crédito imputable a RENTA
// ---------------------------------------------------------------------------
// Contrapartida de defensa (Capa 3) del arreglo del extractor: dado el balance
// desagregado, F03 tiene que ser exactamente Σ(1355+1805) menos el ReteIVA
// (135517) y el ReteICA (135518). Tolerancia CERO — es un ancla.
//
// Art. 373 E.T.: sólo lo retenido a título de renta se imputa a ese impuesto.
// Art. 484-1 E.T.: el ReteIVA se acredita en la declaración de IVA.
// Acreditarlos en renta expone al Art. 647 E.T. (sanción del 100% del mayor
// impuesto) y al Art. 670 E.T. si origina devolución improcedente.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateFiscalAnchorL3 } from '../validators/fiscal-anchor-validators';
import type { L3Context } from '../validators/fiscal-anchor-validators';
import type { FiscalAnchorBlock } from '../fiscal-anchor/types';

/** Cifras reales del Grupo Empresarial 2 Tres SAS 2025 (en centavos). */
const TOTAL_1355_1805 = 3548580602; // $35.485.806,02
const RETE_IVA = 485714254; // $4.857.142,54
const RETE_ICA = 60228142; // $602.281,42
const F03_CORRECTO = '3002638206'; // $30.026.382,06

function blockConF03(f03: string): FiscalAnchorBlock {
  return {
    f01: '222849678973',
    f02: '77997387641',
    f03,
    f04: '0',
    f05: '0',
    f06: '0',
    f07: '0',
    f08: '0',
    f09: 0,
    f10: 0,
    calendarioDian: {
      nit: '901714014-6',
      ultimoDigito: 4,
      periodo: '2025',
      vencimientos: [],
      alertaAnticipacionDias: 15,
    },
    alertas: [{ codigo: 'A5_SIN_PROVISION', severidad: 'error', mensaje: 'x', norma: 'Art. 647 E.T.' }],
    fuente: { periodo: '2025', balanceHash: 'test' },
  };
}

function ctx(creditoRenta?: L3Context['creditoRenta']): L3Context {
  return {
    clase54Cents: 0,
    markdownBlock: 'Referencia antes de depuraciones fiscales conforme al Art. 240 E.T.',
    ...(creditoRenta ? { creditoRenta } : {}),
  };
}

const DESAGREGADO = {
  total1355y1805Cents: TOTAL_1355_1805,
  reteIva135517Cents: RETE_IVA,
  reteIca135518Cents: RETE_ICA,
};

const l37 = (block: FiscalAnchorBlock, c: L3Context) =>
  validateFiscalAnchorL3(block, c).find((x) => x.name === 'L3.7_f03_solo_credito_renta');

describe('L3.7 — F03 sólo con crédito de renta', () => {
  it('pasa cuando F03 excluye ReteIVA y ReteICA', () => {
    const c = l37(blockConF03(F03_CORRECTO), ctx(DESAGREGADO));
    expect(c?.passed).toBe(true);
    expect(c?.severity).toBe('error');
  });

  it('bloquea cuando F03 los incluye (los $5.459.423,96 del balance real)', () => {
    const c = l37(blockConF03(String(TOTAL_1355_1805)), ctx(DESAGREGADO));
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('$5.459.423,96');
    expect(c?.norma).toContain('484-1');
  });

  it('tolerancia CERO: un centavo de más bloquea', () => {
    const c = l37(blockConF03('3002638207'), ctx(DESAGREGADO));
    expect(c?.passed).toBe(false);
  });

  it('sin desagregación se declara no aplicable en vez de inventar veredicto', () => {
    const c = l37(blockConF03(F03_CORRECTO), ctx());
    expect(c?.passed).toBe(true);
    expect(c?.detail).toContain('no se puede evaluar');
  });
});
