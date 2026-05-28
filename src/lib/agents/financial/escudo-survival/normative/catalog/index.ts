// ---------------------------------------------------------------------------
// Capa 2 — Motor Normativo — Catálogo: Agregación + Blacklist
// ---------------------------------------------------------------------------
//
// Este archivo materializa `MOTOR_NORMATIVO_CATALOG: NormativeCatalogue`.
// El validator (validators/) lo consume via lookup por id y por patrón regex.
// El prompt builder (prompts/) lo consume para inyectar el contexto normativo.
//
// La blacklist NO depende del catálogo positivo — son patrones tóxicos que el
// validator rechaza aunque no estén en el catálogo. Deben ser conservadores:
// solo entran citas cuya emisión tiene consecuencias materiales verificadas.
// ---------------------------------------------------------------------------

export { ARTICULOS_ET } from './estatuto-tributario';
export { CONCEPTOS_DIAN } from './doctrina-dian';
export { LEYES_REFORMAS } from './leyes-reformas';
export { JURISPRUDENCIA } from './jurisprudencia';
export { SANCIONES } from './sanciones';
export { TARIFAS_RETENCION } from './tarifas-retencion';
export { NORMAS_AUDITORIA } from './niif-nia';

import { ARTICULOS_ET } from './estatuto-tributario';
import { CONCEPTOS_DIAN } from './doctrina-dian';
import { LEYES_REFORMAS } from './leyes-reformas';
import { JURISPRUDENCIA } from './jurisprudencia';
import { SANCIONES } from './sanciones';
import { TARIFAS_RETENCION } from './tarifas-retencion';
import { NORMAS_AUDITORIA } from './niif-nia';

import type { BlacklistEntry, NormativeCatalogue } from '../types';

// ---------------------------------------------------------------------------
// Blacklist — citas prohibidas
// ---------------------------------------------------------------------------
//
// Criterio de inclusión: el spec original del Motor Normativo contenía 15+
// errores verificados. Cada entrada de blacklist bloquea una cita peligrosa
// que el agente podría emitir si no se previene explícitamente.
//
// Las categorías siguen el discriminante del type BlacklistEntry.
// ---------------------------------------------------------------------------

