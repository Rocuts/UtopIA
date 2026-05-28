// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 5 · Defensa DIAN
// ---------------------------------------------------------------------------
//
// Elite Protocol 3 capas para la carta de respuesta a requerimientos DIAN:
//
//   L1 — Sintaxis estructural
//        L1.1 carta contiene las 6 secciones obligatorias en orden:
//             Antecedentes / Posición Jurídica / Soporte Documental /
//             Defensa Art. 647 / Petición / Firmas
//
//   L2 — Lógica de negocio (citas y plazos correctos por tipo)
//        L2.1 plazo correcto según tipo:
//             Art. 752 → 15 días hábiles
//             Art. 685 → 1 mes
//             Art. 715 → pliego cargos, 3 meses (Art. 707)
//             Art. 702 → liquidación oficial, 2 meses (Art. 720)
//        L2.2 si invoca diferencia de criterio → cita parágrafo Art. 647 literal
//        L2.3 si invoca diferencia de criterio → NO cita Concepto 1352/2018
//             (radicado no verificable en normograma DIAN — blacklist CRITICA)
//        L2.4 si menciona reducción → cita Art. 709 / 713 / 640
//
//   L3 — Defensa tributaria
//        L3.1 cierre "borrador para revisión contador/abogado" obligatorio
//        L3.2 cita Art. 647 E.T. (norma raíz de defensa)
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import type { Modulo5DefensaDian, RequerimientoTipo, ValidationCheck } from './types';
import {
  citaParagrafo647,
  citaConcepto1352,
  citaArt752,
  citaArt685,
  citaArt715,
  citaArt702,
  citaArt707,
  citaArt720,
  citaArt709,
  citaArt713,
  citaArt640,
  citaArt647,
} from './helpers';

// ---------------------------------------------------------------------------
// Secciones obligatorias
// ---------------------------------------------------------------------------
//
// Cada sección puede aparecer como heading markdown ("## Antecedentes") o como
// label en negrita ("**Antecedentes**"). El validator acepta ambas formas.
// ---------------------------------------------------------------------------

const SECCIONES_OBLIGATORIAS = [
  'Antecedentes',
  'Posición Jurídica',
  'Soporte Documental',
  'Defensa Art. 647',
  'Petición',
  'Firmas',
] as const;

/**
 * Detecta una sección en el texto. Acepta heading markdown o **negrita**.
 * Tolerante a tildes ("Posición" / "Posicion") y plurales.
 */
function detectarSeccion(texto: string, seccion: string): { found: boolean; index: number } {
  const escapado = seccion
    .replace(/\./g, '\\.')
    .replace(/[íÍ]/g, '[íi]')
    .replace(/[áÁ]/g, '[áa]')
    .replace(/[éÉ]/g, '[ée]')
    .replace(/[óÓ]/g, '[óo]')
    .replace(/[úÚ]/g, '[úu]');
  // Heading markdown (#, ##, ###, etc.) o **negrita** o "Sección:" con dos puntos
  const patrones = [
    new RegExp(`^#{1,6}\\s*${escapado}\\b`, 'im'),
    new RegExp(`\\*\\*\\s*${escapado}\\b[^*]*\\*\\*`, 'i'),
    new RegExp(`\\b${escapado}\\s*:`, 'i'),
  ];
  for (const p of patrones) {
    const m = texto.match(p);
    if (m && m.index !== undefined) return { found: true, index: m.index };
  }
  return { found: false, index: -1 };
}

// ---------------------------------------------------------------------------
// Plazos correctos por tipo de requerimiento
// ---------------------------------------------------------------------------

interface PlazoEsperado {
  /** Patrón obligatorio que debe aparecer en el texto. */
  readonly patron: RegExp;
  /** Norma que lo soporta. */
  readonly norma: string;
  /** Descripción legible del plazo esperado. */
  readonly descripcion: string;
  /** Función auxiliar para chequeo de cita normativa principal. */
  readonly citaPrincipal: (t: string) => boolean;
}

