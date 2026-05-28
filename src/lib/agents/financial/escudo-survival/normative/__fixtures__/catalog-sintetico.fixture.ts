// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 2 Motor Normativo — Catálogo sintético para tests
// ---------------------------------------------------------------------------
//
// Mínimo catálogo COMPLETO que respeta el contrato `NormativeCatalogue`.
// Cubre ≥1 entrada por cada tipo del contrato.
//
// Este fixture NO depende del catálogo real (catalog/**). Los tests del
// validator lo usan para verificar la lógica de validación con datos estables.
//
// Si los tests pasan con este fixture, pasarán con el catálogo real siempre
// que el catálogo respete el contrato `NormativeCatalogue`.
// ---------------------------------------------------------------------------

import type {
  NormativeCatalogue,
  NormativeArticleEntry,
  DianConceptEntry,
  LawReformEntry,
  JurisprudenceEntry,
  SanctionEntry,
  RetentionTariffEntry,
  AuditStandardEntry,
  BlacklistEntry,
} from '../types';

// ---------------------------------------------------------------------------
// Artículos E.T.
// ---------------------------------------------------------------------------

const ART_240_ET: NormativeArticleEntry = {
  id: 'ART_240_ET',
  cita: 'Art. 240 E.T.',
  titulo: 'Tarifa general para personas jurídicas',
  resumen:
    'Tarifa de renta personas jurídicas 35%. Sobretasas: +3pp hidroeléctricas, +5pp financieras (40% total hasta 2027 según parágrafo 2).',
  textoLiteral: null,
  estado: 'VIGENTE_2026',
  modificaciones: [
    {
      norma: 'Ley 2277 de 2022, Art. 10',
      fecha: '2022-12-13',
      cambio: 'Fija tarifa general en 35% y sobretasas sectoriales.',
    },
  ],
  urlOficial: 'https://estatuto.co/?e=472',
  tags: ['renta', 'tarifa', 'PJ'],
};

const ART_647_ET: NormativeArticleEntry = {
  id: 'ART_647_ET',
  cita: 'Art. 647 E.T.',
  titulo: 'Sanción por inexactitud',
  resumen:
    'Sanción del 100% del mayor valor del impuesto determinado por inexactitud en la declaración tributaria. El parágrafo regula diferencia de criterio.',
  textoLiteral:
    'Parágrafo. No se configura inexactitud cuando el menor valor a pagar resulte de diferencias de criterio entre la administración tributaria y el declarante, relativas a la interpretación del derecho aplicable.',
  estado: 'VIGENTE_2026',
  modificaciones: [
    {
      norma: 'Ley 1819 de 2016, Art. 287',
      fecha: '2016-12-29',
      cambio: 'Reescribe el artículo y reduce sanción general del 160% al 100%.',
    },
  ],
  urlOficial: 'https://estatuto.co/?e=929',
  tags: ['sanciones', 'inexactitud', 'defensa'],
};

const ART_647_PAR_ET: NormativeArticleEntry = {
  id: 'ART_647_PAR_ET',
  cita: 'Art. 647 par. E.T.',
  titulo: 'Parágrafo Art. 647 — Diferencia de criterio',
  resumen:
    'Diferencia de criterio sobre interpretación del derecho aplicable NO configura inexactitud sancionable.',
  textoLiteral:
    'No se configura inexactitud cuando el menor valor a pagar resulte de diferencias de criterio entre la administración tributaria y el declarante.',
  estado: 'VIGENTE_2026',
  modificaciones: [],
  urlOficial: 'https://estatuto.co/?e=929',
  tags: ['defensa', 'diferencia_criterio'],
};

