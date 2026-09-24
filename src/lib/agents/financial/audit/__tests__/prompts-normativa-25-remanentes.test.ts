// ---------------------------------------------------------------------------
// prompts-normativa-25 (remanentes) y auditoria-calidad-31 (umbrales del RF)
// ---------------------------------------------------------------------------
// Cada afirmación normativa se contrasta con el corpus del repo
// (src/data/tax_docs); sin fuente en el corpus no se cambia la regla.
//
// (a) Auditor Tributario: listaba RTE, SIMPLE y FNCER como excepciones del
//     parágrafo 6 del Art. 240 E.T. Fuente: ley_2277_2022.md (art. 10) — la
//     lista literal ya vive en EXCEPCIONES_TTD_PAR6 del Tax Optimizer.
// (b) Modelador DCF: «NIC 36 … mínimo 5 años, §33». NIC 36.33(b) limita a un
//     MÁXIMO de 5 años las proyecciones basadas en presupuestos, salvo
//     justificación de un plazo mayor.
// (c) Gobierno: «Libros Oficiales registrados (Art. 28 C.Co. — actas,
//     accionistas, mayor)». El corpus (decreto_1074_2015.md, art.
//     2.2.2.39.4) nombra como libros inscritos en el registro mercantil los de
//     registro de socios o accionistas y los de actas; ninguna fuente del
//     corpus incluye el libro mayor.
// (d) Contexto 2026: «35% vigente desde el ejercicio 2023 por Ley 2277». La
//     fuente primaria del corpus (ley_2155_2021.md, art. 7) fija el 35% «a
//     partir del año gravable 2022»; la Ley 2277 (art. 10) lo conserva.
// auditoria-calidad-31: el texto de la Ley 43/1990 art. 13 par. 2 no está en
//     el corpus, así que el operador de los umbrales del revisor fiscal no se
//     cambia; la prueba fija que ambos prompts usan el mismo y lo documentan.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTaxAuditorPrompt } from '../prompts/tax-auditor.prompt';
import { buildLegalAuditorPrompt } from '../prompts/legal-auditor.prompt';
import { EXCEPCIONES_TTD_PAR6 } from '../../tax-planning/prompts/tax-optimizer.prompt';
import { buildDcfModelerPrompt } from '../../valuation/prompts/dcf-modeler.prompt';
import { buildGovernancePrompt } from '../../prompts/governance-specialist.prompt';
import { buildColombia2026Context } from '../../prompts/colombia-2026-context';

const company = { name: 'X SAS', nit: '1', niifGroup: 2, fiscalPeriod: '2025', entityType: 'SAS' } as never;
const companyLtda = { name: 'X LTDA', nit: '1', niifGroup: 2, fiscalPeriod: '2025', entityType: 'LTDA' } as never;
const corpus = (f: string) => readFileSync(join(process.cwd(), 'src/data/tax_docs', f), 'utf8');

describe('(a) Auditor Tributario — excepciones de la TTD del parágrafo 6', () => {
  const p = buildTaxAuditorPrompt(company, 'es');

  it('usa la lista literal del parágrafo 6 (EXCEPCIONES_TTD_PAR6)', () => {
    for (const e of EXCEPCIONES_TTD_PAR6) expect(p).toContain(e);
  });

  it('RTE y SIMPLE no son excepciones del parágrafo 6 (no son sujetos del Art. 240) y FNCER no aparece', () => {
    expect(p).not.toMatch(/excepciones del paragrafo 6 \(RTE/);
    expect(p).not.toMatch(/FNCER|Ley 1715/);
    expect(p).toMatch(/RTE \(Art\. 19\) y el SIMPLE \(Arts\. 903-916\)[^\n]*no son contribuyentes del Art\. 240/);
  });

  it('la fuente del corpus contiene las exclusiones', () => {
    const ley = corpus('ley_2277_2022.md');
    expect(ley).toMatch(/personas jur[ií]dicas extranjeras sin residencia/i);
    expect(ley).toMatch(/ZOMAC/);
  });
});

describe('(b) Modelador DCF — NIC 36.33(b)', () => {
  const p = buildDcfModelerPrompt(company, 'es');

  it('no afirma un mínimo de 5 años; el máximo de 5 años aplica salvo justificación', () => {
    expect(p).not.toMatch(/m[ií]nimo 5 años, §33/);
    expect(p).toMatch(/NIC 36\.33\(b\)[^\n]*máximo de 5 años[^\n]*salvo que se justifique un plazo mayor/);
  });
});

describe('(c) Gobierno — libros inscritos en el registro mercantil', () => {
  const p = buildGovernancePrompt(company, 'es');

  it('la enumeración no incluye el libro mayor y cita la fuente del corpus', () => {
    expect(p).not.toMatch(/libro de actas, accionistas, mayor/);
    expect(p).toMatch(/registro de socios o accionistas[^\n]*actas[^\n]*Decreto 1074\/2015 art\. 2\.2\.2\.39\.4/);
  });

  it('el corpus respalda la enumeración', () => {
    expect(corpus('decreto_1074_2015.md')).toMatch(
      /Los libros de registro de socios o accionistas y los de actas de asamblea y junta de socios, que deban ser\s+inscritos en el registro mercantil/,
    );
  });
});

describe('(d) Contexto 2026 — vigencia del 35% del Art. 240 E.T.', () => {
  it('el 35% rige desde el AG 2022 (Ley 2155/2021 art. 7), conservado por la Ley 2277/2022 (es/en espejo)', () => {
    const es = buildColombia2026Context('es');
    const en = buildColombia2026Context('en');
    expect(es).not.toMatch(/vigente desde el ejercicio 2023 por Ley 2277/);
    expect(en).not.toMatch(/in force since 2023 under Law 2277/);
    expect(es).toMatch(/35%\*\* \(desde el año gravable 2022 por el art\. 7 de la Ley 2155 de 2021; conservada por el art\. 10 de la Ley 2277 de 2022\)/);
    expect(en).toMatch(/35%\*\* \(since tax year 2022 under Art\. 7 of Law 2155 of 2021; kept by Art\. 10 of Law 2277 of 2022\)/);
  });

  it('la fuente primaria del corpus lo dice', () => {
    expect(corpus('ley_2155_2021.md')).toMatch(/treinta y cinco por ciento \(35%\), a partir del año gravable 2022/);
  });
});

describe('auditoria-calidad-31 — umbrales del revisor fiscal sin fuente en el corpus', () => {
  it('la Ley 43/1990 no está en el corpus: el operador no se cambia', () => {
    expect(existsSync(join(process.cwd(), 'src/data/tax_docs/ley_0043_1990.md'))).toBe(false);
  });

  it('Gobierno y Auditor Legal usan el mismo umbral y lo atribuyen al Art. 13 par. 2 Ley 43/1990', () => {
    const gov = buildGovernancePrompt(company, 'es');
    expect(gov).toMatch(/activos > 5\.000 SMMLV o ingresos > 3\.000 SMMLV/);
    const sas = buildLegalAuditorPrompt(company, 'es');
    const ltda = buildLegalAuditorPrompt(companyLtda, 'es');
    for (const p of [sas, ltda]) {
      expect(p).toMatch(/ingresos>3\.000 SMMLV o activos>5\.000 SMMLV \(Art\. 13 par\. 2 Ley 43\/1990\)/);
    }
  });
});
