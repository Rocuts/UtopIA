// ---------------------------------------------------------------------------
// I5-niif 8 — decreto_572_2025_autorretenciones.md: origen del 35 %
// ---------------------------------------------------------------------------
// El resumen atribuía a la Ley 2277 de 2022 un «35% efectivo». La tarifa
// general del 35 % del Art. 240 E.T. la fijó el art. 7 de la Ley 2155 de 2021
// a partir del año gravable 2022 (ley_2155_2021.md); el art. 10 de la Ley 2277
// de 2022 la conservó (ley_2277_2022.md). Es una tarifa nominal, no «efectiva».
// Mismo criterio que art240-tarifa-35-desde-2022-rag.test.ts (I4-escudo 4).
// Tras el cambio hace falta reingestar el índice RAG (`npm run db:ingest`).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..');
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');

describe('decreto_572_2025_autorretenciones.md — tarifa general del 35 %', () => {
  const t = read('decreto_572_2025_autorretenciones.md');

  it('las fuentes primarias del corpus respaldan la atribución', () => {
    expect(read('ley_2155_2021.md')).toMatch(
      /ARTÍCULO 7o\. Modifíquese el inciso 1[\s\S]{0,600}treinta y cinco por ciento \(35%\), a partir del año gravable 2022/,
    );
    expect(read('ley_2277_2022.md')).toMatch(/ARTÍCULO 10\. Modifíquese el Artículo 240[\s\S]{0,600}treinta y cinco por ciento \(35%\)/);
  });

  it('no atribuye a la Ley 2277 un «35% efectivo»', () => {
    expect(t).not.toMatch(/35 ?% efectivo/);
    expect(t).not.toMatch(/35 ?%[^\n]{0,40}Ley 2277/);
  });

  it('cita la Ley 2155 de 2021 (art. 7) como origen y la Ley 2277 como la que la conserva', () => {
    expect(t).toMatch(/tarifa general del 35 ?% del Art\. 240 E\.T\. \(fijada por el art\. 7 de la Ley 2155 de 2021/);
    expect(t).toMatch(/conservada por el art\. 10 de la Ley 2277 de 2022/);
    expect(t).toMatch(/relatedNorms: \[[^\]]*"Ley 2155 de 2021"/);
  });
});