const PLAZOS: Record<RequerimientoTipo, PlazoEsperado> = {
  requerimiento_ordinario_752: {
    patron: /\b15\s+d[íi]as\s+h[áa]biles\b/i,
    norma: 'Art. 752 E.T.',
    descripcion: '15 días hábiles',
    citaPrincipal: citaArt752,
  },
  requerimiento_especial_685: {
    patron: /\b1\s+mes\b|\bun\s+mes\b/i,
    norma: 'Art. 685 E.T.',
    descripcion: '1 mes',
    citaPrincipal: citaArt685,
  },
  pliego_cargos_715: {
    patron: /\b3\s+meses\b|\btres\s+meses\b/i,
    norma: 'Art. 707 E.T. (plazo respuesta pliego de cargos Art. 715)',
    descripcion: '3 meses',
    citaPrincipal: (t: string) => citaArt715(t) && citaArt707(t),
  },
  liquidacion_oficial_702: {
    patron: /\b2\s+meses\b|\bdos\s+meses\b/i,
    norma: 'Art. 720 E.T. (plazo recurrir liquidación oficial Art. 702)',
    descripcion: '2 meses',
    citaPrincipal: (t: string) => citaArt702(t) && citaArt720(t),
  },
};

// ---------------------------------------------------------------------------
// Cierre obligatorio (borrador)
// ---------------------------------------------------------------------------

/**
 * True si la carta declara explícitamente que es un borrador sujeto a
 * revisión por contador público o abogado.
 */
function declaraBorrador(texto: string): boolean {
  const t = texto.toLowerCase();
  const tieneBorrador = /\bborrador\b/.test(t);
  const tieneRevision = /\brevisi[óo]n\b/.test(t);
  const tieneProfesional =
    /\bcontador(?:\s+p[úu]blico)?\b/.test(t) ||
    /\babogado\b/.test(t) ||
    /\brevisor\s+fiscal\b/.test(t);
  return tieneBorrador && tieneRevision && tieneProfesional;
}

// ---------------------------------------------------------------------------
// CAPA 1 — Sintaxis estructural
// ---------------------------------------------------------------------------

