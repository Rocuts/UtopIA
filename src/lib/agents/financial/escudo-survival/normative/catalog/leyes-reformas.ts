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
  // INEXEQUIBLE por la Corte Constitucional el 15-abr-2026, con orden de
  // devolución de lo recaudado (decreto_1474_2025_emergencia.md; el corpus no
  // trae el número de la sentencia).
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
      'Reemplazó la Ley 1943/2018 declarada inexequible. Estableció descuento 100% IVA activos fijos (Art. 258-1, art. 95); fijó la tarifa de renta PJ en descenso (Art. 240, art. 92): 32% (2020), 31% (2021) y 30% proyectado desde 2022 — este último nunca aplicó porque la Ley 2155/2021 la elevó al 35% a partir de 2022.',
    // I5-niif 5: no «ratificó la eliminación del periodo IVA anual» ni toca el
    // Art. 600 (ley_2010_2019.md); esa redacción es del art. 196 de la Ley 1819
    // de 2016. Arts. 92 (Art. 240) y 95 (Art. 258-1) verificados en el corpus.
    articulosClave: ['Art. 240 E.T.', 'Art. 258-1 E.T.'],
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
      'Declarada inexequible por la Corte Constitucional por vicios de forma; sus disposiciones se mantuvieron hasta 31-dic-2019 y fueron reproducidas por Ley 2010/2019.',
    // I5-niif 5: el período IVA anual lo eliminó el art. 196 de la Ley 1819 de
    // 2016 (ley_1819_2016.md), no esta ley; su texto no está en el corpus.
    articulosClave: [],
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
    // Revisión de la fase 2 (pendiente #8): el esqueleto de la carta DIAN cita
    // su Art. 261 para el plazo del requerimiento ordinario
    // (src/data/tax_docs/ley_0223_1995.md).
    id: 'LEY_223_1995',
    cita: 'Ley 223 de 1995',
    titulo: 'Normas sobre racionalización tributaria',
    resumen:
      'Reforma tributaria de 1995. Su Art. 261 fija en quince (15) días calendario el plazo mínimo para responder los requerimientos ordinarios o solicitudes de información de la DIAN (concordante con el Art. 686 E.T.).',
    articulosClave: ['Art. 686 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_0223_1995.html',
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
  // ─── REGLAMENTOS Y NORMAS QUE NOMBRA EL MOTOR NORMATIVO (I4-escudo 3) ────
  // El prompt del Motor Normativo (constantes, resúmenes de artículos, tarifas
  // de retención) nombra estos decretos, la Ley 1430 de 2010 y la Resolución
  // DIAN 139 de 2012; sin entrada, la Capa 2 los bloqueaba como NO_VERIFICADO.
  // Cada entrada indica su fuente en src/data/tax_docs. `urlOficial` queda en
  // null: el normograma no se consultó.
  {
    // decreto_2229_2023.md: lo cita el aviso del dígito de calendario del
    // Motor Normativo (último dígito del NIT sin DV).
    id: 'DECRETO_2229_2023',
    cita: 'Decreto 2229 de 2023',
    titulo: 'Calendario tributario DIAN a partir de 2024',
    resumen:
      'Decreto del 22-dic-2023 que sustituye la Sección 2 del Capítulo 13 del Título 1 de la Parte 6 del Libro 1 del DUR 1625/2016 para fijar los calendarios de plazos de las obligaciones administradas por la DIAN a partir del año 2024. Los vencimientos se asignan por el último dígito del NIT, sin tener en cuenta el dígito de verificación.',
    articulosClave: ['Art. 579 E.T.', 'Art. 600 E.T.', 'Art. 800 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_1625_2016.md
    id: 'DECRETO_1625_2016',
    cita: 'Decreto 1625 de 2016',
    titulo: 'Decreto Único Reglamentario en materia tributaria (DUR)',
    resumen:
      'Decreto del 11-oct-2016 que compila los reglamentos tributarios. Fija, entre otros, las tarifas y bases mínimas de retención en la fuente (Libro 1, Parte 2, Título 4) y la autorretención especial en renta por CIIU (Art. 1.2.6.8). Lo modifican continuamente decretos posteriores (p. ej. Decreto 2231 de 2023 y Decreto 572 de 2025): cite el artículo del DUR en su texto vigente.',
    articulosClave: ['Art. 365 E.T.', 'Art. 392 E.T.', 'Art. 401 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_0572_2025.md (texto) y decreto_572_2025_autorretenciones.md (vigencia).
    // El validador normaliza «Decreto 0572» y «Decreto 572» a esta misma cita.
    id: 'DECRETO_572_2025',
    cita: 'Decreto 572 de 2025',
    titulo: 'Autorretención especial en renta y bases mínimas de retención en la fuente',
    resumen:
      'Decreto 0572 del 28-may-2025. Sustituye en el DUR 1625/2016 los Arts. 1.2.4.4.1 (servicios: base mínima 2 UVT), 1.2.4.6.7 a 1.2.4.6.9, el inciso 3 y el literal i) del 1.2.4.9.1 (compras y demás otros ingresos: 10 UVT), el 1.2.4.10.8 y el 1.2.6.8 (tabla de autorretención por CIIU). Rige desde el 01-jun-2025; entre el 08-may y el 30-jun-2026 rigieron de nuevo las bases anteriores (4 / 27 UVT) por suspensión provisional del Consejo de Estado, y las bases reducidas se restablecieron desde el 01-jul-2026 (auto CE 30229 del 02-jun-2026).',
    articulosClave: ['Art. 365 E.T.', 'Art. 392 E.T.', 'Art. 401 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_2231_2023.md (art. 11).
    id: 'DECRETO_2231_2023',
    cita: 'Decreto 2231 de 2023',
    titulo: 'Reglamentación de los Arts. 206, 331, 336 y 383 E.T. (Ley 2277 de 2022)',
    resumen:
      'Decreto del 22-dic-2023 que reglamenta parcialmente los Arts. 206, 331, 336 y 383 E.T., modificados por la Ley 2277 de 2022, y modifica el DUR 1625/2016. Su Art. 11 modificó el par. 4 del Art. 1.2.4.1.17: las personas naturales con rentas de trabajo no laborales que no piden al agente retenedor aplicar costos y deducciones se retienen con la tabla del Art. 383 E.T.; si los piden, con las tarifas de los Arts. 392 y 401 E.T.',
    articulosClave: ['Art. 383 E.T.', 'Art. 383 par. 2 E.T.', 'Art. 392 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_1103_2023.md.
    id: 'DECRETO_1103_2023',
    cita: 'Decreto 1103 de 2023',
    titulo: 'Reglamentación de los Arts. 242, 242-1, 245 y 246 E.T. — dividendos',
    resumen:
      'Decreto del 04-jul-2023 que reglamenta parcialmente los Arts. 242, 242-1, 245 y 246 E.T., modificados por los arts. 3, 12, 4 y 13 de la Ley 2277 de 2022, y ajusta en el DUR 1625/2016 el tratamiento de los dividendos y participaciones distribuidos desde el 1-ene-2023 (Arts. 1.2.1.10.4, 1.2.1.10.5 y siguientes).',
    articulosClave: ['Art. 242 E.T.', 'Art. 242-1 E.T.', 'Art. 245 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_0261_2023.md.
    id: 'DECRETO_261_2023',
    cita: 'Decreto 261 de 2023',
    titulo: 'Tarifas de retención y autorretención en renta armonizadas con la Ley 2277 de 2022',
    resumen:
      'Decreto del 24-feb-2023 que sustituyó los Arts. 1.2.4.10.12 y 1.2.6.8 del DUR 1625/2016 para armonizar las autorretenciones con la Ley 2277 de 2022, incluida la sobretasa de los CIIU 0510, 0520 y 0610 (Art. 240 par. 3 E.T.). Esos artículos fueron sustituidos después por el Decreto 242 de 2024: no lo cite como tarifa vigente.',
    articulosClave: ['Art. 365 E.T.', 'Art. 240 par. 3 E.T.'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // decreto_0242_2024.md; sustitución del Art. 1.2.6.8 por el art. 8 del
    // Decreto 0572 de 2025 (decreto_0572_2025.md).
    id: 'DECRETO_242_2024',
    cita: 'Decreto 242 de 2024',
    titulo: 'Tarifas de retención y autorretención en renta (sustituye las del Decreto 261 de 2023)',
    resumen:
      'Decreto del 29-feb-2024 que sustituyó los Arts. 1.2.4.10.12 y 1.2.6.8 del DUR 1625/2016 (tarifas de retención y autorretención del impuesto sobre la renta). El Art. 1.2.6.8 fue sustituido luego por el art. 8 del Decreto 572 de 2025: para un periodo concreto, verifique qué tabla regía.',
    articulosClave: ['Art. 365 E.T.', 'Art. 240 par. 3 E.T.'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // ley_1430_2010.md (art. 1); derogatoria del Art. 158-3 por el art. 376 de
    // la Ley 1819 de 2016: estatuto_tributario_completo.md.
    id: 'LEY_1430_2010',
    cita: 'Ley 1430 de 2010',
    titulo: 'Normas tributarias de control y para la competitividad',
    resumen:
      'Ley del 29-dic-2010. Su Art. 1 adicionó el par. 3 al Art. 158-3 E.T.: desde el año gravable 2011 ningún contribuyente puede usar la deducción especial por inversión en activos fijos reales productivos (salvo contratos de estabilidad jurídica solicitados antes del 1-nov-2010). El Art. 158-3 fue después derogado por el art. 376 de la Ley 1819 de 2016. Cítela sólo como antecedente: el beneficio vigente para activos fijos es el descuento del Art. 258-1 E.T.',
    articulosClave: ['Art. 158-3 E.T.', 'Art. 258-1 E.T.'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    // ley_1607_2012.md (códigos 241 y 120 de los Arts. 437-4 y 437-5),
    // decreto_1091_2020.md (fecha: 21-nov-2012) y decreto_1625_2016.md
    // (CIIU Rev. 4 A.C. adoptada por la Resolución 000114 de 2020). No es una
    // ley: se registra aquí porque el catálogo no tiene lista de resoluciones.
    id: 'RESOLUCION_DIAN_139_2012',
    cita: 'Resolución DIAN 000139 de 2012',
    titulo: 'Clasificación de actividades económicas (CIIU) adoptada por la DIAN',
    resumen:
      'Resolución del 21-nov-2012 que adoptó la clasificación CIIU para el RUT. Los Arts. 437-4 y 437-5 E.T. remiten a sus códigos 241 (siderúrgicas) y 120 (tabacaleras) «o la que la sustituya»; el DUR 1625/2016 remite hoy a la CIIU Rev. 4 A.C. adoptada por la Resolución 000114 de 2020. Verifique el código vigente antes de aplicarlo.',
    articulosClave: ['Art. 437-4 E.T.', 'Art. 437-5 E.T.'],
    estado: 'MODIFICADO',
    sentenciaCorte: null,
    urlOficial: null,
  },
  // ─── RESOLUCIONES DE LA UVT (re-auditoría 2026-09-24, NT-03) ─────────────
  // El encabezado de cada módulo del Agente Fiscal y el Motor Normativo fijan
  // la UVT 2026 con la Resolución DIAN 000238 de 2025; sin entrada, la Capa 2
  // bloqueaba como NO_VERIFICADO la salida honesta que la citaba en su forma
  // canónica. Fuentes: resolucion_dian_238_2025_uvt_2026.md (número, fechas de
  // expedición y publicación, UVT 2026 $52.374 y UVT 2025 $49.799) y las
  // concordancias del Art. 868 en estatuto_tributario_completo.md («Para el año
  // 2026 : Resolución DIAN 238 de 2025» / «Para el año 2025 : Resolución DIAN
  // 193 de 2024»).
  {
    id: 'RESOLUCION_DIAN_238_2025',
    cita: 'Resolución DIAN 000238 de 2025',
    titulo: 'Valor de la UVT aplicable para el año 2026',
    resumen:
      'Resolución del 15-dic-2025 (publicada el 18-dic-2025) que fija la UVT del año gravable 2026 en $52.374 (Art. 868 E.T.), frente a $49.799 del año 2025. Rige desde el 1-ene-2026 para los hechos del año gravable 2026.',
    articulosClave: ['Art. 868 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
  {
    id: 'RESOLUCION_DIAN_193_2024',
    cita: 'Resolución DIAN 000193 de 2024',
    titulo: 'Valor de la UVT aplicable para el año 2025',
    resumen:
      'Resolución que fija la UVT del año gravable 2025 ($49.799), según las concordancias del Art. 868 E.T. Úsela sólo para cifras del año gravable 2025 (los balances de cierre 2025 que se analizan en 2026); para 2026 rige la Resolución DIAN 000238 de 2025.',
    articulosClave: ['Art. 868 E.T.'],
    // Vigente para su año gravable: citarla al analizar el año 2025 es correcto.
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial: null,
  },
] as const;
