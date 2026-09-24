// ---------------------------------------------------------------------------
// I4-escudo 5 — comentarios del código con citas sin fuente en el corpus
// ---------------------------------------------------------------------------
// Los comentarios no viajan al LLM, pero son la documentación que lee quien
// mantiene la regla. Dos citaban normas o criterios que el corpus
// (src/data/tax_docs) no respalda:
//   · contracts/audit-report.ts — JSDoc de TmtAnalysisSchema: listaba el RTE
//     (Art. 19), el SIMPLE, la ZESE y los hoteles como «excepciones legales
//     del parágrafo 6». El texto del parágrafo 6 (ley_2277_2022.md) está en
//     EXCEPCIONES_TTD_PAR6; el RTE y el SIMPLE no son excepciones del
//     parágrafo sino sujetos que no liquidan el Art. 240.
//   · fiscal-agent/tools/ccv-calculator.ts — «DIAN Concepto 4228 de 2026,
//     paragraph 4», que no está en el corpus.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXCEPCIONES_TTD_PAR6 } from '@/lib/agents/financial/tax-planning/prompts/tax-optimizer.prompt';

const src = (f: string) => readFileSync(join(process.cwd(), 'src/lib/agents/financial', f), 'utf8');

function jsdocAntesDe(texto: string, ancla: string): string {
  const fin = texto.indexOf(ancla);
  const ini = texto.lastIndexOf('/**', fin);
  // Una sola línea: sin los «*» de continuación del comentario.
  return texto.slice(ini, fin).replace(/\n\s*\*\s*/g, ' ');
}

describe('JSDoc de TmtAnalysisSchema (audit-report.ts)', () => {
  const doc = jsdocAntesDe(src('contracts/audit-report.ts'), 'export const TmtAnalysisSchema');

  it('no presenta al RTE ni al SIMPLE como excepciones del parágrafo 6', () => {
    expect(doc).not.toMatch(/excepciones[^.]*parag(?:rafo)?\s*6\s*\(RTE/i);
    expect(doc).toMatch(/RTE[\s\S]{0,80}SIMPLE[\s\S]{0,20}no son contribuyentes del Art\. 240/);
  });

  it('remite a EXCEPCIONES_TTD_PAR6 y a sus supuestos', () => {
    expect(doc).toContain('EXCEPCIONES_TTD_PAR6');
    expect(EXCEPCIONES_TTD_PAR6.join(' ')).toMatch(/ZESE/);
    expect(doc).toMatch(/ZOMAC/);
    expect(doc).toMatch(/UD\s*(?:≤|<=)\s*0/);
  });
});

describe('ccv-calculator.ts', () => {
  it('no cita el Concepto DIAN 4228 de 2026 (ausente del corpus)', () => {
    expect(src('escudo-survival/fiscal-agent/tools/ccv-calculator.ts')).not.toMatch(/4228/);
    // Nadie en el corpus lo recoge: si se incorpora, se puede volver a citar.
    const et = readFileSync(join(process.cwd(), 'src/data/tax_docs/estatuto_tributario_completo.md'), 'utf8');
    expect(et).not.toMatch(/Concepto DIAN 4228 de 2026/);
  });

  it('la regla que documenta (UD no es la UAI) conserva su fuente en el corpus', () => {
    const doc = jsdocAntesDe(src('escudo-survival/fiscal-agent/tools/ccv-calculator.ts'), 'export function buildAlertaTasaMinima');
    expect(doc).toMatch(/ley_2277_2022\.md/);
    const ley = readFileSync(join(process.cwd(), 'src/data/tax_docs/ley_2277_2022.md'), 'utf8');
    expect(ley).toMatch(/Utilidad Depurada/i);
    expect(ley).toMatch(/Impuesto Depurado/i);
  });
});
