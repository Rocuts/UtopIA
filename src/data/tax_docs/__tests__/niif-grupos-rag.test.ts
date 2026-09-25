// ---------------------------------------------------------------------------
// Regresión prompts-normativa-16 — documentos RAG de grupos NIIF
// ---------------------------------------------------------------------------
// El chat contable recupera estos documentos con search_docs. Repetían los
// criterios de tamaño del Grupo 3 del Decreto 2706/2012 (10 trabajadores,
// 500 SMMLV, 6.000 SMMLV), reemplazados por el Decreto 1670 de 2021 (Art.
// 1.1.3.1 DUR 2420/2015; topes de microempresa en UVT del Decreto 957/2019), y
// exigían "activos Y empleados" para el Grupo 1 sin los parámetros adicionales.
// Deben decir lo mismo que el prompt del chat (fragments/niif-grupos.fragment.ts)
// y que el contexto del pipeline financiero (colombia-2026-context.ts).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DOCS = ['decreto_2420_2015_marco_niif.md', 'niif_colombia_2026.md'];

function seccion(doc: string, desde: RegExp, hasta: RegExp): string {
  const i = doc.search(desde);
  expect(i).toBeGreaterThan(-1);
  const resto = doc.slice(i);
  const j = resto.slice(1).search(hasta);
  return j === -1 ? resto : resto.slice(0, j + 1);
}

describe.each(DOCS)('%s', (nombre) => {
  const doc = readFileSync(join(__dirname, '..', nombre), 'utf-8');

  it('Grupo 3 usa los topes de microempresa del Decreto 957/2019 (Decreto 1670/2021)', () => {
    const g3 = seccion(doc, /### Grupo 3/, /\n##+ /);
    expect(g3).toMatch(/Decreto 1670 de 2021/);
    expect(g3).toMatch(/23\.563 UVT/);
    expect(g3).toMatch(/32\.988 UVT/);
    expect(g3).toMatch(/44\.769 UVT/);
    // Los criterios derogados sólo pueden aparecer en la advertencia.
    for (const linea of g3.split('\n').filter((l) => l.startsWith('- '))) {
      expect(linea).not.toMatch(/6\.000 SMMLV|500 SMMLV|10 trabajadores|10 o menos empleados/);
    }
  });

  it('Grupo 1: planta > 200 trabajadores o activos > 30.000 SMMLV más un parámetro adicional', () => {
    const g1 = seccion(doc, /### Grupo 1/, /\n### /);
    expect(g1).toMatch(/200 trabajadores o activos totales superiores a 30\.000 SMMLV/);
    expect(g1).toMatch(/importaciones o exportaciones/i);
    expect(g1).toMatch(/ingresos \*\*no\*\* son criterio/i);
  });
});