const ART_158_3_ET: NormativeArticleEntry = {
  id: 'ART_158_3_ET',
  cita: 'Art. 158-3 E.T.',
  titulo: 'Deducción inversión activos fijos productivos (DEROGADO)',
  resumen:
    'Deducción del 30% (luego 40%) por inversión en activos fijos reales productivos. Derogado por Ley 1819 de 2016 Art. 376.',
  textoLiteral: null,
  estado: 'DEROGADO',
  modificaciones: [
    {
      norma: 'Ley 1430 de 2010',
      fecha: '2010-12-29',
      cambio: 'Suspendido a partir de 2011.',
    },
    {
      norma: 'Ley 1819 de 2016, Art. 376',
      fecha: '2016-12-29',
      cambio: 'Derogación expresa.',
    },
  ],
  urlOficial: null,
  tags: ['derogado', 'activos_fijos'],
};

const ART_437_1_ET: NormativeArticleEntry = {
  id: 'ART_437_1_ET',
  cita: 'Art. 437-1 E.T.',
  titulo: 'Retención en la fuente del IVA (ReteIVA)',
  resumen:
    'Sistema de retención del impuesto sobre las ventas. La tarifa general es del 15% del valor del impuesto.',
  textoLiteral: null,
  estado: 'VIGENTE_2026',
  modificaciones: [
    {
      norma: 'Ley 2010 de 2019',
      fecha: '2019-12-27',
      cambio: 'Ajusta tarifa general ReteIVA al 15%.',
    },
  ],
  urlOficial: 'https://estatuto.co/?e=748',
  tags: ['IVA', 'retencion'],
};

const ART_122_ET: NormativeArticleEntry = {
  id: 'ART_122_ET',
  cita: 'Art. 122 E.T.',
  titulo: 'Limitación a la deducción de costos y gastos al exterior',
  resumen:
    'Los gastos al exterior se limitan al 15% de la renta líquida del contribuyente.',
  textoLiteral: null,
  estado: 'VIGENTE_2026',
  modificaciones: [],
  urlOficial: 'https://estatuto.co/?e=434',
  tags: ['deducciones', 'exterior'],
};

const ART_240_PAR2_ET: NormativeArticleEntry = {
  id: 'ART_240_PAR2_ET',
  cita: 'Art. 240 par. 2 E.T.',
  titulo: 'Sobretasa financiera (parágrafo 2)',
  resumen:
    'Sobretasa de +5 puntos porcentuales para entidades financieras hasta el año gravable 2027 (40% total).',
  textoLiteral: null,
  estado: 'VIGENTE_2026',
  modificaciones: [
    {
      norma: 'Ley 2277 de 2022',
      fecha: '2022-12-13',
      cambio: 'Establece sobretasa transitoria.',
    },
  ],
  urlOficial: 'https://estatuto.co/?e=472',
  tags: ['renta', 'financiera', 'sobretasa'],
};

const ARTICULOS_ET: readonly NormativeArticleEntry[] = [
  ART_240_ET,
  ART_240_PAR2_ET,
  ART_647_ET,
  ART_647_PAR_ET,
  ART_158_3_ET,
  ART_437_1_ET,
  ART_122_ET,
];

// ---------------------------------------------------------------------------
// Conceptos DIAN
// ---------------------------------------------------------------------------

const CONCEPTO_UNIFICADO_2024: DianConceptEntry = {
  id: 'CONCEPTO_UNIFICADO_202_006038_2024',
  cita: 'Concepto Unificado DIAN 202(006038) de 2024',
  radicado: '202(006038)',
  fecha: '2024-04-19',
  titulo: 'Concepto Unificado sobre impuesto sobre la renta — personas jurídicas',
  tesis:
    'Reúne la doctrina vigente sobre tarifa, sobretasas, dividendos y descuentos para personas jurídicas. Verificado en normograma.dian.gov.co.',
  articulosAplicables: ['Art. 240 E.T.', 'Art. 242 E.T.', 'Art. 245 E.T.'],
  estado: 'VIGENTE_2026',
  urlOficial: 'https://normograma.dian.gov.co/dian/docs/concepto_dian_unificado_202_006038_2024.htm',
  verificadoEnNormograma: true,
};

