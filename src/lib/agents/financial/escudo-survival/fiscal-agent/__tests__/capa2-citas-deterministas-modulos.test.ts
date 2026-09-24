// ---------------------------------------------------------------------------
// Capa 2 — citas deterministas de los módulos del Escudo (fase 2, I2 6b)
// ---------------------------------------------------------------------------
// El Motor Normativo bloquea (NO_VERIFICADO implícito) toda cita que no esté
// en su catálogo. Varias citas que los propios módulos escriben o exigen no
// estaban catalogadas, así que una salida honesta quedaba en «bloqueo»:
//   - Módulo 8 (supervivencia) y el Optimizador de dividendos: la norma
//     determinista de dividendos cita el Art. 242-1 E.T. (sociedad nacional
//     receptora, 10% trasladable) y la derogatoria del Art. 36-3 remite al
//     Concepto DIAN 2769 de 2026.
//   - Encabezado de todos los módulos (CONSTANTES OPERATIVAS) y prompt del
//     Módulo 8 (ALWAYS): «Art. 771-5 par. 1 E.T.», «Art. 771-5 par. 2 E.T.» y
//     «C.E. sentencia 26676 de 2023».
// Fuentes del corpus (src/data/tax_docs): estatuto_tributario_completo.md
// (Art. 242-1 mod. art. 12 Ley 2277/2022; Art. 771-5 par. 1 y 2 mod. art. 307
// Ley 1819/2016, con la sentencia 26676 como jurisprudencia concordante) y
// escudo_normativa_supervivencia_co_2026.md (Concepto 2769 de 19-feb-2026,
// num. 16; tesis de la sentencia 26676).
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOTOR_NORMATIVO_CATALOG } from '../../normative';
import { validateNormativeResponse } from '../../normative/validators/normative.validator';
import { buildFiscalAgentHeader } from '../prompts/fiscal-agent.prompt';
import { buildSupervivenciaPrompt } from '../prompts/supervivencia.prompt';
import { enforceDividend } from '../../lib/deterministic-survival';

function veredictos(texto: string): Map<string, string> {
  const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
  return new Map(r.citations.map((c) => [c.citation.normalized, c.veredicto]));
}

/** Citas que Capa 2 bloquea por no estar en el catálogo (NO_VERIFICADO implícito). */
function noVerificadas(texto: string): string[] {
  const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
  return [
    ...new Set(
      r.citations
        .filter((c) => c.veredicto === 'bloqueo' && /NO está en el catálogo/.test(c.mensaje))
        .map((c) => c.citation.normalized),
    ),
  ];
}

const corpus = (f: string) => readFileSync(join(process.cwd(), 'src/data/tax_docs', f), 'utf8');

describe('Capa 2 — citas deterministas del Módulo 8 y del Optimizador de dividendos', () => {
  it('la norma determinista de dividendos (Art. 242-1 E.T.) no se bloquea', () => {
    const legacy = enforceDividend({
      markdown: 'x',
      warnings: [],
      data: {
        utilidadDistribuible: 1,
        escenarios: {
          distribuirTotal: { ahorroSocio: 0, impuestoSocio: 0, netoSocio: 0, fortPatrimonio: null },
          capitalizarTotal: { ahorroSocio: 0, impuestoSocio: 0, netoSocio: 0, fortPatrimonio: null },
          hibrido50_50: { ahorroSocio: 0, impuestoSocio: 0, netoSocio: 0, fortPatrimonio: null },
        },
        recomendacion: 'x',
        norma: 'Art. 242-1 E.T.',
      },
    } as never);
    expect(legacy.data.norma).toBe('Art. 242-1 E.T.');
    expect(noVerificadas(legacy.data.norma)).toEqual([]);
    expect(veredictos('Art. 242-1 E.T.').get('Art. 242-1 E.T.')).not.toBe('bloqueo');
  });

  it('una salida honesta del Módulo 8 sobre dividendos y bancarización no queda NO_VERIFICADO', () => {
    const honesta = [
      'Capitalizar utilidades tributa como distribuir: Art. 242 E.T. para el socio persona natural y',
      'Art. 242-1 E.T. (retención del 10% trasladable) si el socio es una sociedad nacional;',
      'la derogatoria del incentivo la ratifica el DIAN Concepto 2769 de 2026 (Ley 2277 de 2022, art. 96).',
      'Bancarización: tope general del Art. 771-5 par. 1 E.T. y tope individual de 100 UVT por pago del',
      'Art. 771-5 parágrafo 2 E.T. (C.E. sentencia 26676 de 2023).',
    ].join(' ');
    expect(noVerificadas(honesta)).toEqual([]);
  });

  it('el prompt del Módulo 8 no exige citas fuera del catálogo', () => {
    const p = buildSupervivenciaPrompt('es');
    const exigidas = [...p.matchAll(/ALWAYS cita "([^"]+)"(?: o "([^"]+)")?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
    expect(exigidas.length).toBeGreaterThan(0);
    expect(noVerificadas(exigidas.join('. '))).toEqual([]);
  });

  it('las CONSTANTES OPERATIVAS del encabezado de los módulos sólo citan normas catalogadas', () => {
    const h = buildFiscalAgentHeader({ language: 'es' });
    const constantes = h.slice(h.indexOf('CONSTANTES OPERATIVAS 2026:'), h.indexOf('FORMATO DE SALIDA:'));
    expect(constantes).toMatch(/Art\. 771-5 par\. 2 E\.T\./);
    expect(noVerificadas(constantes)).toEqual([]);
  });

  it('una norma fuera del catálogo sigue bloqueando', () => {
    expect(noVerificadas('Art. 999-9 E.T.')).toContain('Art. 999-9 E.T.');
  });
});

describe('fuentes del corpus de las entradas nuevas', () => {
  const et = corpus('estatuto_tributario_completo.md');
  const pack = corpus('escudo_normativa_supervivencia_co_2026.md');

  it('Art. 242-1 E.T. — 10% trasladable a sociedades nacionales (mod. art. 12 Ley 2277/2022)', () => {
    expect(et).toMatch(/ARTÍCULO 242-1\. TARIFA ESPECIAL PARA DIVIDENDOS O PARTICIPACIONES/);
    expect(et).toMatch(/Inciso modificado por el artículo 12 de la Ley 2277 de 2022/);
    expect(et).toMatch(/tarifa del diez por ciento \(10%\) a título de retención en la\s+fuente sobre la renta, que será trasladable/);
  });

  it('Art. 771-5 par. 1 y 2 E.T. y sentencia 26676 de 2023', () => {
    expect(et).toMatch(/cuarenta por ciento \(40%\) de lo pagado, que en todo caso no podrá superar de cuarenta mil\s+\(40\.000\) UVT/);
    expect(et).toMatch(/pagos individuales realizados por personas jurídicas y\s+las personas naturales que perciban rentas no laborales/);
    expect(et).toMatch(/00\(26676\) de 19 de julio de 2023/);
    expect(pack).toMatch(/sentencia 26676 de 19-jul-2023/);
  });

  it('Concepto DIAN 2769 de 2026 (num. 16)', () => {
    expect(pack).toMatch(/DIAN, Concepto 2769 de 19-feb-2026 \(num\. 16\)/);
    expect(et).toMatch(/Concepto DIAN 2769 de 2026/);
  });
});
