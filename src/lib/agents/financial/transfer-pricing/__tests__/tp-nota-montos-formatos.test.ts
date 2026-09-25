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
  computeTpRangeCheck,
  enforceComparableAnalysis,
  notaSinMontosDelModelo,
  textoSinMontosDeAjuste,
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

// ---------------------------------------------------------------------------
// Re-auditoría 2026-09-24 (NT-10): montos del ajuste con escalas y unidades
// que el filtro dejaba pasar junto al ajuste en COP N/D.
// ---------------------------------------------------------------------------
describe('NT-10 — escalas y unidades del monto del ajuste', () => {
  const CASOS = [
    'El ajuste requerido asciende a 850 mil dólares por la operación de servicios.',
    'Se estima un ajuste de 420 mil pesos en la renta líquida.',
    'El ajuste a la mediana implica 1,2 billones de pesos de mayor renta.',
    'The adjustment amounts to 850 thousand dollars.',
    'Adjustment: 3.5bn COP.',
    'El ajuste equivale a 16.000 UVT.',
    'El ajuste estimado es de 2,5M sobre la base.',
  ];

  it.each(CASOS)('enforceComparableAnalysis retira «%s» de rationale, nota y notas técnicas', (texto) => {
    const json = {
      selectedComparables: [
        { pliPercent: 5, isSimulated: false }, { pliPercent: 7, isSimulated: false },
        { pliPercent: 9, isSimulated: false }, { pliPercent: 11, isSimulated: false },
      ],
      interquartileRange: { observedPliPercent: 2, min: 0, q1: 0, median: 0, q3: 0, max: 0, isWithinRange: false },
      armLengthConclusion: { complies: false, requiredAdjustmentPercent: 1, requiredAdjustmentCop: '99900000000', taxImpactNote: texto, rationale: texto },
      technicalNotes: [texto],
    } as unknown as Parameters<typeof enforceComparableAnalysis>[0];
    const out = enforceComparableAnalysis(json, computeTpRangeCheck(json), 'es');
    expect(out.armLengthConclusion.requiredAdjustmentCop).toBeNull();
    expect(out.armLengthConclusion.taxImpactNote).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
    expect(out.armLengthConclusion.rationale).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
    expect(out.technicalNotes).toEqual([TP_AJUSTE_COP_SIN_BASE_MOTIVO]);
  });

  it.each([
    'Ajuste de 2,3 puntos porcentuales sobre el margen operativo (Art. 260-4 E.T.).',
    'El ajuste se documenta en el Formato 1125 del año gravable 2025.',
    'The adjustment to the median is 3.5 percentage points.',
  ])('una frase del ajuste sin monto se conserva: «%s»', (t) => {
    expect(textoSinMontosDeAjuste(t, null, 'es')).toBe(t);
  });

  // Revisión adversarial de NT-10: el sufijo de escala pegado a la cifra
  // leía «B2B» como un monto y retiraba la nota honesta.
  it('«B2B» no es un monto; «2,5M» y «850K» sí', () => {
    const honesta = 'Ajuste por operaciones B2B con vinculados del exterior (Art. 260-4 E.T.).';
    expect(notaSinMontosDelModelo(honesta, null, 'es')).toBe(honesta);
    expect(textoSinMontosDeAjuste(honesta, null, 'es')).toBe(honesta);
    for (const t of ['El ajuste estimado es de 2,5M sobre la base.', 'Adjustment of 850K to taxable income.', 'Ajuste de 3B.']) {
      expect(notaSinMontosDelModelo(t, null, 'es'), t).toBe(TP_AJUSTE_COP_SIN_BASE_MOTIVO);
    }
  });
});
