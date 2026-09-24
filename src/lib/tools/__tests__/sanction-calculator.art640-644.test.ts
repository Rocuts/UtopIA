/**
 * Regresión tributario-calc-12 — gradualidad del Art. 640 nums. 1-2,
 * corrección antes del vencimiento, incremento del par. 1 del Art. 644 y
 * extemporaneidad posterior al emplazamiento (Art. 642).
 *
 * Textos verificados en el corpus (src/data/tax_docs/estatuto_tributario_completo.md):
 *  - Art. 639: "El valor mínimo de cualquier sanción, incluidas las sanciones
 *    reducidas ... será equivalente a la suma de 10 UVT".
 *  - Art. 640 (mod. art. 282 Ley 1819/2016): cuando la sanción la liquida el
 *    contribuyente se reduce al 50 % (sin la misma conducta en los 2 años
 *    anteriores) o al 75 % (sin ella en el año anterior), siempre que la DIAN
 *    no haya proferido pliego de cargos, requerimiento especial o emplazamiento
 *    previo por no declarar.
 *  - Art. 642: 10 % mensual del impuesto, tope 200 %; sin impuesto 1 % de los
 *    ingresos (tope menor entre 10 %, 4× saldo a favor o 5.000 UVT); sin
 *    ingresos 2 % del patrimonio líquido (tope menor entre 20 %, 4× saldo a
 *    favor o 5.000 UVT).
 *  - Art. 644 num. 1 (mod. art. 285 Ley 1819/2016): 10 % "cuando la corrección
 *    se realice después del vencimiento del plazo para declarar"; par. 1: +5 %
 *    por mes de extemporaneidad de la declaración inicial, total ≤ 100 %;
 *    par. 3: la base no incluye la propia sanción.
 */

import { describe, expect, it } from 'vitest';
import { calculateSanction, MIN_SANCTION } from '../sanction-calculator';

const UVT_2026 = 52_374;
const TOPE_5000_UVT = 5_000 * UVT_2026; // 261.870.000

describe('Art. 640 nums. 1-2 — gradualidad de sanciones liquidadas por el contribuyente', () => {
  it("extemporaneidad reducida al 50 % con reduccion640 '50'", () => {
    const plena = calculateSanction({ type: 'extemporaneidad', taxDue: 20_000_000, delayMonths: 2 });
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 20_000_000,
      delayMonths: 2,
      reduccion640: '50',
    });
    expect(plena.amount).toBe(2_000_000);
    expect(r.amount).toBe(1_000_000);
    expect(r.details.sancionPlena).toBe(2_000_000);
    expect(r.article).toMatch(/640/);
  });

  it("corrección reducida al 75 % con reduccion640 '75'", () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'antes_emplazamiento',
      reduccion640: '75',
    });
    expect(r.amount).toBe(7_500_000);
  });

  it('la sanción mínima (Art. 639) se aplica DESPUÉS de reducir', () => {
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 1_500_000,
      delayMonths: 10, // 750.000 plena → 375.000 reducida → mínimo 524.000
      reduccion640: '50',
    });
    expect(r.amount).toBe(MIN_SANCTION);
  });

  it('no reduce la extemporaneidad posterior al emplazamiento (Art. 640 lit. b)', () => {
    const r = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      taxDue: 10_000_000,
      delayMonths: 3,
      reduccion640: '50',
    });
    expect(r.amount).toBe(3_000_000);
    expect(r.explanation).toMatch(/emplazamiento previo por no declarar/i);
  });
});

describe('Art. 644 — corrección antes del vencimiento y par. 1', () => {
  it("correccionStage 'antes_vencimiento' no genera sanción (ni mínima)", () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'antes_vencimiento',
    });
    expect(r.amount).toBe(0);
  });

  it('par. 1: declaración inicial extemporánea suma 5 % por mes al 10 %', () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'antes_emplazamiento',
      mesesExtemporaneidadInicial: 3,
    });
    expect(r.amount).toBe(25_000_000);
  });

  it('par. 1: el total no excede el 100 % del mayor valor', () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'despues_emplazamiento',
      mesesExtemporaneidadInicial: 20,
    });
    expect(r.amount).toBe(100_000_000);
  });

  it('cita el parágrafo 3 (no el 1) para excluir la propia sanción de la base', () => {
    const r = calculateSanction({ type: 'correccion', difference: 100_000_000 });
    expect(r.explanation).toMatch(/par[aá]grafo 3/i);
    expect(r.explanation).not.toMatch(/par[aá]grafo 1º E\.T\.\)/);
  });

  it('rechaza una corrección "antes del vencimiento" de una declaración inicial extemporánea', () => {
    expect(() =>
      calculateSanction({
        type: 'correccion',
        difference: 1_000_000,
        correccionStage: 'antes_vencimiento',
        mesesExtemporaneidadInicial: 2,
      }),
    ).toThrow(/vencimiento/i);
  });
});

describe('Art. 642 — extemporaneidad posterior al emplazamiento', () => {
  it('10 % mensual del impuesto a cargo', () => {
    const r = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      taxDue: 10_000_000,
      delayMonths: 3,
    });
    expect(r.amount).toBe(3_000_000);
    expect(r.article).toMatch(/642/);
  });

  it('tope del 200 % del impuesto', () => {
    const r = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      taxDue: 10_000_000,
      delayMonths: 25,
    });
    expect(r.amount).toBe(20_000_000);
  });

  it('sin impuesto: 1 % de ingresos, tope menor entre 10 % y 4× saldo a favor', () => {
    const sinSaldo = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      grossIncome: 1_000_000_000,
      delayMonths: 12,
    });
    expect(sinSaldo.amount).toBe(100_000_000);
    const conSaldo = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      grossIncome: 1_000_000_000,
      saldoAFavor: 10_000_000,
      delayMonths: 12,
    });
    expect(conSaldo.amount).toBe(40_000_000);
  });

  it('sin ingresos: 2 % del patrimonio líquido, tope 5.000 UVT', () => {
    const r = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      netEquityPriorYear: 2_000_000_000,
      delayMonths: 3,
    });
    expect(r.amount).toBe(120_000_000);
    const tope = calculateSanction({
      type: 'extemporaneidad_post_emplazamiento',
      netEquityPriorYear: 2_000_000_000,
      delayMonths: 9, // 360 M bruto; 20 % = 400 M; tope 5.000 UVT
    });
    expect(tope.amount).toBe(TOPE_5000_UVT);
  });
});
