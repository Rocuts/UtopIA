/**
 * prompts-normativa-21 — citas normativas inexactas en los prompts de
 * aseguramiento (Revisor Fiscal, Dictamen 4) y del dictamen fiscal.
 *
 * Fuentes del repo (src/data/tax_docs; sin acceso web a fuentes oficiales):
 *  - decreto_1998_2017.md: "Por el cual se sustituye la Parte 7 del Libro 1
 *    del Decreto 1625 de 2016 ... para reglamentar la Conciliación Fiscal de
 *    que trata el artículo 772-1 del Estatuto Tributario" (el Formato 2516 no
 *    lo reglamenta el Decreto 2235/2017, que el prompt citaba).
 *  - ley_1762_2015.md, Art. 27: adiciona el numeral 10 al Art. 207 C.Co.
 *    (reporte a la UIAF de operaciones sospechosas).
 *  - decreto_1074_2015.md: estados financieros "certificados ... conforme lo
 *    señalado por el artículo 37 de la Ley 222 de 1995".
 *  - estatuto_tributario_completo.md, Art. 659 E.T.: las sanciones al contador
 *    o revisor fiscal son "en los términos de la Ley 43 de 1990" y las impone
 *    la Junta Central de Contadores.
 * Los artículos que el corpus no respalda ("Ley 43 art. 10 = forma del
 * dictamen", "Ley 222 art. 38 = responsabilidad personal / art. 43 =
 * sanciones JCC", "Ley 43 art. 37 par. 1-5") salen de los prompts; la forma
 * y el contenido del dictamen se citan por el Art. 208 C.Co. y las NIA.
 */

import { describe, expect, it } from 'vitest';
import { buildFiscalReviewerPrompt } from '../audit/prompts/fiscal-reviewer.prompt';
import { buildComplianceCheckerPrompt } from '../fiscal-opinion/prompts/compliance-checker.prompt';
import { buildOpinionDrafterPrompt } from '../fiscal-opinion/prompts/opinion-drafter.prompt';
import type { CompanyInfo } from '../types';

const company: CompanyInfo = {
  name: 'Comercializadora Andina SAS',
  nit: '900123456-7',
  fiscalPeriod: '2025',
};

describe('prompts-normativa-21 — citas del aseguramiento y del dictamen fiscal', () => {
  it('Formato 2516: Decreto 1998/2017 (DUR 1625/2016 Parte 7), no el 2235/2017', () => {
    const p = buildFiscalReviewerPrompt(company, 'es');
    expect(p).not.toMatch(/Decreto 2235/);
    expect(p).toContain('reference="Art. 772-1 E.T. / Decreto 1998/2017"');
  });

  it('Verificador de cumplimiento: sin Ley 43 art. 10 como forma del dictamen ni Ley 222 arts. 38/43 mal atribuidos', () => {
    for (const lang of ['es', 'en'] as const) {
      const p = buildComplianceCheckerPrompt(company, lang);
      expect(p).not.toMatch(/art\. 10 \(forma del dictamen\)/i);
      expect(p).not.toMatch(/art\. 38 \(responsabilidad personal\)|art\. 43 \(sanciones JCC\)/i);
      expect(p).not.toMatch(/art\. 37 par\. 1-5/i);
      expect(p).toMatch(/Ley 222\/1995 Art\. 37/);
      expect(p).toMatch(/Junta Central de Contadores.*Ley 43\/1990.*Art\. 659 E\.T\./);
      // Función 10 del Art. 207 C.Co.: Ley 1762/2015 (Art. 27), respaldada en el corpus.
      expect(p).toMatch(/Funcion 10: reportar a UIAF operaciones sospechosas \(Ley 1762\/2015 Art\. 27\)/);
    }
  });

  it('Redactor del dictamen: la forma del dictamen se cita por el Art. 208 C.Co. y las NIA, no por la Ley 43 art. 10', () => {
    const p = buildOpinionDrafterPrompt(company, 'es');
    expect(p).not.toMatch(/Ley 43\/1990 art\. 10/i);
    expect(p).toMatch(/Art\. 208 C\.Co\. y NIA 700\/705\/706/);
  });
});
