/**
 * Regresiones normativas sobre PROMPTS — bancarizacion (Art. 771-5 E.T.) y
 * regimen SIMPLE frente al IVA (Art. 915 E.T.).
 *
 * Los prompts son la frontera donde el LLM toma la decision que el cliente
 * firma; una instruccion equivocada aqui produce un dictamen equivocado. Estos
 * tests FALLAN contra la version previa de ambos prompts.
 *
 * Fuentes consultadas (agosto 2026):
 *  - Art. 771-5 §2 E.T. medido por TRANSACCION INDIVIDUAL, no por acumulado
 *    anual por beneficiario. Consejo de Estado, Seccion Cuarta,
 *    Sent. 11001-03-27-000-2022-00041-00 (26676) del 19-jul-2023, que anulo
 *    parcialmente los Oficios DIAN 0935 y 1275 de 2018:
 *    https://www.consejodeestado.gov.co/documentos/boletines/269/11001-03-27-000-2022-00041-00(26676).pdf
 *    https://www.ambitojuridico.com/noticias/tributario/anulan-parcialmente-oficios-dian-sobre-limite-de-100-uvt-para-pagos-en-efectivo
 *  - Art. 771-5 §5 E.T. (agro / comercializador SIMPLE / cooperativas de
 *    productores agricolas): 70% de costos desde 2022, sin limite de 100 UVT.
 *    DIAN Concepto 010383 del 22-jun-2026:
 *    https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2026/07/dian-nuevas-precisiones-sobre-la-aplicacion-del-limite-de-100-uvt-para-pagos-en-efectivo/
 *    https://www.contadia.com/estatuto-tributario/articulo-771-5-medios-de-pago-para-efectos-de-la-aceptacion-de-costos-deducciones-pasivos-e-impuestos-descontables
 *  - Art. 915 E.T.: el SIMPLE NO exime de IVA; declaracion anual consolidada.
 *    Unica excepcion: Art. 437 par. 4 E.T. (solo actividades del num. 1 del
 *    Art. 908 E.T.). El INC de bares/restaurantes si se integra (Art. 907 E.T.):
 *    https://www.contadia.com/estatuto-tributario/articulo-915-regimen-de-iva-y-de-impuesto-al-consumo
 *    https://www.gerencie.com/regimen-simple-y-su-relacion-con-el-iva.html
 */

import { describe, it, expect } from 'vitest';
import { buildAntiDianAuditorPrompt } from '../escudo-survival/prompts/anti-dian-auditor.prompt';
import { buildFiscalReviewerPrompt } from '../audit/prompts/fiscal-reviewer.prompt';
import type { CompanyInfo } from '../types';

const company: CompanyInfo = {
  name: 'Comercializadora Andina SAS',
  nit: '900123456-7',
  fiscalPeriod: '2025',
};

describe('Anti-DIAN — Art. 771-5 §2 E.T. se mide por PAGO INDIVIDUAL', () => {
  const prompt = buildAntiDianAuditorPrompt('es');

  it('no instruye acumular pagos del ano al mismo NIT contra las 100 UVT', () => {
    // Defecto previo: "pagos a un mismo NIT en efectivo no pueden exceder
    // 100 UVT = $5.237.400 al ano" y "listar cada pago a un mismo NIT >
    // $5.237.400". Anulado por C. de E. 26676/2023.
    expect(prompt).not.toMatch(/a un mismo NIT en efectivo no pueden exceder/i);
    expect(prompt).not.toMatch(/100 UVT = \$5\.237\.400 al ano/i);
    expect(prompt).toMatch(/listar cada PAGO individual/i);
  });

  it('cita la sentencia que fijo la lectura por transaccion', () => {
    expect(prompt).toContain('26676');
    expect(prompt).toMatch(/Consejo de Estado/i);
    expect(prompt).toMatch(/0935 y 1275 de 2018/);
  });

  it('prohibe expresamente agregar pagos por beneficiario', () => {
    expect(prompt).toMatch(/NEVER sumes los pagos en efectivo hechos a un mismo NIT/i);
    expect(prompt).toMatch(/PAGO POR PAGO/i);
  });

  it('conserva el tope de 100 UVT = $5.237.400 por transaccion (UVT 2026 $52.374)', () => {
    expect(prompt).toContain('$5.237.400');
    expect(prompt).toContain('100 UVT');
  });
});

