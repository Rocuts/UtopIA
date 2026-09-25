// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 6 · Devoluciones y Saldos a Favor
// ---------------------------------------------------------------------------
//
// Valida lo que el módulo PUBLICA (fase 2 de la auditoría 2026-09-24,
// pendiente #8). El contrato anterior exigía saldo a favor = |F04|; desde
// tributario-modulos-02 F04 es una posición de referencia contable y el saldo
// devolvible es el liquidado en la declaración (Formulario 110).
//
//   L1 — Cifras
//        L1.1 saldo publicado = saldo declarado (null sin declaración; 0 si
//             la declaración no liquida saldo a favor)
//        L1.2 viabilidad coherente con el saldo declarado
//
//   L2 — Prosa y citas
//        L2.1 la prosa no presenta |F04| como saldo a favor: una oración que
//             cita el monto como saldo a favor / devolución lo rotula como
//             estimación / referencia contable (es y en)
//        L2.2 con saldo declarado: cita Arts. 850, 854 y 855 (no el rango
//             854-860)
//        L2.3 sin saldo devolvible: ningún paso de solicitud de devolución
//
//   L3 — Defensa tributaria
//        L3.1 con saldo declarado: requisitos completos (MUISCA, certificación
//             de contador/RF, relación de retenedores con NIT, copia de la
//             declaración)
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { Modulo6Devoluciones, Modulo6Viabilidad, ValidationCheck } from './types';
import { citaArticulo, citaRango854_860, montosCopEnTexto } from './helpers';

const ZERO = BigInt(0);

interface RequisitoSpec {
  readonly nombre: string;
  readonly patrones: readonly RegExp[];
}

const REQUISITOS: readonly RequisitoSpec[] = [
  {
    nombre: 'Solicitud por MUISCA',
    patrones: [/\bMUISCA\b/i, /\bservicio\s+inform[áa]tico\s+electr[óo]nico\b/i, /\b(?:formulario|formato)\s+010\b/i],
  },
  {
    nombre: 'Certificación de contador público o revisor fiscal',
    patrones: [
      /\bcertificaci[óo]n\s+(?:firmada\s+)?(?:del?\s+|por\s+)?(?:contador|revisor)\b/i,
      /\bcontador\s+p[úu]blico\b/i,
      /\brevisor\s+fiscal\b/i,
    ],
  },
  {
    nombre: 'Relación de retenedores con NIT',
    patrones: [
      /\brelaci[óo]n\s+(?:de\s+)?(?:los\s+)?(?:agentes\s+)?(?:retenedores|terceros|retenciones)\b/i,
      /\b(?:listado|relaci[óo]n)\s+(?:de\s+)?NIT\b/i,
      /\bdiscriminaci[óo]n\s+(?:de\s+)?retenedores\b/i,
    ],
  },
  {
    nombre: 'Copia de la declaración',
    patrones: [
      /\bcopia\s+(?:de\s+)?(?:las?\s+)?declaraci[óo]n(?:es)?\b/i,
      /\bdeclaraci[óo]n(?:es)?\s+(?:de\s+renta\s+|tributaria(?:s)?\s+)?presentada(?:s)?\b/i,
      /\bdeclaraci[óo]n\s+de\s+renta\b/i,
      /\bformulario\s+110\b/i,
    ],
  },
];

function parseMoney(v: string | null): bigint | null {
  return v !== null && /^-?\d+$/.test(v) ? BigInt(v) : null;
}

function saldoEsperado(declarado: bigint | null): bigint | null {
  if (declarado === null) return null;
  return declarado > ZERO ? declarado : ZERO;
}

function viabilidadesEsperadas(declarado: bigint | null): readonly Modulo6Viabilidad[] {
  if (declarado === null) return ['no_determinable'];
  if (declarado <= ZERO) return ['no_aplica'];
  return ['alta', 'media', 'baja'];
}

const conSaldoDevolvible = (m6: Modulo6Devoluciones) =>
  m6.viabilidad === 'alta' || m6.viabilidad === 'media' || m6.viabilidad === 'baja';

// ---------------------------------------------------------------------------
// CAPA 1 — Cifras
// ---------------------------------------------------------------------------

