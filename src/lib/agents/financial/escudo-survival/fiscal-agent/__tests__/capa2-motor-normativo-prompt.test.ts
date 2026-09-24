// ---------------------------------------------------------------------------
// Capa 2 — el prompt del Motor Normativo sólo nombra normas que su validador
// acepta, y una norma derogada mencionada COMO derogada no bloquea (I4-escudo 3)
// ---------------------------------------------------------------------------
// (a) El Motor Normativo se inyecta en el encabezado de todos los módulos del
//     Agente Fiscal y ordena «toda cita debe coincidir con el Motor
//     Normativo». Pero nombraba normas que el propio validador bloqueaba como
//     NO_VERIFICADO (no catalogadas): Arts. 868, 634, 383, 383 par. 2, 381,
//     243 y 235-2 E.T.; Decretos 1625/2016, 0572/2025, 2231/2023, 1103/2023,
//     261/2023 y 242/2024; Ley 1430/2010; Sentencias C-389/2023 y C-050/2026;
//     Resolución DIAN 139/2012 (y el Decreto 2229/2023 del aviso del NIT).
//     Una salida honesta que las repitiera quedaba
//     en «bloqueo». Todas tienen fuente en src/data/tax_docs y se catalogan
//     con su archivo (ver `fuentes del corpus` abajo).
// (b) Art. 36-3 E.T. (decisión del coordinador): una cita catalogada DEROGADA
//     dentro de una frase que afirma su derogación pasa como advertencia;
//     citarla como vigente sigue bloqueando.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOTOR_NORMATIVO_CATALOG, buildMotorNormativoPrompt } from '../../normative';
import { validateNormativeResponse } from '../../normative/validators/normative.validator';
import { normalizeCitation } from '../../normative/validators/citation.validator';
import { buildFiscalAgentHeader, type FiscalAgentHeaderOptions } from '../prompts/fiscal-agent.prompt';
import { ART_36_3_DEROGADO_MOTIVO } from '../../lib/deterministic-survival';

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

function veredicto(texto: string, cita: string): string | undefined {
  const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
  return r.citations.find((c) => c.citation.normalized === cita)?.veredicto;
}

const USE_CASES: Array<FiscalAgentHeaderOptions['useCase']> = [
  undefined,
  'analisis_completo',
  'planeacion_tributaria',
  'defensa_dian',
  'devolucion_saldos',
  'modo_supervivencia',
];

