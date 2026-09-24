// ---------------------------------------------------------------------------
// Capa 4 — Módulo 5 — Tool: DIAN Letter Builder
// ---------------------------------------------------------------------------
//
// Identifica el tipo de actuación DIAN a partir del texto del requerimiento
// (keywords) y produce el esqueleto de la carta de respuesta con secciones
// fijas (Antecedentes / Posición jurídica / Soportes / Defensa Art. 647 /
// Petición / Firmas).
//
// El LLM rellena el contenido sustantivo de cada sección — el tool fija la
// estructura, el tipo de actuación, el plazo y la norma del plazo.
//
// Cero LLM, cero red.
// ---------------------------------------------------------------------------

import type { DianRequirementKind } from '../types';

/**
 * Reglas (keyword, kind, plazo, norma del plazo). Ordenadas por especificidad.
 *
 * Auditoría 2026-09 (tributario-modulos-13):
 *   - Pliego de cargos: 1 mes para responder el traslado de cargos (p. ej.
 *     Arts. 651 y 860 E.T.), NO 3 meses: los 3 meses del Art. 707 son para
 *     responder el REQUERIMIENTO ESPECIAL, que ahora es un tipo propio.
 *   - Requerimiento ordinario: el plazo que fije el acto, mínimo 15 días
 *     calendario (Art. 261 Ley 223/1995; deber del Art. 686 E.T.).
 */
const RULES: ReadonlyArray<{
  keywords: readonly string[];
  kind: DianRequirementKind;
  plazo: string;
  normaPlazo: string;
}> = [
  {
    keywords: ['liquidación oficial de revisión', 'liquidacion oficial de revision', 'liquidación de revisión'],
    kind: 'liquidacion_oficial_revision',
    plazo: '2 meses para interponer recurso de reconsideración (Art. 720 E.T.).',
    normaPlazo: 'Art. 720 E.T.',
  },
  {
    kind: 'requerimiento_especial',
    keywords: ['requerimiento especial', 'ampliación al requerimiento especial', 'ampliacion al requerimiento especial'],
    plazo: '3 meses desde la notificación para responder (Art. 707 E.T.).',
    normaPlazo: 'Art. 707 E.T.',
  },
  {
    kind: 'pliego_cargos',
    keywords: ['pliego de cargos'],
    plazo: '1 mes desde la notificación para responder el traslado de cargos (p. ej. Arts. 651 y 860 E.T.); verificar el término que indique el acto.',
    normaPlazo: 'Traslado de cargos — 1 mes (p. ej. Arts. 651 y 860 E.T.)',
  },
  {
    kind: 'emplazamiento_corregir',
    keywords: ['emplazamiento para corregir'],
    plazo: '1 mes desde la notificación para corregir voluntariamente (Art. 685 E.T.).',
    normaPlazo: 'Art. 685 E.T.',
  },
  {
    kind: 'emplazamiento_no_declarar',
    keywords: ['emplazamiento previo por no declarar', 'emplazamiento por no declarar'],
    plazo: 'Término señalado por la DIAN en el emplazamiento (Art. 715 E.T.).',
    normaPlazo: 'Art. 715 E.T.',
  },
  {
    kind: 'requerimiento_ordinario',
    keywords: ['requerimiento ordinario', 'requerimiento de información', 'requerimiento ordinario de información'],
    plazo: 'El plazo que fije el requerimiento, que no puede ser inferior a 15 días calendario (Art. 261 Ley 223/1995; Art. 686 E.T.).',
    normaPlazo: 'Art. 686 E.T. y Art. 261 Ley 223/1995',
  },
];

export interface DianRequirementClassification {
  kind: DianRequirementKind;
  plazoRespuesta: string;
  normaPlazo: string;
}

/**
 * Identifica el tipo de actuación DIAN a partir del texto. Si el caller
 * provee `kindOverride`, se usa directamente (caso UI: el usuario selecciona
 * el tipo en un dropdown).
 */
export function classifyDianRequirement(
  text: string | undefined,
  kindOverride?: DianRequirementKind,
): DianRequirementClassification {
  if (kindOverride && kindOverride !== 'desconocido') {
    return classificationFromKind(kindOverride);
  }
  const normalized = (text ?? '').toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        return { kind: rule.kind, plazoRespuesta: rule.plazo, normaPlazo: rule.normaPlazo };
      }
    }
  }
  return {
    kind: 'desconocido',
    plazoRespuesta: 'Plazo no identificable — verificar texto del requerimiento manualmente.',
    normaPlazo: 'No identificable — verificar el acto',
  };
}

