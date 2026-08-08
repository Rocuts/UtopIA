// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Leyes y Reformas
// ---------------------------------------------------------------------------
//
// Reformas estructurales del sistema tributario colombiano que afectan las
// bases de los módulos 1-8 de Capa 4. Orden cronológico descendente.
// ---------------------------------------------------------------------------

import type { LawReformEntry } from '../types';

export const LEYES_REFORMAS: readonly LawReformEntry[] = [
  // ─── DECRETOS LEGISLATIVOS DE EMERGENCIA 2026 ─────────────────────────────
  // Normas TEMPORALES y de alta volatilidad: nacen de la emergencia económica,
  // social y ecológica del Decreto Legislativo 150 de 2026 y su control de
  // constitucionalidad de fondo puede seguir en curso. Antes de citarlas en un
  // dictamen firmado, verificar el estado del expediente en corteconstitucional.gov.co.
  // Antecedente que obliga a esa cautela: el Decreto 1474 de 2025 fue declarado
  // INEXEQUIBLE (Sentencia C-079 de 2026) con orden de devolución de lo recaudado.
  {
    id: 'DECRETO_173_2026',
    cita: 'Decreto 173 de 2026',
    titulo: 'Impuesto al patrimonio TEMPORAL a cargo de personas jurídicas — solo año 2026',
    resumen:
      'Decreto Legislativo del 24-feb-2026 (Art. 215 C.P.), expedido bajo la emergencia del Decreto Legislativo 150 de 2026, para financiar la atención de la ola invernal. Crea un impuesto al patrimonio TEMPORAL y exclusivo del año 2026 a cargo de personas jurídicas y sociedades de hecho contribuyentes declarantes del impuesto sobre la renta —hasta entonces el impuesto al patrimonio solo recaía sobre personas naturales—. Hecho generador: poseer al 1 de MARZO de 2026 un patrimonio líquido igual o superior a 200.000 UVT (200.000 × $52.374 = $10.474.800.000). Base gravable: patrimonio bruto menos deudas vigentes a esa fecha, excluyendo las acciones, cuotas o partes de interés en sociedades nacionales (directas o indirectas), los activos fijos inmuebles ambientales de empresas públicas de acueducto, las reservas técnicas de Fogafín y Fogacoop y los aportes sociales de las entidades del Art. 19-4 E.T. Tarifas: 0,5% general y 1,6% para instituciones financieras, aseguradoras, comisionistas de bolsa y actividades de extracción de carbón (CIIU 0510 y 0520) y de petróleo crudo (CIIU 0610). Plazos: declaración y primera cuota (50%) el 1-abr-2026 y segunda cuota (50%) el 4-may-2026; para establecimientos permanentes y sucursales de entidades extranjeras, declaración el 30-abr-2026 y cuotas el 30-abr-2026 y el 1-jun-2026 (par. adicionado por el Decreto 240 de 2026). El valor pagado NO es deducible ni descontable en el impuesto sobre la renta. No sujetos pasivos: empresas del sector salud, empresas intervenidas por el Estado y empresas de servicios públicos domiciliarios de los municipios declarados en calamidad pública dentro de la zona de emergencia. Regla antielusión: las sociedades escindidas entre la entrada en vigor y el 1-mar-2026 suman los patrimonios de las beneficiarias para determinar la sujeción. ADVERTENCIA OPERATIVA: los plazos de abril y mayo de 2026 ya vencieron; una persona jurídica sujeta que no declaró está en extemporaneidad (Art. 641 E.T., 5% mensual, tope 100%) más intereses de mora (Art. 635 E.T.).',
    articulosClave: [
      'Decreto 150 de 2026',
      'Art. 19-4 E.T.',
      'Art. 641 E.T.',
      'Art. 635 E.T.',
    ],
    estado: 'VIGENTE_2026',
    sentenciaCorte:
      'La Corte Constitucional declaró EXEQUIBLE DE MANERA CONDICIONADA el Decreto Legislativo 150 de 2026 (habilitante) en junio de 2026, limitando la emergencia a los 181 municipios afectados; con ello se mantuvo la exigibilidad del impuesto al patrimonio de personas jurídicas. El control de fondo del propio Decreto 173 debe verificarse antes de citarlo en un dictamen.',
    urlOficial:
      'https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0173_2026.htm',
  },
  {
    id: 'DECRETO_240_2026',
    cita: 'Decreto 240 de 2026',
    titulo: 'INC del 16% a los juegos de suerte y azar por internet + normalización tributaria — solo 2026',
    resumen:
      'Decreto Legislativo del 12-mar-2026, expedido bajo la emergencia del Decreto Legislativo 150 de 2026. (1) Crea, para la vigencia fiscal 2026, un IMPUESTO NACIONAL AL CONSUMO del 16% sobre los juegos de suerte y azar operados EXCLUSIVAMENTE POR INTERNET. Hecho generador: el depósito en dinero —pago en efectivo, transferencia o criptoactivos— realizado por cada usuario apostador al operador, desde el territorio nacional o desde el exterior. Base gravable: GGR (gross gaming revenue) = total de apuestas menos premios pagados en el bimestre. Responsable: el operador autorizado de la plataforma. Periodicidad: bimestral (Formulario 310). Cesa al terminar la vigencia fiscal 2026. Complemento indispensable: el lit. e) del Art. 420 E.T. EXCLUYE del IVA los juegos operados exclusivamente por internet, de modo que la operación tributa INC y NO IVA. (2) Crea un impuesto complementario de NORMALIZACIÓN TRIBUTARIA del 19% sobre activos omitidos y pasivos inexistentes poseídos al 1-abr-2026, con declaración única antes del 31-jul-2026 (no corregible). (3) Extiende el impuesto al patrimonio del Decreto 173 de 2026 a establecimientos permanentes y sucursales de entidades extranjeras. (4) Adopta medidas transitorias de alivio: reducción de sanciones e intereses y conciliación contencioso-administrativa.',
    articulosClave: [
      'Decreto 150 de 2026',
      'Decreto 173 de 2026',
      'Art. 420 E.T.',
      'Art. 512-1 E.T.',
    ],
    estado: 'VIGENTE_2026',
    sentenciaCorte:
      'Emergencia habilitante (Decreto Legislativo 150 de 2026) declarada EXEQUIBLE DE MANERA CONDICIONADA por la Corte Constitucional en junio de 2026. El control de fondo del Decreto 240 no consta resuelto a la fecha de esta entrada (agosto de 2026): tratar como norma temporal de alta volatilidad y verificar antes de citarla.',
    urlOficial:
      'https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0240_2026.htm',
  },
  {
    id: 'LEY_2277_2022',
    cita: 'Ley 2277 de 2022',
    titulo: 'Reforma tributaria estructural',
    resumen:
      'Reforma tributaria de 2022. Principales cambios: elevó tarifa GO de 10% a 15% (Art. 313); introdujo TTD ≥ 15% como parágrafo 6 del Art. 240; modificó tarifas dividendos PN (integración base ordinaria Art. 241); eliminó descuento 50% ICA — solo deducción 100% Art. 115; amplió descuento exterior Art. 254; ajustó descuento I+D+i a 30% Art. 256. Su Art. 10 reescribió por completo el Art. 240: estableció TRES sobretasas distintas, cada una con su propio umbral de renta gravable —par. 2 sector financiero/asegurador/bursátil +5pp con umbral de 120.000 UVT (AG 2023-2027), par. 3 extracción de petróleo crudo y carbón con puntos variables por percentil de precios y umbral de 50.000 UVT, par. 4 generación de energía eléctrica con recursos hídricos +3pp con umbral de 30.000 UVT (AG 2023-2026)— y elevó de 9% a 15% las tarifas del par. 5 (hoteles y parques temáticos) y del par. 7 (empresas editoriales). Su Art. 35 y siguientes reconfiguraron el impuesto al patrimonio permanente de personas naturales (Arts. 292-3 a 298-8 E.T.).',
    articulosClave: [
      'Art. 115 E.T.',
      'Art. 240 par. 2 E.T.',
      'Art. 240 par. 3 E.T.',
      'Art. 240 par. 4 E.T.',
      'Art. 240 par. 5 E.T.',
      'Art. 240 par. 6 E.T.',
      'Art. 240 par. 7 E.T.',
      'Art. 241 E.T.',
      'Art. 242 E.T.',
      'Art. 254 E.T.',
      'Art. 256 E.T.',
      'Art. 313 E.T.',
    ],
    estado: 'VIGENTE_2026',
    sentenciaCorte: 'Sentencia C-219 de 2024 (exequible Art. 10 — TTD)',
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_2277_2022.html',
  },
  {
    id: 'LEY_2155_2021',
    cita: 'Ley 2155 de 2021',
    titulo: 'Ley de inversión social — extensión descuento IVA activos fijos',
    resumen:
      'Extendió la vigencia del descuento del 100% del IVA en activos fijos reales productivos (Art. 258-1 E.T.) y estableció medidas de reactivación económica post-pandemia.',
    articulosClave: ['Art. 258-1 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_2155_2021.html',
  },
  {
    id: 'LEY_2010_2019',
    cita: 'Ley 2010 de 2019',
    titulo: 'Ley de crecimiento económico — reemplaza Ley 1943/2018',
    resumen:
      'Reemplazó la Ley 1943/2018 declarada inexequible. Ratificó la eliminación del periodo IVA anual (solo bimestral y cuatrimestral); estableció descuento 100% IVA activos fijos (Art. 258-1); fijó la tarifa de renta PJ en descenso: 32% (2020), 31% (2021) y 30% proyectado desde 2022 — este último nunca aplicó porque la Ley 2155/2021 la elevó al 35% a partir de 2022.',
    articulosClave: ['Art. 258-1 E.T.', 'Art. 600 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_2010_2019.html',
  },
  {
    id: 'LEY_1943_2018',
    cita: 'Ley 1943 de 2018',
    titulo: 'Ley de financiamiento — parcialmente reemplazada',
    resumen:
      'Eliminó el periodo IVA anual (<15.000 UVT). Declarada inexequible por la Corte Constitucional por vicios de forma; sus disposiciones se mantuvieron hasta 31-dic-2019 y fueron reproducidas por Ley 2010/2019.',
    articulosClave: ['Art. 600 E.T.'],
    estado: 'INEXEQUIBLE',
    sentenciaCorte: 'Sentencia C-481 de 2019',
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_1943_2018.html',
  },
  {
    id: 'LEY_1819_2016',
    cita: 'Ley 1819 de 2016',
    titulo: 'Reforma tributaria estructural 2016',
    resumen:
      'Reforma estructural que derogó formalmente Art. 158-3 E.T. (Art. 376 Ley 1819); elevó tarifa general renta PJ; introdujo IVA 19%; incorporó NIIF como base contable con ajustes fiscales; reformó régimen de retención y sancionatorio.',
    articulosClave: [
      'Art. 240 E.T.',
      'Art. 468 E.T.',
      'Art. 158-3 E.T. (derogado)',
    ],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_1819_2016.html',
  },
  {
    id: 'LEY_2068_2020',
    cita: 'Ley 2068 de 2020',
    titulo: 'Ley de turismo',
    resumen:
      'Reguló incentivos para el sector turismo. La tarifa reducida de renta del sector hotelero NO la fija esta ley sino el parágrafo 5 del Art. 240 E.T. (el spec original confundió la fuente), y desde el año gravable 2023 esa tarifa es del 15% por 10 años —no del 9%—, tras la modificación del Art. 10 de la Ley 2277 de 2022. Aplica solo a nuevos hoteles, hoteles remodelados o ampliados y nuevos parques temáticos de ecoturismo/agroturismo construidos en municipios de hasta 200.000 habitantes o en municipios PDET, con inscripción en el Registro Nacional de Turismo. El 9% únicamente subsiste como derecho adquirido para quienes consolidaron el beneficio bajo el régimen anterior (Ley 1943/2018 – Ley 2010/2019), condición que debe acreditarse caso por caso.',
    articulosClave: ['Art. 240 par. 5 E.T.', 'Ley 2277 de 2022'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_2068_2020.html',
  },
  {
    id: 'LEY_98_1993',
    cita: 'Ley 98 de 1993',
    titulo: 'Ley del libro — norma de remisión subjetiva del beneficio editorial',
    resumen:
      'Ley de democratización y fomento del libro colombiano. Hoy NO fija la tarifa de renta del sector: opera como norma de remisión que define qué es una empresa editorial. La tarifa aplicable la fija el parágrafo 7 del Art. 240 E.T. (adicionado por el Art. 10 de la Ley 2277 de 2022) y es del 15% desde el año gravable 2023 — antes de esa reforma era 9%, nunca 0%. El beneficio solo cobija a personas jurídicas constituidas en Colombia cuya actividad económica Y objeto social sea EXCLUSIVAMENTE la edición de libros en los términos de esta ley; una editorial con actividades mixtas tributa a la tarifa general del 35%. Además, los contribuyentes del par. 7 están excluidos de la tasa mínima de tributación del par. 6 del Art. 240. Los libros son bienes exentos de IVA (Art. 477 E.T.).',
    articulosClave: ['Art. 240 par. 7 E.T.', 'Art. 477 E.T.', 'Ley 2277 de 2022'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_0098_1993.html',
  },
  {
    id: 'LEY_43_1990',
    cita: 'Ley 43 de 1990',
    titulo: 'Ley que regula la profesión de Contador Público en Colombia',
    resumen:
      'Regula el ejercicio de la Contaduría Pública: principios de contabilidad generalmente aceptados (previos a NIIF), funciones del revisor fiscal, fe pública contable, sanciones disciplinarias.',
    articulosClave: [],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_0043_1990.html',
  },
] as const;
