// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 6 · Devoluciones y Saldos a Favor
// ---------------------------------------------------------------------------
//
// Elite Protocol 3 capas para análisis de devoluciones:
//
//   L1 — Aritmética
//        L1.1 |F04| coincide con saldoFavorCents reportado
//
//   L2 — Lógica de negocio
//        L2.1 origen retenciones → cita Art. 850 + 855 (NO rango 854-860)
//        L2.2 origen IVA → cita Art. 815 (compensación) antes de devolución
//        L2.3 cita Art. 854 (prescripción 2 años)
//
//   L3 — Defensa tributaria
//        L3.1 lista requisitos completos: MUISCA + cert. contador/RF +
//             relación NIT + copia declaraciones
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import type { Modulo6Devoluciones, ValidationCheck } from './types';
import {
  parseCents,
  formatCentsCop,
  TOLERANCE_CENTS,
  citaArt850,
  citaArt855,
  citaArt815,
  citaArt854,
  citaRango854_860,
} from './helpers';

// ---------------------------------------------------------------------------
// Requisitos obligatorios — lista canónica
// ---------------------------------------------------------------------------
//
// El validator NO exige textualmente estos términos; en cambio aplica regex
// tolerante para cada categoría. Esto permite redacción libre del agente
// siempre que los conceptos centrales estén presentes.
// ---------------------------------------------------------------------------

interface RequisitoSpec {
  readonly id: string;
  readonly nombre: string;
  /** Regex que valida presencia del requisito en alguno de los strings. */
  readonly patrones: readonly RegExp[];
}

const REQUISITOS: readonly RequisitoSpec[] = [
  {
    id: 'muisca',
    nombre: 'Solicitud por MUISCA',
    patrones: [/\bMUISCA\b/i, /\bservicio\s+inform[áa]tico\s+electr[óo]nico\b/i],
  },
  {
    id: 'cert_contador',
    nombre: 'Certificación de contador público o revisor fiscal',
    patrones: [
      /\bcertificaci[óo]n\s+(?:del?\s+)?(?:contador|revisor)\b/i,
      /\bcontador\s+p[úu]blico\b/i,
      /\brevisor\s+fiscal\b/i,
    ],
  },
  {
    id: 'relacion_nit',
    nombre: 'Relación de retenedores con NIT',
    patrones: [
      /\brelaci[óo]n\s+(?:de\s+)?(?:retenedores|terceros)\b/i,
      /\b(?:listado|relaci[óo]n)\s+(?:de\s+)?NIT\b/i,
      /\bdiscriminaci[óo]n\s+(?:de\s+)?retenedores\b/i,
    ],
  },
  {
    id: 'copia_declaraciones',
    nombre: 'Copia de declaraciones',
    patrones: [
      /\bcopia\s+(?:de\s+)?(?:las?\s+)?declaraci[óo]n(?:es)?\b/i,
      /\bdeclaraci[óo]n(?:es)?\s+(?:tributaria(?:s)?\s+)?presentada(?:s)?\b/i,
    ],
  },
];

/**
 * Detecta requisitos presentes en cualquiera de los strings de la lista.
 */
function requisitosPresentes(items: readonly string[]): {
  presentes: readonly string[];
  faltantes: readonly string[];
} {
  const concat = items.join(' \n ');
  const presentes: string[] = [];
  const faltantes: string[] = [];
  for (const r of REQUISITOS) {
    const ok = r.patrones.some((p) => p.test(concat));
    if (ok) presentes.push(r.nombre);
    else faltantes.push(r.nombre);
  }
  return { presentes, faltantes };
}

// ---------------------------------------------------------------------------
// CAPA 1 — Aritmética
// ---------------------------------------------------------------------------