describe('Anti-DIAN — Art. 771-5 §5 E.T. (agro, comercializador SIMPLE, cooperativas)', () => {
  const prompt = buildAntiDianAuditorPrompt('es');

  it('modela el regimen especial del paragrafo 5', () => {
    // Defecto previo: el prompt solo modelaba §1 y §2; el §5 no aparecia.
    expect(prompt).toContain('771-5 §5');
    expect(prompt).toMatch(/70%/);
    expect(prompt).toMatch(/agropecuario/i);
    expect(prompt).toMatch(/cooperativas/i);
  });

  it('declara que el §5 no esta sujeto al limite individual de 100 UVT', () => {
    expect(prompt).toMatch(/SIN el limite individual de 100 UVT/i);
    expect(prompt).toContain('010383');
  });

  it('da la formula del exceso bajo §5 y una regla de decision de regimen', () => {
    expect(prompt).toMatch(/0\.70 x costosTotales/);
    expect(prompt).toMatch(/If el contribuyente pertenece al sector agropecuario/i);
  });

  it('exige warning cuando el regimen no se puede determinar (no recomienda a ciegas)', () => {
    expect(prompt).toMatch(/regimen de bancarizacion no determinado/i);
  });

  it('mantiene la gradualidad historica del §5 (85% 2020, 75% 2021, 70% desde 2022)', () => {
    expect(prompt).toMatch(/85% en 2020, 75% en 2021, 70% desde/i);
  });
});

describe('Revisor Fiscal — Art. 915 E.T.: el SIMPLE NO exime de IVA', () => {
  const prompt = buildFiscalReviewerPrompt(company, 'es');

  it('elimina la instruccion "SIMPLE exime IVA"', () => {
    // Defecto previo: "'no_aplica' (regimen no obliga, ej. SIMPLE exime IVA)".
    expect(prompt).not.toMatch(/SIMPLE exime IVA/i);
    expect(prompt).not.toMatch(/ej\.\s*SIMPLE exime/i);
    // La unica aparicion admisible de "SIMPLE exime" es dentro de la
    // prohibicion explicita ("NEVER afirmes que el Regimen SIMPLE exime...").
    const apariciones = prompt.match(/SIMPLE exime/gi) ?? [];
    expect(apariciones).toHaveLength(1);
    expect(prompt).toMatch(/NEVER afirmes que el Regimen SIMPLE exime/i);
  });

  it('instruye la declaracion anual consolidada de IVA del Art. 915 E.T.', () => {
    expect(prompt).toContain('Art. 915 E.T.');
    expect(prompt).toMatch(/anual consolidada/i);
    expect(prompt).toMatch(/recibo electronico SIMPLE/i);
  });

  it('reserva la excepcion al Art. 437 par. 4 E.T. (num. 1 del Art. 908 E.T.)', () => {
    expect(prompt).toContain('Art. 437 par. 4 E.T.');
    expect(prompt).toMatch(/UNICAMENTE actividades del numeral 1 del Art\. 908/i);
    expect(prompt).toMatch(/peluquer/i);
  });

  it('prohibe afirmar que el SIMPLE exime, releva o sustituye el IVA', () => {
    expect(prompt).toMatch(
      /NEVER afirmes que el Regimen SIMPLE exime, releva o sustituye el IVA/i,
    );
  });

  it('distingue el INC (integrado, Art. 907 E.T.) del IVA (no integrado)', () => {
    expect(prompt).toContain('Art. 907 E.T.');
    expect(prompt).toMatch(/NUNCA se extiende al IVA/i);
  });

  it('el ejemplo de "no_aplica" ya no es el IVA del SIMPLE', () => {
    expect(prompt).toMatch(/'no_aplica' \(el regimen realmente NO obliga/);
  });
});