const CONCEPTOS_DIAN: readonly DianConceptEntry[] = [CONCEPTO_UNIFICADO_2024];

// ---------------------------------------------------------------------------
// Leyes y reformas
// ---------------------------------------------------------------------------

const LEY_2277_2022: LawReformEntry = {
  id: 'LEY_2277_2022',
  cita: 'Ley 2277 de 2022',
  titulo: 'Ley de Reforma Tributaria para la Igualdad y la Justicia Social',
  resumen:
    'Eleva tarifa general PJ al 35%, introduce sobretasas sectoriales, impuesto al patrimonio y tributos saludables.',
  articulosClave: ['Art. 240 E.T.', 'Art. 242 E.T.', 'Art. 295-3 E.T.'],
  estado: 'VIGENTE_2026',
  sentenciaCorte: null,
  urlOficial: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199883',
};

const LEYES_REFORMAS: readonly LawReformEntry[] = [LEY_2277_2022];

// ---------------------------------------------------------------------------
// Jurisprudencia
// ---------------------------------------------------------------------------

const SENTENCIA_C_079_2026: JurisprudenceEntry = {
  id: 'SENTENCIA_C_079_2026',
  cita: 'Sentencia C-079 de 2026',
  tribunal: 'Corte Constitucional',
  fecha: '2026-03-12',
  tema: 'Decreto 1474 de 2025 — sobretasa financiera 50%',
  tesis:
    'Declara INEXEQUIBLE el Decreto 1474 de 2025 que incrementaba la sobretasa financiera al 50%, por violación al principio de reserva legal en materia tributaria.',
  normasAfectadas: ['Decreto 1474 de 2025'],
  urlOficial: null,
};

const JURISPRUDENCIA: readonly JurisprudenceEntry[] = [SENTENCIA_C_079_2026];

// ---------------------------------------------------------------------------
// Sanciones
// ---------------------------------------------------------------------------

const SANCION_INEXACTITUD: SanctionEntry = {
  id: 'SANCION_INEXACTITUD_ART647',
  normaRef: 'Art. 647 E.T.',
  nombre: 'Sanción por inexactitud',
  supuesto:
    'Inclusión de costos, deducciones, descuentos, retenciones, anticipos inexistentes, o utilización en las declaraciones de datos o factores falsos.',
  tarifa: '100% del mayor valor del impuesto a cargo',
  tope: null,
  reducciones: [
    {
      momento: 'Aceptación pliego de cargos',
      reduccion: '50%',
      norma: 'Art. 713 E.T.',
    },
  ],
  estado: 'VIGENTE_2026',
};

const SANCIONES: readonly SanctionEntry[] = [SANCION_INEXACTITUD];

// ---------------------------------------------------------------------------
// Tarifas de retención (DUR 1625/2016)
// ---------------------------------------------------------------------------

const RTF_HONORARIOS: RetentionTariffEntry = {
  id: 'RTF_HONORARIOS',
  concepto: 'Honorarios',
  tarifaDeclarante: '11%',
  tarifaNoDeclarante: '10%',
  umbralUVT: null,
  normaRef: 'Decreto 1625 de 2016',
  estado: 'VIGENTE_2026',
};

const TARIFAS_RETENCION: readonly RetentionTariffEntry[] = [RTF_HONORARIOS];

// ---------------------------------------------------------------------------
// Normas de auditoría
// ---------------------------------------------------------------------------

const NIA_705: AuditStandardEntry = {
  id: 'NIA_705',
  cita: 'NIA 705',
  familia: 'NIA',
  numero: '705',
  titulo: 'Opinión modificada en el informe del auditor independiente',
  resumen:
    'Establece cuándo un auditor debe emitir opinión con salvedades, adversa o abstención.',
  decretoAdopcion: 'Decreto 2420 de 2015',
  estado: 'VIGENTE_2026',
};

