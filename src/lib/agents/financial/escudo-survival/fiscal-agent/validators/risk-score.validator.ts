// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 3 · Risk Score DIAN
// ---------------------------------------------------------------------------
//
// Valida el Score que el agente PUBLICA (fase 2 de la auditoría 2026-09-24,
// pendiente #8): score, nivel y factores salen de `computeRiskScore`; el
// modelo sólo redacta. El contrato anterior describía otra fórmula de cinco
// factores que el agente nunca produjo, por eso el módulo quedaba sin validar.
//
//   L1 — Aritmética
//        L1.1 score entero ∈ [0, 100]
//        L1.2 cada factor es un código conocido y sus puntos están en
//             [0, máximo del factor] (RISK_FACTOR_MAX_PUNTOS)
//        L1.3 score = min(100, Σ puntos)
//
//   L2 — Coherencia de lo publicado
//        L2.1 nivel coherente con el score
//        L2.2 publicable ⇔ F01 ≠ 0, con motivo cuando no es publicable
//        L2.3 la prosa del modelo no cita un score «N/100» distinto; si el
//             score no es publicable no cita ninguno (el 0/100 «bajo» era
//             ausencia de datos)
//
//   L3 — Defensa tributaria
//        L3.1 score publicable > 60 → Modo Supervivencia activo o
//             recomendado explícitamente (prompt del Módulo 3)
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import {
  RISK_FACTOR_MAX_PUNTOS,
  RISK_SCORE_UMBRAL_SUPERVIVENCIA,
  classifyRiskNivel,
} from '../tools/risk-score-calculator';
import type { Modulo3RiskScore, ValidationCheck } from './types';

const ZERO = BigInt(0);

function f01EsCero(f01Cents: string): boolean | null {
  if (!/^-?\d+$/.test(f01Cents)) return null;
  return BigInt(f01Cents) === ZERO;
}

/**
 * Contexto que precede a un «N/100» que NO es el score de la entidad sino un
 * umbral, un rango, un límite o el aporte de un factor (re-auditoría
 * 2026-09-24, NT-07): «supera el umbral de 60/100», «rango 61-80/100»,
 * «aporta 30 de 100 puntos posibles», «un score superior a 60/100».
 *
 * Revisión adversarial de NT-07: con una ventana de 40 caracteres para
 * cualquier clave, «se ubica en el rango muy alto con 72/100», «por encima
 * de su nivel previo, 72/100» o «alcanza el máximo nivel de riesgo, 72/100»
 * dejaban de verificarse y un score distinto del determinista llegaba al
 * cliente. Ahora:
 *   - los sustantivos de referencia (umbral, límite, tope, threshold, limit)
 *     admiten hasta 40 caracteres antes del número («el umbral del Modo
 *     Supervivencia es 60/100»), sin dígitos, sin «score / puntaje /
 *     puntuación», sin «con / with» y sin «, : ;» en medio;
 *   - los comparativos y aportes (superior a, supera, hasta, máximo, aporta,
 *     above, up to…) sólo cuando el número va inmediatamente después (con un
 *     artículo o «de» a lo sumo): «superior a 60/100», «aporta 30/100»;
 *   - «rango» / «range» sólo con los extremos del rango («rango de 41 a
 *     60/100»); el guion («61-80/100») lo cubre ANTES_DE_RANGO.
 */
