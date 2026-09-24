// ---------------------------------------------------------------------------
// Precios de transferencia — montos del modelo en la nota de impacto fiscal
// ---------------------------------------------------------------------------
// Con el ajuste en COP N/D (el análisis no trae la base del PLI por
// operación), `notaSinMontosDelModelo` sustituye por el motivo la nota del
// modelo que escribe un monto: ese monto no lo calculó el código. El detector
// sólo reconocía el símbolo `$`, el prefijo `COP` y "millones/million", así
// que el monto con la moneda DESPUÉS de la cifra ("150,000,000 COP",
// "52.500.000 pesos"), en otra moneda ("USD 250,000", "EUR 300.000") o con
// la abreviatura "MM" llegaba al cliente como si fuera una cifra verificada.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
  notaSinMontosDelModelo,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO,
  TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
} from '../lib/deterministic';

describe('notaSinMontosDelModelo — montos del modelo en cualquier formato', () => {
  it.each([
    ['en', 'An adjustment of 150,000,000 COP would increase taxable income.'],
    ['es', 'Mayor impuesto de 52.500.000 pesos sobre la renta líquida.'],
    ['en', 'Adjustment of USD 250,000 to taxable income.'],
    ['es', 'Ajuste de 250.000 dólares a la base gravable.'],
    ['es', 'EUR 300.000 de ajuste a la renta.'],
    ['es', 'Impacto estimado de 1.500 MM en el impuesto.'],
    ['en', 'Estimated tax impact of 45,000,000 pesos.'],
  ] as const)('%s: «%s» se sustituye por el motivo', (lang, nota) => {
    const motivo = lang === 'en' ? TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN : TP_AJUSTE_COP_SIN_BASE_MOTIVO;
    expect(notaSinMontosDelModelo(nota, null, lang)).toBe(motivo);
  });

  it.each([
    'Ajuste de 2,3 puntos porcentuales sobre el margen operativo.',
    'Revisar el Art. 260-5 E.T. y el Formato 1125 del año gravable 2025.',
    'La muestra tiene 3 operaciones y 5 comparables.',
    'El ajuste en COP requiere la base del PLI por operación.',
  ])('una nota sin montos se conserva: «%s»', (nota) => {
    expect(notaSinMontosDelModelo(nota, null, 'es')).toBe(nota);
  });

  it('con el ajuste determinista ("0") la nota del modelo no se toca', () => {
    const nota = 'An adjustment of 150,000,000 COP would increase taxable income.';
    expect(notaSinMontosDelModelo(nota, '0', 'en')).toBe(nota);
  });

  it('el motivo no se reconoce a sí mismo como un monto (idempotente)', () => {
    expect(notaSinMontosDelModelo(TP_AJUSTE_COP_SIN_BASE_MOTIVO, null, 'es')).toBe(
      TP_AJUSTE_COP_SIN_BASE_MOTIVO,
    );
    expect(notaSinMontosDelModelo(TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN, null, 'en')).toBe(
      TP_AJUSTE_COP_SIN_BASE_MOTIVO_EN,
    );
  });
});
