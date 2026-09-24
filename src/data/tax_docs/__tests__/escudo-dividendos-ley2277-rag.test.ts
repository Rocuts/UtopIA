// ---------------------------------------------------------------------------
// Regresión — corpus RAG de dividendos, Art. 36-3 y bancarización
// ---------------------------------------------------------------------------
// Auditoría 2026-09 (prompts-normativa-18, tributario-calc-01). El chat busca
// primero en `search_docs` y cita textual. Estos dos documentos conservaban:
//   - el régimen de dividendos anterior a la Ley 2277 de 2022 («+10%
//     adicional», «35% + 10% sobre el remanente», 10% sobre 300 UVT);
//   - la capitalización de utilidades como INCRGNO por el Art. 36-3 E.T.,
//     derogado por el art. 96 de la Ley 2277 de 2022 (DIAN Concepto 2769/2026);
//   - la lectura acumulada «por beneficiario» del tope de 100 UVT del Art.
//     771-5 par. 2 (C.E. sentencia 26676 de 2023: por pago individual);
//   - la sobretasa financiera con umbral de «activos» (es renta gravable);
//   - el tope conjunto 255+256+257 al 30% (Art. 258: 25%).
// Fuente de los textos vigentes: `estatuto_tributario_completo.md` del corpus.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const leer = (f: string) => readFileSync(join(__dirname, '..', f), 'utf-8');
const ESCUDO = leer('escudo_normativa_supervivencia_co_2026.md');
const ART242 = leer('et_articulo_242_dividendos.md');

describe('corpus Escudo — régimen vigente Ley 2277 de 2022', () => {
  it('no conserva el régimen de dividendos anterior como vigente', () => {
    for (const doc of [ESCUDO, ART242]) {
      expect(doc).not.toMatch(/\+10% adicional/);
      expect(doc).not.toMatch(/35% \+ 10% sobre el remanente/);
    }
  });

  it('Art. 242: dividendos no gravados integran la base del Art. 241; la tabla 0%/15% es retención', () => {
    for (const doc of [ESCUDO, ART242]) {
      expect(doc).toMatch(/Art\. 241/);
      expect(doc).toMatch(/Ret(ención|encion) en la fuente/i);
      expect(doc).toMatch(/254-1/);
    }
    // La tabla 0/15% ya no se presenta como «Impuesto» del socio.
    expect(ART242).not.toMatch(/\| Impuesto 15% \|/);
    expect(ART242).not.toMatch(/Mínimo exento/);
  });

  it('Art. 36-3 figura como derogado y sin tratamiento INCRGNO para capitalizar utilidades', () => {
    expect(ESCUDO).toMatch(/36-3 E\.T\. — DEROGADO/);
    expect(ESCUDO).toMatch(/artículo 96 de la Ley 2277 de 2022/);
    expect(ESCUDO).not.toMatch(/Capitalización de utilidades vía emisión de acciones a los socios = INCRGNO/);
    expect(ART242).toMatch(/36-3 E\.T\.\*\*: DEROGADO/);
  });

  it('bancarización: tope de 100 UVT por pago individual; sin umbral de «activos» para la sobretasa', () => {
    expect(ESCUDO).not.toMatch(/a un mismo beneficiario en el año que superen 100 UVT/);
    expect(ESCUDO).toMatch(/PAGO INDIVIDUAL/);
    expect(ESCUDO).not.toMatch(/activos > 120\.000 UVT/);
  });

  it('tope conjunto Arts. 255/256/257 = 25% (Art. 258)', () => {
    expect(ESCUDO).not.toMatch(/30% del impuesto/);
    expect(ESCUDO).toMatch(/25% del impuesto/);
  });
});