export function validateDevolucionesL1(m6: Modulo6Devoluciones): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L1.1 — |F04| coincide con saldoFavorCents
  // -------------------------------------------------------------------
  {
    const saldoFavor = parseCents(m6.saldoFavorCents);
    const f04 = parseCents(m6.f04CitadoCents);
    const f04Abs = Math.abs(f04);
    const diff = Math.abs(saldoFavor - f04Abs);
    const ok = diff <= TOLERANCE_CENTS;
    checks.push({
      name: 'M6.L1.1_saldo_favor_coincide_f04',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — Bloque Âncora F04',
      detail: ok
        ? `Saldo a favor ${formatCentsCop(saldoFavor)} = |F04| ${formatCentsCop(f04Abs)} (tolerancia ${TOLERANCE_CENTS}ct).`
        : `Saldo a favor reportado ${formatCentsCop(saldoFavor)} ≠ |F04| citado ${formatCentsCop(f04Abs)} (diff ${formatCentsCop(diff)}; tolerancia ${TOLERANCE_CENTS}ct).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

export function validateDevolucionesL2(m6: Modulo6Devoluciones): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m6.textoAnalisis;

  // -------------------------------------------------------------------
  // L2.1 — retenciones → cita Art. 850 + 855 (NO rango 854-860)
  // -------------------------------------------------------------------
  if (m6.origen === 'retenciones_fuente') {
    const tieneCitas = citaArt850(texto) && citaArt855(texto);
    const usaRangoMalo = citaRango854_860(texto);
    const ok = tieneCitas && !usaRangoMalo;
    checks.push({
      name: 'M6.L2.1_retenciones_cita_850_855',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 850 y 855 E.T.',
      detail: ok
        ? 'Origen retenciones: cita Arts. 850 (derecho a devolución) y 855 (plazos 50/20 días hábiles) correctamente.'
        : `Origen retenciones: Art. 850 ${citaArt850(texto) ? 'OK' : 'FALTA'}, Art. 855 ${citaArt855(texto) ? 'OK' : 'FALTA'}, rango 854-860 ${usaRangoMalo ? 'PRESENTE (INCORRECTO — usar Art. 855 puntual)' : 'no presente'}.`,
    });
  }

  // -------------------------------------------------------------------
  // L2.2 — IVA → cita Art. 815 (compensación antes de devolución)
  // -------------------------------------------------------------------
  if (m6.origen === 'iva') {
    const ok = citaArt815(texto);
    checks.push({
      name: 'M6.L2.2_iva_cita_815_compensacion',
      passed: ok,
      severity: 'error',
      norma: 'Art. 815 E.T.',
      detail: ok
        ? 'Origen IVA: cita Art. 815 (compensación de saldos a favor) — orden de operaciones correcto.'
        : 'Origen IVA: NO cita Art. 815 E.T. Antes de solicitar devolución debe explorarse compensación con otras obligaciones tributarias (Art. 815). Sin esta cita el análisis está incompleto.',
    });
  }

  // -------------------------------------------------------------------
  // L2.3 — prescripción 2 años → cita Art. 854
  // -------------------------------------------------------------------
  {
    const ok = citaArt854(texto);
    checks.push({
      name: 'M6.L2.3_prescripcion_cita_854',
      passed: ok,
      severity: 'error',
      norma: 'Art. 854 E.T.',
      detail: ok
        ? 'Cita Art. 854 E.T. — término de 2 años para solicitar devolución informado al cliente.'
        : 'NO cita Art. 854 E.T. (término 2 años para solicitar devolución). Sin esta advertencia el cliente puede perder el derecho por prescripción.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateDevolucionesL3(m6: Modulo6Devoluciones): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L3.1 — lista requisitos completos
  // -------------------------------------------------------------------
  {
    const { presentes, faltantes } = requisitosPresentes(m6.listaRequisitos);
    const ok = faltantes.length === 0;
    checks.push({
      name: 'M6.L3.1_requisitos_completos',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 850-855 E.T. + Decreto 1625/2016',
      detail: ok
        ? `Requisitos completos: ${presentes.join(', ')}.`
        : `Requisitos FALTANTES: ${faltantes.join(', ')}. Presentes: ${presentes.length === 0 ? '(ninguno)' : presentes.join(', ')}. Sin requisitos completos DIAN rechaza la solicitud.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateDevoluciones(m6: Modulo6Devoluciones): ValidationCheck[] {
  return [
    ...validateDevolucionesL1(m6),
    ...validateDevolucionesL2(m6),
    ...validateDevolucionesL3(m6),
  ];
}
