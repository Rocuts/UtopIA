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
  it('UVT_2026_COP === 52374 (Resolución DIAN 000238/2025)', () => {
    expect(UVT_2026_COP).toBe(52_374);
  });

  it('UVT_2025_COP === 49799', () => {
    expect(UVT_2025_COP).toBe(49_799);
  });

  it('RTF_THRESHOLD_UVT === 2 (servicios — DUR 1.2.4.4.1, Decreto 0572/2025 vigente desde 01-jul-2026)', () => {
    expect(RTF_THRESHOLD_UVT).toBe(2);
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

  it('años históricos usan el UVT oficial de SU año (resoluciones DIAN)', () => {
    // Antes todo período < 2025 caía al UVT 2025 — retenciones históricas
    // incorrectas. La tabla UVT_BY_YEAR resuelve cada año con su valor real.
    expect(uvtToCopByYear(1, 2024)).toBe(47_065);
    expect(uvtToCopByYear(1, 2023)).toBe(42_412);
    expect(uvtToCopByYear(1, 2022)).toBe(38_004);
    expect(uvtToCopByYear(1, 2021)).toBe(36_308);
    expect(uvtToCopByYear(1, 2020)).toBe(35_607);
  });

  it('año anterior al histórico tabulado cae al más antiguo conocido (2020) con warning', () => {
    expect(uvtToCopByYear(1, 2015)).toBe(35_607);
  });

  it('fracción de UVT se redondea correctamente (Math.round)', () => {
    // 1.5 UVT × 52374 = 78561 (exacto)
    expect(uvtToCopByYear(1.5, 2026)).toBe(78_561);
  });
});
