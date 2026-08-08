/**
 * Regresión normativa — Régimen Simple de Tributación (SIMPLE).
 *
 * Cada bloque fija un valor contra su fuente. Todos estos casos FALLAN con la
 * versión anterior de src/lib/tax/taxCalculator.ts, que:
 *   - llamaba "tope del Régimen Simple" al umbral de no-responsable de IVA
 *     (3.500 UVT) y lo usaba para decirle al usuario que revisara su régimen;
 *   - codificaba tarifas del Art. 908 que no corresponden a ninguna versión
 *     de la norma (1,88 / 2,40 / 2,90 / 3,40 y 5,90 / 7,50 / 8,60 / 9,50);
 *   - modelaba solo 2 de los 4 grupos de actividad;
 *   - dejaba el último tramo abierto en Infinity;
 *   - cargaba el IVA solo del lado del régimen ordinario;
 *   - permitía que el descuento por aportes a pensión llevara el impuesto a 0,
 *     erosionando el componente de ICA consolidado.
 *
 * Fuentes verificadas el 07-ago-2026:
 *   - Art. 905 num. 2 E.T. (mod. art. 41 Ley 2155 de 2021) — tope 100.000 UVT.
 *   - Corte Constitucional, Sentencia C-540 de 2023 (05-dic-2023):
 *     https://normograma.dian.gov.co/dian/compilacion/docs/c-540_2023.htm
 *   - Art. 908 E.T. nums. 1 a 3 (art. 44 Ley 2277 de 2022) y numeral 3 del
 *     art. 42 de la Ley 2155 de 2021 revivido por C-540/2023
 *     (DIAN Oficio 100208192-154 del 05-mar-2024).
 *   - Art. 907 y Art. 915 E.T. — el IVA no integra el impuesto unificado.
 *   - Art. 903 par. 4 E.T. — el descuento por aportes a pensión no puede
 *     cubrir el ICA consolidado.
 *   - Art. 437 par. 3 E.T. — umbral de 3.500 UVT de no-responsable de IVA.
 *   - Res. DIAN 000238 del 15-dic-2025 — UVT 2026 = $52.374.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RST_GROUPS,
  TOPE_SIMPLE_UVT,
  UMBRAL_NO_RESPONSABLE_IVA_UVT,
  UVT_2026,
  compare,
  computeOrdinario,
  computeRST,
  computeSimple,
  semaforoResponsabilidadIvaInc,
  semaforoTopeSimple,
  topeSimple,
  umbralNoResponsableIvaInc,
} from '@/lib/tax/taxCalculator';

// ---------------------------------------------------------------------------
// 1. Los dos umbrales son distintos y están separados
// ---------------------------------------------------------------------------

describe('umbrales — tope del SIMPLE vs responsabilidad de IVA', () => {
  it('tope del Régimen Simple = 100.000 UVT = $5.237.400.000 (Art. 905 num. 2 E.T.)', () => {
    expect(TOPE_SIMPLE_UVT).toBe(100_000);
    expect(topeSimple()).toBe(5_237_400_000);
  });

  it('umbral de no-responsable de IVA/INC = 3.500 UVT = $183.309.000 (Art. 437 par. 3 E.T.)', () => {
    expect(UMBRAL_NO_RESPONSABLE_IVA_UVT).toBe(3_500);
    expect(umbralNoResponsableIvaInc()).toBe(183_309_000);
  });

  it('el umbral de IVA es 28,57 veces menor que el tope del régimen', () => {
    expect(topeSimple() / umbralNoResponsableIvaInc()).toBeCloseTo(100_000 / 3_500, 6);
  });

  it('una Pyme de $200M/año está DENTRO del SIMPLE pero SÍ es responsable de IVA', () => {
    const ventas = 200_000_000; // ≈ 3.818 UVT
    expect(semaforoTopeSimple(ventas).level).toBe('verde');
    expect(semaforoResponsabilidadIvaInc(ventas).level).toBe('rojo');
    // El mensaje del umbral de IVA nunca puede pedir cambiar de régimen.
    expect(semaforoResponsabilidadIvaInc(ventas).message).not.toMatch(/revise su régimen/i);
    expect(semaforoResponsabilidadIvaInc(ventas).message).toMatch(/IVA/);
    expect(semaforoTopeSimple(ventas).concepto).toBe('tope-simple');
    expect(semaforoResponsabilidadIvaInc(ventas).concepto).toBe('umbral-iva-inc');
  });
});

// ---------------------------------------------------------------------------
// 2. Tarifas del Art. 908 E.T.
// ---------------------------------------------------------------------------

describe('tarifas Art. 908 E.T. — cuatro grupos + tarifa única CIIU', () => {
  const tramos = [
    { uvt: 5_000, tiendas: 0.012, comercio: 0.016, comidas: 0.031, servicios: 0.059 },
    { uvt: 10_000, tiendas: 0.028, comercio: 0.02, comidas: 0.034, servicios: 0.073 },
    { uvt: 20_000, tiendas: 0.044, comercio: 0.035, comidas: 0.04, servicios: 0.12 },
    { uvt: 50_000, tiendas: 0.056, comercio: 0.045, comidas: 0.045, servicios: 0.145 },
  ];

  it.each(tramos)('grupo 1 (tiendas) a $uvt UVT → tarifa esperada', (t) => {
    const ventas = t.uvt * UVT_2026;
    expect(computeSimple(ventas, 'tiendas').tarifa).toBe(t.tiendas);
  });

  it.each(tramos)('grupo 2 (comercio/industria) a $uvt UVT → tarifa esperada', (t) => {
    const ventas = t.uvt * UVT_2026;
    expect(computeSimple(ventas, 'comercioIndustria').tarifa).toBe(t.comercio);
  });

  it.each(tramos)('grupo 3 (comidas/transporte) a $uvt UVT → tarifa esperada', (t) => {
    const ventas = t.uvt * UVT_2026;
    expect(computeSimple(ventas, 'comidasTransporte').tarifa).toBe(t.comidas);
  });

  it.each(tramos)('grupo 4 (servicios profesionales, C-540/2023) a $uvt UVT → tarifa esperada', (t) => {
    const ventas = t.uvt * UVT_2026;
    expect(computeSimple(ventas, 'servicios').tarifa).toBe(t.servicios);
  });

  it('el tramo alto de servicios es 14,5%, no 9,5% (numeral 3 art. 42 Ley 2155/2021 revivido)', () => {
    const ventas = 50_000 * UVT_2026;
    expect(computeRST(ventas, 'servicios')).toBeCloseTo(ventas * 0.145, 6);
    expect(computeRST(ventas, 'servicios')).not.toBeCloseTo(ventas * 0.095, 6);
  });

  it('CIIU 4665 / 3830 / 3811 → tarifa única del 1,62% con su condición de permanencia', () => {
    const ventas = 20_000 * UVT_2026;
    const r = computeSimple(ventas, 'aprovechamientoMateriales');
    expect(r.tarifa).toBe(0.0162);
    expect(r.advertencias.join(' ')).toMatch(/utilidad neta no supera el 3%/i);
  });

  it('ningún grupo deja el último tramo abierto: todos cierran en 100.000 UVT', () => {
    for (const brackets of Object.values(RST_GROUPS)) {
      expect(brackets[brackets.length - 1].uvtMax).toBe(TOPE_SIMPLE_UVT);
      expect(brackets.some((b) => !Number.isFinite(b.uvtMax))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Exclusión por encima de 100.000 UVT
// ---------------------------------------------------------------------------

describe('exclusión del SIMPLE por encima de 100.000 UVT (Arts. 905 num. 2 y 914 E.T.)', () => {
  it('a 150.000 UVT no hay tarifa SIMPLE aplicable', () => {
    const ventas = 150_000 * UVT_2026;
    const r = computeSimple(ventas, 'tiendas');
    expect(r.aplicaSimple).toBe(false);
    expect(r.tarifa).toBeNull();
    expect(r.impuesto).toBe(0);
    expect(r.advertencias.join(' ')).toMatch(/excluido del Régimen Simple/i);
  });

  it('compare() no puede recomendar el SIMPLE a un contribuyente excluido', () => {
    const ventas = 150_000 * UVT_2026;
    expect(compare(ventas, { group: 'tiendas', icaRate: 0.007 }).recommended).toBe('Ordinario');
  });
});

// ---------------------------------------------------------------------------
// 4. El IVA no integra el impuesto unificado (Arts. 907 y 915 E.T.)
// ---------------------------------------------------------------------------

describe('comparación simétrica — el IVA no entra por ningún lado', () => {
  it('computeOrdinario ya no suma IVA: total = renta + ICA', () => {
    const r = computeOrdinario(200_000_000, { icaRate: 0.007 });
    expect(r.total).toBeCloseTo(r.renta + (r.ica ?? 0), 6);
    expect(r).not.toHaveProperty('iva');
  });

  it('sin ICA municipal no se calcula ICA y se advierte', () => {
    const r = computeOrdinario(200_000_000);
    expect(r.ica).toBeNull();
    expect(r.total).toBeCloseTo(r.renta, 6);
    expect(r.advertencias.join(' ')).toMatch(/Ley 14 de 1983/);
  });
});

// ---------------------------------------------------------------------------
// 5. No hay tarifa nacional de ICA → no hay recomendación de régimen a ciegas
// ---------------------------------------------------------------------------

describe('compare() — no recomienda régimen con supuestos inventados', () => {
  it('sin tarifa de ICA municipal devuelve recommended = null', () => {
    const r = compare(97_992_000, { group: 'tiendas' });
    expect(r.recommended).toBeNull();
    expect(r.comparable).toBe(false);
    expect(r.savings).toBe(0);
    expect(r.advertencias.join(' ')).toMatch(/concejo municipal/i);
  });

  it('con tarifa municipal verificada sí compara', () => {
    const r = compare(97_992_000, { group: 'tiendas', icaRate: 0.0069 });
    expect(r.comparable).toBe(true);
    expect(r.recommended === 'RST' || r.recommended === 'Ordinario').toBe(true);
    expect(r.savings).toBeCloseTo(Math.abs(r.ordinario - r.rst), 6);
  });

  it('con aportes a pensión pero sin componente de ICA consolidado no recomienda', () => {
    const r = compare(97_992_000, {
      group: 'tiendas',
      icaRate: 0.0069,
      aportesPension: 3_000_000,
    });
    expect(r.recommended).toBeNull();
    expect(r.comparable).toBe(false);
  });

  it('expone los dos semáforos por separado', () => {
    const r = compare(200_000_000, { group: 'tiendas', icaRate: 0.0069 });
    expect(r.semaforo.concepto).toBe('tope-simple');
    expect(r.semaforo.level).toBe('verde');
    expect(r.semaforoIvaInc.concepto).toBe('umbral-iva-inc');
    expect(r.semaforoIvaInc.level).toBe('rojo');
  });
});

// ---------------------------------------------------------------------------
// 6. Descuento por aportes a pensión (Art. 903 par. 4 E.T.)
// ---------------------------------------------------------------------------

describe('descuento por aportes a pensión — nunca erosiona el ICA consolidado', () => {
  it('sin componente de ICA verificado el descuento NO se aplica (antes daba impuesto = 0)', () => {
    const ventas = 10_000_000;
    const bruto = ventas * 0.012;
    expect(computeRST(ventas, 'tiendas', 10_000_000)).toBeCloseTo(bruto, 6);
    expect(computeRST(ventas, 'tiendas', 10_000_000)).not.toBe(0);
  });

  it('con componente de ICA verificado el impuesto nunca baja del piso de ICA', () => {
    const ventas = 100_000_000;
    const icaConsolidadoRate = 0.004;
    const r = computeSimple(ventas, 'tiendas', {
      aportesPension: 50_000_000,
      icaConsolidadoRate,
    });
    expect(r.pisoIcaConsolidado).toBeCloseTo(ventas * icaConsolidadoRate, 6);
    expect(r.impuesto).toBeCloseTo(ventas * icaConsolidadoRate, 6);
    expect(r.impuesto).toBeGreaterThan(0);
  });

  it('el exceso del descuento se difiere, no se pierde (Art. 903 par. 4 E.T.)', () => {
    const ventas = 100_000_000;
    const aportes = 50_000_000;
    const r = computeSimple(ventas, 'tiendas', {
      aportesPension: aportes,
      icaConsolidadoRate: 0.004,
    });
    expect(r.descuentoPensionAplicado + r.descuentoPensionDiferido).toBeCloseTo(aportes, 6);
    expect(r.descuentoPensionDiferido).toBeGreaterThan(0);
    expect(r.advertencias.join(' ')).toMatch(/traslada a recibos/i);
  });

  it('un descuento pequeño sí baja el impuesto hasta el piso', () => {
    const ventas = 100_000_000;
    const bruto = ventas * 0.012;
    const r = computeSimple(ventas, 'tiendas', {
      aportesPension: 100_000,
      icaConsolidadoRate: 0.004,
    });
    expect(r.impuesto).toBeCloseTo(bruto - 100_000, 6);
    expect(r.descuentoPensionDiferido).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. UI Pyme — el semáforo visible no puede volver a hablar de "tope del RST"
// ---------------------------------------------------------------------------

describe('PymeHub — el semáforo mide responsabilidad de IVA, no el régimen', () => {
  const fuente = readFileSync(
    join(process.cwd(), 'src/components/workspace/pyme/PymeHub.tsx'),
    'utf8',
  );

  it('ya no le dice al usuario que superó el tope del Régimen Simple', () => {
    expect(fuente).not.toMatch(/superan el tope del Régimen Simple/i);
    expect(fuente).not.toMatch(/Pasó el tope — toca revisar su régimen/i);
  });

  it('no importa ni usa el antiguo topeRST()', () => {
    expect(fuente).not.toMatch(/topeRST/);
    expect(fuente).toMatch(/umbralNoResponsableIvaInc/);
  });

  it('la etiqueta de la escala habla de IVA, no de tope de régimen', () => {
    expect(fuente).not.toMatch(/Tope: \{copM/);
    expect(fuente).toMatch(/Cobrar IVA desde/);
  });
});
