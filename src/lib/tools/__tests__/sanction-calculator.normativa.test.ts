/**
 * Regresiones normativas — Calculadora de Sanciones e Intereses (Colombia 2026)
 *
 * Cada bloque documenta la norma verificada contra fuente y el defecto que
 * cubre. Todos estos tests FALLAN contra la version previa del archivo.
 *
 * Fuentes consultadas (agosto 2026):
 *  - Art. 641 E.T. incisos 2º y 3º (topes 5%/10%/doble saldo a favor/2.500 UVT):
 *    https://www.contadia.com/estatuto-tributario/articulo-641-extemporaneidad-en-la-presentacion
 *    https://www.gerencie.com/sancion-por-extemporaneidad.html
 *  - Art. 644 E.T. nums. 1 y 2 (hito = emplazamiento para corregir, Art. 685 E.T.):
 *    https://www.gerencie.com/sancion-por-correccion.html
 *  - Arts. 639 y 868 lit. c) E.T. (sancion minima 10 UVT aproximada al mil):
 *    https://actualicese.com/esta-es-la-sancion-minima-tributaria-2026/
 *    https://www.contadia.com/estatuto-tributario/articulo-868-unidad-de-valor-tributario-uvt
 *  - Art. 577 E.T. (aproximacion de valores de las declaraciones al mil):
 *    https://www.contadia.com/estatuto-tributario/articulo-577-aproximacion-de-los-valores-de-las-declaraciones-tributarias
 *  - Art. 635 E.T. + Res. Superfinanciera 1139 del 31-jul-2026 (mora ago-2026 = 27,66% E.A.):
 *    https://siemprealdia.co/colombia/finanzas/tasa-de-interes-moratorio/
 */

import { describe, it, expect } from 'vitest';
import {
  calculateSanction,
  aproximarValorAbsolutoUvt,
  aproximarValorDeclaracion,
} from '../sanction-calculator';

const UVT_2026 = 52_374; // Resolucion DIAN 000238 del 15-dic-2025
const SANCION_MINIMA_2026 = 524_000; // 10 UVT = $523.740 -> Art. 868 lit. c)
const TOPE_2500_UVT_2026 = 130_935_000; // 2.500 UVT

describe('Art. 868 lit. c) E.T. — aproximacion de valores absolutos en UVT', () => {
  it('aproxima al multiplo de mil mas cercano cuando el resultado supera $10.000', () => {
    // 10 UVT = 523.740 -> 524.000. Antes el codigo dejaba $523.740 crudo.
    expect(aproximarValorAbsolutoUvt(10 * UVT_2026)).toBe(SANCION_MINIMA_2026);
    expect(aproximarValorAbsolutoUvt(2_500 * UVT_2026)).toBe(TOPE_2500_UVT_2026);
  });

  it('aproxima al multiplo de cien entre $100 y $10.000 (lit. b) y al entero hasta $100 (lit. a)', () => {
    expect(aproximarValorAbsolutoUvt(5_240)).toBe(5_200);
    expect(aproximarValorAbsolutoUvt(5_260)).toBe(5_300);
    expect(aproximarValorAbsolutoUvt(52.4)).toBe(52);
  });
});

describe('Art. 577 E.T. — aproximacion de los valores de la declaracion', () => {
  it('sube al mil siguiente cuando la fraccion es >= 500', () => {
    expect(aproximarValorDeclaracion(1_500)).toBe(2_000);
    expect(aproximarValorDeclaracion(1_499)).toBe(1_000);
  });
});

describe('Sancion minima — Arts. 639 y 868 E.T. (2026)', () => {
  it('la sancion minima liquidada es $524.000, no $523.740', () => {
    // Defecto previo: MIN_SANCTION = 10 * 52.374 = 523.740 sin aproximar.
    const r = calculateSanction({ type: 'extemporaneidad' });
    expect(r.amount).toBe(SANCION_MINIMA_2026);
    expect(r.details.minSanction).toBe(SANCION_MINIMA_2026);
  });

  it('tambien rige el piso en correccion e inexactitud', () => {
    expect(
      calculateSanction({ type: 'correccion', difference: 100_000 }).amount,
    ).toBe(SANCION_MINIMA_2026);
    expect(
      calculateSanction({ type: 'inexactitud', difference: 100_000 }).amount,
    ).toBe(SANCION_MINIMA_2026);
  });
});

describe('Art. 641 E.T. inciso 2º — tope de 2.500 UVT sin impuesto a cargo', () => {
  it('sin saldo a favor, la sancion nunca excede 2.500 UVT = $130.935.000', () => {
    // Caso del informe: $50.000 millones de ingresos brutos, sin impuesto a cargo,
    // 12 meses de retardo. El codigo previo topaba solo al 5% -> $2.500 millones.
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      grossIncome: 50_000_000_000,
      delayMonths: 12,
    });
    expect(r.amount).toBe(TOPE_2500_UVT_2026);
    expect(r.amount).toBeLessThan(50_000_000_000 * 0.05); // muy por debajo del 5%
    expect(r.details.tope2500Uvt).toBe(TOPE_2500_UVT_2026);
  });

  it('cuando el 5% de los ingresos es menor que 2.500 UVT, gana el 5%', () => {
    // Ingresos $500.000.000 -> 5% = $25.000.000 < $130.935.000.
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      grossIncome: 500_000_000,
      delayMonths: 24,
    });
    expect(r.amount).toBe(25_000_000);
  });

  it('con saldo a favor, el tope alterno es el DOBLE del saldo a favor (no 2.500 UVT)', () => {
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      grossIncome: 50_000_000_000,
      saldoAFavor: 3_000_000,
      delayMonths: 12,
    });
    expect(r.amount).toBe(6_000_000);
    expect(String(r.details.capLabel)).toContain('saldo a favor');
  });
});

