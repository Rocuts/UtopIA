// ---------------------------------------------------------------------------
// El tope del Art. 258 E.T. NO alcanza al descuento del Art. 254
// ---------------------------------------------------------------------------
// Auditoría fiscal 2026-08 (superficie 2, defecto d). El validador aplicaba el
// tope conjunto del 25% a un campo que agrega 254 + 256 + 257, de modo que
// rechazaba la conciliación CORRECTA y exigía una liquidación mayor:
//   impuesto bruto $350.000.000 · descuento Art. 254 $120.000.000
//   correcto  → impuesto neto $230.000.000
//   exigido   → impuesto neto $262.500.000   (tope 25% = $87.500.000)
//
// Art. 258 E.T. (mod. Art. 106 Ley 1819/2016), verbatim: «Los descuentos de que
// tratan los artículos 255, 256 y 257 del Estatuto Tributario tomados en su
// conjunto no podrán exceder del 25% del impuesto sobre la renta a cargo del
// contribuyente en el respectivo año gravable.» El Art. 254 (descuento por
// impuestos pagados en el exterior) no aparece: su límite propio es el impuesto
// colombiano generado por esas rentas (Art. 254 lit. e y par. 1).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validateConciliacionL1, validateConciliacionL2 } from '../validators/conciliacion.validator';
import type { Modulo2Conciliacion } from '../validators/types';

const BASE: Modulo2Conciliacion = {
  uaiCents: '100000000000', // $1.000.000.000
  adicionesCents: '0',
  deduccionesCents: '0',
  rentaLiquidaCents: '100000000000',
  impuestoBrutoCents: '35000000000', // $350.000.000 = 35%
  descuento258_1Cents: '0',
  descuentos254_256_257Cents: '12000000000', // $120.000.000
  impuestoNetoCents: '23000000000', // $230.000.000 — el correcto
  tarifa: 35,
  detallesAdiciones: [],
  detallesDeducciones: [],
  closingNote:
    'Conciliación de cierre. Parágrafo del Art. 647 E.T. — diferencia de criterio razonable.',
  rentasExentasCents: '0',
};

const l15 = (m2: Modulo2Conciliacion) =>
  validateConciliacionL1(m2).find((c) => c.name === 'M2.L1.5_impuesto_neto_descuentos');

describe('M2.L1.5 — descuentos y tope del Art. 258', () => {
  it('acepta el neto correcto cuando el descuento es del Art. 254', () => {
    const c = l15({ ...BASE, descuento254Cents: '12000000000' });
    expect(c?.passed).toBe(true);
  });

  it('sigue exigiendo el tope cuando el descuento NO es del Art. 254', () => {
    // Declarando 254 = $0, los $120.000.000 son 255/256/257 y sí se topean.
    const c = l15({ ...BASE, descuento254Cents: '0' });
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('$262.500.000,00');
  });

  it('sin desglose no inventa una cifra: valida el rango admisible', () => {
    // Los dos extremos legítimos: todo 254 ($230.000.000) ↔ nada 254
    // ($262.500.000). El correcto cae dentro y ya no se rechaza.
    const c = l15(BASE);
    expect(c?.passed).toBe(true);
    const techo = l15({ ...BASE, impuestoNetoCents: '26250000000' });
    expect(techo?.passed).toBe(true);
  });

  it('el rango no es barra libre: un sobrecrédito sigue fallando', () => {
    const c = l15({ ...BASE, impuestoNetoCents: '15000000000' }); // $150.000.000
    expect(c?.passed).toBe(false);
  });

  it('el 254 declarado no puede exceder el total de descuentos', () => {
    const c = l15({ ...BASE, descuento254Cents: '20000000000' });
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('excede el total');
  });

  it('el descuento del Art. 258-1 sigue fuera del tope conjunto', () => {
    // bruto 350M − 258-1 100M − 254 120M = 130M
    const c = l15({
      ...BASE,
      descuento258_1Cents: '10000000000',
      descuento254Cents: '12000000000',
      impuestoNetoCents: '13000000000',
    });
    expect(c?.passed).toBe(true);
  });
});

describe('M2.L2.2 — el desglose faltante se pide, no se asume', () => {
  it('avisa cuando el total excede el tope y no se separa el Art. 254', () => {
    const c = validateConciliacionL2(BASE).find(
      (x) => x.name === 'M2.L2.2_descuentos_otros_tope_25pct',
    );
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe('warning');
    expect(c?.detail).toContain('Art. 254');
  });

  it('no avisa cuando el 254 viene declarado', () => {
    const c = validateConciliacionL2({ ...BASE, descuento254Cents: '12000000000' }).find(
      (x) => x.name === 'M2.L2.2_descuentos_otros_tope_25pct',
    );
    expect(c?.passed).toBe(true);
  });
});
