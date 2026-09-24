// ---------------------------------------------------------------------------
// Regresión contab-nomina-21 — documentos RAG de retención en la fuente laboral
// ---------------------------------------------------------------------------
// et_articulo_383_a_388_retencion_fuente.md (y el resumen del E.T. 2026) se
// ingestan en el RAG del chat. Decían que la renta exenta del 25 % tenía tope
// de "240 UVT/mes" (norma anterior a la Ley 2277/2022) y que el límite global
// era "1.340 UVT mensuales". Texto primario del corpus (ley_2277_2022.md):
//   - Art. 206 num. 10 (art. 2 Ley 2277/2022): 25 % "limitada anualmente a
//     setecientos noventa (790) UVT".
//   - Art. 336 num. 3 (art. 7 Ley 2277/2022): 40 % "que en todo caso no puede
//     exceder de mil trescientas cuarenta (1.340) UVT anuales", más 72 UVT por
//     dependiente hasta cuatro.
// El ejemplo decía $365.057: (6.900.000 − 95 × 52.374) × 19 % = $365.649,3.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOC_383 = readFileSync(
  join(__dirname, '..', 'et_articulo_383_a_388_retencion_fuente.md'),
  'utf-8',
);
const RESUMEN = readFileSync(join(__dirname, '..', 'estatuto_tributario_resumen_2026.md'), 'utf-8');

describe('et_articulo_383_a_388_retencion_fuente.md', () => {
  it('renta exenta del 25 %: 790 UVT ANUALES, no 240 UVT mensuales', () => {
    expect(DOC_383).not.toMatch(/240 UVT\/mes/);
    expect(DOC_383).toMatch(/790 UVT anuales/);
  });

  it('límite global del 40 %: 1.340 UVT ANUALES, no mensuales', () => {
    expect(DOC_383).not.toMatch(/1\.340 UVT mensuales/);
    expect(DOC_383).toMatch(/1\.340 UVT anuales/);
  });

  it('menciona los 72 UVT adicionales por dependiente (hasta 4)', () => {
    expect(DOC_383).toMatch(/72 UVT por dependiente/);
  });

  it('el ejemplo numérico es aritméticamente correcto', () => {
    expect(DOC_383).not.toMatch(/365\.057/);
    expect(DOC_383).toMatch(/365\.649/);
    expect(Math.round((6_900_000 - 95 * 52_374) * 0.19)).toBe(365_649);
  });

  it('no rotula el Art. 385 como "pagos no laborales" (es el Procedimiento 1)', () => {
    expect(DOC_383).not.toMatch(/Art\. 385 — Retención por concepto de pagos no laborales/);
    expect(DOC_383).toMatch(/Art\. 385[^\n]*Procedimiento 1/);
  });

  it('bases mínimas vigentes desde el 01-jul-2026: servicios 2 UVT y compras 10 UVT (Decreto 0572/2025)', () => {
    expect(DOC_383).not.toMatch(/sobre exceso 4 UVT/);
    expect(DOC_383).toMatch(/2 UVT/);
    expect(DOC_383).toMatch(/10 UVT/);
  });

  it('honorarios: 10 %/11 % por el umbral de 3.300 UVT, no por "declarantes"', () => {
    expect(DOC_383).not.toMatch(/Honorarios → 11% \(declarantes\)/);
    expect(DOC_383).toMatch(/3\.300 UVT/);
  });
});

describe('bases mínimas en los demás documentos RAG de retención (Decreto 0572/2025)', () => {
  const D572_RESUMEN = readFileSync(
    join(__dirname, '..', 'decreto_572_2025_autorretenciones.md'),
    'utf-8',
  );
  const MATRIZ = readFileSync(join(__dirname, '..', 'matriz_retenciones_2026.md'), 'utf-8');
  const D572_TEXTO = readFileSync(join(__dirname, '..', 'decreto_0572_2025.md'), 'utf-8');

  it('el texto primario del decreto fija 2 UVT (servicios) y 10 UVT (otros ingresos)', () => {
    expect(D572_TEXTO).toMatch(/inferior a dos \(2\) UVT/);
    expect(D572_TEXTO).toMatch(/inferior a diez \(10\) UVT/);
  });

  it('el resumen del decreto ya no dice que "se mantienen" 27 y 4 UVT', () => {
    expect(D572_RESUMEN).not.toMatch(/Se mantienen las bases mínimas/);
    expect(D572_RESUMEN).toMatch(/\*\*2 UVT\*\*/);
    expect(D572_RESUMEN).toMatch(/\*\*10 UVT\*\*/);
  });

  it('la matriz usa 10 UVT para compras y 2 UVT para servicios generales', () => {
    expect(MATRIZ).toContain('| Compras generales — declarantes | 2,5% | 10 UVT |');
    expect(MATRIZ).toContain('| Servicios generales — declarantes | 4% | 2 UVT |');
    expect(MATRIZ).not.toMatch(/Honorarios — Personas Naturales declarantes/);
  });
});

describe('estatuto_tributario_resumen_2026.md', () => {
  it('no repite los topes derogados de la renta exenta y del límite global', () => {
    expect(RESUMEN).not.toMatch(/240 UVT mensuales/);
    expect(RESUMEN).not.toMatch(/5\.040 UVT/);
    expect(RESUMEN).toMatch(/790 UVT anuales/);
    expect(RESUMEN).toMatch(/1\.340 UVT anuales/);
  });

  it('bases mínimas de retención de compras y servicios actualizadas al Decreto 0572/2025', () => {
    expect(RESUMEN).not.toMatch(/\| Compras generales \| 27 UVT/);
    expect(RESUMEN).not.toMatch(/\| Servicios generales \| 4 UVT/);
  });
});