const SUSTANTIVOS_REFERENCIA = ['umbral(?:es)?', 'l[íi]mite', 'tope', 'thresholds?', 'limits?'].join('|');
const ANTES_DE_SUSTANTIVO = new RegExp(
  `\\b(?:${SUSTANTIVOS_REFERENCIA})\\b(?:(?!score|puntaje|puntuaci|\\bcon\\b|\\bwith\\b)[^\\d,:;]){0,40}$`,
  'i',
);
const COMPARATIVOS_REFERENCIA = [
  'hasta', 'm[áa]ximo', 'm[íi]nimo', 'aporta(?:n)?',
  'superior(?:es)?\\s+a', 'inferior(?:es)?\\s+a', 'mayor(?:es)?\\s+(?:a|que)', 'menor(?:es)?\\s+(?:a|que)',
  'por\\s+encima\\s+de', 'por\\s+debajo\\s+de', 'm[áa]s\\s+de', 'menos\\s+de', 'supera(?:r|n)?',
  'entre\\s+\\d{1,3}\\s+y', 'up\\s+to', 'max(?:imum)?', 'min(?:imum)?', 'contributes?',
  'above', 'below', 'exceeds?', 'more\\s+than', 'less\\s+than', 'between\\s+\\d{1,3}\\s+and',
].join('|');
const ANTES_DE_COMPARATIVO = new RegExp(
  `\\b(?:${COMPARATIVOS_REFERENCIA})\\b(?:\\s+(?:el|la|los|las|un|una|de|del|the|a|an|of))?\\s*$`,
  'i',
);
/** «rango de 41 a 60/100», «range from 41 to 60/100». */
const ANTES_DE_RANGO_EXPLICITO = /\b(?:rango|range)\s+(?:(?:de|del|from)\s+)?\d{1,3}\s*(?:a|al|y|to|and|[-–])\s*$/i;
const ANTES_DE_REFERENCIA = {
  test: (antes: string): boolean =>
    ANTES_DE_SUSTANTIVO.test(antes) || ANTES_DE_COMPARATIVO.test(antes) || ANTES_DE_RANGO_EXPLICITO.test(antes),
};
/** «61-80/100»: el número cierra un rango. */
const ANTES_DE_RANGO = /\d\s*[-–]\s*$/;
/** «30 de 100 puntos posibles» / «30 of 100 possible points». */
const DESPUES_DE_REFERENCIA = /^\s*(?:puntos?\s+posibles|possible\s+points)/i;

/**
 * Scores citados en prosa con la forma «N/100» (o «N de 100»). Devuelve los
 * valores numéricos encontrados, sin los umbrales, rangos, límites y aportes
 * de factores (NT-07), que no son el score de la entidad.
 */