export function validateDefensaDianL1(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m5.cartaTexto;

  // -------------------------------------------------------------------
  // L1.1 — secciones presentes y en orden
  // -------------------------------------------------------------------
  const detectadas = SECCIONES_OBLIGATORIAS.map((s) => ({
    seccion: s,
    ...detectarSeccion(texto, s),
  }));

  const faltantes = detectadas.filter((d) => !d.found).map((d) => d.seccion);
  const okPresencia = faltantes.length === 0;
  checks.push({
    name: 'M5.L1.1_secciones_presentes',
    passed: okPresencia,
    severity: 'error',
    norma: 'INTERNAL',
    detail: okPresencia
      ? `Carta contiene las 6 secciones obligatorias: ${SECCIONES_OBLIGATORIAS.join(' / ')}.`
      : `Carta NO contiene sección(es): ${faltantes.join(', ')}. Estructura obligatoria: ${SECCIONES_OBLIGATORIAS.join(' / ')}.`,
  });

  if (okPresencia) {
    let ordenOk = true;
    let lastIdx = -1;
    let primerFuera: string | null = null;
    for (const d of detectadas) {
      if (d.index < lastIdx) {
        ordenOk = false;
        primerFuera = d.seccion;
        break;
      }
      lastIdx = d.index;
    }
    checks.push({
      name: 'M5.L1.1b_secciones_ordenadas',
      passed: ordenOk,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ordenOk
        ? 'Secciones aparecen en el orden correcto.'
        : `Sección "${primerFuera}" aparece fuera de orden. Orden esperado: ${SECCIONES_OBLIGATORIAS.join(' → ')}.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

export function validateDefensaDianL2(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m5.cartaTexto;
  const plazo = PLAZOS[m5.tipoRequerimiento];

  // -------------------------------------------------------------------
  // L2.1 — plazo correcto + cita principal
  // -------------------------------------------------------------------
  {
    const tienePlazo = plazo.patron.test(texto);
    const tieneCita = plazo.citaPrincipal(texto);
    const ok = tienePlazo && tieneCita;
    checks.push({
      name: 'M5.L2.1_plazo_y_cita_correctos',
      passed: ok,
      severity: 'error',
      norma: plazo.norma,
      detail: ok
        ? `Tipo ${m5.tipoRequerimiento}: plazo ${plazo.descripcion} citado correctamente con norma ${plazo.norma}.`
        : `Tipo ${m5.tipoRequerimiento} requiere plazo "${plazo.descripcion}" (presente: ${tienePlazo}) y cita normativa ${plazo.norma} (presente: ${tieneCita}).`,
    });
  }

  // -------------------------------------------------------------------
  // L2.2 — si invoca diferencia de criterio → cita parágrafo Art. 647
  // -------------------------------------------------------------------
  if (m5.invocaDiferenciaCriterio) {
    const ok = citaParagrafo647(texto);
    checks.push({
      name: 'M5.L2.2_diferencia_criterio_cita_par_647',
      passed: ok,
      severity: 'error',
      norma: 'Art. 647 par. E.T.',
      detail: ok
        ? 'Defensa diferencia de criterio invoca el parágrafo del Art. 647 — sustento jurídico correcto.'
        : 'Defensa diferencia de criterio NO cita el parágrafo del Art. 647 E.T. literalmente. Sin esto la defensa carece de soporte normativo y queda en interpretación libre del funcionario DIAN.',
    });
  }

  // -------------------------------------------------------------------
  // L2.3 — NO cita Concepto 100208221-1352 (no verificable en normograma)
  // -------------------------------------------------------------------
  {
    const violacion = citaConcepto1352(texto);
    checks.push({
      name: 'M5.L2.3_no_cita_concepto_1352',
      passed: !violacion,
      severity: 'error',
      norma: 'Blacklist normativa — Concepto 100208221-1352 no verificable',
      detail: violacion
        ? 'La carta cita el Concepto DIAN 100208221-1352 de 2018, cuyo radicado NO es verificable en normograma.dian.gov.co. Citarlo expone al cliente a que DIAN pida verificación y devuelva la carta como infundada. Sustituir por: parágrafo del Art. 647 + Sentencias Sección Cuarta Consejo de Estado.'
        : 'No se detectó cita al Concepto 100208221-1352 — OK.',
    });
  }

  // -------------------------------------------------------------------
  // L2.4 — si menciona reducción → cita Art. 709 / 713 / 640
  // -------------------------------------------------------------------
  if (m5.mencionaReduccion) {
    const ok = citaArt709(texto) || citaArt713(texto) || citaArt640(texto);
    checks.push({
      name: 'M5.L2.4_reduccion_cita_norma',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 709 / 713 / 640 E.T.',
      detail: ok
        ? 'Mención de reducción soportada con norma vigente (Art. 709 / 713 / 640 E.T.).'
        : 'Carta menciona reducción de sanción pero NO cita Art. 709 (25%), Art. 713 (50%) ni Art. 640. Sin norma soporte, la solicitud de reducción puede ser rechazada por DIAN.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateDefensaDianL3(m5: Modulo5DefensaDian): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m5.cartaTexto;

  // -------------------------------------------------------------------
  // L3.1 — closing note "borrador para revisión contador/abogado"
  // -------------------------------------------------------------------
  {
    const ok = declaraBorrador(texto);
    checks.push({
      name: 'M5.L3.1_cierre_borrador_revision',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? 'Carta declara explícitamente que es un borrador para revisión por contador público / abogado / revisor fiscal.'
        : 'Carta NO declara que es un borrador para revisión profesional. Sin esta declaración el output de IA puede usarse directamente y exponer al cliente a errores no controlados (Art. 647 si se presenta defectuosa).',
    });
  }

  // -------------------------------------------------------------------
  // L3.2 — cita Art. 647 E.T. (norma raíz de defensa)
  // -------------------------------------------------------------------
  {
    const ok = citaArt647(texto);
    checks.push({
      name: 'M5.L3.2_cita_art_647',
      passed: ok,
      severity: 'error',
      norma: 'Art. 647 E.T.',
      detail: ok
        ? 'Carta cita Art. 647 E.T. — la norma raíz de defensa por inexactitud está invocada.'
        : 'Carta NO cita Art. 647 E.T. — la sección "Defensa Art. 647" es estructural pero el cuerpo debe invocar la norma con cita formal.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateDefensaDian(m5: Modulo5DefensaDian): ValidationCheck[] {
  return [
    ...validateDefensaDianL1(m5),
    ...validateDefensaDianL2(m5),
    ...validateDefensaDianL3(m5),
  ];
}