function classificationFromKind(kind: DianRequirementKind): DianRequirementClassification {
  const rule = RULES.find((r) => r.kind === kind);
  if (!rule) {
    return {
      kind: 'desconocido',
      plazoRespuesta: 'Plazo no identificable — verificar tipo de actuación.',
      normaPlazo: 'No identificable — verificar el acto',
    };
  }
  return { kind: rule.kind, plazoRespuesta: rule.plazo, normaPlazo: rule.normaPlazo };
}

/**
 * Reducciones disponibles según el tipo de actuación, citadas con la norma
 * exacta. El LLM las incluye en la carta cuando aplican al caso.
 */
export function reduccionesDisponibles(
  kind: DianRequirementKind,
): string[] {
  const arts640 = [
    'Reducciones escalonadas por principios de gradualidad y proporcionalidad (Art. 640 E.T.).',
  ];
  switch (kind) {
    case 'requerimiento_especial':
      return [
        ...arts640,
        'Reducción de la sanción por inexactitud a la cuarta parte si en la respuesta al requerimiento especial (o a su ampliación) se aceptan total o parcialmente los hechos y se corrige la declaración (Art. 709 E.T.).',
      ];
    case 'pliego_cargos':
      return [
        ...arts640,
        'Reducciones propias del artículo que regula la sanción propuesta (p. ej. Art. 651 E.T. para información exógena); la reducción del Art. 709 E.T. aplica sólo a la sanción por inexactitud.',
      ];
    case 'liquidacion_oficial_revision':
      return [
        ...arts640,
        'Reducción de la sanción por inexactitud a la mitad si se aceptan los hechos de la liquidación oficial de revisión dentro del término del recurso (Art. 713 E.T.).',
      ];
    case 'emplazamiento_corregir':
      return [
        ...arts640,
        'Sanción por corrección del Art. 644 E.T.: 10% del mayor valor a pagar si se corrige antes del emplazamiento; 20% si se corrige después de notificado el emplazamiento para corregir y antes del requerimiento especial.',
      ];
    case 'emplazamiento_no_declarar':
      return [
        ...arts640,
        'Reducción según Art. 716 E.T. si la declaración se presenta dentro del término del emplazamiento.',
      ];
    case 'requerimiento_ordinario':
    case 'desconocido':
    default:
      return arts640;
  }
}

/**
 * Esqueleto de carta DIAN. El LLM rellena cada sección con el contenido
 * sustantivo a partir del balance + del texto del requerimiento.
 */
export interface DianLetterSkeleton {
  classification: DianRequirementClassification;
  /** Líneas vacías que el LLM debe llenar — orden fijo. */
  secciones: ReadonlyArray<{ titulo: string; instrucciones: string }>;
  reduccionesDisponibles: string[];
}

export function buildDianLetterSkeleton(
  text: string | undefined,
  kindOverride?: DianRequirementKind,
): DianLetterSkeleton {
  const classification = classifyDianRequirement(text, kindOverride);
  const secciones = [
    {
      titulo: 'Antecedentes',
      instrucciones:
        'Síntesis del requerimiento DIAN: número, fecha de notificación, hechos imputados.',
    },
    {
      titulo: 'Posición jurídica del contribuyente',
      instrucciones:
        'Tesis del contribuyente con sustento normativo (Estatuto Tributario, Conceptos DIAN whitelisted, jurisprudencia constitucional). Citar artículo exacto.',
    },
    {
      titulo: 'Soporte documental',
      instrucciones:
        'Listado de soportes que respaldan la tesis: contratos, facturas, soportes contables, certificaciones, dictámenes.',
    },
    {
      titulo: 'Defensa diferencia de criterio (parágrafo Art. 647 E.T.)',
      instrucciones:
        'Solo si la posición del contribuyente puede entenderse como una interpretación razonable del derecho aplicable, citar TEXTUALMENTE el parágrafo del Art. 647 E.T. para neutralizar la sanción por inexactitud.',
    },
    {
      titulo: 'Petición',
      instrucciones:
        'Solicitud expresa: archivo, modificación, no aplicación de sanción, levantamiento parcial, según corresponda.',
    },
    {
      titulo: 'Firmas',
      instrucciones:
        'Representante legal + contador / RF con T.P. visible. Cierre con: "Esta respuesta es un borrador para revisión del contador y/o abogado tributarista antes de su envío."',
    },
  ];
  return {
    classification,
    secciones,
    reduccionesDisponibles: reduccionesDisponibles(classification.kind),
  };
}
