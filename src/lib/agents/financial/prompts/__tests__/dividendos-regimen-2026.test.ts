// ---------------------------------------------------------------------------
// Regresion — Auditoria normativa 2026-08-07, grupo "dividendos".
// ---------------------------------------------------------------------------
// Blinda los cuatro prompts que codificaban tarifas de dividendos inexistentes
// o derogadas contra el regimen realmente vigente en el ano gravable 2026.
//
// CITAS NORMATIVAS VERIFICADAS (07-ago-2026):
//   - Art. 242 E.T., modificado por el Art. 3 de la Ley 2277 de 2022.
//     Inciso 1: los dividendos no gravados pagados a persona natural residente
//     estan sujetos a la tarifa del Art. 241 E.T. (progresiva, 0% a 39%).
//     Inciso 2: los dividendos provenientes de utilidades gravadas conforme al
//     paragrafo 2 del Art. 49 E.T. estan sujetos a la tarifa del Art. 240 E.T.
//     Paragrafo (reglamentado por el Decreto 1103 de 2023): retencion en la
//     fuente escalonada — "0 a 1.090 UVT: 0%" / "Mayor a 1.090 UVT:
//     (Dividendos decretados en UVT menos 1.090 UVT) x 15%". Es un anticipo
//     imputable, no el impuesto definitivo.
//     Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1103_2023.htm
//   - Art. 254-1 E.T., adicionado por el Art. 5 de la Ley 2277 de 2022,
//     aplicable desde el ano gravable 2023: descuento tributario sobre la renta
//     liquida cedular de dividendos — 0% hasta 1.090 UVT y 19% sobre el exceso.
//   - Art. 242-1 E.T.: 10% de retencion trasladable e imputable, SOLO para
//     sociedades nacionales receptoras.
//   - Art. 245 E.T., modificado por el Art. 4 de la Ley 2277 de 2022: 20% para
//     sociedades u otras entidades extranjeras / no residentes. Ese es el UNICO
//     20% del regimen — no pertenece al Art. 242.
//   - Art. 49 E.T. (numerales 1 a 5 y paragrafo 2): maximo de utilidad
//     susceptible de distribuirse como ingreso no constitutivo de renta ni
//     ganancia ocasional; el exceso se reparte como dividendo GRAVADO.
//   - Escala DEROGADA el 31-dic-2022 por la Ley 2277/2022: 10% sobre el exceso
//     de 300 UVT (Art. 242 pre-reforma). NUNCA debe aparecer en un prompt.
//   - UVT 2026 = $52.374 (Resolucion DIAN 000238 del 15-dic-2025)
//     => 1.090 UVT = $57.087.660.
//
//   - Grupo 3 (contabilidad simplificada): Art. 1.1.3.1 del Decreto 2420 de
//     2015 modificado por el Decreto 1670 de 2021 (vigente desde el
//     01-ene-2023), que derogo los criterios de tamano del Anexo 3 / Decreto
//     2706 de 2012 (10 trabajadores, 500 SMMLV de activos, 6.000 SMMLV de
//     ingresos). Topes de microempresa del Decreto 1074 de 2015 (Cap. 13,
//     Tit. 1, Parte 2, Libro 2, adicionado por el Decreto 957 de 2019):
//     manufacturero <= 23.563 UVT, servicios <= 32.988 UVT, comercio
//     <= 44.769 UVT.
//   - Decreto 0701 del 07-jul-2026 (Diario Oficial 53.547 del 08-jul-2026,
//     rige desde el 09-jul-2026 por su art. 5): modifica los marcos tecnicos
//     de los Grupos 1 y 2 del DUR 2420 de 2015. Sin transicion: aplica al
//     ejercicio 2026 que el producto dictamina.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { buildColombia2026Context } from '../colombia-2026-context';
import { buildStrategyDirectorPrompt } from '../strategy-director.prompt';
import { buildLegalAuditorPrompt } from '../../audit/prompts/legal-auditor.prompt';
import { buildDividendOptimizerPrompt } from '../../escudo-survival/prompts/dividend-optimizer.prompt';
import type { CompanyInfo } from '../../types';

const company: CompanyInfo = {
  name: 'Comercializadora Andina S.A.S.',
  nit: '900.123.456-7',
  entityType: 'SAS',
  fiscalPeriod: '2026',
  comparativePeriod: '2025',
};