const NIIF_PYMES_S29: AuditStandardEntry = {
  id: 'NIIF_PYMES_S29',
  cita: 'NIIF para PYMES §29',
  familia: 'NIIF_PYMES',
  numero: '29',
  titulo: 'Impuesto a las ganancias',
  resumen:
    'Reconocimiento y medición del impuesto corriente y diferido por las consecuencias fiscales de las transacciones del periodo.',
  decretoAdopcion: 'Decreto 2420 de 2015',
  estado: 'VIGENTE_2026',
};

const NORMAS_AUDITORIA: readonly AuditStandardEntry[] = [NIA_705, NIIF_PYMES_S29];

// ---------------------------------------------------------------------------
// Blacklist (9 entradas — verificadas por dictamen tributario)
// ---------------------------------------------------------------------------

const BL_ART_158_3: BlacklistEntry = {
  id: 'BL_ART_158_3_DEROGADO',
  patrones: [
    '\\bArt\\.?\\s*158-?3\\b',
    '\\bArt[íi]culo\\s+158-?3\\b',
  ],
  razon:
    'Art. 158-3 E.T. fue derogado por Ley 1819 de 2016 Art. 376. Suspendido desde 2011 por Ley 1430 de 2010.',
  alternativaCorrecta:
    'Si el contexto era deducción por inversión en activos fijos: citar Art. 258-1 E.T. (descuento IVA bienes de capital).',
  severidad: 'CRITICA',
  categoria: 'norma_derogada',
};

const BL_DECRETO_1474: BlacklistEntry = {
  id: 'BL_DECRETO_1474_INEXEQUIBLE',
  patrones: [
    '\\bDecreto\\s+1474\\s+(?:de|del|\\/)\\s*2025\\b',
    '\\bDL\\s+1474\\b',
  ],
  razon:
    'Decreto 1474 de 2025 fue declarado INEXEQUIBLE por Sentencia C-079 de 2026 (Corte Constitucional).',
  alternativaCorrecta:
    'Citar el Art. 240 vigente (35% tarifa general, +5pp sobretasa financiera del parágrafo 2).',
  severidad: 'CRITICA',
  categoria: 'norma_inexequible',
};

const BL_SOBRETASA_FINANCIERA_50: BlacklistEntry = {
  id: 'BL_SOBRETASA_FINANCIERA_50PCT',
  patrones: [
    '\\bsobretasa\\s+financiera.{0,30}50\\s*%',
    '\\b50\\s*%.{0,30}financier',
    '\\btarifa.{0,20}50\\s*%.{0,40}financier',
  ],
  razon:
    'La sobretasa financiera 2026 NO es 50% — esa tarifa estaba en el Decreto 1474 inexequible. La vigente es +5pp (40% total) hasta 2027 según parágrafo 2 del Art. 240.',
  alternativaCorrecta: 'Art. 240 parágrafo 2 E.T. — sobretasa +5pp (40% total) hasta 2027.',
  severidad: 'CRITICA',
  categoria: 'tarifa_incorrecta',
};

const BL_CONCEPTO_1352: BlacklistEntry = {
  id: 'BL_CONCEPTO_100208221_1352',
  patrones: [
    '\\bConcepto(?:\\s+DIAN)?\\s+100208221-?1352\\b',
    '\\bConcepto(?:\\s+DIAN)?\\s+1352\\s+(?:de|del|\\/)\\s*2018\\b',
    '\\bConcepto\\s+1352\\b',
  ],
  razon:
    'Radicado NO verificable en normograma.dian.gov.co. La defensa diferencia de criterio se invoca con el parágrafo del Art. 647 + jurisprudencia del Consejo de Estado.',
  alternativaCorrecta:
    'Parágrafo del Art. 647 E.T. (texto literal) + Sentencias del Consejo de Estado Sección Cuarta.',
  severidad: 'CRITICA',
  categoria: 'concepto_dian_no_verificable',
};