describe('Art. 641 E.T. inciso 3º — rama del patrimonio liquido', () => {
  it('sin ingresos en el periodo liquida 1% mensual del patrimonio liquido del ano anterior', () => {
    // Defecto previo: sin ingresos caia directo a la sancion minima.
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      grossIncome: 0,
      netEquityPriorYear: 800_000_000,
      delayMonths: 3,
    });
    // 1% x 800.000.000 x 3 = 24.000.000; tope 10% = 80.000.000; 2.500 UVT = 130.935.000
    expect(r.amount).toBe(24_000_000);
    expect(r.amount).toBeGreaterThan(SANCION_MINIMA_2026);
  });

  it('la rama de patrimonio respeta el tope del 10% del patrimonio liquido', () => {
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      netEquityPriorYear: 800_000_000,
      delayMonths: 24,
    });
    expect(r.amount).toBe(80_000_000);
  });

  it('la rama de patrimonio tambien respeta el tope de 2.500 UVT', () => {
    const r = calculateSanction({
      type: 'extemporaneidad',
      taxDue: 0,
      netEquityPriorYear: 40_000_000_000,
      delayMonths: 12,
    });
    expect(r.amount).toBe(TOPE_2500_UVT_2026);
  });
});

describe('Art. 644 E.T. nums. 1 y 2 — el hito 10% -> 20% es el EMPLAZAMIENTO PARA CORREGIR', () => {
  it('el texto no puede afirmar que el 10% rige hasta el requerimiento especial', () => {
    // Defecto previo: "correccion voluntaria (antes de notificacion del
    // requerimiento especial o pliego de cargos)". Entre el emplazamiento y el
    // requerimiento especial la tarifa YA es del 20%.
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      isVoluntary: true,
    });
    expect(r.explanation).toContain('emplazamiento para corregir');
    expect(r.explanation).toContain('Art. 685');
    expect(r.explanation).not.toMatch(
      /(?:voluntaria|ANTES)[^.]*antes de notificacion del requerimiento especial/i,
    );
  });

  it("correccionStage 'despues_emplazamiento' liquida al 20% aunque no haya requerimiento especial", () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'despues_emplazamiento',
    });
    expect(r.amount).toBe(20_000_000);
    expect(r.details.rate).toBe('20%');
  });

  it("correccionStage 'antes_emplazamiento' liquida al 10%", () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'antes_emplazamiento',
    });
    expect(r.amount).toBe(10_000_000);
  });

  it('correccionStage prevalece sobre el legado isVoluntary', () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      isVoluntary: true,
      correccionStage: 'despues_emplazamiento',
    });
    expect(r.amount).toBe(20_000_000);
  });

  it('la recomendacion advierte que el emplazamiento eleva la tarifa al 20%', () => {
    const r = calculateSanction({
      type: 'correccion',
      difference: 100_000_000,
      correccionStage: 'antes_emplazamiento',
    });
    expect(r.recommendations.join(' ')).toMatch(/EMPLAZAMIENTO PARA CORREGIR/i);
  });
});

describe('Art. 635 E.T. — tasa de interes moratorio por defecto', () => {
  it('el fallback es 27,66% E.A. (usura 29,66% - 2 pp, Res. SFC 1139 del 31-jul-2026), no 25,44%', () => {
    const r = calculateSanction({
      type: 'intereses_moratorios',
      principal: 100_000_000,
      days: 365,
    });
    expect(r.details.annualRate).toBe(27.66);
    expect(r.details.annualRate).not.toBe(25.44);
  });

  it('marca el uso del fallback y bloquea que la cifra alimente una decision de pago', () => {
    const r = calculateSanction({
      type: 'intereses_moratorios',
      principal: 100_000_000,
      days: 365,
    });
    expect(r.details.tasaPorDefectoUsada).toBe(true);
    expect(r.explanation).toContain('NO LIQUIDABLE');
    expect(r.recommendations[0]).toMatch(/NO use esta cifra/i);
  });

  it('cuando el caller pasa la tasa del periodo, no marca fallback ni advierte', () => {
    const r = calculateSanction({
      type: 'intereses_moratorios',
      principal: 100_000_000,
      annualRate: 27.66,
      days: 365,
    });
    expect(r.details.tasaPorDefectoUsada).toBe(false);
    expect(r.explanation).not.toContain('NO LIQUIDABLE');
  });
});