describe('(a) el prompt del Motor Normativo no nombra normas que su validador bloquea', () => {
  it.each(USE_CASES.flatMap((u) => (['es', 'en'] as const).map((l) => [u ?? 'sin caso', l, u] as const)))(
    'Motor Normativo (%s, %s): ninguna cita NO_VERIFICADO',
    (_n, language, useCase) => {
      const p = buildMotorNormativoPrompt({ language, useCase, includeBlacklist: true });
      expect(noVerificadas(p)).toEqual([]);
    },
  );

  it.each(USE_CASES.map((u) => [u ?? 'sin caso', u] as const))(
    'encabezado de los módulos (%s): ninguna cita NO_VERIFICADO',
    (_n, useCase) => {
      const h = buildFiscalAgentHeader({ language: 'es', useCase, nitContext: '900123456-1' });
      expect(noVerificadas(h)).toEqual([]);
    },
  );

  // Salidas honestas que repiten lo que el Motor Normativo les da.
  const HONESTAS: Record<string, string> = {
    'CCV / retenciones': [
      'Las rentas de trabajo no laborales de quien no contrató dos o más trabajadores se retienen con la tabla',
      'del Art. 383 E.T. (Art. 383 par. 2 E.T.; Decreto 1625 de 2016, Art. 1.2.4.1.17 par. 4, mod. Decreto 2231 de 2023).',
      'Desde el 01-jul-2026 la base mínima de compras es 10 UVT (Decreto 0572 de 2025; también citado como Decreto 572 de 2025).',
      'El agente retenedor expide el certificado de retenciones por otros conceptos (Art. 381 E.T.).',
    ].join(' '),
    'Defensa DIAN / sanciones': [
      'Los valores no consignados causan intereses moratorios por cada día calendario de retardo (Art. 634 E.T.).',
      'La sanción mínima es 10 UVT (Art. 639 E.T.), convertida con el procedimiento de aproximaciones del Art. 868 E.T.',
    ].join(' '),
    'Conciliación / planeación': [
      'La sobretasa del Art. 240 par. 4 E.T. sólo grava la generación hídrica con renta gravable de al menos 30.000 UVT',
      '(Sentencia C-389 de 2023); el parágrafo fue declarado exequible por la Sentencia C-050 de 2026.',
      'En la utilidad depurada sólo se restan las rentas exentas de los literales a) y b) del numeral 4 y del numeral 7',
      'del Art. 235-2 E.T. Nueve puntos de la tarifa tienen destinación específica (Art. 243 E.T.).',
      'Las autorretenciones de los CIIU 0510, 0520 y 0610 se ajustaron con el Decreto 261 de 2023 y el Decreto 242 de 2024.',
    ].join(' '),
    'Supervivencia / dividendos': [
      'Los dividendos gravados tributan primero a la tarifa del Art. 240 E.T. y luego al escalón del Art. 242 E.T.',
      '(Decreto 1103 de 2023). La deducción por inversión en activos fijos quedó eliminada desde el año gravable 2011',
      'por la Ley 1430 de 2010; el beneficio vigente es el descuento del Art. 258-1 E.T.',
    ].join(' '),
    'Devoluciones / ReteIVA': [
      'La venta de chatarra a siderúrgicas (código 241 de la Resolución DIAN 139 de 2012) tiene retención del 100% del IVA',
      '(Art. 437-4 E.T.).',
    ].join(' '),
  };

  it.each(Object.entries(HONESTAS))('salida honesta de %s: sin NO_VERIFICADO ni bloqueos', (_m, texto) => {
    expect(noVerificadas(texto)).toEqual([]);
    const r = validateNormativeResponse(texto, MOTOR_NORMATIVO_CATALOG);
    expect(r.citations.filter((c) => c.veredicto === 'bloqueo').map((c) => c.citation.normalized)).toEqual([]);
    expect(r.veredictoGlobal).not.toBe('bloqueo');
  });

  it('una norma fuera del catálogo sigue bloqueando', () => {
    expect(noVerificadas('Art. 999-9 E.T. y Decreto 9999 de 2030')).toEqual([
      'Art. 999-9 E.T.',
      'Decreto 9999 de 2030',
    ]);
  });

  it('el número del decreto se normaliza sin ceros a la izquierda (0572 = 572)', () => {
    expect(normalizeCitation('Decreto 0572/2025')?.normalized).toBe('Decreto 572 de 2025');
    expect(normalizeCitation('Decreto 572 de 2025')?.normalized).toBe('Decreto 572 de 2025');
  });

  it('el par. 3 del Art. 240 no atribuye a los Decretos 261/2023 y 242/2024 la certificación de percentiles', () => {
    const par3 = MOTOR_NORMATIVO_CATALOG.articulosET.find((a) => a.id === 'ART_240_PAR3_ET')!;
    // Ley 2277/2022 art. 10 par. 3: la UPME y la ANH publican por resolución.
    expect(par3.resumen).toMatch(/UPME/);
    expect(par3.resumen).not.toMatch(/recogida en decreto reglamentario/);
  });
});

describe('(b) Art. 36-3 E.T.: derogado mencionado como derogado ⇒ advertencia; como vigente ⇒ bloqueo', () => {
  it('frases que afirman la derogación (es/en) pasan como advertencia', () => {
    for (const t of [
      'El Art. 36-3 E.T. fue derogado por el art. 96 de la Ley 2277 de 2022.',
      'Capitalizar tributa como distribuir: el Art. 36-3 E.T. está derogado desde 2023.',
      'La Ley 2277 de 2022 derogó el Art. 36-3 E.T.',
      'Art. 36-3 E.T. was repealed by Ley 2277 de 2022 (art. 96).',
    ]) {
      expect(veredicto(t, 'Art. 36-3 E.T.'), t).toBe('advertencia');
    }
  });

  it('las frases deterministas del Módulo 8 y del prompt de supervivencia no bloquean', () => {
    const r = validateNormativeResponse(ART_36_3_DEROGADO_MOTIVO, MOTOR_NORMATIVO_CATALOG);
    expect(r.veredictoGlobal).not.toBe('bloqueo');
    expect(veredicto(ART_36_3_DEROGADO_MOTIVO, 'Art. 36-3 E.T.')).toBe('advertencia');
  });

  it('citarlo como vigente sigue bloqueando', () => {
    for (const t of [
      'Según el Art. 36-3 E.T., la capitalización de utilidades es un ingreso no constitutivo de renta.',
      'El Art. 36-3 E.T. no fue derogado y sigue vigente.',
      'The Art. 36-3 E.T. has not been repealed and remains in force.',
      // La afirmación de derogación está en OTRA frase: no protege a esta cita.
      'El Art. 36-3 E.T. permite capitalizar sin impuesto. La Ley 2277 de 2022 derogó otras normas.',
      // «E.T.» al final de una frase la cierra: la derogación del Art. 158-3 no
      // se extiende a la frase siguiente.
      'La Ley 1819 de 2016 derogó el Art. 158-3 E.T. El Art. 36-3 E.T. permite capitalizar sin impuesto.',
    ]) {
      expect(veredicto(t, 'Art. 36-3 E.T.'), t).toBe('bloqueo');
    }
  });

  it('la regla no alcanza a la blacklist: Art. 158-3 E.T. sigue bloqueando aunque se diga derogado', () => {
    const t = 'El Art. 158-3 E.T. fue derogado por la Ley 1819 de 2016.';
    expect(validateNormativeResponse(t, MOTOR_NORMATIVO_CATALOG).veredictoGlobal).toBe('bloqueo');
  });
});

