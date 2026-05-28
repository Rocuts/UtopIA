// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Leyes y Reformas
// ---------------------------------------------------------------------------
//
// Reformas estructurales del sistema tributario colombiano que afectan las
// bases de los módulos 1-8 de Capa 4. Orden cronológico descendente.
// ---------------------------------------------------------------------------

import type { LawReformEntry } from '../types';

export const LEYES_REFORMAS: readonly LawReformEntry[] = [
  {
    id: 'LEY_2277_2022',
    cita: 'Ley 2277 de 2022',
    titulo: 'Reforma tributaria estructural',
    resumen:
      'Reforma tributaria de 2022. Principales cambios: elevó tarifa GO de 10% a 15% (Art. 313); introdujo TTD ≥ 15% como parágrafo 6 del Art. 240; modificó tarifas dividendos PN (integración base ordinaria Art. 241); eliminó descuento 50% ICA — solo deducción 100% Art. 115; amplió descuento exterior Art. 254; ajustó descuento I+D+i a 30% Art. 256; estableció sobretasas par. 2 Art. 240.',
    articulosClave: [
      'Art. 115 E.T.',
      'Art. 240 par. 2 E.T.',
      'Art. 240 par. 6 E.T.',
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
      'Reemplazó la Ley 1943/2018 declarada inexequible. Ratificó la eliminación del periodo IVA anual (solo bimestral y cuatrimestral); estableció descuento 100% IVA activos fijos (Art. 258-1); mantuvo tarifa 33% renta PJ hasta 2021.',
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
      'Reguló incentivos para el sector turismo. La tarifa reducida del 9% para hoteles está en el parágrafo 5 del Art. 240 E.T., no directamente en esta ley (el spec original confundió la fuente).',
    articulosClave: ['Art. 240 par. 5 E.T.'],
    estado: 'VIGENTE_2026',
    sentenciaCorte: null,
    urlOficial:
      'https://www.secretariasenado.gov.co/senado/basedoc/ley_2068_2020.html',
  },
  {
    id: 'LEY_98_1993',
    cita: 'Ley 98 de 1993',
    titulo: 'Ley del libro — tarifa renta 0% para editoriales',
    resumen:
      'Establece el beneficio de tarifa cero (0%) en renta para empresas editoriales de libros, revistas, folletos y coleccionables. Beneficio temporal que ha sido prorrogado. Los libros también son exentos de IVA (Art. 477 E.T.).',
    articulosClave: ['Art. 240 E.T.', 'Art. 477 E.T.'],
    estado: 'VIGENTE_2026',
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
