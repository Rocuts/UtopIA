// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 7 · Formato y Entrega
// ---------------------------------------------------------------------------
//
// Elite Protocol 3 capas para presentación del output al usuario final:
//
//   L1 — Sintaxis
//        L1.1 NO contiene símbolo `§` (debe usar "parágrafo" o "Sección")
//        L1.2 NO contiene la palabra "centavos" (sustantivo visible)
//        L1.3 Formatos monetarios son es-CO ($X.XXX.XXX,XX) — no anglo
//        L1.4 modo "quick" ≤ 5 líneas no vacías
//        L1.5 modo "full" ≤ 4000 caracteres (~ 2 páginas)
//
//   L2 — Lógica de negocio
//        L2.1 tono profesional (no informal / marketing)
//
//   L3 — Defensa tributaria
//        L3.1 cierre obligatorio "Este análisis fue generado por El Escudo..."
//             presente con normalización suave (NFD + colapso espacios)
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import type { Modulo7Format, ValidationCheck } from './types';
import {
  contieneSimboloParagrafo,
  contienePalabraCentavos,
  tieneFormatoPesoAnglo,
  contarLineas,
  contieneCierreObligatorio,
  tieneTonoInformal,
} from './helpers';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MAX_LINEAS_QUICK = 5;
const MAX_CARACTERES_FULL = 4000;

// ---------------------------------------------------------------------------
// CAPA 1 — Sintaxis
// ---------------------------------------------------------------------------

export function validateFormatL1(m7: Modulo7Format): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m7.textoSalida;

  // -------------------------------------------------------------------
  // L1.1 — NO símbolo `§`
  // -------------------------------------------------------------------
  {
    const violacion = contieneSimboloParagrafo(texto);
    checks.push({
      name: 'M7.L1.1_no_simbolo_paragrafo',
      passed: !violacion,
      severity: 'error',
      norma: 'INTERNAL — guía estilo Capa 4',
      detail: violacion
        ? 'Texto contiene el símbolo `§`. Debe sustituirse por "parágrafo" o "Sección" para legibilidad en es-CO.'
        : 'No se detecta símbolo `§` — OK.',
    });
  }

  // -------------------------------------------------------------------
  // L1.2 — NO palabra "centavos"
  // -------------------------------------------------------------------
  {
    const violacion = contienePalabraCentavos(texto);
    checks.push({
      name: 'M7.L1.2_no_palabra_centavos',
      passed: !violacion,
      severity: 'error',
      norma: 'INTERNAL — guía estilo Capa 4',
      detail: violacion
        ? 'Texto contiene la palabra "centavos" como sustantivo visible. MoneyCop es un detalle interno — el usuario debe ver pesos formateados ($X.XXX.XXX,XX), no centavos.'
        : 'No se detecta la palabra "centavos" — OK.',
    });
  }

  // -------------------------------------------------------------------
  // L1.3 — formato monetario es-CO (no anglo)
  // -------------------------------------------------------------------
  {
    const usaAnglo = tieneFormatoPesoAnglo(texto);
    checks.push({
      name: 'M7.L1.3_formato_peso_es_co',
      passed: !usaAnglo,
      severity: 'error',
      norma: 'INTERNAL — convención es-CO',
      detail: usaAnglo
        ? 'Texto usa formato monetario anglo ($1,234,567.89). Convención Colombia: punto miles, coma decimal ($1.234.567,89).'
        : 'No se detectó formato monetario anglo — OK.',
    });
  }

  // -------------------------------------------------------------------
  // L1.4 — modo quick ≤ 5 líneas
  // -------------------------------------------------------------------
  if (m7.modo === 'quick') {
    const lineas = contarLineas(texto);
    const ok = lineas <= MAX_LINEAS_QUICK;
    checks.push({
      name: 'M7.L1.4_quick_lineas_max',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — modo quick',
      detail: ok
        ? `Modo quick: ${lineas} líneas ≤ ${MAX_LINEAS_QUICK} — OK.`
        : `Modo quick: ${lineas} líneas > ${MAX_LINEAS_QUICK} permitidas. Respuestas rápidas deben ser concisas.`,
    });
  }

  // -------------------------------------------------------------------
  // L1.5 — modo full ≤ 4000 caracteres
  // -------------------------------------------------------------------
  if (m7.modo === 'full') {
    const len = texto.length;
    const ok = len <= MAX_CARACTERES_FULL;
    checks.push({
      name: 'M7.L1.5_full_caracteres_max',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL — modo full',
      detail: ok
        ? `Modo full: ${len} caracteres ≤ ${MAX_CARACTERES_FULL} (~ 2 páginas) — OK.`
        : `Modo full: ${len} caracteres > ${MAX_CARACTERES_FULL} (~ 2 páginas máx). Reducir prolijidad.`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

export function validateFormatL2(m7: Modulo7Format): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m7.textoSalida;

  // -------------------------------------------------------------------
  // L2.1 — tono profesional
  // -------------------------------------------------------------------
  {
    const informal = tieneTonoInformal(texto);
    checks.push({
      name: 'M7.L2.1_tono_profesional',
      passed: !informal,
      severity: 'error',
      norma: 'INTERNAL — guía tono Capa 4',
      detail: informal
        ? 'Texto contiene tokens de tono informal o marketing-y (ej. "chévere", "súper", "compra ya", "oferta limitada"). Capa 4 exige tono profesional contable-tributario.'
        : 'Tono profesional — OK.',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateFormatL3(m7: Modulo7Format): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const texto = m7.textoSalida;

  // -------------------------------------------------------------------
  // L3.1 — cierre obligatorio
  // -------------------------------------------------------------------
  {
    const ok = contieneCierreObligatorio(texto);
    checks.push({
      name: 'M7.L3.1_cierre_obligatorio',
      passed: ok,
      severity: 'error',
      norma: 'Disclaimer Capa 4 — defensa Art. 647 E.T.',
      detail: ok
        ? 'Texto incluye el cierre obligatorio de validación profesional — defensa Art. 647 disponible.'
        : 'Texto NO incluye cierre obligatorio: "Este análisis fue generado por El Escudo (1+1 IA). Las cifras y posiciones deben ser validadas por un contador público o asesor tributario antes de su uso oficial o presentación ante la DIAN." Sin este cierre el output puede usarse directamente y exponer al cliente a Art. 647 (sanción 100% mayor valor impuesto).',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateFormat(m7: Modulo7Format): ValidationCheck[] {
  return [
    ...validateFormatL1(m7),
    ...validateFormatL2(m7),
    ...validateFormatL3(m7),
  ];
}