/** Normaliza para buscar sin depender de tildes ni de saltos de linea. */
function flat(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// 1. colombia-2026-context.ts — se antepone a TODOS los agentes del pipeline
// ---------------------------------------------------------------------------

describe('colombia-2026-context — regimen de dividendos (Arts. 242, 242-1, 245, 254-1, 49 E.T.)', () => {
  for (const language of ['es', 'en'] as const) {
    describe(`idioma ${language}`, () => {
      const ctx = flat(buildColombia2026Context(language));

      it('NO afirma una tarifa del 20% para personas naturales residentes bajo el Art. 242 E.T.', () => {
        // Regresion del bug: "Art. 242 ET — 20% para personas naturales residentes".
        expect(ctx).not.toMatch(/Art\.?\s*242\s*E?\.?T\.?\s*[—-]\s*20%/i);
        expect(ctx).not.toMatch(/20%\s*(para|for)\s*(personas naturales residentes|resident individuals)/i);
      });

      it('remite los dividendos no gravados de PN residente a la tarifa progresiva del Art. 241 E.T.', () => {
        expect(ctx).toMatch(/Art\.?\s*241/i);
        expect(ctx).toMatch(/0%\s*(a|to)\s*39%/i);
      });

      it('codifica la retencion escalonada del paragrafo del Art. 242 (0% hasta 1.090 UVT, 15% sobre el exceso)', () => {
        expect(ctx).toMatch(/1\.090 UVT|1,090 UVT/);
        expect(ctx).toMatch(/15%/);
        expect(ctx).toContain('$57.087.660');
        expect(ctx).toMatch(/Decreto 1103 de 2023|Decree 1103 of 2023/i);
      });

      it('declara la retencion como anticipo imputable y no como impuesto definitivo', () => {
        expect(ctx).toMatch(/ANTICIPO IMPUTABLE|IMPUTABLE PREPAYMENT/i);
      });

      it('incluye el descuento del Art. 254-1 E.T. (19% sobre el exceso de 1.090 UVT)', () => {
        expect(ctx).toMatch(/254-1/);
        expect(ctx).toMatch(/19%/);
      });

      it('atribuye el 20% al Art. 245 (no residentes) y el 10% al Art. 242-1 (sociedad nacional)', () => {
        expect(ctx).toMatch(/Art\.?\s*245[^.]{0,400}20%|20%[^.]{0,400}Art\.?\s*245/i);
        expect(ctx).toMatch(/242-1/);
        expect(ctx).toMatch(/10%/);
      });

      it('exige el tope del Art. 49 E.T. para separar dividendo gravado de no gravado', () => {
        expect(ctx).toMatch(/Art\.?\s*49/i);
        expect(ctx).toMatch(/Art\.?\s*240 E?\.?T\.?[^.]{0,80}35%|35%[^.]{0,120}Art\.?\s*240/i);
      });
    });
  }

  it('las versiones ES y EN son coherentes en las cifras del regimen de dividendos', () => {
    const es = flat(buildColombia2026Context('es'));
    const en = flat(buildColombia2026Context('en'));
    for (const token of ['1.090 UVT', '$57.087.660', '15%', '19%', '35%', '20%', '10%', '254-1', '242-1', '245']) {
      expect(es.includes(token), `ES debe contener ${token}`).toBe(true);
    }
    for (const token of ['1,090 UVT', '$57.087.660', '15%', '19%', '35%', '20%', '10%', '254-1', '242-1', '245']) {
      expect(en.includes(token), `EN debe contener ${token}`).toBe(true);
    }
  });
});

describe('colombia-2026-context — Grupo 3 (Decreto 1670 de 2021) y cadena DUR 2420/2015', () => {
  for (const language of ['es', 'en'] as const) {
    const ctx = flat(buildColombia2026Context(language));

    it(`[${language}] no define el Grupo 3 por los criterios derogados del Decreto 2706 de 2012`, () => {
      // El Decreto 2706/2012 puede citarse SOLO para advertir que sus criterios
      // de tamano fueron derogados; nunca como el criterio aplicable.
      expect(ctx).not.toMatch(/microempresas que cumplen criterios del Decreto 2706 de 2012/i);
      expect(ctx).not.toMatch(/microenterprises meeting Decree 2706 of 2012 criteria/i);
    });

    it(`[${language}] ancla el Grupo 3 en el Decreto 1670 de 2021 y los topes de microempresa por macrosector`, () => {
      expect(ctx).toMatch(/Decreto 1670 de 2021|Decree 1670 of 2021/i);
      expect(ctx).toMatch(/23\.563 UVT|23,563 UVT/);
      expect(ctx).toMatch(/32\.988 UVT|32,988 UVT/);
      expect(ctx).toMatch(/44\.769 UVT|44,769 UVT/);
    });

    it(`[${language}] declara el Decreto 0701 de 2026 como parte del marco del ejercicio 2026`, () => {
      expect(ctx).toMatch(/0701/);
      expect(ctx).toMatch(/1611 de 2022|1611 of 2022/i);
      expect(ctx).toMatch(/1271 de 2024|1271 of 2024/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. strategy-director.prompt.ts — macro-supuestos de los 3 escenarios
// ---------------------------------------------------------------------------

describe('strategy-director — macro-supuesto de dividendos', () => {
  const prompt = flat(buildStrategyDirectorPrompt(company, 'es'));

  it('NO declara "Dividendos: 20% (Art. 242 E.T.)"', () => {
    expect(prompt).not.toMatch(/Dividendos:\s*20%\s*\(Art\.?\s*242/i);
  });

  it('modela la carga del socio con la escala del Art. 241 y la retencion del 15%/1.090 UVT', () => {
    expect(prompt).toMatch(/Art\.?\s*241/);
    expect(prompt).toMatch(/1\.090 UVT/);
    expect(prompt).toContain('$57.087.660');
    expect(prompt).toMatch(/254-1/);
  });

  it('reserva el 20% para el Art. 245 (no residentes)', () => {
    expect(prompt).toMatch(/No residente: 20% \(Art\.?\s*245/i);
  });
});

// ---------------------------------------------------------------------------
// 3. legal-auditor.prompt.ts — dictamen societario firmable
// ---------------------------------------------------------------------------

describe('legal-auditor — retencion sobre dividendos en el dictamen societario', () => {
  const prompt = flat(buildLegalAuditorPrompt(company, 'es'));

  it('NO instruye una retencion del 10% sobre dividendos gravados bajo el Art. 242 E.T.', () => {
    // Escala derogada el 31-dic-2022 (10% sobre el exceso de 300 UVT).
    expect(prompt).not.toMatch(/Retencion 10% dividendos gravados/i);
    expect(prompt).not.toMatch(/retencion 10% dividendos gravados \(Art\.?\s*242/i);
  });

  it('impuestoDividendosComment ya no fuerza el 10% y exige el regimen vigente', () => {
    expect(prompt).not.toMatch(/impuestoDividendosComment SIEMPRE menciona Art\.?\s*242 E\.T\. \(retencion 10%/i);
    expect(prompt).toMatch(/impuestoDividendosComment SIEMPRE cita/i);
    expect(prompt).toMatch(/15% sobre el exceso de 1\.090 UVT/);
    expect(prompt).toMatch(/Art\.?\s*240 E\.T\. \(35%\)/);
  });

  it('separa el 10% (Art. 242-1, sociedad nacional) y el 20% (Art. 245, no residentes)', () => {
    expect(prompt).toMatch(/242-1/);
    expect(prompt).toMatch(/Art\.?\s*245 E\.T\./);
  });

  it('prohibe explicitamente atribuir el 10% o el 20% al Art. 242 E.T.', () => {
    expect(prompt).toMatch(/NEVER atribuyas al Art\.?\s*242 E\.T\. una retencion del 10% ni una tarifa plana del 20%/i);
  });
});

// ---------------------------------------------------------------------------
// 4. dividend-optimizer.prompt.ts — escenarios distribuir vs capitalizar
// ---------------------------------------------------------------------------

describe('dividend-optimizer — formula del impuesto al socio y tope del Art. 49 E.T.', () => {
  const prompt = flat(buildDividendOptimizerPrompt('es'));

  it('NO modela la retencion del 15% como impuesto unico y definitivo del socio', () => {
    expect(prompt).not.toMatch(
      /distribuirTotal: impuestoSocio = max\(0, \(utilidadDistribuible - 57\.087\.660\) x 0\.15\)/i,
    );
  });

  it('declara la retencion del 15% como anticipo imputable y remite al Art. 241 + descuento Art. 254-1', () => {
    expect(prompt).toMatch(/ANTICIPO IMPUTABLE/);
    expect(prompt).toMatch(/Art\.?\s*241 E\.T\./);
    expect(prompt).toMatch(/254-1/);
    expect(prompt).toMatch(/19%/);
    expect(prompt).toMatch(/Decreto 1103 de 2023/);
  });

  it('prohibe presentar la retencion del 15% como impuesto definitivo', () => {
    expect(prompt).toMatch(/NEVER presentes la retencion del 15% como el impuesto definitivo/i);
  });

  it('NO asume sin mas que todo el dividendo es no gravado: exige el tope del Art. 49 E.T. o un warning', () => {
    expect(prompt).not.toMatch(
      /Asumir socio persona natural residente, dividendo NO gravado en cabeza de la sociedad \(caso PYME mas comun\) salvo que el user content indique lo contrario\./i,
    );
    expect(prompt).toMatch(/Art\.?\s*49 E\.T\./);
    expect(prompt).toMatch(/paragrafo 2 del Art\.?\s*49 E\.T\./i);
    expect(prompt).toMatch(/porcionGravada/);
    expect(prompt).toMatch(/warning/i);
    expect(prompt).toMatch(/NEVER asumas que el 100% de la utilidad distribuible es dividendo no gravado/i);
  });

  it('mantiene la regla vigente de capitalizacion (Art. 36-3 E.T., impuestoSocio = 0)', () => {
    // No debe romperse el validator C1.6 al corregir el escenario de distribucion.
    expect(prompt).toMatch(/impuestoSocio = 0 \(INCRGNO Art\.?\s*36-3 E\.T\.\)/);
  });

  it('sigue prohibiendo la escala derogada del 10% pre-Ley 2277/2022', () => {
    expect(prompt).toMatch(/NEVER apliques retencion del 10% legacy/i);
  });
});