export function validateDevolucionesL1(m6: Modulo6Devoluciones): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const declarado = parseMoney(m6.saldoDeclaradoCents);
  const esperado = saldoEsperado(declarado);
  const publicado = parseMoney(m6.saldoAFavorCents);

  {
    const ok = esperado === null ? m6.saldoAFavorCents === null : publicado === esperado;
    checks.push({
      name: 'M6.L1.1_saldo_publicado_es_el_declarado',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 26, 807 y 850 E.T. — saldo liquidado en el Formulario 110',
      detail: ok
        ? esperado === null
          ? 'Sin declaración el saldo a favor se publica N/D (F04 no es base de devolución).'
          : `Saldo publicado ${formatCopFromCents(esperado)} = saldo declarado.`
        : esperado === null
          ? `Sin declaración se publicó un saldo a favor (${m6.saldoAFavorCents}); debe ser N/D.`
          : `Saldo publicado ${m6.saldoAFavorCents ?? 'N/D'} ≠ saldo declarado ${formatCopFromCents(esperado)}.`,
    });
  }

  {
    const permitidas = viabilidadesEsperadas(declarado);
    const ok = permitidas.includes(m6.viabilidad);
    checks.push({
      name: 'M6.L1.2_viabilidad_coherente',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — refund-analyzer',
      detail: ok
        ? `Viabilidad «${m6.viabilidad}» coherente con el saldo declarado.`
        : `Viabilidad «${m6.viabilidad}» incoherente: se esperaba ${permitidas.join(' / ')}.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Prosa y citas
// ---------------------------------------------------------------------------

// Rótulo de estimación / referencia contable (es y en: el prompt en inglés
// conserva el formato es-CO de los montos).
const ROTULO_ESTIMACION =
  /estimaci[óo]n|referencia|no\s+(?:es|constituye|equivale|determinable|liquidad)|no\s+es\s+(?:un\s+)?saldo|\bestimat(?:e|ed|ion)\b|\breference\b|\bnot\s+(?:a|an|the)?\s*(?:refundable|determinable|declared|settled|liquidated)\b|\bcannot\s+be\s+(?:determined|refunded)\b/i;

// La oración presenta el monto como saldo a favor / devolución (es y en). Sin
// esta señal una mención neutra («Su valor es $X.») no es la violación: lo que
// el Art. 670 E.T. castiga es solicitar como saldo a favor lo no liquidado.
const PRESENTA_COMO_SALDO =
  /\bsaldos?\s+a\s+favor\b|\ba\s+favor\b|devoluci[óo]n|\bdevolver|\bdevuelv|reembols|\bcompensa(?:ci[óo]n|r)\b|\brecuper|\bsolicit(?:ar|e|ud)\b|\brefund|\bcredit\s+balance\b|\boverpa(?:id|yment)\b|\bin\s+(?:the\s+taxpayer'?s\s+)?favou?r\b/i;

/** Oraciones (o líneas) del texto que mencionan el monto indicado. */
function oracionesConMonto(texto: string, cents: bigint): string[] {
  return texto
    .split(/(?<=[.;!?])\s+|\n+/)
    .filter((o) => montosCopEnTexto(o).some((m) => m === cents));
}

export function validateDevolucionesL2(m6: Modulo6Devoluciones): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m6.textoAnalisis;
  const f04 = parseMoney(m6.f04Cents);
  const declarado = parseMoney(m6.saldoDeclaradoCents);

  // L2.1 — |F04| nunca como saldo a favor. Si el saldo declarado coincide con
  // |F04| la cifra es legítima (viene de la declaración).
  if (f04 !== null && f04 < ZERO && declarado !== -f04) {
    const abs = -f04;
    const sinRotulo = oracionesConMonto(texto, abs).filter(
      (o) => PRESENTA_COMO_SALDO.test(o) && !ROTULO_ESTIMACION.test(o),
    );
    const ok = sinRotulo.length === 0;
    checks.push({
      name: 'M6.L2.1_f04_no_presentado_como_saldo_a_favor',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 26, 807, 850 y 670 E.T.',
      detail: ok
        ? `La prosa no presenta |F04| = ${formatCopFromCents(abs)} como saldo a favor.`
        : `La prosa presenta |F04| = ${formatCopFromCents(abs)} sin rotularlo como estimación contable: «${sinRotulo[0].trim().slice(0, 160)}». F04 no es el saldo a favor de la declaración (riesgo Art. 670 E.T.).`,
    });
  }

  if (conSaldoDevolvible(m6)) {
    const faltan = ['850', '854', '855'].filter((a) => !citaArticulo(texto, a));
    const rango = citaRango854_860(texto);
    const ok = faltan.length === 0 && !rango;
    checks.push({
      name: 'M6.L2.2_citas_850_854_855',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 850, 854 y 855 E.T.',
      detail: ok
        ? 'Cita Arts. 850 (derecho), 854 (término de 2 años) y 855 (plazo DIAN).'
        : `Faltan citas: ${faltan.length ? faltan.map((a) => `Art. ${a}`).join(', ') : 'ninguna'}${rango ? '; usa el rango 854-860 en lugar del artículo puntual' : ''}.`,
    });
  } else {
    const pasoSolicitud = m6.pasosProcedimentales.find((p) =>
      /\b(?:radicar|formulario\s+010|solicitud\s+de\s+devoluci[óo]n|solicitar\s+la\s+devoluci[óo]n)\b/i.test(p),
    );
    checks.push({
      name: 'M6.L2.3_sin_pasos_de_solicitud',
      passed: pasoSolicitud === undefined,
      severity: 'error',
      norma: 'Art. 670 E.T.',
      detail:
        pasoSolicitud === undefined
          ? `Viabilidad «${m6.viabilidad}»: sin pasos de solicitud de devolución.`
          : `Viabilidad «${m6.viabilidad}» y se publica un paso de solicitud: «${pasoSolicitud.slice(0, 160)}».`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateDevolucionesL3(m6: Modulo6Devoluciones): ValidationCheck[] {
  if (!conSaldoDevolvible(m6)) return [];
  const concat = m6.documentosRequeridos.join(' \n ');
  const presentes = REQUISITOS.filter((r) => r.patrones.some((p) => p.test(concat))).map((r) => r.nombre);
  const faltantes = REQUISITOS.filter((r) => !presentes.includes(r.nombre)).map((r) => r.nombre);
  const ok = faltantes.length === 0;
  return [
    {
      name: 'M6.L3.1_requisitos_completos',
      passed: ok,
      severity: 'error',
      norma: 'Arts. 850-857 E.T. + Decreto 1625/2016',
      detail: ok
        ? `Requisitos completos: ${presentes.join(', ')}.`
        : `Requisitos FALTANTES: ${faltantes.join(', ')}. Presentes: ${presentes.length ? presentes.join(', ') : '(ninguno)'}.`,
    },
  ];
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
