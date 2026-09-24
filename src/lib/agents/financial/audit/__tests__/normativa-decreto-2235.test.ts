/**
 * prompts-normativa-21 (remanentes) — Decreto 2235/2017 mal citado.
 *
 * Fuentes del repo (src/data/tax_docs; sin acceso web a fuentes oficiales):
 *  - decreto_1625_2016.md, Cap. 25 del Tít. 1 de la Parte 2 del Libro 1: el
 *    Decreto 2235 de 2017 reglamenta los contratos de concesión y las APP. No
 *    trata la conciliación fiscal ni las devoluciones de saldos a favor.
 *  - decreto_1998_2017.md: "Por el cual se sustituye la Parte 7 del Libro 1 del
 *    Decreto 1625 de 2016 ... para reglamentar la Conciliación Fiscal de que
 *    trata el artículo 772-1 del Estatuto Tributario" (Formato 2516).
 *  - decreto_1625_2016.md, Cap. 21 ("Procedimiento de devoluciones y/o
 *    compensaciones", Arts. 1.6.1.21.1 y ss.): reglamentación de la devolución
 *    de saldos a favor que analiza `retencionesAnalysis` junto al Art. 850 E.T.
 *
 * P3 corrigió los prompts; quedaban el `.describe` que llega al LLM (ejemplo de
 * norma de respaldo del análisis de retenciones) y el documento del corpus RAG
 * sobre el Art. 772-1, que atribuía el Formato 2516 al Decreto 2235/2017.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RetencionesAnalysisSchema } from '@/lib/agents/financial/contracts/audit-report';

const CORPUS = join(process.cwd(), 'src/data/tax_docs');

describe('Decreto 2235/2017 no es la norma de la conciliación fiscal ni de las devoluciones', () => {
  it('el ejemplo de norma de respaldo del análisis de retenciones (hacia el LLM) no cita el 2235', () => {
    const d = RetencionesAnalysisSchema.shape.reference.description ?? '';
    expect(d).not.toMatch(/2235/);
    expect(d).toContain('Art. 850 E.T.');
    expect(d).toContain('1.6.1.21.1');
  });

  it('corpus RAG Art. 772-1: el Formato 2516 se reglamenta por el Decreto 1998/2017', () => {
    const doc = readFileSync(join(CORPUS, 'et_articulo_772_1_conciliacion_contable_fiscal.md'), 'utf8');
    expect(doc).not.toMatch(/2235/);
    expect(doc).toMatch(/## Reglamentación: Decreto 1998\/2017/);
    expect(doc).toContain('decreto-1998-2017');
  });

  it('la fuente citada existe en el corpus y reglamenta el Art. 772-1', () => {
    const src = readFileSync(join(CORPUS, 'decreto_1998_2017.md'), 'utf8');
    expect(src).toMatch(/reglamentar la Conciliación Fiscal de que trata el artículo 772-1/);
  });
});
