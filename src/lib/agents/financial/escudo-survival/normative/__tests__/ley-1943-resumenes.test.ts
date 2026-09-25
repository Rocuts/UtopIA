// ---------------------------------------------------------------------------
// I5-niif 5 — Resúmenes del Motor Normativo que citaban la Ley 1943 de 2018
// ---------------------------------------------------------------------------
// Los resúmenes del Art. 600 E.T., del par. 5 del Art. 240 E.T. y el motivo de
// BL_IVA_PERIODO_ANUAL decían «eliminado por Ley 1943/2018». El catálogo marca
// esa ley INEXEQUIBLE, así que una salida honesta que repetía el resumen que
// el propio prompt le dio al Agente Fiscal se bloqueaba.
//
// Decisión del coordinador: citar la Ley 2010 de 2019 si el corpus lo respalda
// y, si no, retirar la atribución sin inventar otra. Verificado en el corpus
// (src/data/tax_docs):
//   - Art. 600 E.T.: la Ley 2010 de 2019 no lo modifica (ley_2010_2019.md no
//     lo menciona). Su redacción vigente —sólo bimestral y cuatrimestral— es
//     la del art. 196 de la Ley 1819 de 2016 (ley_1819_2016.md), y la nota del
//     editor del DUR 1625 de 2016 (decreto_1625_2016.md) atribuye a ese mismo
//     artículo la eliminación de la declaración anual. Se cita esa fuente, que
//     está en el corpus, en vez de la Ley 1943.
//   - Par. 5 del Art. 240 E.T. (tarifa del 9% del régimen anterior): el art.
//     92 de la Ley 2010 de 2019 dio su redacción (ley_2010_2019.md).
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MOTOR_NORMATIVO_CATALOG as CATALOGO } from '../catalog';
import { buildMotorNormativoPrompt } from '../prompts/motor-normativo.prompt';
import { validateCitations } from '../validators/citation.validator';
import { validateNormativeResponse } from '../validators/normative.validator';

const TAX_DOCS = path.join(process.cwd(), 'src/data/tax_docs');
const corpus = (file: string) => fs.readFileSync(path.join(TAX_DOCS, file), 'utf-8');

const articulo = (id: string) => {
  const a = CATALOGO.articulosET.find((x) => x.id === id);
  if (!a) throw new Error(`sin ${id}`);
  return a;
};
const blacklist = (id: string) => {
  const b = CATALOGO.blacklist.find((x) => x.id === id);
  if (!b) throw new Error(`sin ${id}`);
  return b;
};

describe('el corpus respalda las fuentes citadas', () => {
  it('art. 196 de la Ley 1819 de 2016 sustituye el Art. 600 E.T. (bimestral y cuatrimestral)', () => {
    const ley1819 = corpus('ley_1819_2016.md');
    expect(ley1819).toMatch(/ARTÍCULO 196\. Modifíquese el artículo 600 del Estatuto Tributario/);
    expect(corpus('decreto_1625_2016.md')).toMatch(
      /La declaración anual fue eliminada en la modificación al artículo 600 del Estatuto por el artículo 196 de la L/,
    );
    // La Ley 2010 de 2019 no toca el Art. 600.
    expect(corpus('ley_2010_2019.md')).not.toMatch(/art[ií]culo 600/i);
  });

  it('art. 92 de la Ley 2010 de 2019 da la redacción del par. 5 del Art. 240 (9%)', () => {
    const ley2010 = corpus('ley_2010_2019.md');
    expect(ley2010).toMatch(/ARTÍCULO 92\. Modifíquense el inciso primero y el parágrafo 5/);
    expect(ley2010).toMatch(/PARÁGRAFO 5o\. Las siguientes rentas están gravadas a la tarifa del 9%/);
  });
});

describe('Motor Normativo — sin atribuciones a la Ley 1943 de 2018 (INEXEQUIBLE)', () => {
  it('una salida honesta que repite cada resumen no se bloquea', () => {
    for (const id of ['ART_600_ET', 'ART_240_PAR5_ET']) {
      const a = articulo(id);
      const r = validateNormativeResponse(`${a.cita}: ${a.resumen}`, CATALOGO);
      expect({ id, veredicto: r.veredictoGlobal }).not.toEqual({ id, veredicto: 'bloqueo' });
    }
    const razon = blacklist('BL_IVA_PERIODO_ANUAL').razon;
    expect(validateNormativeResponse(razon, CATALOGO).veredictoGlobal).not.toBe('bloqueo');
  });

  it('las atribuciones son las del corpus', () => {
    const a600 = articulo('ART_600_ET');
    expect(a600.resumen).toMatch(/artículo 196 de la Ley 1819 de 2016/);
    expect(a600.modificaciones.map((m) => m.norma)).toEqual(['Ley 1819 de 2016, art. 196']);
    expect(articulo('ART_240_PAR5_ET').resumen).toMatch(/art\. 92 de la Ley 2010 de 2019/);
    expect(blacklist('BL_IVA_PERIODO_ANUAL').razon).toMatch(/artículo 196 de la Ley 1819 de 2016/);
    // El resto del contenido de los resúmenes se conserva.
    expect(a600.resumen).toContain('92.000 UVT');
    expect(a600.resumen).toMatch(/SIN IMPORTAR EL MONTO DE SUS INGRESOS/);
    expect(articulo('ART_240_PAR5_ET').resumen).toMatch(/derecho adquirido/);
  });

  it('ningún texto que el prompt renderiza cita una norma INEXEQUIBLE', () => {
    const textos: Array<[string, string]> = [];
    for (const a of CATALOGO.articulosET) {
      if (a.estado === 'DEROGADO' || a.estado === 'INEXEQUIBLE') continue;
      textos.push([a.id, `${a.cita} — ${a.resumen}${a.textoLiteral ? ` ${a.textoLiteral}` : ''}`]);
    }
    for (const b of CATALOGO.blacklist) {
      textos.push([`${b.id}:razon`, b.razon]);
      if (b.alternativaCorrecta) textos.push([`${b.id}:alternativa`, b.alternativaCorrecta]);
    }
    for (const n of CATALOGO.normasAuditoria) textos.push([n.cita, `${n.cita} — ${n.titulo}: ${n.resumen}`]);
    const inexequibles = textos.flatMap(([id, t]) =>
      validateCitations(t, CATALOGO)
        .filter((c) => c.estado === 'INEXEQUIBLE')
        .map((c) => `${id}: ${c.citation.normalized}`),
    );
    expect(inexequibles).toEqual([]);
    expect(buildMotorNormativoPrompt({ language: 'es' })).not.toMatch(/1943/);
  });
});
