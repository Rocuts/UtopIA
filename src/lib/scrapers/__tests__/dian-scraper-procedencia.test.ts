// Auditoría 2026-09 (tributario-calc-06 / -13, integración IW5b).
//
// 1. Las fechas del scraper se CALCULAN con la regla de días hábiles del
//    Decreto 2229/2023 y salen con `verified: false`, pero la nota decía
//    «Comunicado DIAN 128 … — verificado»: el usuario leía una procedencia que
//    la fila niega.
// 2. Los comentarios del calendario citaban la sanción del Art. 651 E.T. como
//    «hasta 15.000 UVT»; el artículo vigente gradúa 1 % / 0,7 % / 0,5 % con
//    tope de 7.500 UVT.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';

import { buildDeadlines2026 } from '../dian-scraper';

describe('dian-scraper — procedencia de las fechas calculadas', () => {
  it('ninguna fila no verificada afirma en su nota que fue verificada', () => {
    const contradictorias = buildDeadlines2026().filter(
      (d) => d.verified !== true && /(^|[^n]\s|—\s)verificad[oa]\b/i.test(d.notes ?? '') && !/no confrontada|no verificad/i.test(d.notes ?? ''),
    );
    expect(contradictorias.map((d) => `${d.obligation}/${d.period}/${d.nitDigit}: ${d.notes}`)).toEqual([]);
  });

  it('las filas calculadas declaran la regla y que no se confrontaron con la tabla oficial', () => {
    const retencion = buildDeadlines2026().filter((d) => d.obligation === 'Retención en la Fuente');
    expect(retencion.length).toBeGreaterThan(0);
    for (const d of retencion) {
      expect(d.notes).toMatch(/Decreto 2229\/2023/);
      expect(d.notes).toMatch(/no confrontada con la tabla oficial/);
    }
  });
});

describe('comentarios del Art. 651 E.T.', () => {
  const archivos = [
    path.resolve(process.cwd(), 'src/lib/scrapers/dian-scraper.ts'),
    path.resolve(process.cwd(), 'src/data/calendars/nacional-2026.ts'),
  ];

  it('no citan el tope derogado de 15.000 UVT', () => {
    for (const f of archivos) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/15\.000 UVT/);
    }
  });

  it('citan la graduación vigente (1 % / 0,7 % / 0,5 %, tope 7.500 UVT)', () => {
    for (const f of archivos) {
      expect(fs.readFileSync(f, 'utf8'), f).toMatch(/1 % \/ 0,7 % \/ 0,5 %, tope 7\.500 UVT/);
    }
  });
});
