// constants.test.ts — Pinea las constantes críticas de UVT 2026.
// Si cambian, los tests fallan y el equipo es notificado antes de producción.

import { describe, it, expect } from 'vitest';
import {
  UVT_2026_COP,
  UVT_2025_COP,
  uvtToCopByYear,
  RTF_THRESHOLD_UVT,
  RTF_HONORARIOS_THRESHOLD_UVT,
} from '../constants';

describe('Constantes UVT', () => {
  it('UVT_2026_COP === 52374 (Resolución DIAN 000187/2025)', () => {
    expect(UVT_2026_COP).toBe(52_374);
  });

  it('UVT_2025_COP === 49799', () => {
    expect(UVT_2025_COP).toBe(49_799);
  });

  it('RTF_THRESHOLD_UVT === 4 (Art. 401 ET)', () => {
    expect(RTF_THRESHOLD_UVT).toBe(4);
  });

  it('RTF_HONORARIOS_THRESHOLD_UVT === 0 (Art. 392 ET — desde el primer peso)', () => {
    expect(RTF_HONORARIOS_THRESHOLD_UVT).toBe(0);
  });
});

describe('uvtToCopByYear', () => {
  it('4 UVT en 2026 = 4 × 52374 = 209496 COP', () => {
    expect(uvtToCopByYear(4, 2026)).toBe(209_496);
  });

  it('4 UVT en 2025 = 4 × 49799 = 199196 COP', () => {
    expect(uvtToCopByYear(4, 2025)).toBe(199_196);
  });

  it('1 UVT en 2026 = 52374 COP (sin decimales)', () => {
    expect(uvtToCopByYear(1, 2026)).toBe(52_374);
  });

  it('1 UVT en 2025 = 49799 COP', () => {
    expect(uvtToCopByYear(1, 2025)).toBe(49_799);
  });

  it('año futuro >= 2027 usa tarifa 2026 (sin salto al pasado)', () => {
    // La función usa UVT_2026 para todo >= 2026
    expect(uvtToCopByYear(1, 2027)).toBe(52_374);
  });

  it('año histórico < 2025 usa tarifa 2025 como fallback conservador', () => {
    // Comportamiento documentado en constants.ts como TODO diferido
    expect(uvtToCopByYear(1, 2020)).toBe(49_799);
  });

  it('fracción de UVT se redondea correctamente (Math.round)', () => {
    // 1.5 UVT × 52374 = 78561 (exacto)
    expect(uvtToCopByYear(1.5, 2026)).toBe(78_561);
  });
});