export function scoresCitadosEnProsa(texto: string): number[] {
  const out: number[] = [];
  // «100» cierra el número: «30.000 de 100.000 UVT» no es un score.
  const re = /(?<![\d.,])(\d{1,3}(?:[.,]\d+)?)\s*(?:\/|de)\s*100\b(?![.,]\d)(?!\s*%)/gi;
  for (const m of texto.matchAll(re)) {
    const inicio = m.index ?? 0;
    const antes = texto.slice(Math.max(0, inicio - 60), inicio);
    const despues = texto.slice(inicio + m[0].length, inicio + m[0].length + 30);
    if (ANTES_DE_REFERENCIA.test(antes) || ANTES_DE_RANGO.test(antes) || DESPUES_DE_REFERENCIA.test(despues)) continue;
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CAPA 1 — Aritmética
// ---------------------------------------------------------------------------

export function validateRiskScoreL1(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  {
    const ok = Number.isInteger(m3.score) && m3.score >= 0 && m3.score <= 100;
    checks.push({
      name: 'M3.L1.1_score_rango',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok ? `Score ${m3.score} ∈ [0, 100].` : `Score ${m3.score} no es un entero en [0, 100].`,
    });
  }

  for (const f of m3.factores) {
    const max = (RISK_FACTOR_MAX_PUNTOS as Readonly<Record<string, number>>)[f.factor];
    const conocido = typeof max === 'number';
    const ok = conocido && Number.isFinite(f.puntos) && f.puntos >= 0 && f.puntos <= max;
    checks.push({
      name: `M3.L1.2_${f.factor}_rango`,
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — computeRiskScore',
      detail: !conocido
        ? `Factor «${f.factor}» no pertenece al modelo determinista del Score.`
        : ok
          ? `${f.factor} = ${f.puntos} ∈ [0, ${max}].`
          : `${f.factor} = ${f.puntos} fuera de [0, ${max}].`,
    });
  }

  {
    const suma = m3.factores.reduce((acc, f) => acc + f.puntos, 0);
    const esperado = Math.min(100, suma);
    const ok = m3.score === esperado;
    checks.push({
      name: 'M3.L1.3_score_suma_factores',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — computeRiskScore',
      detail: ok
        ? `Score ${m3.score} = min(100, Σ factores = ${suma}).`
        : `Score publicado ${m3.score} ≠ min(100, Σ factores = ${suma}).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Coherencia de lo publicado
// ---------------------------------------------------------------------------

export function validateRiskScoreL2(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  {
    const esperado = classifyRiskNivel(m3.score);
    const ok = esperado === m3.nivel;
    checks.push({
      name: 'M3.L2.1_nivel_coherente',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? `Nivel ${m3.nivel} coherente con score ${m3.score}.`
        : `Nivel publicado ${m3.nivel} ≠ ${esperado} para score ${m3.score} (bajo 0-20, medio 21-40, alto 41-60, muy_alto 61-80, crítico 81-100).`,
    });
  }

  {
    const cero = f01EsCero(m3.f01Cents);
    const esperadoPublicable = cero === null ? null : !cero;
    const motivoOk = m3.publicable || (m3.noPublicableMotivo ?? '').trim().length > 0;
    const ok = esperadoPublicable !== null && m3.publicable === esperadoPublicable && motivoOk;
    checks.push({
      name: 'M3.L2.2_publicabilidad_coherente',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — Bloque Âncora F01',
      detail: ok
        ? m3.publicable
          ? 'Score publicable: hay base gravable (F01 ≠ $0).'
          : `Score no publicable con motivo: ${m3.noPublicableMotivo}`
        : esperadoPublicable === null
          ? `F01 no es MoneyCop válido («${m3.f01Cents}»): no se puede verificar la publicabilidad.`
          : !motivoOk
            ? 'Score no publicable sin motivo declarado.'
            : `publicable = ${m3.publicable} contradice F01 ${cero ? '= $0' : '≠ $0'}.`,
    });
  }

  {
    const citados = scoresCitadosEnProsa(m3.narrativa);
    const distintos = m3.publicable ? citados.filter((n) => n !== m3.score) : citados;
    const ok = distintos.length === 0;
    checks.push({
      name: 'M3.L2.3_narrativa_cita_score_determinista',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — el modelo sólo redacta',
      detail: ok
        ? citados.length === 0
          ? 'La prosa no cita un score numérico.'
          : `La prosa cita el score determinista ${m3.score}/100.`
        : m3.publicable
          ? `La prosa cita ${distintos.map((n) => `${n}/100`).join(', ')} pero el score determinista es ${m3.score}/100.`
          : `El score no es publicable y la prosa cita ${distintos.map((n) => `${n}/100`).join(', ')}: debe decir «no determinable».`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateRiskScoreL3(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const umbral = RISK_SCORE_UMBRAL_SUPERVIVENCIA;

  if (m3.publicable && m3.score > umbral) {
    const recomendado = [m3.narrativa, ...m3.recomendaciones].some((t) =>
      /modo\s+supervivencia|survival\s+mode/i.test(t),
    );
    const ok = m3.modoSupervivenciaActivo === true || recomendado;
    checks.push({
      name: 'M3.L3.1_modo_supervivencia_score_alto',
      passed: ok,
      severity: 'error',
      norma: 'Capa 4 Módulo 8 — Modo Supervivencia',
      detail: ok
        ? `Score ${m3.score} > ${umbral}: Modo Supervivencia ${m3.modoSupervivenciaActivo ? 'activo' : 'recomendado'}.`
        : `Score ${m3.score} > ${umbral} sin Modo Supervivencia activo ni recomendado. El Módulo 8 debe declararse para limitar exposición (Art. 647 E.T.).`,
    });
  } else {
    checks.push({
      name: 'M3.L3.1_modo_supervivencia_score_alto',
      passed: true,
      severity: 'warning',
      norma: 'Capa 4 Módulo 8',
      detail: m3.publicable
        ? `Score ${m3.score} ≤ ${umbral} — Modo Supervivencia no requerido.`
        : 'Score no publicable — el umbral del Modo Supervivencia no aplica.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateRiskScore(m3: Modulo3RiskScore): ValidationCheck[] {
  return [
    ...validateRiskScoreL1(m3),
    ...validateRiskScoreL2(m3),
    ...validateRiskScoreL3(m3),
  ];
}
