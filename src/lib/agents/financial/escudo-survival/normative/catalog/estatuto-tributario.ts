// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Estatuto Tributario
// ---------------------------------------------------------------------------
//
// Fuente de verdad: dictamen corregido escudo-tributario-co 2026 (15 correcciones
// críticas verificadas). CADA entrada fue reconciliada contra el dictamen.
//
// Por qué `as const`: los literal types (`estado`, `tags`) deben fluir a los
// tipos del validator sin widening. `as const` garantiza el literal en build.
// ---------------------------------------------------------------------------

import type { NormativeArticleEntry } from '../types';

export const ARTICULOS_ET: readonly NormativeArticleEntry[] = [
  // ─── RENTA — CONCEPTOS GENERALES ──────────────────────────────────────────
  {
    id: 'ART_26_ET',
    cita: 'Art. 26 E.T.',
    titulo: 'Concepto de renta bruta',
    resumen:
      'La renta bruta es la suma de todos los ingresos ordinarios y extraordinarios realizados en el año o período gravable que no hayan sido expresamente exceptuados por la ley.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=26',
    tags: ['renta', 'determinacion', 'ingreso', 'PJ', 'PN'],
  },
  {
    id: 'ART_45_ET',
    cita: 'Art. 45 E.T.',
    titulo: 'Las indemnizaciones por seguros como ingreso no constitutivo de renta ni ganancia ocasional (INCRGNO)',
    resumen:
      'Las indemnizaciones recibidas en dinero o en especie como consecuencia de seguros de daño son INCRGNO en la parte correspondiente al daño emergente. Las indemnizaciones por lucro cesante y las demás sí constituyen renta.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=45',
    tags: ['renta', 'INCRGNO', 'seguros', 'PN', 'PJ'],
  },
  {
    id: 'ART_47_ET',
    cita: 'Art. 47 E.T.',
    titulo: 'Gananciales — no renta ni ganancia ocasional',
    resumen:
      'Lo percibido por concepto de gananciales como consecuencia de la liquidación de la sociedad conyugal no constituye renta ni ganancia ocasional. El régimen de ganancias ocasionales vive en Arts. 299–317 E.T.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=47',
    // Corrección crítica: el spec original atribuía "ganancias ocasionales 15%" a este
    // artículo. Error: GO está en Arts. 299-317. Art. 47 regula gananciales conyugales.
    tags: ['INCRGNO', 'sociedad_conyugal', 'gananciales', 'PN'],
  },

  // ─── RENTA — DEDUCCIONES ──────────────────────────────────────────────────
  {
    id: 'ART_107_ET',
    cita: 'Art. 107 E.T.',
    titulo: 'Expensas necesarias — deducibilidad',
    resumen:
      'Son deducibles las expensas realizadas durante el año o período gravable en el desarrollo de cualquier actividad productora de renta, siempre que tengan relación de causalidad con las actividades productoras de renta y que sean necesarias y proporcionadas.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=107',
    tags: ['renta', 'deduccion', 'causalidad', 'necesidad', 'proporcionalidad', 'PJ'],
  },
  {
    id: 'ART_108_ET',
    cita: 'Art. 108 E.T.',
    titulo: 'Deducción de salarios — requisito parafiscales',
    resumen:
      'Para que sean deducibles los salarios y demás pagos laborales, el empleador debe haber pagado los aportes parafiscales (ICBF, SENA, Caja de Compensación) y los aportes al sistema de seguridad social. Vigente sin modificación.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=108',
    tags: ['renta', 'deduccion', 'salarios', 'parafiscales', 'seguridad_social', 'PJ'],
  },
  {
    id: 'ART_115_ET',
    cita: 'Art. 115 E.T.',
    titulo: 'Deducción de impuestos, tasas y contribuciones pagados',
    resumen:
      'Tras Ley 2277/2022: es deducible el 100% de lo efectivamente pagado de impuestos, tasas y contribuciones con causalidad, incluido ICA al 100%. GMF: 50% deducible sin importar causalidad. Ley 2277/2022 derogó el descuento del 50% de ICA contra renta; hoy solo aplica deducción 100% ratificada por Concepto DIAN 211 de 2025.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Derogó el descuento del 50% de ICA (antes Art. 115 par.). Unificó deducción al 100% de ICA pagado con causalidad.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=115',
    tags: ['renta', 'deduccion', 'ICA', 'GMF', 'impuestos', 'PJ'],
  },
  {
    id: 'ART_122_ET',
    cita: 'Art. 122 E.T.',
    titulo: 'Limitación de deducciones por pagos al exterior',
    resumen:
      'Los pagos al exterior solo son deducibles hasta el 15% de la renta líquida del contribuyente, computada antes de descontar tales pagos, salvo las excepciones expresas de la ley.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=122',
    tags: ['renta', 'deduccion', 'exterior', 'limitacion', 'PJ'],
  },

  // ─── DEPRECIACIÓN ─────────────────────────────────────────────────────────
  {
    id: 'ART_137_ET',
    cita: 'Art. 137 E.T.',
    titulo: 'Tasas máximas de depreciación',
    resumen:
      'Las tasas máximas de depreciación fiscal varían entre 3% y 33% anual según el tipo de activo (edificios 5%, maquinaria 10-33%, vehículos 20%, computadores 33%). Base normativa Arts. 134-141 E.T.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=137',
    tags: ['renta', 'depreciacion', 'activos_fijos', 'PJ'],
  },
  {
    id: 'ART_140_ET',
    cita: 'Art. 140 E.T.',
    titulo: 'Depreciación acelerada por turnos de trabajo',
    resumen:
      'Cuando los activos fijos se utilizan en más de un turno de trabajo diario, se puede aumentar la tasa de depreciación en un 25% por cada turno adicional, siempre que los activos sean utilizados en la actividad productora de renta.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=140',
    tags: ['renta', 'depreciacion', 'turnos', 'acelerada', 'PJ'],
  },

  // ─── RENTA — DEROGADO (Art. 158-3) ────────────────────────────────────────
  {
    id: 'ART_158_3_ET',
    cita: 'Art. 158-3 E.T.',
    titulo: 'Deducción especial por inversión en activos fijos reales productivos — DEROGADO',
    resumen:
      'DEROGADO por Art. 376 de Ley 1819 de 2016. Suspendido efectivamente desde 2011 (Ley 1430/2010). Solo aplica residualmente a contratos de estabilidad jurídica suscritos antes de 2012. No citar como beneficio vigente.',
    textoLiteral: null,
    estado: 'DEROGADO',
    modificaciones: [
      {
        norma: 'Ley 1430 de 2010',
        fecha: '2010-12-29',
        cambio: 'Suspendió la aplicación del beneficio del 30% a partir de 2011.',
      },
      {
        norma: 'Ley 1819 de 2016, Art. 376',
        fecha: '2016-12-29',
        cambio: 'Derogó formalmente el Art. 158-3 E.T.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=158-3',
    tags: ['renta', 'deduccion', 'activos_fijos', 'derogado', 'PJ'],
  },

  // ─── TARIFAS DE RENTA ─────────────────────────────────────────────────────
  {
    id: 'ART_240_ET',
    cita: 'Art. 240 E.T.',
    titulo: 'Tarifa general del impuesto sobre la renta — personas jurídicas',
    resumen:
      'Tarifa general PJ: 35%. Zonas francas: régimen híbrido Ley 2277/2022 (20% sobre renta de exportación + 35% otras). Par. 1: empresas industriales y comerciales del Estado con participación estatal >90% en monopolios de suerte y azar y de licores: 9%. Par. 5: servicios hoteleros, parques temáticos de ecoturismo y agroturismo en municipios ≤200.000 habitantes o PDET: 15% por 10 años (NO 9%). Par. 7: empresas editoriales cuya actividad económica y objeto social sea EXCLUSIVAMENTE la edición de libros en los términos de la Ley 98/1993: 15% (NO 0%). Sobretasas — cada una con umbral propio de renta gravable: par. 2 sector financiero/asegurador/bursátil +5pp = 40% (AG 2023-2027, solo si renta gravable ≥ 120.000 UVT); par. 3 extracción de petróleo crudo (CIIU 0610) y de carbón (CIIU 0510/0520) +0/5/10/15pp según percentil de precios (solo si renta gravable ≥ 50.000 UVT); par. 4 generación de energía eléctrica con recursos hídricos +3pp = 38% (AG 2023-2026, solo si renta gravable ≥ 30.000 UVT y plantas >1.000 kW). Los acueductos NO están sujetos a sobretasa.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio:
          'Mantuvo 35% tarifa general; introdujo régimen híbrido zona franca; estableció las sobretasas de los par. 2, 3 y 4 con umbrales de renta gravable; subió hoteles de 9% a 15% (par. 5); subió editoriales de 9% a 15% (par. 7); introdujo la tasa mínima de tributación (par. 6).',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    tags: ['renta', 'tarifa', 'PJ', 'zona_franca', 'sobretasa', 'financiero', 'hidro', 'hidrocarburos', 'carbon', 'hoteles', 'editoriales'],
  },
  {
    id: 'ART_240_PAR2_ET',
    cita: 'Art. 240 par. 2 E.T.',
    titulo: 'Sobretasa del sector financiero, asegurador y bursátil — 5 puntos con umbral de 120.000 UVT',
    resumen:
      'Par. 2 Art. 240: las instituciones financieras, entidades aseguradoras y reaseguradoras, sociedades comisionistas de bolsa de valores, comisionistas agropecuarios, bolsas de bienes y productos agropecuarios y agroindustriales y proveedores de infraestructura del mercado de valores liquidan 5 puntos adicionales (tarifa total 40%) durante los años gravables 2023 a 2027. Condición de aplicación: SOLO a las personas jurídicas que en el año gravable correspondiente tengan una renta gravable igual o superior a 120.000 UVT (2026: 120.000 × $52.374 = $6.284.880.000). Si la renta gravable es inferior al umbral, la tarifa es la general del 35%. La sobretasa está sujeta a un anticipo del 100% de su valor, calculado sobre la base gravable del año gravable inmediatamente anterior y pagadero en dos cuotas anuales iguales. Tres de los cinco puntos se destinan a la Red Vial Terciaria.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Estableció la sobretasa financiera del parágrafo 2 para los AG 2023-2027 con umbral de 120.000 UVT y anticipo del 100% en dos cuotas.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    // Corrección normativa 2026-08: la versión anterior de esta entrada (a) omitía el umbral
    // de 120.000 UVT de renta gravable y el anticipo del 100%, y (b) atribuía al par. 2 la
    // sobretasa hidroeléctrica, que vive en el par. 4 y NO cobija acueductos.
    // Umbral en pesos calculado con la UVT del año gravable (Res. DIAN 000238 de 2025 → UVT 2026 $52.374).
    tags: ['renta', 'tarifa', 'sobretasa', 'financiero', 'asegurador', 'bursatil', 'umbral', '120000_UVT', 'PJ'],
  },
  {
    id: 'ART_240_PAR3_ET',
    cita: 'Art. 240 par. 3 E.T.',
    titulo: 'Sobretasa a la extracción de petróleo crudo y de carbón — puntos variables por percentil de precios',
    resumen:
      'Par. 3 Art. 240: las personas jurídicas cuya actividad económica sea la extracción de hulla y carbón lignito (CIIU 0510 y 0520) o la extracción de petróleo crudo (CIIU 0610) liquidan puntos adicionales VARIABLES, determinados comparando el precio promedio del respectivo año gravable contra percentiles del precio promedio mensual de los últimos 120 meses. Escalonamiento del carbón: 0 puntos si el precio está por debajo del percentil 65; 5 puntos entre percentil 65 y 75; 10 puntos por encima del percentil 75 (tarifa total hasta 45%). Escalonamiento del petróleo crudo: 0 puntos por debajo del percentil 30; 5 puntos entre percentil 30 y 45; 10 puntos entre percentil 45 y 60; 15 puntos por encima del percentil 60 (tarifa total hasta 50%). Condición de aplicación: SOLO a contribuyentes con renta gravable igual o superior a 50.000 UVT (2026: 50.000 × $52.374 = $2.618.700.000). El precio promedio y los percentiles del año NO son un valor fijo: los certifican anualmente la UPME (carbón) y la ANH (petróleo) mediante resolución publicada a más tardar el 31 de enero, recogida en decreto reglamentario (antecedentes: Decreto 261 de 2023 y Decreto 242 de 2024). NO codificar el número de puntos del año gravable 2026 sin leer la resolución/decreto de ese año — el valor no está verificado en este catálogo y no debe alimentar una liquidación.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Adicionó el parágrafo 3 con la sobretasa escalonada por percentiles de precio para carbón e hidrocarburos, vigente desde el AG 2023.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    // Corrección normativa 2026-08: el catálogo presentaba la lista de sobretasas como cerrada
    // (solo par. 2 y par. 4), lo que impedía al agente detectar esta sobretasa. Un contribuyente
    // de extracción liquidado al 35% puede estar subdeclarando hasta 15 puntos.
    tags: ['renta', 'tarifa', 'sobretasa', 'hidrocarburos', 'petroleo', 'carbon', 'CIIU_0610', 'CIIU_0510', 'umbral', '50000_UVT', 'PJ'],
  },
  {
    id: 'ART_240_PAR4_ET',
    cita: 'Art. 240 par. 4 E.T.',
    titulo: 'Sobretasa a la generación de energía eléctrica con recursos hídricos — 3 puntos con umbral de 30.000 UVT',
    resumen:
      'Par. 4 Art. 240: las personas jurídicas cuya actividad económica PRINCIPAL sea la generación de energía eléctrica A TRAVÉS DE RECURSOS HÍDRICOS liquidan 3 puntos adicionales (tarifa total 38%) durante los años gravables 2023, 2024, 2025 y 2026 — 2026 es el último año. Condiciones de aplicación: (a) SOLO si en el año gravable correspondiente la renta gravable es igual o superior a 30.000 UVT (2026: 30.000 × $52.374 = $1.571.220.000); (b) NO aplica a centrales cuya capacidad instalada sea igual o inferior a 1.000 kW; (c) la sobretasa no puede trasladarse al usuario final. Alcance subjetivo: la sobretasa NO cobija a las empresas de acueducto y alcantarillado. Alcance objetivo: por la exequibilidad condicionada de la Sentencia C-389 de 2023, los 3 puntos gravan ÚNICAMENTE la renta de la actividad de generación hídrica, no las demás actividades del contribuyente. El umbral de 30.000 UVT fue declarado exequible por la Sentencia C-050 de 2026.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Adicionó el parágrafo 4 con la sobretasa de 3 puntos a la generación hídrica para los AG 2023-2026.',
      },
      {
        norma: 'Sentencia C-389 de 2023 (Corte Constitucional)',
        fecha: '2023-10-04',
        cambio: 'Exequibilidad CONDICIONADA: la sobretasa solo puede aplicarse a la renta de la actividad de generación de energía eléctrica con recursos hídricos, no a otras actividades del contribuyente.',
      },
    ],
    urlOficial:
      'https://www.corteconstitucional.gov.co/relatoria/2023/c-389-23.htm',
    // Corrección normativa 2026-08: el catálogo (a) ubicaba esta sobretasa en el par. 2,
    // (b) extendía el sujeto pasivo a "acueductos" (la norma no los menciona), y (c) omitía
    // el umbral de 30.000 UVT, la exclusión de plantas ≤1.000 kW y el condicionamiento C-389/23.
    tags: ['renta', 'tarifa', 'sobretasa', 'hidro', 'generacion_electrica', 'umbral', '30000_UVT', 'C-389_2023', 'PJ'],
  },
  {
    id: 'ART_240_PAR5_ET',
    cita: 'Art. 240 par. 5 E.T.',
    titulo: 'Tarifa del 15% para servicios hoteleros, parques temáticos de ecoturismo y agroturismo',
    resumen:
      'Par. 5 Art. 240: las rentas provenientes de servicios prestados en nuevos hoteles, en hoteles remodelados y/o ampliados, y en nuevos parques temáticos de ecoturismo y/o agroturismo, se gravan a la tarifa del 15% por un término de 10 años contados desde el inicio de las operaciones. Requisitos: municipio de hasta 200.000 habitantes (censo DANE 2022) o municipio PDET; construcción/remodelación dentro de los 5 años siguientes a la Ley 2277/2022; inscripción en el Registro Nacional de Turismo; no puede pactarse rendimiento garantizado. Excluye moteles y residencias. La tarifa del 9% NO es la tarifa vigente del sector: solo subsiste como derecho adquirido para quienes consolidaron el beneficio bajo el régimen anterior (Ley 1943/2018 – Ley 2010/2019), condición que debe acreditarse caso por caso.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Elevó de 9% a 15% la tarifa del par. 5 y restringió el beneficio a municipios ≤200.000 habitantes o PDET. Vigente desde el AG 2023.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    // Corrección normativa 2026-08: el catálogo declaraba "Hoteles 9%". Subestimaba el impuesto
    // de un hotel nuevo en 6 puntos de la renta líquida gravable.
    tags: ['renta', 'tarifa', 'hoteles', 'ecoturismo', 'agroturismo', 'PDET', '15%', 'PJ'],
  },
  {
    id: 'ART_240_PAR7_ET',
    cita: 'Art. 240 par. 7 E.T.',
    titulo: 'Tarifa del 15% para empresas editoriales (Ley 98 de 1993)',
    resumen:
      'Par. 7 Art. 240: la tarifa del impuesto sobre la renta aplicable a las empresas editoriales constituidas en Colombia como personas jurídicas, cuya actividad económica Y objeto social sea EXCLUSIVAMENTE la edición de libros en los términos de la Ley 98 de 1993, es del 15%. El requisito de exclusividad es constitutivo: una editorial con actividades mixtas NO califica y tributa a la tarifa general del 35%. La tarifa del 0% no está vigente para ningún año gravable reciente; la tarifa anterior a la Ley 2277/2022 era 9% (antiguo par. 4), no 0%.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Elevó de 9% a 15% la tarifa de las empresas editoriales y acotó el beneficio a las dedicadas exclusivamente a la edición de libros. Vigente desde el AG 2023.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    // Corrección normativa 2026-08: el catálogo declaraba "Editoriales 0% (Ley 98/1993)".
    // Un dictamen con 0% produce impuesto cero frente a un 15% real → inexactitud del 100%
    // del impuesto a cargo (Art. 648 E.T.) más intereses.
    tags: ['renta', 'tarifa', 'editoriales', 'libros', 'Ley_98_1993', '15%', 'PJ'],
  },
  {
    id: 'ART_240_1_ET',
    cita: 'Art. 240-1 E.T.',
    titulo: 'Régimen tributario especial zonas francas',
    resumen:
      'Art. 240-1 regula el régimen de zonas francas; NO la sobretasa financiera (confusión frecuente con el spec original). Ley 2277/2022 modificó el régimen: tasa del 20% sobre renta exportación y 35% sobre demás rentas.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Introdujo régimen híbrido: 20% exportación + 35% otras rentas para zonas francas.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240-1',
    tags: ['renta', 'tarifa', 'zona_franca', 'PJ'],
  },
  {
    id: 'ART_241_ET',
    cita: 'Art. 241 E.T.',
    titulo: 'Tarifa del impuesto sobre la renta — personas naturales',
    resumen:
      'Escala progresiva PN 2026: 0% (hasta 1.090 UVT) / 19% / 28% / 33% / 35% / 37% / 39% (sobre 31.000 UVT). Tabla en UVT vigente 2026 ($52.374 por UVT).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Añadió tramos 37% y 39% para rentas altas de personas naturales.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=241',
    tags: ['renta', 'tarifa', 'PN', 'escala_progresiva'],
  },
  {
    id: 'ART_242_ET',
    cita: 'Art. 242 E.T.',
    titulo: 'Impuesto sobre dividendos — personas naturales residentes',
    resumen:
      'Tras Ley 2277/2022 (vigencia 2023+): los dividendos no gravados se integran a la base ordinaria y tributan según Art. 241 (NO tarifa plana del 10%). Retención según tabla Art. 242 con tope 15% residentes. Descuento tributario por dividendos en Art. 254-1 desde 2023.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Eliminó tarifa plana 10%; integró dividendos no gravados a base ordinaria Art. 241.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=242',
    tags: ['renta', 'dividendos', 'PN', 'residente', 'tarifa', 'retencion'],
  },
  {
    id: 'ART_245_ET',
    cita: 'Art. 245 E.T.',
    titulo: 'Tarifa especial dividendos — no residentes',
    resumen:
      'Dividendos y participaciones pagados a personas no residentes ni domiciliadas en Colombia: 20% general, modulable por CDI (Convenio para Evitar la Doble Imposición) vigente.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Ajustó la tarifa a 20% para no residentes.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=245',
    tags: ['renta', 'dividendos', 'no_residente', 'tarifa', 'CDI'],
  },

  // ─── GANANCIAS OCASIONALES ────────────────────────────────────────────────
  {
    id: 'ART_299_317_ET',
    cita: 'Arts. 299 a 317 E.T.',
    titulo: 'Régimen de ganancias ocasionales',
    resumen:
      'Capítulo que regula integralmente las ganancias ocasionales: concepto (Art. 299), exclusiones, tarifas (Art. 313 = 15%), activos poseídos >2 años, herencias, loterías (Art. 317 = 20%).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 32',
        fecha: '2022-12-13',
        cambio: 'Elevó tarifa GO de 10% a 15%.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=299',
    tags: ['ganancia_ocasional', 'tarifa', 'PJ', 'PN'],
  },
  {
    id: 'ART_307_ET',
    cita: 'Art. 307 E.T.',
    titulo: 'Exención sobre herencias y legados — vivienda del causante',
    resumen:
      'Primeras 13.000 UVT del valor de la vivienda del causante recibida por herencia o legado son exentas de ganancia ocasional (modificado por Ley 2277/2022).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Modificó el tope de exención sobre vivienda del causante.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=307',
    tags: ['ganancia_ocasional', 'exencion', 'herencia', 'vivienda', 'PN'],
  },
  {
    id: 'ART_313_ET',
    cita: 'Art. 313 E.T.',
    titulo: 'Tarifa del impuesto sobre ganancias ocasionales — PJ y PN',
    resumen:
      'Tarifa general GO para PJ y PN: 15% (modificado por Art. 32 Ley 2277/2022; subió desde 10%). Aplica a activos poseídos >2 años, herencias, legados y demás GO.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 32',
        fecha: '2022-12-13',
        cambio: 'Elevó tarifa GO de 10% a 15% para PJ y PN.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=313',
    tags: ['ganancia_ocasional', 'tarifa', 'PJ', 'PN'],
  },
  {
    id: 'ART_317_ET',
    cita: 'Art. 317 E.T.',
    titulo: 'Tarifa especial loterías, rifas, apuestas y similares',
    resumen:
      'Las ganancias provenientes de loterías, rifas, apuestas y similares se gravan a una tarifa del 20%.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=317',
    tags: ['ganancia_ocasional', 'tarifa', 'loteria', 'PN'],
  },

  // ─── DESCUENTOS TRIBUTARIOS ───────────────────────────────────────────────
  {
    id: 'ART_254_ET',
    cita: 'Art. 254 E.T.',
    titulo: 'Descuento por impuestos pagados en el exterior',
    resumen:
      'Descuento por impuestos pagados en el exterior sobre rentas de fuente extranjera. Tope = impuesto colombiano sobre la misma renta. Exceso aplicable hasta 4 años siguientes. Ley 2277/2022 amplió el descuento a dividendos extranjeros.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Amplió el descuento a dividendos de fuente extranjera; mantuvo tope del impuesto colombiano.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=254',
    tags: ['renta', 'descuento', 'exterior', 'CDI', 'PJ'],
  },
  {
    id: 'ART_255_ET',
    cita: 'Art. 255 E.T.',
    titulo: 'Descuento por inversiones en control y mejoramiento del medio ambiente',
    resumen:
      'Descuento del 25% por inversiones realizadas en control y mejoramiento del medio ambiente, certificadas por la autoridad ambiental competente. NO confundir con Art. 258-1 (IVA en activos fijos reales productivos).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=255',
    tags: ['renta', 'descuento', 'medio_ambiente', 'PJ'],
  },
  {
    id: 'ART_256_ET',
    cita: 'Art. 256 E.T.',
    titulo: 'Descuento por inversiones en investigación, desarrollo e innovación (I+D+i)',
    resumen:
      'Descuento del 30% del valor invertido en proyectos calificados por Minciencias. Art. 256-1: mipymes con crédito fiscal alternativo del 50%. Tope conjunto Arts. 255+256+257+257-1 = 25% del impuesto (Art. 258 E.T.).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Ajustó el porcentaje de descuento I+D+i al 30%; creó Art. 256-1 crédito fiscal mipymes 50%.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=256',
    tags: ['renta', 'descuento', 'I+D+i', 'innovacion', 'Minciencias', 'PJ'],
  },
  {
    id: 'ART_257_ET',
    cita: 'Art. 257 E.T.',
    titulo: 'Descuento por donaciones a entidades sin ánimo de lucro del régimen especial',
    resumen:
      'Descuento del 25% del valor de donaciones efectuadas a ESAL del régimen tributario especial reconocidas por la DIAN.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=257',
    tags: ['renta', 'descuento', 'ESAL', 'donaciones', 'PJ'],
  },
  {
    id: 'ART_257_1_ET',
    cita: 'Art. 257-1 E.T.',
    titulo: 'Becas por Impuestos — programa MinDeporte',
    resumen:
      'Descuento por contribuciones al programa "Becas por Impuestos" del Ministerio del Deporte. Entra en el tope conjunto del Art. 258.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=257-1',
    tags: ['renta', 'descuento', 'deporte', 'becas', 'PJ'],
  },
  {
    id: 'ART_258_ET',
    cita: 'Art. 258 E.T.',
    titulo: 'Tope conjunto descuentos tributarios Arts. 255 + 256 + 257 + 257-1',
    resumen:
      'La sumatoria de los descuentos de Arts. 255, 256, 257 y 257-1 no puede exceder el 25% del impuesto sobre la renta a cargo del contribuyente. Ley 2277/2022 NO modificó este tope (mantiene 25%).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=258',
    tags: ['renta', 'descuento', 'tope', 'PJ'],
  },
  {
    id: 'ART_258_1_ET',
    cita: 'Art. 258-1 E.T.',
    titulo: 'Descuento del 100% del IVA en activos fijos reales productivos',
    resumen:
      'Descuento del 100% del IVA pagado en adquisición, importación o construcción de activos fijos reales productivos. El tope conjunto del Art. 258 NO aplica a este descuento. Modificado por Ley 2010/2019 y Ley 2155/2021; vigente al 100%.',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2010 de 2019',
        fecha: '2019-12-27',
        cambio: 'Estableció el descuento del IVA en activos fijos reales productivos al 100%.',
      },
      {
        norma: 'Ley 2155 de 2021',
        fecha: '2021-09-14',
        cambio: 'Extendió la vigencia del descuento y lo ratificó al 100%.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=258-1',
    // Corrección crítica: el spec original etiquetó este descuento como Art. 255.
    tags: ['renta', 'descuento', 'IVA', 'activos_fijos', 'PJ'],
  },

  // ─── TASA MÍNIMA DE TRIBUTACIÓN (TTD) ────────────────────────────────────
  {
    id: 'ART_240_PAR6_TTD_ET',
    cita: 'Art. 240 par. 6 E.T.',
    titulo: 'Tasa de Tributación Depurada (TTD) — tasa mínima del 15%',
    resumen:
      'Parágrafo 6 Art. 240 (introducido por Art. 10 Ley 2277/2022): TTD = ID / UD, y no puede ser inferior al 15%. UTILIDAD DEPURADA: UD = UC + DPARL − INCRNGO − VIMPP − VNGO − RE − C, donde UC = utilidad contable o financiera antes de impuestos; DPARL = diferencias permanentes consagradas en la ley que AUMENTAN la renta líquida (se SUMAN, no se restan); INCRNGO = ingresos no constitutivos de renta ni ganancia ocasional que afectan la UC; VIMPP = valor del ingreso por método de participación patrimonial del año; VNGO = valor neto de los ingresos por ganancia ocasional que afectan la UC; RE = SOLO las rentas exentas por tratados para evitar la doble imposición (CAN/CDI), las del régimen de Compañías Holding Colombianas (CHC) y las de los literales a) y b) del numeral 4 y del numeral 7 del Art. 235-2 E.T. — NO todas las rentas exentas; C = compensación de pérdidas fiscales o de excesos de renta presuntiva tomados en el año que no afectaron la utilidad contable. IMPUESTO DEPURADO: ID = INR + DTC − IRP, donde INR = impuesto neto de renta; DTC = descuentos tributarios o créditos por tratados de doble imposición y el Art. 254 E.T.; IRP = impuesto sobre rentas pasivas de entidades controladas del exterior (ECE). IMPUESTO A ADICIONAR: si TTD < 15%, IA = (UD × 15%) − ID. NO aplica el parágrafo 6 a: sociedades ZESE mientras su tarifa de renta sea 0%; usuarios de zona franca del Art. 240-1 mientras su tarifa sea 0% y los de sus par. 1 y 2; sociedades beneficiarias del incentivo ZOMAC; contribuyentes del par. 1 del Art. 240 (empresas industriales y comerciales del Estado en monopolios); contribuyentes del par. 5 (hoteles y parques temáticos) y del par. 7 (empresas editoriales); personas jurídicas extranjeras sin residencia en el país; y contribuyentes cuya UD sea igual o menor a cero (o, si sus estados financieros se consolidan, cuya suma de UD del grupo sea igual o menor a cero). Tampoco alcanza a quienes no son sujetos de los Arts. 240 / 240-1: personas naturales, entidades del Régimen Tributario Especial (Art. 19) y contribuyentes del régimen SIMPLE. Vigente desde el año gravable 2023. Art. 10 de la Ley 2277/2022 declarado EXEQUIBLE por Sentencia C-219 de 2024. Metodología: Concepto Unificado DIAN 202(006038) de 2024.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Introdujo el parágrafo 6 con la TTD (tasa mínima 15%) al Art. 240 E.T.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    // Corrección normativa 2026-08: la fórmula anterior ("UD = UAI − INCRGNO − rentas exentas
    // − diferencias permanentes + gastos no deducibles") invertía el signo de las diferencias
    // permanentes (DPARL SUMA), restaba TODAS las rentas exentas (la ley solo permite un
    // subconjunto taxativo), y omitía VIMPP, VNGO y C. También faltaba por completo la lista
    // de exclusiones subjetivas, que hacía liquidable impuesto adicional a hoteles del par. 5,
    // editoriales del par. 7 y sociedades ZESE/ZOMAC expresamente excluidas.
    tags: ['renta', 'TTD', 'tasa_minima', 'PJ', 'Ley_2277', 'exclusiones', 'UD', 'ID'],
  },

  // ─── RETENCIÓN EN LA FUENTE ────────────────────────────────────────────────
  {
    id: 'ART_365_ET',
    cita: 'Art. 365 E.T.',
    titulo: 'Marco general agentes de retención en la fuente',
    resumen:
      'Define el marco general de los agentes de retención: quiénes son, sus obligaciones de practicar, declarar y consignar las retenciones.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=365',
    tags: ['retencion', 'agentes', 'marco_general'],
  },
  {
    id: 'ART_368_2_ET',
    cita: 'Art. 368-2 E.T.',
    titulo: 'Umbral personas naturales comerciantes como agentes de retención',
    resumen:
      'Personas naturales comerciantes son agentes de retención si en el año inmediatamente ANTERIOR tuvieron un patrimonio bruto o ingresos brutos superiores a 30.000 UVT. La conversión a pesos se hace con la UVT del año que se evalúa (el anterior), no con la del año en que se practica la retención (Art. 868 E.T.). Para determinar la calidad de retenedor DURANTE 2026 el test se corre sobre el año 2025 con la UVT 2025: 30.000 × $49.799 = $1.493.970.000. Las 30.000 UVT convertidas con la UVT 2026 ($52.374 → $1.571.220.000) son el umbral del año 2026, es decir el que definirá la calidad de retenedor en 2027. Corrección: spec original citaba "Arts. 365-401 genérico" y umbral 3.500 UVT incorrecto.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=368-2',
    // Corrección normativa 2026-08: el catálogo convertía las 30.000 UVT con la UVT del año en
    // curso. Una PN comerciante con patrimonio o ingresos brutos 2025 entre $1.493.970.000 y
    // $1.571.220.000 quedaba clasificada como NO agente de retención siendo que sí lo es
    // → responsabilidad solidaria por el impuesto no retenido (Art. 370 E.T.) durante todo 2026.
    // UVT 2025 = $49.799 (Res. DIAN 000193 de 2024). UVT 2026 = $52.374 (Res. DIAN 000238 de 2025).
    tags: ['retencion', 'agentes', 'PN', 'umbral', '30000_UVT', 'UVT_año_anterior'],
  },
  {
    id: 'ART_376_ET',
    cita: 'Art. 376 E.T.',
    titulo: 'Plazo para consignar retenciones — delegación al Gobierno Nacional',
    resumen:
      'El plazo para consignar las retenciones practicadas lo fija el Gobierno Nacional mediante el Decreto Anual de Plazos. Los plazos no son uniformes por dígito NIT — varían por mes según días hábiles del calendario anual.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=376',
    tags: ['retencion', 'plazos', 'consignacion'],
  },
  {
    id: 'ART_392_ET',
    cita: 'Art. 392 E.T.',
    titulo: 'Retención por servicios, honorarios, comisiones y arrendamientos',
    resumen:
      'Regula la retención en la fuente aplicable a pagos por servicios, honorarios, comisiones y arrendamientos. Las tarifas específicas se fijan en el Decreto 1625/2016 (DUR Tributario).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=392',
    tags: ['retencion', 'servicios', 'honorarios', 'arrendamiento'],
  },
  {
    id: 'ART_395_ET',
    cita: 'Art. 395 E.T.',
    titulo: 'Retención por rendimientos financieros',
    resumen:
      'Retención en la fuente sobre rendimientos financieros. Tarifa: 7% (Decreto 1625/2016). No tiene umbral mínimo en UVT.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=395',
    tags: ['retencion', 'rendimientos_financieros'],
  },
  {
    id: 'ART_401_ET',
    cita: 'Art. 401 E.T.',
    titulo: 'Retención sobre otros ingresos — umbral 10 UVT',
    resumen:
      'Regula retención sobre otros pagos gravables ("otros ingresos tributarios"). Cuantía mínima 10 UVT = $523.740 COP 2026 (DUR 1625/2016 Arts. 1.2.4.6.9 / 1.2.4.9.1, mod. Decreto 0572/2025, restablecido por CE 30229/2026 desde 01-jul-2026; entre 08-may y 30-jun-2026 rigió la base anterior de 27 UVT). La tarifa específica la fija el Decreto 1625/2016.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=401',
    tags: ['retencion', 'umbral', '10_UVT', 'decreto_0572_2025'],
  },
  {
    id: 'ART_437_1_ET',
    cita: 'Art. 437-1 E.T.',
    titulo: 'ReteIVA — retención del IVA',
    resumen:
      'ReteIVA tarifa general: 15% del IVA generado. Supuestos de retención del 100%: (a) Art. 437-4 — venta de chatarra a siderúrgicas; (b) Art. 437-5 — venta de tabaco en rama o sin elaborar a la industria tabacalera; (c) par. 1 del propio Art. 437-1 — servicios gravados prestados DESDE EL EXTERIOR por prestadores sin residencia ni domicilio en el país. Ninguno de estos supuestos es "compra a no responsables del IVA": un no responsable no factura IVA y por tanto no hay impuesto que retener. Corrección crítica: el spec original citaba Art. 381 para ReteIVA — error.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=437-1',
    tags: ['IVA', 'reteIVA', 'retencion', 'servicios_exterior'],
  },
  {
    id: 'ART_437_4_ET',
    cita: 'Art. 437-4 E.T.',
    titulo: 'ReteIVA 100% — venta de chatarra a siderúrgicas',
    resumen:
      'El IVA causado en la venta de CHATARRA identificada con las nomenclaturas arancelarias andinas 72.04 (fundición, hierro y acero), 74.04 (cobre) y 76.02 (aluminio) se genera cuando esta sea vendida a las SIDERÚRGICAS, y es retenido en el 100% por la siderúrgica. Se entiende por siderúrgica la empresa cuya actividad económica principal esté registrada en el RUT bajo el código 241 de la Resolución DIAN 139 de 2012 o la que la sustituya. El impuesto generado da derecho a impuestos descontables en los términos del Art. 485 E.T. Reglas especiales: la importación de estos bienes y las ventas entre siderúrgicas o a terceros se rigen por las reglas generales del Libro III. Par. 4: el Gobierno Nacional puede extender el mecanismo a otros bienes reutilizables que sean materia prima para la industria manufacturera — por esa vía se incorporaron el papel o cartón para reciclar (partida 47.07) y los desperdicios y desechos de plomo (partida 78.02); antes de aplicar esas dos partidas verificar el decreto reglamentario vigente. Este artículo NO regula compras a no responsables del IVA.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=437-4',
    // Corrección normativa 2026-08: la entrada anterior describía el Art. 437-4 como "ReteIVA
    // 100% en compras a no responsables del IVA", supuesto que no existe en la norma. El error
    // inducía a retener donde no hay IVA y a omitir la retención obligatoria de la siderúrgica.
    tags: ['IVA', 'reteIVA', 'retencion', 'chatarra', 'siderurgicas', 'CIIU_241'],
  },
  {
    id: 'ART_437_5_ET',
    cita: 'Art. 437-5 E.T.',
    titulo: 'ReteIVA 100% — venta de tabaco en rama a la industria tabacalera',
    resumen:
      'El IVA causado en la venta de tabaco en rama o sin elaborar y de desperdicios de tabaco identificados con la nomenclatura arancelaria andina 24.01 se genera cuando estos sean vendidos a la industria tabacalera por productores pertenecientes al régimen común (hoy: responsables del IVA), y es retenido en el 100% por la empresa tabacalera. Se entiende por empresa tabacalera la que tenga registrada en el RUT como actividad económica principal el código 120 de la Resolución DIAN 139 de 2012. El impuesto generado da derecho a impuestos descontables en los términos del Art. 485 E.T. La importación de estos bienes y las ventas entre tabacaleras o a terceros se rigen por las reglas generales del Libro III.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=437-5',
    // Añadido 2026-08: el catálogo citaba el Art. 437-5 en el resumen del Art. 437-1 sin tener
    // entrada propia, de modo que el citation.validator lo marcaba como NO_VERIFICADO.
    tags: ['IVA', 'reteIVA', 'retencion', 'tabaco', 'tabacalera', 'CIIU_120'],
  },

  // ─── IVA ──────────────────────────────────────────────────────────────────
  {
    id: 'ART_420_ET',
    cita: 'Art. 420 E.T.',
    titulo: 'Hecho generador del IVA',
    resumen:
      'El IVA recae sobre: lit. a) la venta de bienes corporales muebles E INMUEBLES, con excepción de los expresamente excluidos; lit. b) la venta o cesión de derechos sobre activos intangibles, únicamente los asociados con la propiedad industrial; lit. c) la prestación de servicios en el territorio nacional O DESDE EL EXTERIOR, con excepción de los expresamente excluidos; lit. d) la importación de bienes corporales no excluidos expresamente; lit. e) la circulación, venta u operación de juegos de suerte y azar, CON EXCEPCIÓN DE LAS LOTERÍAS Y DE LOS JUEGOS DE SUERTE Y AZAR OPERADOS EXCLUSIVAMENTE POR INTERNET. Consecuencias operativas: (1) los juegos operados exclusivamente por internet NO se gravan con IVA — en 2026 tributan Impuesto Nacional al Consumo del 16% (Decreto 240 de 2026); (2) el lit. c) "desde el exterior" es la base del IVA de servicios digitales prestados por no residentes y de la ReteIVA del 100% del par. 1 del Art. 437-1.',
    textoLiteral:
      'La circulación, venta u operación de juegos de suerte y azar, con excepción de las loterías y de los juegos de suerte y azar operados exclusivamente por internet.',
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 1819 de 2016',
        fecha: '2016-12-29',
        cambio: 'Redactó los literales a) a e) en su forma vigente, incluida la exclusión de las loterías y de los juegos operados exclusivamente por internet.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=420',
    // Corrección normativa 2026-08: el resumen anterior omitía la exclusión del lit. e) (juegos
    // por internet) y el "desde el exterior" del lit. c). El Decreto Legislativo 175 de 2025 y
    // el Decreto 1474 de 2025 gravaron temporalmente con IVA esos juegos; el 1474 fue declarado
    // INEXEQUIBLE (Sentencia C-079 de 2026, abril de 2026, con orden de devolución). Desde 2026
    // la exclusión del lit. e) opera plenamente.
    tags: ['IVA', 'hecho_generador', 'juegos_suerte_azar', 'internet', 'servicios_exterior', 'inmuebles'],
  },
  {
    id: 'ART_424_ET',
    cita: 'Art. 424 E.T.',
    titulo: 'Bienes excluidos del IVA',
    resumen:
      'Listado de bienes que NO causan IVA (bienes excluidos). Los excluidos no generan derecho a saldo a favor ni devolución. Distinto de exentos (Art. 477) que se gravan al 0% y sí generan derecho a devolución.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=424',
    // Corrección: spec confundió excluidos (Art. 424) vs exentos (Art. 477).
    tags: ['IVA', 'excluidos', 'no_causa'],
  },
  {
    id: 'ART_468_ET',
    cita: 'Art. 468 E.T.',
    titulo: 'Tarifa general del IVA',
    resumen:
      'Tarifa general del IVA: 19%. Vigente sin modificación desde Ley 1819/2016.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=468',
    tags: ['IVA', 'tarifa', '19%'],
  },
  {
    id: 'ART_468_1_ET',
    cita: 'Art. 468-1 E.T.',
    titulo: 'Bienes gravados a la tarifa diferencial del 5%',
    resumen:
      'Bienes de la canasta familiar básica y otros listados en el artículo se gravan al 5%.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=468-1',
    tags: ['IVA', 'tarifa', '5%', 'canasta'],
  },
  {
    id: 'ART_476_ET',
    cita: 'Art. 476 E.T.',
    titulo: 'Servicios excluidos del IVA',
    resumen:
      'Listado de servicios que NO generan IVA (servicios excluidos): servicios médicos, educación, transporte público terrestre de personas, entre otros. NO confundir con Art. 477 (bienes exentos).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=476',
    // Corrección crítica: spec invirtió Arts. 476 y 477.
    tags: ['IVA', 'servicios', 'excluidos'],
  },
  {
    id: 'ART_477_ET',
    cita: 'Art. 477 E.T.',
    titulo: 'Bienes exentos del IVA (gravados a tarifa 0%)',
    resumen:
      'Bienes exentos: gravados a tarifa cero (0%), generan derecho a saldo a favor y devolución del IVA descontable. Incluye carnes, pollos, huevos, leche, libros (Ley 98/1993), entre otros.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=477',
    // Corrección crítica: spec invirtió Arts. 476 y 477.
    tags: ['IVA', 'exentos', 'tarifa_cero', 'devolucion'],
  },
  {
    id: 'ART_485_ET',
    cita: 'Art. 485 E.T.',
    titulo: 'IVA descontable',
    resumen:
      'El IVA pagado en la adquisición de bienes y servicios necesarios para la actividad gravada puede descontarse del IVA generado. Sujeto a proporcionalidad cuando hay operaciones gravadas y excluidas.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=485',
    tags: ['IVA', 'descontable'],
  },
  {
    id: 'ART_600_ET',
    cita: 'Art. 600 E.T.',
    titulo: 'Periodicidad del IVA — bimestral y cuatrimestral',
    resumen:
      'Periodos gravables IVA 2026. Numeral 1 — declaración y pago BIMESTRAL para: (a) los grandes contribuyentes; (b) las personas jurídicas y naturales cuyos ingresos brutos a 31-dic del año gravable anterior sean iguales o superiores a 92.000 UVT; y (c) los responsables de que tratan los Arts. 477 (bienes exentos) y 481 (bienes y servicios exentos con derecho a devolución bimestral, incl. exportadores) de este Estatuto, SIN IMPORTAR EL MONTO DE SUS INGRESOS. Numeral 2 — declaración y pago CUATRIMESTRAL solo para los demás responsables, personas jurídicas y naturales, cuyos ingresos brutos a 31-dic del año anterior sean inferiores a 92.000 UVT. El período ANUAL fue ELIMINADO por Ley 1943/2018 (ratificado por Ley 2010/2019).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 1943 de 2018',
        fecha: '2018-12-28',
        cambio: 'Eliminó el período IVA anual; estableció solo bimestral y cuatrimestral.',
      },
      {
        norma: 'Ley 2010 de 2019',
        fecha: '2019-12-27',
        cambio: 'Ratificó la eliminación del período anual.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=600',
    // Corrección crítica: spec mencionaba "anual <15.000 UVT" — INCORRECTO.
    // Corrección normativa 2026-08: faltaban los responsables de los Arts. 477 y 481, que
    // declaran SIEMPRE bimestralmente sin importar sus ingresos. Clasificar a un exportador o
    // a un productor de bienes exentos como cuatrimestral produce declaraciones extemporáneas
    // (Art. 641 E.T.) y le hace perder la devolución bimestral del Art. 481 E.T.
    tags: ['IVA', 'periodicidad', 'bimestral', 'cuatrimestral', 'Art_477', 'Art_481', 'exportadores'],
  },

  // ─── IMPUESTO NACIONAL AL CONSUMO (INC) ───────────────────────────────────
  // Impuesto INDEPENDIENTE del IVA (Libro Tercero, Arts. 512-1 a 512-22 E.T.).
  // El catálogo no lo contenía pese a que el motor lo declara como tipo de impuesto
  // (schema-tax.ts y el enum del tax-engine incluyen 'INC'). Sin estas entradas el
  // Motor Normativo no puede citarlo y ningún restaurante, bar, operador de telefonía
  // móvil o vendedor de vehículos recibía alerta de la obligación bimestral (Form. 310).
  {
    id: 'ART_512_1_ET',
    cita: 'Art. 512-1 E.T.',
    titulo: 'Impuesto Nacional al Consumo — hecho generador',
    resumen:
      'El INC tiene como hecho generador la prestación o la venta al consumidor final (o la importación por el usuario final) de: num. 1) el servicio de telefonía móvil, datos, internet y navegación móvil (Art. 512-2); num. 2) las ventas de algunos bienes corporales muebles de producción doméstica o importados — vehículos, motocicletas, yates, aerodinos (Arts. 512-3, 512-4 y 512-5); num. 3) el servicio de expendio de comidas y bebidas preparadas en restaurantes, cafeterías, autoservicios, heladerías, fruterías, pastelerías y panaderías, los servicios de alimentación bajo contrato (incluido catering), y el servicio de expendio de comidas y bebidas alcohólicas para consumo dentro de bares, tabernas y discotecas (Arts. 512-8 a 512-13). El INC no genera impuestos descontables en IVA y constituye para el comprador un mayor valor del costo del bien o servicio adquirido. Es un impuesto INDEPENDIENTE del IVA: un mismo hecho no se grava con ambos.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 1607 de 2012',
        fecha: '2012-12-26',
        cambio: 'Creó el Impuesto Nacional al Consumo (Arts. 512-1 y siguientes E.T.).',
      },
      {
        norma: 'Ley 2010 de 2019',
        fecha: '2019-12-27',
        cambio: 'Ajustó el régimen de responsables y no responsables del INC de restaurantes y bares (Art. 512-13).',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=512-1',
    tags: ['INC', 'consumo', 'hecho_generador', 'restaurantes', 'bares', 'telefonia', 'vehiculos'],
  },
  {
    id: 'ART_512_2_ET',
    cita: 'Art. 512-2 E.T.',
    titulo: 'INC — servicios de telefonía móvil, internet, navegación móvil y datos',
    resumen:
      'Tarifa del 4% sobre la totalidad del servicio de telefonía móvil, datos y/o voz, sin incluir el IVA. Los servicios de datos, internet y navegación móvil se gravan solo respecto de los ingresos por encima de 1,5 UVT mensuales (2026: 1,5 × $52.374 = $78.561). El impuesto se causa en el momento del pago correspondiente hecho por el usuario.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=512-2',
    tags: ['INC', 'consumo', 'telefonia_movil', 'internet', 'datos', '4%'],
  },
  {
    id: 'ART_512_3_ET',
    cita: 'Art. 512-3 E.T.',
    titulo: 'INC — bienes gravados a la tarifa del 8%',
    resumen:
      'Se gravan al 8%: vehículos automóviles de tipo familiar y camperos cuyo valor FOB (o su equivalente) sea INFERIOR a USD 30.000, con sus accesorios; pick-ups cuyo valor FOB sea inferior a USD 30.000; motocicletas con motor de émbolo alternativo de cilindrada SUPERIOR a 200 c.c.; yates y demás barcos y embarcaciones de recreo o deporte, barcas de remo y canoas. No están gravadas las motocicletas de hasta 200 c.c. ni los vehículos de transporte público de pasajeros o de carga.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=512-3',
    // Nota de verificación 2026-08: el informe de auditoría afirmaba que las motocicletas de
    // más de 200 c.c. tributan al 19%. NO se aplicó: las fuentes consultadas (agosto 2026)
    // las ubican en el 8% del Art. 512-3, y no hay reforma vigente que las mueva.
    tags: ['INC', 'consumo', 'vehiculos', 'motocicletas', 'yates', '8%'],
  },
  {
    id: 'ART_512_4_ET',
    cita: 'Art. 512-4 E.T.',
    titulo: 'INC — bienes gravados a la tarifa del 16%',
    resumen:
      'Se gravan al 16%: vehículos automóviles de tipo familiar, camperos y pick-ups cuyo valor FOB (o su equivalente) sea IGUAL O SUPERIOR a USD 30.000, con sus accesorios; globos y dirigibles, planeadores, alas planeadoras y demás aeronaves sin motor; helicópteros y aviones de uso privado; barcos de recreo y de deporte de valor FOB igual o superior a USD 30.000.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=512-4',
    tags: ['INC', 'consumo', 'vehiculos', 'aerodinos', '16%'],
  },
  {
    id: 'ART_512_9_ET',
    cita: 'Art. 512-9 E.T.',
    titulo: 'INC — base gravable y tarifa en el servicio de restaurantes',
    resumen:
      'La base gravable del servicio de restaurantes es el precio total de consumo, incluidas las bebidas acompañantes y demás valores adicionales. NO forma parte de la base la propina (voluntaria) ni los alimentos excluidos del IVA que se vendan sin transformaciones o preparaciones adicionales. Tarifa: 8% sobre todo consumo. El impuesto debe discriminarse en la cuenta de cobro, tiquete de registradora, factura o documento equivalente, y ser cobrado al cliente por el responsable.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=512-9',
    tags: ['INC', 'consumo', 'restaurantes', '8%'],
  },
  {
    id: 'ART_512_11_ET',
    cita: 'Art. 512-11 E.T.',
    titulo: 'INC — base gravable y tarifa en los servicios de bares, tabernas y discotecas',
    resumen:
      'La base gravable en los servicios prestados por establecimientos que operan como bar, taberna o discoteca es el valor total del consumo, incluidas comidas, precio de entrada y demás valores adicionales. La propina no hace parte de la base por ser voluntaria. Tarifa: 8% sobre todo consumo, que debe discriminarse en la cuenta de cobro o documento equivalente y ser cobrado al cliente por el responsable.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=512-11',
    tags: ['INC', 'consumo', 'bares', 'tabernas', 'discotecas', '8%'],
  },
  {
    id: 'ART_512_13_ET',
    cita: 'Art. 512-13 E.T.',
    titulo: 'INC — no responsables del impuesto de restaurantes y bares',
    resumen:
      'No son responsables del INC de restaurantes y bares las personas naturales que cumplan la TOTALIDAD de las condiciones: (a) haber obtenido en el año anterior ingresos brutos totales, provenientes de la actividad, inferiores a 3.500 UVT (2026: 3.500 × $52.374 = $183.309.000); y (b) tener máximo un establecimiento de comercio, sede, local o negocio donde ejercen su actividad. Si durante el año se abre un segundo establecimiento o se supera el tope, el contribuyente pasa a ser responsable a partir de ese momento. La responsabilidad se identifica en el RUT con el código 33. Los responsables del INC declaran BIMESTRALMENTE en el Formulario 310.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2010 de 2019',
        fecha: '2019-12-27',
        cambio: 'Redefinió las condiciones de los no responsables del INC de restaurantes y bares (umbral 3.500 UVT y un solo establecimiento).',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=512-13',
    tags: ['INC', 'consumo', 'no_responsables', '3500_UVT', 'restaurantes', 'bares', 'formulario_310'],
  },

  // ─── RÉGIMEN SANCIONATORIO ────────────────────────────────────────────────
  {
    id: 'ART_639_ET',
    cita: 'Art. 639 E.T.',
    titulo: 'Sanción mínima',
    resumen:
      'Ninguna sanción puede ser inferior a 10 UVT. En 2026: 10 × $52.374 = $523.740 COP.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=639',
    tags: ['sancion', 'minima', '10_UVT'],
  },
  {
    id: 'ART_640_ET',
    cita: 'Art. 640 E.T.',
    titulo: 'Aplicación de los principios de lesividad, proporcionalidad, gradualidad y favorabilidad',
    resumen:
      'La reducción NO depende de "aceptar" o de "subsanar antes del pliego": depende del historial de reincidencia y del momento procesal, y siempre reduce la sanción AL 50% o AL 75% de su monto legal (no un descuento adicional sobre otra reducción). Cuando la sanción la LIQUIDA EL CONTRIBUYENTE, agente retenedor, responsable o declarante: num. 1 — se reduce AL 50% si (a) dentro de los 2 años anteriores a la comisión de la conducta no se cometió la misma conducta sancionada mediante acto administrativo en firme, y (b) la DIAN no ha proferido pliego de cargos, requerimiento especial ni emplazamiento previo por no declarar; num. 2 — se reduce AL 75% con las mismas condiciones pero con período limpio de 1 año. Cuando la sanción la PROPONE O DETERMINA LA DIAN: num. 3 — se reduce AL 50% si (a) dentro de los 4 años anteriores no se cometió la misma conducta sancionada mediante acto en firme, y (b) la sanción es aceptada y la infracción subsanada; num. 4 — AL 75% con período limpio de 2 años y las mismas condiciones. Par. 2: hay reincidencia cuando la conducta se comete dentro de los 2 años siguientes a la firmeza del acto sancionatorio, y la sanción se aumenta en un 100%. Par. 3: la proporcionalidad y la gradualidad NO APLICAN a las sanciones de los numerales 1, 2 y 3 del inciso 3º del Art. 648 (200% por activos omitidos/pasivos inexistentes, 160% por proveedores ficticios o abuso, y 20% en ingresos y patrimonio), ni a los Arts. 640-1, 652-1, numerales 1 a 3 del 657, 658-1, 658-2, numeral 4 del 658-3, 669, inciso 6º del 670, 671, 672 y 673. Par. 4: tampoco aplican a los intereses moratorios ni a los Arts. 674, 675, 676 y 676-1. Corrección: spec atribuía estas reducciones a Art. 649.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 1819 de 2016, Art. 282',
        fecha: '2016-12-29',
        cambio: 'Modificó el Art. 640 fijando la gradualidad por historial de reincidencia y momento procesal, y excluyendo expresamente (par. 3) las sanciones agravadas del inciso 3º del Art. 648.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=640',
    // Corrección normativa 2026-08: la redacción anterior ("50% si se acepta cargo sin pliego
    // de cargos; 75% si subsana antes del pliego") invertía el criterio legal y omitía el
    // parágrafo 3, permitiendo que el agente ofreciera gradualidad sobre el 200% por activos
    // omitidos, que está expresamente excluido.
    tags: ['sancion', 'reduccion', 'principios', 'gradualidad', 'reincidencia', 'par_3_exclusiones'],
  },
  {
    id: 'ART_641_ET',
    cita: 'Art. 641 E.T.',
    titulo: 'Sanción por extemporaneidad — presentación ANTES de emplazamiento',
    resumen:
      'Aplica a la declaración presentada de forma extemporánea ANTES del emplazamiento para declarar o del auto que ordena inspección tributaria: 5% del total del impuesto a cargo o retención objeto de la declaración por cada mes o fracción de mes de retardo, sin exceder el 100% del impuesto o retención. Si no hay impuesto a cargo: 0,5% mensual de los ingresos brutos del período, sin exceder el menor entre el 5% de tales ingresos, el doble del saldo a favor si lo hubiere, o 2.500 UVT ($130.935.000 con UVT 2026 de $52.374). Si tampoco hay ingresos: 1% mensual del patrimonio líquido del año anterior, sin exceder el menor entre el 10% de ese patrimonio, el doble del saldo a favor si lo hubiere, o 2.500 UVT. El supuesto post-emplazamiento (10% mensual, tope 200%) NO es de este artículo: está en el Art. 642 E.T.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=641',
    // Corrección normativa 2026-08: la entrada describía el supuesto del Art. 642 (10% mensual)
    // aplicándole el tope del Art. 641 (100%), truncando a la mitad la sanción post-emplazamiento.
    // Se elimina también el comentario de la auditoría de julio 2026 que declaraba "el tope del
    // 200% es INCORRECTO": el 200% sí es el tope legal, pero del Art. 642, no del 641.
    tags: ['sancion', 'extemporaneidad', '5%', 'tope_100%', 'antes_emplazamiento'],
  },
  {
    id: 'ART_642_ET',
    cita: 'Art. 642 E.T.',
    titulo: 'Sanción por extemporaneidad — presentación DESPUÉS de emplazamiento',
    resumen:
      'Aplica cuando la declaración se presenta con posterioridad al emplazamiento o al auto que ordena inspección tributaria: 10% del total del impuesto a cargo o retención objeto de la declaración por cada mes o fracción de mes de retardo, sin exceder el 200% del impuesto o retención. Si no hay impuesto a cargo: 1% mensual de los ingresos brutos del período, sin exceder el menor entre el 10% de tales ingresos, 4 veces el saldo a favor si lo hubiere, o 5.000 UVT ($261.870.000 con UVT 2026 de $52.374). Si tampoco hay ingresos: 2% mensual del patrimonio líquido del año anterior, sin exceder el menor entre el 20% de ese patrimonio, 4 veces el saldo a favor si lo hubiere, o 5.000 UVT. Es decir: todos los porcentajes y topes del Art. 641 se duplican.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=642',
    // Añadido 2026-08: el catálogo no tenía entrada para el Art. 642 pese a que el agente
    // debe distinguir los dos topes (100% vs 200%). Sin ella el citation.validator marcaba
    // "Art. 642 E.T." como NO_VERIFICADO y bloqueaba una cita correcta.
    tags: ['sancion', 'extemporaneidad', '10%', 'tope_200%', 'post_emplazamiento'],
  },
  {
    id: 'ART_644_ET',
    cita: 'Art. 644 E.T.',
    titulo: 'Sanción por corrección de declaraciones',
    resumen:
      'Corrección que aumenta el impuesto o disminuye el saldo a favor: 10% del mayor valor antes de emplazamiento, 20% después.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=644',
    tags: ['sancion', 'correccion', '10%', '20%'],
  },
  {
    id: 'ART_647_ET',
    cita: 'Art. 647 E.T.',
    titulo: 'Sanción por inexactitud en declaraciones tributarias',
    resumen:
      'Tipifica las conductas constitutivas de inexactitud: omisión de ingresos o impuestos generados, inclusión de costos, deducciones, descuentos, exenciones, pasivos, impuestos descontables, retenciones o anticipos inexistentes o inexactos; omisión de activos o inclusión de pasivos inexistentes (num. 4); utilización en las declaraciones de datos o factores falsos, desfigurados, alterados, simulados o modificados artificialmente; compras o gastos a PROVEEDORES FICTICIOS o insolventes (num. 5). Las CUANTÍAS de la sanción no están en este artículo: están en el Art. 648 E.T., que es escalonado (100% general, 15% en ingresos y patrimonio, y las agravaciones de 200%, 160%, 20% y 50%). El parágrafo del Art. 647 establece la defensa de diferencia de criterio.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=647',
    // Corrección normativa 2026-08: el resumen afirmaba que "Art. 648 consolida la tarifa"
    // en 100%. El Art. 648 NO consolidó nada: conserva un régimen escalonado.
    tags: ['sancion', 'inexactitud', 'conductas', 'proveedores_ficticios', 'defensa'],
  },
  {
    id: 'ART_647_PAR_ET',
    cita: 'Art. 647 par. E.T.',
    titulo: 'Defensa de diferencia de criterio — parágrafo Art. 647',
    resumen:
      'Exención de sanción por inexactitud cuando el menor valor a pagar deriva de interpretación razonable del derecho, siempre que los hechos y cifras sean completos y verdaderos.',
    textoLiteral:
      'No se configura inexactitud cuando el menor valor a pagar o el mayor saldo a favor que resulte en las declaraciones tributarias se derive de una interpretación razonable en la apreciación o interpretación del derecho aplicable, siempre que los hechos y cifras denunciados sean completos y verdaderos.',
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=647',
    tags: ['sancion', 'inexactitud', 'defensa', 'diferencia_criterio'],
  },
  {
    id: 'ART_648_ET',
    cita: 'Art. 648 E.T.',
    titulo: 'Sanción por inexactitud — cuantías escalonadas',
    resumen:
      'Régimen ESCALONADO, no una tarifa única. Inciso 1º: 100% de la diferencia entre el saldo a pagar o saldo a favor determinado en la liquidación oficial y el declarado por el contribuyente, agente retenedor o responsable; o 15% de los valores inexactos en el caso de las declaraciones de ingresos y patrimonio. Inciso 2º: la sanción no se aplica sobre el mayor valor del anticipo que se genere al modificar el impuesto declarado. Inciso 3º — cuantías agravadas: num. 1) 200% del mayor valor del impuesto a cargo determinado cuando se OMITAN ACTIVOS o se INCLUYAN PASIVOS INEXISTENTES; num. 2) 160% de la diferencia cuando la inexactitud se origine en las conductas del numeral 5 del Art. 647 (compras o gastos a proveedores ficticios o insolventes) o en la conducta de abuso en materia tributaria del Art. 869; num. 3) 20% de los valores inexactos en las declaraciones de ingresos y patrimonio cuando la inexactitud se origine en esas mismas conductas; num. 4) 50% de la diferencia entre el saldo a pagar determinado y el declarado, en las declaraciones del monotributo. Par. 1: la sanción del inciso 1º se reduce en todos los casos si se cumplen los supuestos de los Arts. 709 y 713. Par. 2: la sanción del numeral 1 del inciso 3º (200%) aplica a partir del año gravable 2018. Advertencia operativa: por el par. 3 del Art. 640, la proporcionalidad y la gradualidad NO aplican a los numerales 1, 2 y 3 del inciso 3º — no puede ofrecerse reducción del 50%/75% sobre el 200%, el 160% ni el 20%.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 1819 de 2016, Art. 288',
        fecha: '2016-12-29',
        cambio: 'Reescribió el Art. 648 fijando la sanción base en 100% (15% en ingresos y patrimonio) y las cuantías agravadas de 200%, 160%, 20% y 50% del inciso 3º.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=648',
    // Corrección normativa 2026-08: la entrada declaraba que el Art. 648 "consolida la tarifa
    // escalonada en el 100%". El caso más auditado por la DIAN (omisión de activos y pasivos
    // inexistentes) se dictaminaba así al 100% cuando la norma impone 200% — el cliente
    // subestimaba su exposición exactamente a la mitad.
    tags: ['sancion', 'inexactitud', '100%', '200%', '160%', '20%', '50%', 'activos_omitidos', 'escalonada'],
  },
  {
    id: 'ART_709_ET',
    cita: 'Art. 709 E.T.',
    titulo: 'Corrección provocada por el requerimiento especial — sanción por inexactitud al 25%',
    resumen:
      'Si con ocasión de la respuesta al requerimiento especial o a su ampliación el contribuyente acepta total o parcialmente los hechos planteados, la sanción por inexactitud se reduce a la cuarta parte (25%) de la planteada por la Administración, en relación con los hechos aceptados. Requisitos: corregir la declaración privada incluyendo los mayores valores aceptados y la sanción reducida, y adjuntar a la respuesta copia de la corrección y prueba del pago o acuerdo de pago.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=709',
    tags: ['sancion', 'reduccion', '25%', 'pliego_cargos'],
  },
  {
    id: 'ART_713_ET',
    cita: 'Art. 713 E.T.',
    titulo: 'Reducción de sanción por aceptación de liquidación oficial — 50%',
    resumen:
      'Si el contribuyente acepta la liquidación de revisión, la sanción se reduce al 50% del valor inicial.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=713',
    tags: ['sancion', 'reduccion', '50%', 'liquidacion'],
  },

  // ─── DEVOLUCIONES ─────────────────────────────────────────────────────────
  {
    id: 'ART_771_5_ET',
    cita: 'Art. 771-5 E.T.',
    titulo: 'Bancarización — limitación de pagos en efectivo',
    resumen:
      'Para reconocimiento fiscal (deducción, costo, IVA descontable), los pagos deben realizarse por medios diferentes al efectivo. §2: tope individual 100 UVT por NIT ($5.237.400 COP 2026). §1: tope general 40.000 UVT ($2.094.960.000) o 40% de pagos en efectivo o 35% de costos/deducciones totales (el menor).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=771-5',
    tags: ['bancarizacion', 'efectivo', 'deduccion', 'DIAN', 'auditoria'],
  },
  {
    id: 'ART_850_ET',
    cita: 'Art. 850 E.T.',
    titulo: 'Derecho a la devolución o compensación de saldos a favor',
    resumen:
      'Los contribuyentes y responsables tienen derecho a solicitar la devolución o compensación de los saldos a favor liquidados en sus declaraciones tributarias.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=850',
    tags: ['devolucion', 'saldo_favor', 'compensacion'],
  },
  {
    id: 'ART_854_ET',
    cita: 'Art. 854 E.T.',
    titulo: 'Plazo para solicitar devolución',
    resumen:
      'El derecho a solicitar la devolución prescribe en 2 años desde el vencimiento del plazo para presentar la declaración.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=854',
    tags: ['devolucion', 'plazo', 'prescripcion'],
  },
  {
    id: 'ART_855_ET',
    cita: 'Art. 855 E.T.',
    titulo: 'Término para efectuar la devolución por parte de la DIAN',
    resumen:
      'La DIAN debe resolver la solicitud de devolución en 50 días hábiles. Con garantía bancaria personal: 20 días hábiles.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=855',
    // Corrección: spec citaba "Arts. 854-860 genérico"; la regla específica del plazo
    // DIAN está en Art. 855.
    tags: ['devolucion', 'DIAN', 'plazo', '50_dias', '20_dias'],
  },

  // ─── PROCEDIMIENTO DIAN — REQUERIMIENTOS Y RECURSOS ──────────────────────
  // Capa 4 — Módulo 5 (Defensa DIAN). Estos artículos rigen los plazos y la
  // estructura procesal de respuesta a actuaciones DIAN. Toda carta producida
  // por `dian-letter-builder` cita uno de estos artículos según tipo.
  {
    id: 'ART_685_ET',
    cita: 'Art. 685 E.T.',
    titulo: 'Emplazamiento para corregir',
    resumen:
      'La DIAN puede emplazar al contribuyente para que corrija su declaración cuando existan indicios de inexactitud. El contribuyente tiene 1 mes contado desde la notificación para corregir voluntariamente o responder al emplazamiento. La corrección oportuna activa la reducción del Art. 644 E.T. (10% en lugar de 20%).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial: 'https://estatuto.co/?articulo=685',
    tags: ['procedimiento', 'DIAN', 'emplazamiento', 'corregir', 'plazo', '1_mes'],
  },
  {
    id: 'ART_702_ET',
    cita: 'Art. 702 E.T.',
    titulo: 'Facultad de modificar la liquidación privada — Liquidación oficial de revisión',
    resumen:
      'La DIAN puede modificar por una sola vez la liquidación privada del contribuyente mediante liquidación oficial de revisión. Es el acto administrativo definitivo que cierra el proceso de determinación oficial del impuesto. Contra esta liquidación procede el recurso de reconsideración (Art. 720 E.T.), dentro de los 2 meses siguientes a su notificación.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial: 'https://estatuto.co/?articulo=702',
    tags: ['procedimiento', 'DIAN', 'liquidacion_oficial', 'revision'],
  },
  {
    id: 'ART_715_ET',
    cita: 'Art. 715 E.T.',
    titulo: 'Emplazamiento previo por no declarar',
    resumen:
      'Procede cuando el contribuyente, obligado a presentar declaración, no la presenta. La DIAN lo emplaza para que la presente. Si no responde, se aplica la sanción por no declarar (Art. 643 E.T.) y se procede con liquidación de aforo. La presentación dentro del término reduce la sanción al amparo del Art. 716 E.T.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial: 'https://estatuto.co/?articulo=715',
    tags: ['procedimiento', 'DIAN', 'emplazamiento', 'no_declarar'],
  },
  {
    id: 'ART_720_ET',
    cita: 'Art. 720 E.T.',
    titulo: 'Recurso de reconsideración',
    resumen:
      'Procede contra las liquidaciones oficiales, resoluciones que impongan sanciones u ordenen el reintegro de sumas devueltas, y demás actos producidos por la DIAN. Plazo: 2 meses contados desde la notificación del acto. Se interpone ante el funcionario que profirió el acto. Es el recurso obligatorio antes de acudir a la jurisdicción contencioso-administrativa.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial: 'https://estatuto.co/?articulo=720',
    tags: ['procedimiento', 'DIAN', 'recurso', 'reconsideracion', 'plazo', '2_meses'],
  },
  {
    id: 'ART_752_ET',
    cita: 'Art. 752 E.T.',
    titulo: 'Requerimiento ordinario de información',
    resumen:
      'Faculta a la DIAN para solicitar a cualquier persona, dentro o fuera del proceso de determinación, la información que requiera para fines de control tributario. Plazo de respuesta: 15 días hábiles contados desde la notificación, prorrogables por petición motivada. La omisión genera sanción por no informar (Art. 651 E.T.).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial: 'https://estatuto.co/?articulo=752',
    tags: ['procedimiento', 'DIAN', 'requerimiento', 'informacion', 'plazo', '15_dias_habiles'],
  },
] as const;
