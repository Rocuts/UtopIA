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

/** Reglas (keyword, kind, plazo, norma del plazo). Ordenadas por especificidad. */
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
    kind: 'pliego_cargos',
    keywords: ['pliego de cargos'],
    plazo: '3 meses para responder (Art. 707 E.T.).',
    normaPlazo: 'Art. 707 E.T.',
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
    plazo: '15 días hábiles desde la notificación (Art. 752 E.T.).',
    normaPlazo: 'Art. 752 E.T.',
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
    normaPlazo: 'Art. 752 E.T. (referencia genérica al régimen de requerimientos)',
  };
}

function classificationFromKind(kind: DianRequirementKind): DianRequirementClassification {
  const rule = RULES.find((r) => r.kind === kind);
  if (!rule) {
    return {
      kind: 'desconocido',
      plazoRespuesta: 'Plazo no identificable — verificar tipo de actuación.',
      normaPlazo: 'Art. 752 E.T.',
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
    case 'pliego_cargos':
      return [
        ...arts640,
        'Reducción al 25% por aceptación del pliego de cargos (Art. 709 E.T.).',
        'Reducción al 50% del valor inicial por corrección antes del emplazamiento (Art. 644 E.T.).',
      ];
    case 'liquidacion_oficial_revision':
      return [
        ...arts640,
        'Reducción al 50% por aceptación de la liquidación oficial de revisión (Art. 713 E.T.).',
      ];
    case 'emplazamiento_corregir':
      return [
        ...arts640,
        'Reducción al 10% por corrección voluntaria antes del emplazamiento (Art. 644 E.T.); 20% si la corrección es posterior al emplazamiento.',
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
