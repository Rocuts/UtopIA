// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Regresión de la auditoría normativa 2026-08
// ---------------------------------------------------------------------------
//
// Cada bloque de este archivo blinda UNA corrección verificada contra fuente.
// La cita normativa y la fuente consultada quedan en el comentario del bloque.
// Todos los asserts fallan con la versión del catálogo anterior a 2026-08.
//
// Regla de oro: el catálogo alimenta el Motor Normativo, que es fuente directa
// de los dictámenes que el cliente FIRMA ante la DIAN. Una cifra colapsada
// (una tarifa escalonada resumida en un solo número, un umbral omitido) produce
// un dictamen con apariencia de verificado y contenido falso.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import { ARTICULOS_ET } from '../catalog/estatuto-tributario';
import { LEYES_REFORMAS } from '../catalog/leyes-reformas';
import { SANCIONES } from '../catalog/sanciones';

import type {
  LawReformEntry,
  NormativeArticleEntry,
  SanctionEntry,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers de lookup — fallan ruidosamente si la entrada no existe, que es
// exactamente lo que queremos cuando el fix consiste en AÑADIR una entrada.
// ---------------------------------------------------------------------------

function articulo(id: string): NormativeArticleEntry {
  const found = ARTICULOS_ET.find((a) => a.id === id);
  if (!found) throw new Error(`ARTICULOS_ET no contiene la entrada ${id}`);
  return found;
}

function ley(id: string): LawReformEntry {
  const found = LEYES_REFORMAS.find((l) => l.id === id);
  if (!found) throw new Error(`LEYES_REFORMAS no contiene la entrada ${id}`);
  return found;
}

function sancion(id: string): SanctionEntry {
  const found = SANCIONES.find((s) => s.id === id);
  if (!found) throw new Error(`SANCIONES no contiene la entrada ${id}`);
  return found;
}

/** Texto completo de una entrada de artículo (resumen + literal + comentarios de tags). */
function textoArticulo(id: string): string {
  const a = articulo(id);
  return `${a.titulo}\n${a.resumen}\n${a.textoLiteral ?? ''}`;
}

// UVT oficiales usadas en las conversiones del catálogo.
// UVT 2025 = $49.799 (Resolución DIAN 000193 de 2024).
// UVT 2026 = $52.374 (Resolución DIAN 000238 del 15-dic-2025).
const UVT_2025 = 49_799;
const UVT_2026 = 52_374;

// ---------------------------------------------------------------------------
// Art. 368-2 E.T. — umbral de PN comerciantes retenedoras
// ---------------------------------------------------------------------------
// Norma: Art. 368-2 E.T. (adicionado por el Art. 115 de la Ley 488 de 1998);
//        conversión a pesos conforme al Art. 868 E.T.
// Fuente: https://actualicese.com/personas-naturales-retenedoras-2026/
//         "Para el año gravable 2026 serán retenedoras las personas naturales
//          comerciantes que en el año 2025 hayan tenido un patrimonio bruto o
//          ingresos brutos superiores a 30.000 UVT ($1.493.970.000)".
// Vigencia: todo el año gravable 2026.
// ---------------------------------------------------------------------------
describe('Art. 368-2 E.T. — el umbral de 30.000 UVT se convierte con la UVT del año evaluado', () => {
  it('expone el umbral 2026 calculado con la UVT 2025 ($1.493.970.000)', () => {
    expect(30_000 * UVT_2025).toBe(1_493_970_000);
    expect(textoArticulo('ART_368_2_ET')).toContain('1.493.970.000');
  });

  it('advierte que $1.571.220.000 (30.000 × UVT 2026) es el umbral que rige en 2027, no en 2026', () => {
    expect(30_000 * UVT_2026).toBe(1_571_220_000);
    const texto = textoArticulo('ART_368_2_ET');
    expect(texto).toContain('2027');
    // El defecto original enunciaba "superiores a 30.000 UVT (2026: $1.571.220.000)"
    // como si esa fuera la cifra a comparar durante 2026.
    expect(texto).not.toContain('30.000 UVT (2026: $1.571.220.000)');
  });
});

// ---------------------------------------------------------------------------
// Art. 240 E.T. — tarifas sectoriales y sobretasas
// ---------------------------------------------------------------------------
// Norma: Art. 240 E.T., parágrafos 2 a 7, modificados/adicionados por el
//        Art. 10 de la Ley 2277 de 2022.
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-240-tarifa-general-para-personas-juridicas
//         https://leyes.co/se_expide_el_estatuto_tributario_de_los_impuestos_administrados_por_la_direccion_general_de_impuestos_nacionales/240.htm
// Vigencia: desde el año gravable 2023.
// ---------------------------------------------------------------------------
describe('Art. 240 E.T. — el resumen general no puede afirmar tarifas derogadas', () => {
  const resumen = () => articulo('ART_240_ET').resumen;

  it('no declara "Hoteles 9%" ni "Editoriales 0%"', () => {
    expect(resumen()).not.toContain('Hoteles 9%');
    expect(resumen()).not.toContain('Editoriales 0%');
  });

  it('registra las TRES sobretasas (par. 2, par. 3 y par. 4), no dos', () => {
    const r = resumen();
    expect(r).toContain('par. 2');
    expect(r).toContain('par. 3');
    expect(r).toContain('par. 4');
  });

  it('no atribuye la sobretasa hidroeléctrica a los acueductos', () => {
    // Sentencia C-389 de 2023: la sobretasa solo grava la generación hídrica.
    expect(resumen()).not.toMatch(/hidroel[ée]ctricas y acueductos/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 5 E.T. — hoteles al 15%
// Fuente: contadia / leyes.co (par. 5: "quince por ciento (15%)... por 10 años").
// Vigencia: desde el AG 2023. El 9% solo como derecho adquirido pre-Ley 2277/2022.
// ---------------------------------------------------------------------------
describe('Art. 240 par. 5 E.T. — servicios hoteleros y parques temáticos: 15%, no 9%', () => {
  it('existe entrada propia con la tarifa del 15% y el término de 10 años', () => {
    const texto = textoArticulo('ART_240_PAR5_ET');
    expect(texto).toContain('15%');
    expect(texto).toContain('10 años');
  });

  it('documenta que el 9% solo subsiste como derecho adquirido', () => {
    expect(textoArticulo('ART_240_PAR5_ET')).toMatch(/derecho adquirido/i);
  });

  it('la entrada de la Ley 2068 de 2020 ya no afirma el 9% como tarifa vigente', () => {
    const resumen = ley('LEY_2068_2020').resumen;
    expect(resumen).toContain('15%');
    expect(resumen).not.toMatch(/tarifa reducida del 9% para hoteles est[áa] en el par[áa]grafo 5/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 7 E.T. — editoriales al 15%
// Norma: par. 7 adicionado por el Art. 10 de la Ley 2277 de 2022 (antes par. 4 al 9%).
// Fuente: https://actualicese.com/esta-sera-la-nueva-tarifa-del-impuesto-de-renta-para-empresas-editoriales/
//         "cuya actividad económica y objeto social sea exclusivamente la edición
//          de libros, en los términos de la Ley 98 de 1993, será del 15 %".
// Vigencia: desde el AG 2023. La tarifa 0% no está vigente para ningún AG reciente.
// ---------------------------------------------------------------------------
describe('Art. 240 par. 7 E.T. — empresas editoriales: 15%, no 0%', () => {
  it('existe entrada propia con la tarifa del 15% y el requisito de exclusividad', () => {
    const texto = textoArticulo('ART_240_PAR7_ET');
    expect(texto).toContain('15%');
    expect(texto).toMatch(/EXCLUSIVAMENTE/i);
    expect(texto).toContain('Ley 98 de 1993');
  });

  it('la entrada de la Ley 98 de 1993 ya no promete tarifa cero', () => {
    const entrada = ley('LEY_98_1993');
    expect(entrada.titulo).not.toMatch(/0%/);
    expect(entrada.resumen).not.toMatch(/tarifa cero/i);
    expect(entrada.resumen).toContain('15%');
    // El requisito de exclusividad estaba ausente y ampliaba el beneficio a
    // editoriales con actividades mixtas que no califican.
    expect(entrada.resumen).toMatch(/EXCLUSIVAMENTE/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 2 E.T. — sobretasa financiera con umbral de 120.000 UVT
// Fuente: contadia / leyes.co — "solo aplicables a las personas jurídicas que en
//         el año gravable correspondiente tengan una renta gravable igual o
//         superior a 120.000 UVT"; anticipo del 100% en dos cuotas iguales.
// Vigencia: AG 2023 a 2027.
// ---------------------------------------------------------------------------
describe('Art. 240 par. 2 E.T. — la sobretasa del 5% tiene umbral y anticipo', () => {
  it('registra el umbral de 120.000 UVT convertido con la UVT del año gravable', () => {
    expect(120_000 * UVT_2026).toBe(6_284_880_000);
    const texto = textoArticulo('ART_240_PAR2_ET');
    expect(texto).toContain('120.000 UVT');
    expect(texto).toContain('6.284.880.000');
  });

  it('registra el anticipo del 100% en dos cuotas', () => {
    const texto = textoArticulo('ART_240_PAR2_ET');
    expect(texto).toMatch(/anticipo del 100%/i);
    expect(texto).toMatch(/dos cuotas/i);
  });

  it('ya no mezcla la sobretasa hidroeléctrica ni a los acueductos en el par. 2', () => {
    const texto = textoArticulo('ART_240_PAR2_ET');
    expect(texto).not.toMatch(/acueductos/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 4 E.T. — sobretasa hidroeléctrica
// Norma: par. 4 (Art. 10 Ley 2277/2022); Sentencia C-389 de 2023 (exequibilidad
//        condicionada); Sentencia C-050 de 2026 (umbral exequible).
// Fuente: https://www.corteconstitucional.gov.co/relatoria/2023/c-389-23.htm
// Vigencia: AG 2023 a 2026 inclusive.
// ---------------------------------------------------------------------------
describe('Art. 240 par. 4 E.T. — generación hídrica: umbral, plantas menores y C-389/23', () => {
  it('registra el umbral de 30.000 UVT de renta gravable', () => {
    const texto = textoArticulo('ART_240_PAR4_ET');
    expect(texto).toContain('30.000 UVT');
    expect(texto).toContain('1.571.220.000');
  });

  it('excluye las centrales de capacidad igual o inferior a 1.000 kW', () => {
    expect(textoArticulo('ART_240_PAR4_ET')).toContain('1.000 kW');
  });

  it('registra que los acueductos NO son sujetos de la sobretasa', () => {
    expect(textoArticulo('ART_240_PAR4_ET')).toMatch(/NO cobija a las empresas de acueducto/i);
  });

  it('registra el condicionamiento de la Sentencia C-389 de 2023', () => {
    const entrada = articulo('ART_240_PAR4_ET');
    const historial = entrada.modificaciones.map((m) => `${m.norma} ${m.cambio}`).join('\n');
    expect(`${entrada.resumen}\n${historial}`).toContain('C-389 de 2023');
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 3 E.T. — sobretasa de hidrocarburos y carbón (estaba AUSENTE)
// Norma: par. 3 (Art. 10 Ley 2277/2022); Decreto 261 de 2023 y Decreto 242 de 2024
//        (precios promedio y percentiles).
// Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0242_2024.htm
//         contadia / leyes.co (escalonamiento por percentiles).
// Vigencia: desde el AG 2023. Los puntos del año dependen del acto anual.
// ---------------------------------------------------------------------------
describe('Art. 240 par. 3 E.T. — extracción de petróleo y carbón: escalonamiento por percentiles', () => {
  it('reproduce el escalonamiento completo, no un número único', () => {
    const texto = textoArticulo('ART_240_PAR3_ET');
    // Petróleo crudo: 0 / 5 / 10 / 15 puntos → hasta 50%.
    expect(texto).toContain('percentil 30');
    expect(texto).toContain('percentil 60');
    expect(texto).toContain('50%');
    // Carbón: 0 / 5 / 10 puntos → hasta 45%.
    expect(texto).toContain('percentil 65');
    expect(texto).toContain('percentil 75');
    expect(texto).toContain('45%');
  });

  it('registra el umbral de 50.000 UVT y los CIIU alcanzados', () => {
    expect(50_000 * UVT_2026).toBe(2_618_700_000);
    const texto = textoArticulo('ART_240_PAR3_ET');
    expect(texto).toContain('50.000 UVT');
    expect(texto).toContain('2.618.700.000');
    expect(texto).toContain('0610');
    expect(texto).toContain('0510');
  });

  it('marca como NO verificados los puntos adicionales del AG 2026 para que no alimenten una liquidación', () => {
    // El número de puntos del año depende de la resolución UPME/ANH y del decreto
    // reglamentario del año; no puede codificarse de memoria.
    expect(textoArticulo('ART_240_PAR3_ET')).toMatch(/NO codificar el n[úu]mero de puntos del a[ñn]o gravable 2026/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 240 par. 6 E.T. — Tasa de Tributación Depurada
// Norma: par. 6 (Art. 10 Ley 2277/2022); Concepto Unificado DIAN 202(006038) de 2024.
// Fuente: https://www.consultorcontable.com/tasa-minima-de-tributacion-paragrafo-6-art-240-et/
//         UD = UC + DPARL − INCRNGO − VIMPP − VNGO − RE − C ; ID = INR + DTC − IRP ;
//         IA = (UD × 15%) − ID.
// Vigencia: desde el AG 2023 (Art. 10 exequible — Sentencia C-219 de 2024).
// ---------------------------------------------------------------------------
describe('Art. 240 par. 6 E.T. — la fórmula de la Utilidad Depurada', () => {
  const resumen = () => articulo('ART_240_PAR6_TTD_ET').resumen;

  it('usa la fórmula legal completa con el signo correcto de las diferencias permanentes', () => {
    expect(resumen()).toContain('UD = UC + DPARL − INCRNGO − VIMPP − VNGO − RE − C');
    // El defecto invertía el signo: restaba las diferencias permanentes.
    expect(resumen()).not.toContain('UAI − INCRGNO − rentas exentas − diferencias permanentes');
  });

  it('define ID y el impuesto a adicionar', () => {
    const r = resumen();
    expect(r).toContain('ID = INR + DTC − IRP');
    expect(r).toContain('IA = (UD × 15%) − ID');
  });

  it('acota RE al subconjunto taxativo de rentas exentas (CDI, CHC, Art. 235-2)', () => {
    const r = resumen();
    expect(r).toContain('CHC');
    expect(r).toContain('235-2');
    expect(r).toMatch(/NO todas las rentas exentas/i);
  });

  it('enumera las exclusiones subjetivas del parágrafo 6', () => {
    const r = resumen();
    for (const excluido of ['ZESE', 'ZOMAC', 'par. 5', 'par. 7', 'SIMPLE']) {
      expect(r).toContain(excluido);
    }
    expect(r).toMatch(/UD sea igual o menor a cero/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 437-4 y 437-5 E.T. — ReteIVA del 100%
// Norma: Arts. 437-4 y 437-5 E.T. (Ley 1607 de 2012), vigentes sin modificación en 2026.
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-437-4-retencion-de-iva-para-venta-de-chatarra-y-otros-bienes
//         https://estatuto.co/437-5
// ---------------------------------------------------------------------------
describe('Arts. 437-4 y 437-5 E.T. — chatarra y tabaco, no "compras a no responsables"', () => {
  it('el Art. 437-4 describe la venta de chatarra a siderúrgicas', () => {
    const texto = textoArticulo('ART_437_4_ET');
    expect(texto).toMatch(/CHATARRA/i);
    expect(texto).toMatch(/SIDER[ÚU]RGICA/i);
    expect(texto).toContain('72.04');
    expect(texto).toContain('74.04');
    expect(texto).toContain('76.02');
    // El supuesto inventado por el catálogo anterior.
    expect(texto).not.toMatch(/adquiridos a no responsables del IVA que por cuant[íi]a deben retener/i);
  });

  it('existe entrada del Art. 437-5 con el tabaco de la partida 24.01', () => {
    const texto = textoArticulo('ART_437_5_ET');
    expect(texto).toContain('24.01');
    expect(texto).toMatch(/tabacalera/i);
  });

  it('el Art. 437-1 ya no describe los casos del 100% como compras a no responsables', () => {
    const resumen = articulo('ART_437_1_ET').resumen;
    expect(resumen).not.toMatch(/compras o ventas con no declarantes/i);
    expect(resumen).toMatch(/chatarra/i);
    expect(resumen).toMatch(/tabaco/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 420 E.T. — hecho generador del IVA
// Norma: Art. 420 literales a) a e) E.T. (mod. Ley 1819 de 2016).
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-420-hechos-sobre-los-que-recae-el-impuesto
//         lit. e): "...con excepción de las loterías y de los juegos de suerte y
//         azar operados exclusivamente por internet".
// Vigencia: el Decreto 1474 de 2025 (que gravó esos juegos con IVA) fue declarado
//           INEXEQUIBLE por la Sentencia C-079 de 2026.
// ---------------------------------------------------------------------------
describe('Art. 420 E.T. — exclusión de loterías y juegos operados por internet', () => {
  it('registra la excepción del literal e) en el resumen que va al prompt', () => {
    // El resumen es lo que el Motor Normativo inyecta al system prompt: la
    // exclusión debe estar ahí, no solo en el textoLiteral.
    const resumen = articulo('ART_420_ET').resumen;
    expect(resumen).toMatch(/loter[íi]as/i);
    expect(resumen).toMatch(/operados exclusivamente por internet/i);
    expect(resumen).toMatch(/EXCEPCI[ÓO]N/i);
  });

  it('conserva el texto literal del literal e) para citarlo verbatim', () => {
    const literal = articulo('ART_420_ET').textoLiteral;
    expect(literal).not.toBeNull();
    expect(literal).toMatch(/operados exclusivamente por internet/i);
  });

  it('registra el literal c) "desde el exterior" (base del IVA de servicios digitales)', () => {
    expect(articulo('ART_420_ET').resumen).toMatch(/DESDE EL EXTERIOR/i);
  });
});

// ---------------------------------------------------------------------------
// Impuesto Nacional al Consumo — Arts. 512-1 a 512-13 E.T. (estaban AUSENTES)
// Norma: Arts. 512-1, 512-2, 512-3, 512-4, 512-9, 512-11 y 512-13 E.T.
// Fuente: https://siemprealdia.co/colombia/impuestos/impuesto-nacional-al-consumo/
//         https://actualicese.com/impuesto-nacional-al-consumo/
//         https://estatuto.co/512-11
// Vigencia: estructura vigente sin cambios estructurales en 2026 (el Decreto 1474
//           de 2025, que modificaba el INC de licores y cigarrillos, fue inexequible).
// ---------------------------------------------------------------------------
describe('Arts. 512-x E.T. — el catálogo contiene el Impuesto Nacional al Consumo', () => {
  it('tiene entradas para el hecho generador y las tres tarifas', () => {
    expect(textoArticulo('ART_512_1_ET')).toMatch(/hecho generador|Impuesto Nacional al Consumo/i);
    expect(textoArticulo('ART_512_2_ET')).toContain('4%');
    expect(textoArticulo('ART_512_3_ET')).toContain('8%');
    expect(textoArticulo('ART_512_4_ET')).toContain('16%');
  });

  it('grava restaurantes (512-9) y bares/tabernas/discotecas (512-11) al 8%', () => {
    expect(textoArticulo('ART_512_9_ET')).toContain('8%');
    expect(textoArticulo('ART_512_11_ET')).toContain('8%');
  });

  it('registra el umbral de no responsables del Art. 512-13 (3.500 UVT) y el Formulario 310', () => {
    expect(3_500 * UVT_2026).toBe(183_309_000);
    const texto = textoArticulo('ART_512_13_ET');
    expect(texto).toContain('3.500 UVT');
    expect(texto).toContain('183.309.000');
    expect(texto).toContain('310');
  });

  it('separa el umbral FOB de USD 30.000 entre el 8% (512-3) y el 16% (512-4)', () => {
    expect(textoArticulo('ART_512_3_ET')).toMatch(/INFERIOR a USD 30\.000/i);
    expect(textoArticulo('ART_512_4_ET')).toMatch(/IGUAL O SUPERIOR a USD 30\.000/i);
  });
});

// ---------------------------------------------------------------------------
// Art. 600 E.T. — periodicidad del IVA
// Norma: Art. 600 num. 1 y 2 E.T. (mod. Ley 1819 de 2016).
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-600-periodo-gravable-del-impuesto-sobre-las-ventas
//         num. 1: "...y para los responsables de que tratan los artículos 477 y
//         481 de este Estatuto".
// Vigencia: sin cambios en 2026.
// ---------------------------------------------------------------------------
describe('Art. 600 E.T. — los responsables de los Arts. 477 y 481 declaran siempre bimestralmente', () => {
  it('incluye a los responsables de los Arts. 477 y 481 en el período bimestral', () => {
    const resumen = articulo('ART_600_ET').resumen;
    expect(resumen).toContain('477');
    expect(resumen).toContain('481');
    expect(resumen).toMatch(/SIN IMPORTAR EL MONTO DE SUS INGRESOS/i);
  });

  it('mantiene el umbral de 92.000 UVT para el resto', () => {
    expect(articulo('ART_600_ET').resumen).toContain('92.000 UVT');
  });
});

// ---------------------------------------------------------------------------
// Art. 640 E.T. — gradualidad
// Norma: Art. 640 num. 1 a 4 y par. 3 y 4 E.T. (mod. Art. 282 Ley 1819 de 2016).
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-640-aplicacion-de-los-principios-de-lesividad-proporcionalidad-gradualidad-y-favorabilidad-en-el-regimen-sancionatorio
//         https://www.gerencie.com/gradualidad-de-las-sanciones-tributarias.html
// Vigencia: 2026 sin modificaciones posteriores a la Ley 1819 de 2016.
// ---------------------------------------------------------------------------
describe('Art. 640 E.T. — la gradualidad depende de la reincidencia, no de "aceptar"', () => {
  it('codifica los períodos limpios de 2/1 años (autoliquidada) y 4/2 años (DIAN)', () => {
    const resumen = articulo('ART_640_ET').resumen;
    expect(resumen).toMatch(/2 años anteriores/);
    expect(resumen).toMatch(/1 año/);
    expect(resumen).toMatch(/4 años anteriores/);
    // El estándar inventado por el catálogo anterior.
    expect(resumen).not.toMatch(/50% si se acepta cargo sin pliego de cargos/i);
  });

  it('registra el par. 3: no hay gradualidad sobre los numerales 1, 2 y 3 del inciso 3º del Art. 648', () => {
    const resumen = articulo('ART_640_ET').resumen;
    expect(resumen).toMatch(/NO APLICAN a las sanciones de los numerales 1, 2 y 3 del inciso 3º del Art\. 648/i);
    expect(resumen).toContain('200%');
    expect(resumen).toContain('160%');
  });

  it('la matriz de sanciones ya no promete "primer incumplimiento documentado" ni "50% adicional"', () => {
    const extemporaneidad = sancion('SANCION_EXTEMPORANEIDAD_ART641');
    const inexactitud = sancion('SANCION_INEXACTITUD_ART647');
    const todas = [...extemporaneidad.reducciones, ...inexactitud.reducciones]
      .map((r) => `${r.momento} ${r.reduccion}`)
      .join('\n');
    expect(todas).not.toMatch(/primer incumplimiento documentado/i);
    expect(todas).not.toMatch(/50% adicional/i);
    // Y sí advierte de la exclusión del par. 3.
    expect(todas).toMatch(/par\.\s*3 del Art\. 640/i);
  });
});

// ---------------------------------------------------------------------------
// Arts. 641 y 642 E.T. — topes distintos
// Norma: Art. 641 (5% mensual, tope 100%) y Art. 642 (10% mensual, tope 200%).
// Fuente: https://www.gerencie.com/sancion-por-extemporaneidad.html
// Vigencia: 2026 sin modificaciones.
// ---------------------------------------------------------------------------
describe('Arts. 641 y 642 E.T. — el tope del 200% es del Art. 642, no un error', () => {
  it('el Art. 641 solo cubre el supuesto anterior al emplazamiento, con tope del 100%', () => {
    const entrada = articulo('ART_641_ET');
    expect(entrada.resumen).toContain('5%');
    expect(entrada.resumen).toContain('100%');
    // El defecto describía el 10% mensual del Art. 642 bajo el tope del Art. 641.
    expect(entrada.resumen).not.toMatch(/10% mensual despu[ée]s de emplazamiento, tope 100%/i);
  });

  it('existe entrada del Art. 642 con 10% mensual y tope del 200%', () => {
    const entrada = articulo('ART_642_ET');
    expect(entrada.resumen).toContain('10%');
    expect(entrada.resumen).toContain('200%');
    expect(entrada.resumen).toContain('5.000 UVT');
  });

  it('la matriz de sanciones sigue registrando ambos topes de forma coherente', () => {
    const tope = sancion('SANCION_EXTEMPORANEIDAD_ART641').tope ?? '';
    expect(tope).toContain('100%');
    expect(tope).toContain('200%');
  });
});

// ---------------------------------------------------------------------------
// Art. 648 E.T. — cuantías escalonadas de la sanción por inexactitud
// Norma: Art. 648 E.T., incisos 1º y 3º num. 1 a 4 y par. 1 y 2
//        (mod. Art. 288 Ley 1819 de 2016; el num. 1 rige desde el AG 2018).
// Fuente: https://www.contadia.com/estatuto-tributario/articulo-648-sancion-por-inexactitud
//         https://actualicese.com/estatutotributario/648-2/
// Vigencia: desde el AG 2017, sin modificación por Ley 2277 de 2022.
// ---------------------------------------------------------------------------
describe('Art. 648 E.T. — régimen escalonado, no una tarifa consolidada del 100%', () => {
  it('la entrada del catálogo ya no dice que el Art. 648 "consolida" la tarifa en 100%', () => {
    const resumen = articulo('ART_648_ET').resumen;
    expect(resumen).not.toMatch(/consolida la tarifa escalonada/i);
  });

  it('registra las cuatro cuantías agravadas del inciso 3º', () => {
    const resumen = articulo('ART_648_ET').resumen;
    expect(resumen).toContain('200%');
    expect(resumen).toContain('160%');
    expect(resumen).toContain('20%');
    expect(resumen).toContain('50%');
    expect(resumen).toContain('15%'); // declaraciones de ingresos y patrimonio
  });

  it('ata el 200% a la omisión de activos e inclusión de pasivos inexistentes desde el AG 2018', () => {
    const resumen = articulo('ART_648_ET').resumen;
    expect(resumen).toMatch(/OMITAN ACTIVOS/i);
    expect(resumen).toMatch(/PASIVOS INEXISTENTES/i);
    expect(resumen).toContain('2018');
  });

  it('la matriz de sanciones expone el escalonamiento y no un 100% plano', () => {
    const tarifa = sancion('SANCION_INEXACTITUD_ART647').tarifa;
    expect(tarifa).not.toBe('100% del mayor valor del impuesto que se generó.');
    expect(tarifa).toContain('200%');
    expect(tarifa).toContain('160%');
  });

  it('el Art. 647 ya no afirma que el Art. 648 consolida la tarifa', () => {
    expect(articulo('ART_647_ET').resumen).not.toMatch(/Art\. 648 consolida la tarifa/i);
  });
});

// ---------------------------------------------------------------------------
// Decreto 173 de 2026 — impuesto al patrimonio temporal de personas jurídicas
// Norma: Decreto Legislativo 173 del 24-feb-2026 (Art. 215 C.P.), bajo la
//        emergencia del Decreto Legislativo 150 de 2026.
// Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0173_2026.htm
// Vigencia: exclusivo del año 2026; emergencia habilitante declarada exequible
//           de manera condicionada por la Corte Constitucional en junio de 2026.
// ---------------------------------------------------------------------------
describe('Decreto 173 de 2026 — impuesto al patrimonio de personas jurídicas', () => {
  it('está en el catálogo con el umbral de 200.000 UVT al 1 de marzo de 2026', () => {
    expect(200_000 * UVT_2026).toBe(10_474_800_000);
    const entrada = ley('DECRETO_173_2026');
    expect(entrada.resumen).toContain('200.000 UVT');
    expect(entrada.resumen).toContain('10.474.800.000');
    expect(entrada.resumen).toMatch(/1 de MARZO de 2026/i);
  });

  it('reproduce las DOS tarifas (0,5% general y 1,6% financiero/extractivo)', () => {
    const resumen = ley('DECRETO_173_2026').resumen;
    expect(resumen).toContain('0,5%');
    expect(resumen).toContain('1,6%');
    expect(resumen).toContain('0610');
  });

  it('registra los plazos vencidos y la consecuencia de la extemporaneidad', () => {
    const resumen = ley('DECRETO_173_2026').resumen;
    expect(resumen).toContain('1-abr-2026');
    expect(resumen).toContain('4-may-2026');
    expect(resumen).toMatch(/Art\. 641 E\.T\./);
  });

  it('marca el estado del control constitucional en vez de afirmarlo como pacífico', () => {
    expect(ley('DECRETO_173_2026').sentenciaCorte ?? '').toMatch(/EXEQUIBLE DE MANERA CONDICIONADA/i);
  });
});

// ---------------------------------------------------------------------------
// Decreto 240 de 2026 — INC 16% a juegos de suerte y azar por internet
// Norma: Decreto Legislativo 240 del 12-mar-2026; complemento: Art. 420 lit. e) E.T.
// Fuente: https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0240_2026.htm
// Vigencia: solo la vigencia fiscal 2026. Norma temporal de alta volatilidad.
// ---------------------------------------------------------------------------
describe('Decreto 240 de 2026 — INC del 16% a los juegos operados por internet', () => {
  it('está en el catálogo con tarifa, hecho generador y base GGR', () => {
    const resumen = ley('DECRETO_240_2026').resumen;
    expect(resumen).toContain('16%');
    expect(resumen).toMatch(/dep[óo]sito en dinero/i);
    expect(resumen).toContain('GGR');
    expect(resumen).toMatch(/bimestral/i);
    expect(resumen).toContain('310');
  });

  it('aclara que la operación tributa INC y NO IVA (Art. 420 lit. e)', () => {
    const resumen = ley('DECRETO_240_2026').resumen;
    expect(resumen).toMatch(/EXCLUYE del IVA/i);
    expect(resumen).toMatch(/tributa INC y NO IVA/i);
  });

  it('queda marcado como norma temporal con control de fondo pendiente', () => {
    const entrada = ley('DECRETO_240_2026');
    expect(entrada.sentenciaCorte ?? '').toMatch(/alta volatilidad|no consta resuelto/i);
  });
});

// ---------------------------------------------------------------------------
// Invariante transversal: toda cita del catálogo debe ser resoluble por el
// citation.validator. Si una entrada nueva usa una forma no canónica, el
// validator la marcaría NO_VERIFICADO y bloquearía una cita correcta.
// ---------------------------------------------------------------------------
describe('Invariante — las citas nuevas usan la forma canónica del citation.validator', () => {
  const CANONICO_ARTICULO = /^Art\. \d+(?:-\d+)?(?: par\. \d+)? E\.T\.$/;
  const CANONICO_DECRETO = /^Decreto \d+ de \d{4}$/;

  const NUEVAS_ARTICULO = [
    'ART_240_PAR3_ET',
    'ART_240_PAR4_ET',
    'ART_240_PAR5_ET',
    'ART_240_PAR7_ET',
    'ART_437_5_ET',
    'ART_512_1_ET',
    'ART_512_2_ET',
    'ART_512_3_ET',
    'ART_512_4_ET',
    'ART_512_9_ET',
    'ART_512_11_ET',
    'ART_512_13_ET',
    'ART_642_ET',
  ];

  it.each(NUEVAS_ARTICULO)('la cita de %s es canónica', (id) => {
    expect(articulo(id).cita).toMatch(CANONICO_ARTICULO);
  });

  it.each(['DECRETO_173_2026', 'DECRETO_240_2026'])('la cita de %s es canónica', (id) => {
    expect(ley(id).cita).toMatch(CANONICO_DECRETO);
  });

  it('no hay ids duplicados en el catálogo de artículos', () => {
    const ids = ARTICULOS_ET.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no hay citas duplicadas en el catálogo de artículos', () => {
    const citas = ARTICULOS_ET.map((a) => a.cita);
    expect(new Set(citas).size).toBe(citas.length);
  });
});