describe('fuentes del corpus de las entradas nuevas (src/data/tax_docs)', () => {
  const corpus = (f: string) => readFileSync(join(process.cwd(), 'src/data/tax_docs', f), 'utf8');
  const et = corpus('estatuto_tributario_completo.md');

  it('artículos del E.T.', () => {
    expect(et).toMatch(/ARTICULO 868\. UNIDAD DE VALOR TRIBUTARIO, UVT\. <Artículo modificado por\s+el artículo 50 de la Ley 1111 de 2006/);
    expect(et).toMatch(/procedimiento de aproximaciones/);
    expect(et).toMatch(/ARTÍCULO 634\. INTERESES MORATORIOS\. <Artículo modificado por el artículo 278 de\s+la Ley 1819 de 2016/);
    expect(et).toMatch(/ARTICULO 383\. TARIFA\. <Inciso 1o\. y tabla de retención modificados por el artículo 42 de\s+la Ley 2010 de 2019/);
    expect(et).toMatch(/PARÁGRAFO 2o\. <Ver Notas del Editor> <Inciso modificado por el artículo 8 de la Ley 2277\s+de 2022/);
    expect(et).toMatch(/ARTICULO 381\. CERTIFICADOS POR OTROS CONCEPTOS/);
    expect(et).toMatch(/ARTÍCULO 243\. DESTINACIÓN ESPECÍFICA\. <Artículo modificado por el artículo 102\s+de la Ley 1819 de 2016/);
    expect(et).toMatch(/ARTÍCULO 235-2\. RENTAS EXENTAS A PARTIR DEL AÑO GRAVABLE 2019\. <Artículo\s+modificado por el artículo 91 de la Ley 2010 de 2019/);
  });

  it('decretos, ley, sentencias y resolución', () => {
    expect(corpus('decreto_1625_2016.md')).toMatch(/Decreto Único Reglamentario en materia tributaria/);
    expect(corpus('decreto_0572_2025.md')).toMatch(/DECRETO 572 DE 2025/);
    expect(corpus('decreto_572_2025_autorretenciones.md')).toMatch(/auto CE 30229 del 02-jun-2026/);
    expect(corpus('decreto_2231_2023.md')).toMatch(/reglamentan parcialmente los artículos 206, 331, 336 y 383/);
    expect(corpus('decreto_1103_2023.md')).toMatch(/reglamentan parcialmente los artículos 242, 242-1, 245 y 246/);
    expect(corpus('decreto_0261_2023.md')).toMatch(/DECRETO 261 DE 2023/);
    expect(corpus('decreto_0242_2024.md')).toMatch(/tarifas de retención y autorretención/);
    expect(corpus('ley_1430_2010.md')).toMatch(/A partir del año gravable 2011, ningún contribuyente/);
    expect(corpus('decreto_2229_2023.md')).toMatch(/calendarios de plazos/);
    const l2277 = corpus('ley_2277_2022.md');
    expect(l2277).toMatch(/Sentencia C-389-23 de 4 de octubre de 2023/);
    expect(l2277).toMatch(/Sentencia C-\s*050-26 de 13 de marzo de 2026/);
    expect(l2277).toMatch(/Unidad de Planeación Minero-Energética/);
    expect(corpus('ley_1607_2012.md')).toMatch(/código 241 de la Resolución 139 de 2012/);
    expect(corpus('decreto_1625_2016.md')).toMatch(/CIIU Rev\. 4 A\.C, adoptada mediante la Resolución 000114 de 2020/);
  });
});