const BLACKLIST: readonly BlacklistEntry[] = [
  // ─── NORMAS DEROGADAS ─────────────────────────────────────────────────────
  {
    id: 'BL_ART_158_3_DEROGADO',
    patrones: [
      'art\\s*\\.?\\s*158\\s*-?\\s*3',
      '158-3\\s+E\\.?T\\.?',
    ],
    razon:
      'Art. 158-3 E.T. fue derogado por Art. 376 de la Ley 1819/2016 y suspendido desde 2011 (Ley 1430/2010). Citarlo como beneficio vigente expone al contribuyente a sanción por inexactitud Art. 647.',
    alternativaCorrecta:
      'Art. 258-1 E.T. — Descuento del 100% del IVA en activos fijos reales productivos (vigente).',
    severidad: 'CRITICA',
    categoria: 'norma_derogada',
  },

  // ─── NORMAS INEXEQUIBLES ──────────────────────────────────────────────────
  {
    id: 'BL_DECRETO_1474_2025',
    patrones: [
      'decreto\\s+1474\\s+de\\s+2025',
      'decreto\\s+1474/2025',
      'emergencia\\s+econom[ií]ca\\s+2025',
    ],
    razon:
      'Decreto 1474 de 2025 declarado INEXEQUIBLE por Sentencia C-079 de 2026 (Corte Constitucional). Las medidas tributarias del decreto (sobretasa 50%, restricción regalías) NO están vigentes en 2026.',
    alternativaCorrecta:
      'Tarifas vigentes: Art. 240 E.T. tarifa general 35%; par. 2 sobretasa financiera 40% y hidroeléctricas 38%.',
    severidad: 'CRITICA',
    categoria: 'norma_inexequible',
  },
  {
    id: 'BL_SOBRETASA_50_EMERGENCIA',
    patrones: [
      'sobretasa\\s+50\\s*%',
      'tarifa\\s+50\\s*%\\s+renta',
      'emergencia\\s+econ[oó]mica.*renta',
    ],
    razon:
      'La sobretasa del 50% fue introducida por Decreto 1474/2025 declarado INEXEQUIBLE. No existe ninguna tarifa del 50% en renta PJ vigente 2026.',
    alternativaCorrecta:
      'Tarifa general PJ: 35% (Art. 240 E.T.). Sobretasas vigentes: financiero 40% (hasta 2027), hidroeléctricas 38% (hasta 2026).',
    severidad: 'CRITICA',
    categoria: 'norma_inexequible',
  },

  // ─── CONCEPTOS DIAN NO VERIFICABLES ──────────────────────────────────────
  {
    id: 'BL_CONCEPTO_100208221_1352_2018',
    patrones: [
      '100208221-1352',
      '100208221.*1352.*2018',
      'concepto.*1352.*2018',
    ],
    razon:
      'Radicado 100208221-1352/2018 no existe en normograma.dian.gov.co. El spec original lo citaba para diferencia de criterio, pero es un radicado fantasma.',
    alternativaCorrecta:
      'Defensa de diferencia de criterio: Art. 647 par. E.T. (texto literal disponible en el catálogo). Concepto General DIAN 0912/2018 para marco NIIF-fiscal.',
    severidad: 'ALTA',
    categoria: 'concepto_dian_no_verificable',
  },
  {
    id: 'BL_CONCEPTO_481_2018_CAPITALIZACION',
    patrones: [
      'concepto.*481.*2018.*capitaliz',
      'concepto dian 481.*capitaliz',
    ],
    razon:
      'Concepto DIAN 481/2018 trata sobre ESALs, NO sobre capitalización de utilidades. El spec original lo atribuía a Art. 36-3 capitalización — error.',
    alternativaCorrecta:
      'Oficio DIAN 0348 (005875) de 18-03-2020 para capitalización utilidades Art. 36-3 E.T.',
    severidad: 'ALTA',
    categoria: 'concepto_dian_no_verificable',
  },
  {
    id: 'BL_CONCEPTO_906445_2022_TTD',
    patrones: [
      'concepto.*906445.*2022',
      '906445/2022',
    ],
    razon:
      'Concepto DIAN 906445/2022 no es verificable en normograma como documento canónico sobre TTD. El canónico es Concepto Unificado 202(006038)/2024.',
    alternativaCorrecta:
      'Concepto Unificado DIAN 202(006038) de 2024 para metodología TTD.',
    severidad: 'ALTA',
    categoria: 'concepto_dian_no_verificable',
  },
  {
    id: 'BL_OFICIO_100208192_1631_2019',
    patrones: [
      '100208192-1631',
      '100208192.*1631.*2019',
    ],
    razon:
      'Oficio DIAN 100208192-1631/2019 no es verificable en normograma. El spec lo citaba para el umbral agentes de retención con 3.500 UVT incorrecto.',
    alternativaCorrecta:
      'Umbral agentes de retención PN comerciantes: 30.000 UVT (Art. 368-2 E.T.).',
    severidad: 'ALTA',
    categoria: 'concepto_dian_no_verificable',
  },

  // ─── PERIODICIDAD ELIMINADA ───────────────────────────────────────────────
  {
    id: 'BL_IVA_PERIODO_ANUAL',
    patrones: [
      'per[ií]odo.*anual.*iva',
      'iva.*anual.*15\\.?000\\s+uvt',
      'declaraci[oó]n.*iva.*anual',
      'periodo.*iva.*anual',
    ],
    razon:
      'El período IVA anual fue eliminado por Ley 1943/2018 (ratificado por Ley 2010/2019). Solo existen períodos bimestral y cuatrimestral en 2026. Citar el período anual puede generar presentación en fecha incorrecta.',
    alternativaCorrecta:
      'Art. 600 E.T.: bimestral (≥92.000 UVT ingresos) o cuatrimestral (resto).',
    severidad: 'ALTA',
    categoria: 'periodicidad_eliminada',
  },

  // ─── ARTÍCULOS CONFUNDIDOS ────────────────────────────────────────────────
  {
    id: 'BL_RETEIVA_ART_381',
    patrones: [
      'art\\.?\\s*381.*reteiva',
      'reteiva.*art\\.?\\s*381',
      'retenci[oó]n.*iva.*art\\.?\\s*381',
    ],
    razon:
      'Art. 381 E.T. regula certificados de retención por salarios y otros conceptos, NO ReteIVA. El spec original lo confundió. ReteIVA general está en Art. 437-1 E.T.',
    alternativaCorrecta:
      'ReteIVA general 15%: Art. 437-1 E.T. / Casos especiales 100%: Arts. 437-4 y 437-5 E.T.',
    severidad: 'ALTA',
    categoria: 'articulo_confundido',
  },
  {
    id: 'BL_DIVIDENDOS_ART_243_EXTERIOR',
    patrones: [
      'art\\.?\\s*243.*dividendos.*exterior',
      'dividendos.*no\\s+residente.*art\\.?\\s*243',
    ],
    razon:
      'Art. 243 E.T. regula la reasignación de 9 puntos de la tarifa, NO dividendos al exterior. Los dividendos a no residentes están regulados en Art. 245 E.T. (20% general).',
    alternativaCorrecta:
      'Art. 245 E.T. — Dividendos a no residentes: 20% general, modulable por CDI.',
    severidad: 'ALTA',
    categoria: 'articulo_confundido',
  },
  {
    id: 'BL_GO_ART_47_TARIFA',
    patrones: [
      'art\\.?\\s*47.*ganancia.*ocasional.*15\\s*%',
      'art\\.?\\s*47.*go.*15\\s*%',
      'gananciales.*15\\s*%',
    ],
    razon:
      'Art. 47 E.T. regula los gananciales de la sociedad conyugal como INCRGNO (NO son ganancias ocasionales). La tarifa de ganancias ocasionales del 15% está en Art. 313 E.T.',
    alternativaCorrecta:
      'Art. 313 E.T. — Tarifa GO 15% (Ley 2277/2022). Art. 47 E.T. — Gananciales: INCRGNO.',
    severidad: 'ALTA',
    categoria: 'articulo_confundido',
  },
  {
    id: 'BL_IVA_BIENES_CAPITAL_ART_255',
    patrones: [
      'art\\.?\\s*255.*iva.*activos\\s+fijos',
      'art\\.?\\s*255.*iva.*bienes\\s+de\\s+capital',
      'descuento.*iva.*activos.*art\\.?\\s*255',
    ],
    razon:
      'Art. 255 E.T. es el descuento por inversiones en control y mejoramiento del medio ambiente, NO el descuento del IVA en activos fijos. El spec original los confundió.',
    alternativaCorrecta:
      'Art. 258-1 E.T. — Descuento 100% del IVA en adquisición/importación/construcción de activos fijos reales productivos.',
    severidad: 'CRITICA',
    categoria: 'articulo_confundido',
  },

  // ─── TARIFA INCORRECTA ────────────────────────────────────────────────────
  {
    id: 'BL_DIVIDENDOS_PN_10PCT',
    patrones: [
      'dividendos.*10\\s*%.*plano',
      'tarifa.*plana.*10\\s*%.*dividendos',
      'dividendos.*no\\s+gravados.*10\\s*%',
    ],
    razon:
      'Tras Ley 2277/2022 (vigencia 2023+), los dividendos no gravados de PN residentes ya NO tributan al 10% plano. Se integran a la base ordinaria y tributan según la escala progresiva del Art. 241 E.T.',
    alternativaCorrecta:
      'Art. 242 E.T. (Ley 2277/2022): dividendos no gravados integrados a base Art. 241 PN; retención según tabla Art. 242 tope 15%.',
    severidad: 'CRITICA',
    categoria: 'tarifa_incorrecta',
  },
] as const;

// ---------------------------------------------------------------------------
// Agregación final — catálogo completo
// ---------------------------------------------------------------------------

export const MOTOR_NORMATIVO_CATALOG: NormativeCatalogue = {
  articulosET: ARTICULOS_ET,
  conceptosDian: CONCEPTOS_DIAN,
  leyesReformas: LEYES_REFORMAS,
  jurisprudencia: JURISPRUDENCIA,
  sanciones: SANCIONES,
  tarifasRetencion: TARIFAS_RETENCION,
  normasAuditoria: NORMAS_AUDITORIA,
  blacklist: BLACKLIST,
} as const;
