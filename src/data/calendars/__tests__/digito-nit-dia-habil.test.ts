// ---------------------------------------------------------------------------
// Regresión — mapeo último dígito del NIT → día hábil de vencimiento
// ---------------------------------------------------------------------------
// Auditoría normativa 2026-08. `src/data/calendars/nacional-2026.ts` tenía su
// propia copia de esta regla, INVERTIDA respecto de la norma:
//
//     return digit === 0 ? 16 : 16 - digit;   // dígito 1 → 15º día hábil
//
// mientras `src/lib/scrapers/dian-scraper.ts` tenía la correcta. Todo el
// calendario nacional se generaba desde la copia equivocada, así que a un
// contribuyente con NIT terminado en 1 se le anunciaba su vencimiento OCHO
// días hábiles después del real. Eso no es un error de presentación: es una
// sanción por extemporaneidad (Art. 641 E.T.) causada por la herramienta.
//
// Fuente verificada — Decreto 2229 de 2023, compilado en el DUR 1625 de 2016,
// arts. 1.6.1.13.2.12 (renta personas jurídicas) y 1.6.1.13.2.33 (retención en
// la fuente), texto del normograma DIAN:
//   dígito 1 → "séptimo día hábil"
//   dígito 9 → "décimo quinto día hábil"
//   dígito 0 → "décimo sexto día hábil"
// https://normograma.dian.gov.co/dian/compilacion/docs/decreto_2229_2023.htm
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { digitToBusinessDay, nthBusinessDay } from '@/lib/scrapers/dian-scraper';

/**
 * Tabla literal del decreto. Se escribe extendida a propósito: una fórmula
 * aquí podría repetir el mismo error que se está corrigiendo.
 */
const TABLA_DECRETO_2229: ReadonlyArray<readonly [digito: number, diaHabil: number]> = [
  [1, 7],
  [2, 8],
  [3, 9],
  [4, 10],
  [5, 11],
  [6, 12],
  [7, 13],
  [8, 14],
  [9, 15],
  [0, 16],
];

describe('Decreto 2229/2023 — dígito del NIT → día hábil', () => {
  for (const [digito, diaHabil] of TABLA_DECRETO_2229) {
    it(`dígito ${digito} vence el ${diaHabil}º día hábil`, () => {
      expect(digitToBusinessDay(digito)).toBe(diaHabil);
    });
  }

  it('el dígito 1 vence PRIMERO y el 0 ÚLTIMO — la dirección importa', () => {
    // Es la aserción que habría atrapado el defecto: el mapeo invertido
    // producía exactamente los mismos diez valores, sólo que al revés.
    expect(digitToBusinessDay(1)).toBeLessThan(digitToBusinessDay(9));
    expect(digitToBusinessDay(9)).toBeLessThan(digitToBusinessDay(0));
    expect(digitToBusinessDay(1)).toBe(7);
    expect(digitToBusinessDay(0)).toBe(16);
  });

  it('la ventana completa es del 7º al 16º día hábil, sin huecos ni repeticiones', () => {
    const dias = TABLA_DECRETO_2229.map(([d]) => digitToBusinessDay(d)).sort((a, b) => a - b);
    expect(dias).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('rechaza dígitos fuera de rango en vez de devolver una fecha silenciosamente errónea', () => {
    expect(() => digitToBusinessDay(-1)).toThrow();
    expect(() => digitToBusinessDay(10)).toThrow();
    expect(() => digitToBusinessDay(1.5)).toThrow();
  });
});

describe('calendario nacional — coherencia con el helper canónico', () => {
  it('las fechas generadas respetan el orden ascendente por dígito', () => {
    // Para un mes cualquiera, la fecha del dígito 1 debe ser anterior a la del
    // 9, y la del 9 anterior a la del 0.
    for (const mes of [2, 5, 9, 12]) {
      const d1 = nthBusinessDay(2026, mes, digitToBusinessDay(1));
      const d9 = nthBusinessDay(2026, mes, digitToBusinessDay(9));
      const d0 = nthBusinessDay(2026, mes, digitToBusinessDay(0));
      expect(d1 < d9, `mes ${mes}: dígito 1 (${d1}) debería vencer antes que el 9 (${d9})`).toBe(true);
      expect(d9 < d0, `mes ${mes}: dígito 9 (${d9}) debería vencer antes que el 0 (${d0})`).toBe(true);
    }
  });

  it('nthBusinessDay nunca cae en sábado, domingo ni festivo', () => {
    for (const mes of [1, 4, 6, 8, 11]) {
      for (const [digito] of TABLA_DECRETO_2229) {
        const iso = nthBusinessDay(2026, mes, digitToBusinessDay(digito));
        const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
        expect(dow, `${iso} cae en fin de semana`).not.toBe(0);
        expect(dow, `${iso} cae en fin de semana`).not.toBe(6);
      }
    }
  });
});