const BL_PERIODO_IVA_ANUAL: BlacklistEntry = {
  id: 'BL_PERIODO_IVA_ANUAL',
  patrones: [
    '\\b(?:periodo|per[íi]odo)\\s+anual\\s+(?:de\\s+)?IVA\\b',
    '\\bIVA\\s+anual\\b',
    '\\bdeclaraci[óo]n\\s+anual\\s+(?:de\\s+)?IVA\\b',
  ],
  razon:
    'El periodo anual del IVA fue ELIMINADO por Ley 1943 de 2018 (luego Ley 2010 de 2019). Hoy el Art. 600 E.T. solo contempla bimestral (≥92.000 UVT) y cuatrimestral (resto).',
  alternativaCorrecta:
    'Bimestral (grandes contribuyentes y exportadores) o cuatrimestral (resto). Art. 600 E.T.',
  severidad: 'ALTA',
  categoria: 'periodicidad_eliminada',
};

const BL_RETEIVA_ART_381: BlacklistEntry = {
  id: 'BL_RETEIVA_ART_381',
  patrones: [
    // ReteIVA en el mismo párrafo que Art. 381 (ventana 80 chars cubre frases
    // como "ReteIVA aplicada al proveedor se regula conforme al Art. 381").
    '\\bReteIVA.{0,80}Art\\.?\\s*381\\b',
    '\\bretenci[óo]n\\s+(?:de\\s+|del\\s+)?IVA.{0,80}Art\\.?\\s*381\\b',
  ],
  razon: 'La ReteIVA se regula en el Art. 437-1 E.T., no en el Art. 381.',
  alternativaCorrecta: 'Art. 437-1 E.T. — Retención en la fuente del IVA.',
  severidad: 'ALTA',
  categoria: 'articulo_confundido',
};

const BL_DIVIDENDOS_EXTERIOR_ART_243: BlacklistEntry = {
  id: 'BL_DIVIDENDOS_EXTERIOR_ART_243',
  patrones: [
    '\\bdividendos.{0,80}(?:exterior|no\\s+residentes).{0,80}Art\\.?\\s*243\\b',
    '\\bdividendos.{0,40}20\\s*%.{0,80}Art\\.?\\s*243\\b',
  ],
  razon:
    'Los dividendos a no residentes se regulan en el Art. 245 E.T. (tarifa 20%), no en el Art. 243.',
  alternativaCorrecta: 'Art. 245 E.T. — Tarifa especial dividendos a sociedades extranjeras y no residentes.',
  severidad: 'ALTA',
  categoria: 'articulo_confundido',
};

const BL_GANANCIAS_OCASIONALES_ART_47: BlacklistEntry = {
  id: 'BL_GANANCIAS_OCASIONALES_ART_47',
  patrones: [
    '\\bganancias?\\s+ocasionales?.{0,40}Art\\.?\\s*47\\b',
  ],
  razon:
    'El Art. 47 E.T. regula gananciales en la liquidación de sociedad conyugal, no ganancias ocasionales. Las ganancias ocasionales están en los Arts. 299-317.',
  alternativaCorrecta: 'Arts. 299 a 317 E.T. — Ganancias ocasionales.',
  severidad: 'ALTA',
  categoria: 'articulo_confundido',
};

const BL_IVA_BIENES_CAPITAL_ART_255: BlacklistEntry = {
  id: 'BL_IVA_BIENES_CAPITAL_ART_255',
  patrones: [
    '\\bIVA.{0,30}bienes?\\s+de\\s+capital.{0,40}Art\\.?\\s*255\\b',
    '\\bdescuento\\s+IVA.{0,30}Art\\.?\\s*255\\b',
  ],
  razon:
    'El descuento del IVA pagado en la adquisición de bienes de capital se regula en el Art. 258-1 E.T., no en el Art. 255.',
  alternativaCorrecta: 'Art. 258-1 E.T. — Descuento del IVA pagado por bienes de capital.',
  severidad: 'MEDIA',
  categoria: 'articulo_confundido',
};

