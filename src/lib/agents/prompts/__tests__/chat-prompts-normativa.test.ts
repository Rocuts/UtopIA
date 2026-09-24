/**
 * Regresiones prompts-normativa-16 y prompts-normativa-17 — prompts del chat
 * (especialistas contable y tributario).
 *
 * -16: el chat contable usaba "Grupo 1: ingresos > 30.000 SMMLV" (los ingresos
 *      no son criterio del Art. 1.1.1.1 DUR 2420/2015) y los criterios de tamaño
 *      del Grupo 3 del Decreto 2706/2012, reemplazados por el Decreto 1670/2021
 *      (topes de microempresa en UVT del Decreto 957/2019). El contexto del
 *      pipeline financiero (colombia-2026-context.ts) ya los prohibía.
 * -17: el chat tributario presentaba como vigentes la megainversión y el
 *      descuento de ICA (derogados/modificados por la Ley 2277/2022: art. 96 y
 *      Art. 115 E.T.), la devolución con garantía en 10 días (Art. 860 vigente:
 *      20), una tasa moratoria fija "~27.44% EA (tasa de usura vigente)" (Art. 635:
 *      usura − 2 pp del mes) y la comparación renta presuntiva vs ordinaria
 *      (presuntiva 0 % desde el AG 2021, Art. 188).
 */

import { describe, expect, it } from 'vitest';

import type { NITContext } from '@/lib/security/pii-filter';
import { buildAccountingPrompt } from '../accounting-agent.prompt';
import { buildTaxPrompt } from '../tax-agent.prompt';

const PJ: NITContext = {
  lastDigit: 7,
  lastTwoDigits: 17,
  checkDigit: 4,
  presumedType: 'persona_juridica',
};

describe('prompts-normativa-16 — grupos NIIF en el chat contable', () => {
  const prompt = buildAccountingPrompt('es', 'financial-intelligence', PJ);

  it('no usa los ingresos como criterio del Grupo 1', () => {
    expect(prompt).not.toMatch(/Ingresos > 30\.000 SMMLV/i);
    expect(prompt).not.toMatch(/ingresos > 30\.000 SMMLV o activos/i);
  });

  it('Grupo 1: planta > 200 trabajadores o activos > 30.000 SMMLV + parámetro adicional', () => {
    expect(prompt).toMatch(/200 trabajadores/);
    expect(prompt).toMatch(/30\.000 SMMLV/);
    expect(prompt).toMatch(/importaciones o exportaciones/i);
    expect(prompt).toMatch(/1\.1\.1\.1/);
  });

  it('Grupo 3: criterios del Decreto 1670/2021, no los derogados del Decreto 2706/2012', () => {
    expect(prompt).not.toMatch(/ingresos < 6\.000 SMMLV/i);
    expect(prompt).not.toMatch(/activos < 500 SMMLV/i);
    expect(prompt).not.toMatch(/Contabilidad Simplificada \(Decreto 2706\/2012\)/);
    expect(prompt).toMatch(/Decreto 1670 de 2021/);
    expect(prompt).toMatch(/23\.563 UVT/);
    expect(prompt).toMatch(/32\.988 UVT/);
    expect(prompt).toMatch(/44\.769 UVT/);
  });
});

describe('prompts-normativa-17 — datos vigentes en el chat tributario', () => {
  const defensa = buildTaxPrompt('es', 'dian-defense', PJ);
  const devolucion = buildTaxPrompt('es', 'tax-refund', PJ);

  it('no presenta megainversión ni descuento de ICA como beneficios vigentes', () => {
    expect(defensa).not.toMatch(/Ley 2010 de 2019\*\*: Mega-inversion, descuento de ICA/);
    expect(defensa).toMatch(/235-3/);
    expect(defensa).toMatch(/Art\. 115/);
  });

  it('devolución con garantía: 20 días (Art. 860 E.T.)', () => {
    expect(devolucion).not.toMatch(/10 \(con garantia bancaria\)/);
    expect(devolucion).toMatch(/20 dias[^\n]*Art\. 860/);
  });

  it('tasa moratoria: usura del mes − 2 pp, sin cifra fija que caduca', () => {
    expect(defensa).not.toMatch(/27[.,]44/);
    expect(defensa).toMatch(/usura[^\n]*menos 2 puntos/i);
  });

  it('no compara renta presuntiva vs ordinaria como vigente (0 % desde AG 2021)', () => {
    expect(defensa).not.toMatch(/presuntiva vs ordinaria/);
    expect(defensa).toMatch(/Art\. 188/);
  });

  it('sanción mínima 2026 = $524.000 (aproximación Art. 868)', () => {
    expect(defensa).not.toMatch(/523\.740/);
    expect(defensa).toMatch(/524\.000/);
  });
});
