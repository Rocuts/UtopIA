// ---------------------------------------------------------------------------
// I4-escudo 4 — resumen curado del Art. 240 E.T.: el 35 % rige desde el año
// gravable 2022 (Ley 2155 de 2021), no «desde 2023» por la Ley 2277.
// ---------------------------------------------------------------------------
// Fuentes primarias DEL REPO:
//   · ley_2155_2021.md, art. 7: «será del treinta y cinco por ciento (35%), a
//     partir del año gravable 2022».
//   · ley_2010_2019.md, art. 92: 32 % (AG 2020), 31 % (AG 2021) y 30 % a partir
//     del AG 2022 — este último sustituido por el 35 % de la Ley 2155.
//   · ley_1819_2016.md, art. 100: tarifa general del 33 %.
// El resumen et_articulo_240_renta_juridica.md decía «35 % desde 2023» (Ley
// 2277) y «33 % (2018-2022)» (Ley 1819), en contra de esas fuentes.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildColombia2026Context } from '@/lib/agents/financial/prompts/colombia-2026-context';

const DIR = join(__dirname, '..');
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');

describe('fuentes primarias del corpus', () => {
  it('Ley 2155 de 2021 art. 7: 35 % a partir del año gravable 2022', () => {
    expect(read('ley_2155_2021.md')).toMatch(
      /será\s+del treinta y cinco por ciento \(35%\), a partir del año gravable 2022/,
    );
  });

  it('Ley 2010 de 2019 art. 92: 32 % / 31 % / 30 %; Ley 1819 de 2016 art. 100: 33 %', () => {
    expect(read('ley_2010_2019.md')).toMatch(
      /treinta y dos por ciento \(32%\) para el año gravable 2020, treinta y uno por ciento \(31%\) para\s+el año gravable 2021 y del treinta por ciento \(30%\) a partir del año gravable 2022/,
    );
    expect(read('ley_1819_2016.md')).toMatch(/ARTÍCULO 100\. Modifíquese el artículo 240[\s\S]{0,700}será del 33%/);
  });
});

describe('et_articulo_240_renta_juridica.md — historia de la tarifa general', () => {
  const t = read('et_articulo_240_renta_juridica.md');

  it('no atribuye el 35 % a la Ley 2277 «desde 2023» ni el 33 % a 2018-2022', () => {
    expect(t).not.toMatch(/35 ?% desde 2023/);
    expect(t).not.toMatch(/33 ?% \(2018-2022\)/);
  });

  it('registra el 35 % desde el AG 2022 por la Ley 2155 y su conservación por la Ley 2277', () => {
    expect(t).toMatch(/Ley 2155 de 2021, art\. 7\*\*: tarifa general del 35 % a partir del año gravable 2022/);
    expect(t).toMatch(/Ley 2277 de 2022, art\. 10\*\*: [^\n]*conserva la tarifa general del 35 %/);
    expect(t).toMatch(/Ley 2010 de 2019, art\. 92\*\*/);
  });
});

describe('colombia-2026-context — mismo origen de la tarifa (es/en)', () => {
  it('35 % desde el año gravable 2022 (Ley 2155), conservado por la Ley 2277', () => {
    expect(buildColombia2026Context('es')).toMatch(/35%\*\* \(desde el año gravable 2022 por el art\. 7 de la Ley 2155 de 2021/);
    expect(buildColombia2026Context('en')).toMatch(/35%\*\* \(since tax year 2022 under Art\. 7 of Law 2155 of 2021/);
  });
});