const BLACKLIST: readonly BlacklistEntry[] = [
  BL_ART_158_3,
  BL_DECRETO_1474,
  BL_SOBRETASA_FINANCIERA_50,
  BL_CONCEPTO_1352,
  BL_PERIODO_IVA_ANUAL,
  BL_RETEIVA_ART_381,
  BL_DIVIDENDOS_EXTERIOR_ART_243,
  BL_GANANCIAS_OCASIONALES_ART_47,
  BL_IVA_BIENES_CAPITAL_ART_255,
];

// ---------------------------------------------------------------------------
// Catálogo sintético
// ---------------------------------------------------------------------------

const BASE_SYNTHETIC_CATALOGUE: NormativeCatalogue = {
  articulosET: ARTICULOS_ET,
  conceptosDian: CONCEPTOS_DIAN,
  leyesReformas: LEYES_REFORMAS,
  jurisprudencia: JURISPRUDENCIA,
  sanciones: SANCIONES,
  tarifasRetencion: TARIFAS_RETENCION,
  normasAuditoria: NORMAS_AUDITORIA,
  blacklist: BLACKLIST,
};

/**
 * Construye un catálogo sintético mínimo para tests.
 *
 * El parámetro `overrides` permite a tests específicos cambiar algunas
 * propiedades sin reescribir el catálogo entero (ej. cambiar el estado del
 * Art. 240 a DEROGADO para testear el rechazo).
 *
 * Mantiene la inmutabilidad — devuelve una nueva instancia.
 */
export function buildSyntheticCatalogue(
  overrides?: Partial<NormativeCatalogue>,
): NormativeCatalogue {
  if (!overrides) return BASE_SYNTHETIC_CATALOGUE;
  return {
    articulosET: overrides.articulosET ?? BASE_SYNTHETIC_CATALOGUE.articulosET,
    conceptosDian: overrides.conceptosDian ?? BASE_SYNTHETIC_CATALOGUE.conceptosDian,
    leyesReformas: overrides.leyesReformas ?? BASE_SYNTHETIC_CATALOGUE.leyesReformas,
    jurisprudencia: overrides.jurisprudencia ?? BASE_SYNTHETIC_CATALOGUE.jurisprudencia,
    sanciones: overrides.sanciones ?? BASE_SYNTHETIC_CATALOGUE.sanciones,
    tarifasRetencion: overrides.tarifasRetencion ?? BASE_SYNTHETIC_CATALOGUE.tarifasRetencion,
    normasAuditoria: overrides.normasAuditoria ?? BASE_SYNTHETIC_CATALOGUE.normasAuditoria,
    blacklist: overrides.blacklist ?? BASE_SYNTHETIC_CATALOGUE.blacklist,
  };
}

/**
 * Exporta las entradas individuales para que los tests puedan construir
 * catálogos derivados (ej. con un Art. 240 derogado).
 */
export const SYNTHETIC_ENTRIES = {
  ART_240_ET,
  ART_240_PAR2_ET,
  ART_647_ET,
  ART_647_PAR_ET,
  ART_158_3_ET,
  ART_437_1_ET,
  ART_122_ET,
  CONCEPTO_UNIFICADO_2024,
  LEY_2277_2022,
  SENTENCIA_C_079_2026,
  SANCION_INEXACTITUD,
  RTF_HONORARIOS,
  NIA_705,
  NIIF_PYMES_S29,
  BL_ART_158_3,
  BL_DECRETO_1474,
  BL_SOBRETASA_FINANCIERA_50,
  BL_CONCEPTO_1352,
  BL_PERIODO_IVA_ANUAL,
  BL_RETEIVA_ART_381,
  BL_DIVIDENDOS_EXTERIOR_ART_243,
  BL_GANANCIAS_OCASIONALES_ART_47,
  BL_IVA_BIENES_CAPITAL_ART_255,
} as const;
