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
      'Tarifa general PJ: 35%. Zonas francas: régimen híbrido Ley 2277/2022 (20% sobre renta de exportación + 35% otras). Hoteles 9% (par. 5 del mismo artículo). Editoriales 0% (Ley 98/1993). Sobretasas vigentes: hidroeléctricas +3pp = 38% hasta 2026; financieras/seguros/bolsa/reaseguros +5pp = 40% hasta 2027 (par. 2 del Art. 240).',
    textoLiteral: null,
    estado: 'MODIFICADO',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022',
        fecha: '2022-12-13',
        cambio: 'Mantuvo 35% tarifa general; introdujo régimen híbrido zona franca; estableció sobretasas en par. 2.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    tags: ['renta', 'tarifa', 'PJ', 'zona_franca', 'sobretasa', 'financiero', 'hidro'],
  },
  {
    id: 'ART_240_PAR2_ET',
    cita: 'Art. 240 par. 2 E.T.',
    titulo: 'Sobretasas sectoriales — financiero e hidroeléctricas',
    resumen:
      'Par. 2 Art. 240: sobretasa entidades financieras, aseguradoras, bolsa de valores y reaseguradoras +5pp = 40% hasta 2027. Sobretasa hidroeléctricas y acueductos +3pp = 38% hasta 2026.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [
      {
        norma: 'Ley 2277 de 2022, Art. 10',
        fecha: '2022-12-13',
        cambio: 'Estableció las sobretasas sectoriales en el parágrafo 2.',
      },
    ],
    urlOficial:
      'https://estatuto.co/?articulo=240',
    tags: ['renta', 'tarifa', 'sobretasa', 'financiero', 'hidro', 'PJ'],
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
      'Parágrafo 6 Art. 240 (introducido por Art. 10 Ley 2277/2022): TTD = ID/UD ≥ 15%. ID = Impuesto Depurado. UD = Utilidad Depurada (UAI − INCRGNO − rentas exentas − diferencias permanentes + gastos no deducibles). Si TTD < 15% → impuesto adicional = (15% − TTD) × UD. Vigente desde año gravable 2023. Declarada EXEQUIBLE por Sentencia C-219/2024.',
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
    tags: ['renta', 'TTD', 'tasa_minima', 'PJ', 'Ley_2277'],
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
      'Personas naturales comerciantes son agentes de retención si en el año inmediatamente anterior tuvieron un patrimonio bruto o ingresos brutos superiores a 30.000 UVT (2026: $1.571.220.000). Corrección: spec original citaba "Arts. 365-401 genérico" y umbral 3.500 UVT incorrecto.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=368-2',
    tags: ['retencion', 'agentes', 'PN', 'umbral', '30000_UVT'],
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
    titulo: 'Retención sobre otros pagos — umbral 4 UVT',
    resumen:
      'Regula retención sobre otros pagos gravables. Umbral mínimo 4 UVT (RTF_THRESHOLD_UVT en constants.ts) = $209.496 COP 2026. La tarifa específica la fija el Decreto 1625/2016.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=401',
    tags: ['retencion', 'umbral', '4_UVT'],
  },
  {
    id: 'ART_437_1_ET',
    cita: 'Art. 437-1 E.T.',
    titulo: 'ReteIVA — retención del IVA',
    resumen:
      'ReteIVA tarifa general: 15% del IVA generado. Arts. 437-4 y 437-5: ReteIVA 100% en casos especiales (compras o ventas con no declarantes y otros supuestos previstos en el DUR). Corrección crítica: el spec original citaba Art. 381 para ReteIVA — error.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=437-1',
    tags: ['IVA', 'reteIVA', 'retencion'],
  },
  {
    id: 'ART_437_4_ET',
    cita: 'Art. 437-4 E.T.',
    titulo: 'ReteIVA 100% — casos especiales',
    resumen:
      'ReteIVA del 100% del impuesto generado en casos especiales: bienes o servicios adquiridos a no responsables del IVA que por cuantía deben retener, entre otros.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=437-4',
    tags: ['IVA', 'reteIVA', 'retencion', 'especial'],
  },

  // ─── IVA ──────────────────────────────────────────────────────────────────
  {
    id: 'ART_420_ET',
    cita: 'Art. 420 E.T.',
    titulo: 'Hecho generador del IVA',
    resumen:
      'El IVA se genera en la venta de bienes muebles corporales no excluidos, prestación de servicios en territorio nacional, importación de bienes, y circulación, venta u operación de juegos de suerte y azar.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=420',
    tags: ['IVA', 'hecho_generador'],
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
      'Periodos gravables IVA 2026: bimestral para contribuyentes con ingresos ≥ 92.000 UVT al 31-dic del año anterior; cuatrimestral para los demás. El período ANUAL fue ELIMINADO por Ley 1943/2018 (ratificado por Ley 2010/2019).',
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
    tags: ['IVA', 'periodicidad', 'bimestral', 'cuatrimestral'],
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
    titulo: 'Aplicación de principios y reducción de sanciones',
    resumen:
      'Principios de gradualidad, proporcionalidad y favorabilidad para sanciones. Reducción del 50% si se acepta cargo sin pliego de cargos; 75% si subsana antes del pliego. Corrección: spec atribuía estas reducciones a Art. 649.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=640',
    tags: ['sancion', 'reduccion', 'principios', 'gradualidad'],
  },
  {
    id: 'ART_641_ET',
    cita: 'Art. 641 E.T.',
    titulo: 'Sanción por extemporaneidad en la presentación de declaraciones',
    resumen:
      'Extemporaneidad: 5% mensual antes de emplazamiento, 10% mensual después de emplazamiento, tope 100% del impuesto a cargo. Sin impuesto a cargo: 0.5% sobre ingresos brutos (tope 5%) o 1% sobre patrimonio líquido (tope 2.500 UVT).',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=641',
    // Corrección crítica: spec decía tope 200% del impuesto — INCORRECTO. Tope es 100%.
    tags: ['sancion', 'extemporaneidad', '5%', '10%'],
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
      'Sanción por omisión de ingresos, deducciones improcedentes o datos falsos en declaraciones. Tarifa: 100% del mayor valor del impuesto (Art. 648 consolida la tarifa). El parágrafo establece la defensa de diferencia de criterio.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=647',
    tags: ['sancion', 'inexactitud', '100%', 'defensa'],
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
    titulo: 'Sanción por inexactitud — tarifa consolidada',
    resumen:
      'Consolida la tarifa escalonada de la sanción por inexactitud en el 100% del mayor valor del impuesto que se generó o del menor saldo a favor declarado.',
    textoLiteral: null,
    estado: 'VIGENTE_2026',
    modificaciones: [],
    urlOficial:
      'https://estatuto.co/?articulo=648',
    tags: ['sancion', 'inexactitud', '100%'],
  },
  {
    id: 'ART_709_ET',
    cita: 'Art. 709 E.T.',
    titulo: 'Reducción de sanción por aceptación de pliego de cargos — 25%',
    resumen:
      'Si el contribuyente acepta los hechos del pliego de cargos, la sanción se reduce al 25% del valor inicial.',
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
] as const;
