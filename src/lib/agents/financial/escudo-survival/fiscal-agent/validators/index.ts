// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Validators · Barrel & Orchestrator
// ---------------------------------------------------------------------------
//
// Composes the Capa 2 (Motor Normativo) + Capa 4-specific validators
// (Módulos 2-7) into a single entry point.
//
// Flujo:
//   1. validateNormativeResponse(rawText) — Capa 2 baseline.
//      Detecta citas inválidas o tóxicas SIN depender de módulos específicos.
//   2. Por cada módulo presente en `response.modulos`, corre su validator
//      específico (M2/M3/M5/M6/M7). M1 lo cubre fiscal-anchor-validators.ts
//      y M8 lo cubre survival-validators.ts — ambos fuera de este barrel.
//   3. Aplica prefijo de módulo a los nombres de checks de Capa 2 → 'CN.*'
//      ("Capa Normativa") para que el consumer pueda distinguir orígenes.
//
// Cero LLM. Cero red. Cero filesystem.
// ---------------------------------------------------------------------------

import type { NormativeCatalogue } from '../../normative/types';
import { validateNormativeResponse } from '../../normative/validators';

import type { FiscalResponse, ValidationCheck } from './types';
import { validateConciliacion } from './conciliacion.validator';
import { validateRiskScore } from './risk-score.validator';
import { validateDefensaDian } from './defensa-dian.validator';
import { validateDevoluciones } from './devoluciones.validator';
import { validateFormat } from './format.validator';

// ---------------------------------------------------------------------------
// Re-exports (barrel)
// ---------------------------------------------------------------------------

export * from './types';
export { validateConciliacion, validateConciliacionL1, validateConciliacionL2, validateConciliacionL3 } from './conciliacion.validator';
export { validateRiskScore, validateRiskScoreL1, validateRiskScoreL2, validateRiskScoreL3 } from './risk-score.validator';
export { validateDefensaDian, validateDefensaDianL1, validateDefensaDianL2, validateDefensaDianL3 } from './defensa-dian.validator';
export { validateDevoluciones, validateDevolucionesL1, validateDevolucionesL2, validateDevolucionesL3 } from './devoluciones.validator';
export { validateFormat, validateFormatL1, validateFormatL2, validateFormatL3 } from './format.validator';

// ---------------------------------------------------------------------------
// Helper — convierte el reporte normativo en una lista de ValidationCheck
// ---------------------------------------------------------------------------
//
// El motor normativo (Capa 2) devuelve `NormativeValidationReport`. Para
// componer veredicto único en Capa 4, convertimos sus violaciones a
// ValidationCheck[] con prefijo `CN.*` (Capa Normativa).
// ---------------------------------------------------------------------------

function normativeReportAChecks(rawText: string, catalogue: NormativeCatalogue): ValidationCheck[] {
  const report = validateNormativeResponse(rawText, catalogue);
  const checks: ValidationCheck[] = [];

  // Resumen agregado (siempre emitido — útil para telemetría aun en respuestas válidas)
  checks.push({
    name: 'CN.summary',
    passed: report.veredictoGlobal !== 'bloqueo',
    severity: report.veredictoGlobal === 'bloqueo' ? 'error' : 'warning',
    norma: 'Capa 2 — Motor Normativo',
    detail: `Veredicto Capa 2: ${report.veredictoGlobal}. Citas: ${report.resumen.totalCitas} (válidas ${report.resumen.citasValidas}, advertencia ${report.resumen.citasAdvertencia}, bloqueo ${report.resumen.citasBloqueo}). Blacklist: ${report.resumen.violacionesBlacklist} (críticas/altas ${report.resumen.violacionesCriticas}).`,
  });

  // Citas con bloqueo o advertencia
  for (const c of report.citations) {
    if (c.veredicto === 'valida') continue;
    checks.push({
      name: `CN.citation.${c.citation.normalized.replace(/\s+/g, '_')}`,
      passed: c.veredicto !== 'bloqueo',
      severity: c.veredicto === 'bloqueo' ? 'error' : 'warning',
      norma: c.citation.normalized,
      detail: c.mensaje + (c.alternativa ? ` Alternativa: ${c.alternativa}` : ''),
    });
  }

  // Violaciones de blacklist (siempre emitidas como check fallido)
  for (const v of report.blacklistViolations) {
    checks.push({
      name: `CN.blacklist.${v.entry.id}`,
      passed: false,
      severity: v.entry.severidad === 'MEDIA' ? 'warning' : 'error',
      norma: `Blacklist ${v.entry.severidad} — ${v.entry.categoria}`,
      detail: `${v.entry.razon}${v.entry.alternativaCorrecta ? ` Alternativa: ${v.entry.alternativaCorrecta}.` : ''}`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface ValidateFiscalResponseContext {
  readonly catalogue: NormativeCatalogue;
}

/**
 * Valida una respuesta del Agente Fiscal en todas sus capas.
 *
 * Composición:
 *   - Capa 2 (Motor Normativo) → CN.*
 *   - Módulo 2 (Conciliación)   → M2.*
 *   - Módulo 3 (Risk Score)     → M3.*
 *   - Módulo 5 (Defensa DIAN)   → M5.*
 *   - Módulo 6 (Devoluciones)   → M6.*
 *   - Módulo 7 (Formato)        → M7.*
 *
 * Los módulos M1 y M8 NO se ejecutan acá — los cubren fiscal-anchor-validators
 * y survival-validators respectivamente. El validator es robusto si un módulo
 * declarado en `response.modulos` no tiene su payload (módulo X null) — emite
 * un check de coherencia y omite el resto.
 */
export function validateFiscalResponse(
  response: FiscalResponse,
  ctx: ValidateFiscalResponseContext,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // Capa 2 — Motor Normativo (siempre primero)
  // -------------------------------------------------------------------
  checks.push(...normativeReportAChecks(response.rawText, ctx.catalogue));

  // -------------------------------------------------------------------
  // Módulo 2 — Conciliación
  // -------------------------------------------------------------------
  if (response.modulos.includes('M2')) {
    if (response.modulo2 === null) {
      checks.push({
        name: 'M2.coherencia_payload',
        passed: false,
        severity: 'error',
        norma: 'INTERNAL',
        detail: 'Módulo 2 declarado en `modulos` pero payload `modulo2` es null.',
      });
    } else {
      checks.push(...validateConciliacion(response.modulo2));
    }
  }

  // -------------------------------------------------------------------
  // Módulo 3 — Risk Score
  // -------------------------------------------------------------------
  if (response.modulos.includes('M3')) {
    if (response.modulo3 === null) {
      checks.push({
        name: 'M3.coherencia_payload',
        passed: false,
        severity: 'error',
        norma: 'INTERNAL',
        detail: 'Módulo 3 declarado en `modulos` pero payload `modulo3` es null.',
      });
    } else {
      checks.push(...validateRiskScore(response.modulo3));
    }
  }

  // -------------------------------------------------------------------
  // Módulo 5 — Defensa DIAN
  // -------------------------------------------------------------------
  if (response.modulos.includes('M5')) {
    if (response.modulo5 === null) {
      checks.push({
        name: 'M5.coherencia_payload',
        passed: false,
        severity: 'error',
        norma: 'INTERNAL',
        detail: 'Módulo 5 declarado en `modulos` pero payload `modulo5` es null.',
      });
    } else {
      checks.push(...validateDefensaDian(response.modulo5));
    }
  }

  // -------------------------------------------------------------------
  // Módulo 6 — Devoluciones
  // -------------------------------------------------------------------
  if (response.modulos.includes('M6')) {
    if (response.modulo6 === null) {
      checks.push({
        name: 'M6.coherencia_payload',
        passed: false,
        severity: 'error',
        norma: 'INTERNAL',
        detail: 'Módulo 6 declarado en `modulos` pero payload `modulo6` es null.',
      });
    } else {
      checks.push(...validateDevoluciones(response.modulo6));
    }
  }

  // -------------------------------------------------------------------
  // Módulo 7 — Formato (siempre relevante si declarado)
  // -------------------------------------------------------------------
  if (response.modulos.includes('M7')) {
    if (response.modulo7 === null) {
      checks.push({
        name: 'M7.coherencia_payload',
        passed: false,
        severity: 'error',
        norma: 'INTERNAL',
        detail: 'Módulo 7 declarado en `modulos` pero payload `modulo7` es null.',
      });
    } else {
      checks.push(...validateFormat(response.modulo7));
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Veredicto agregado (opcional helper)
// ---------------------------------------------------------------------------

export interface FiscalResponseVerdict {
  readonly veredicto: 'valida' | 'advertencia' | 'bloqueo';
  readonly totalChecks: number;
  readonly errores: number;
  readonly advertencias: number;
  readonly pasados: number;
}

/**
 * Resume un array de checks en un veredicto global:
 *   - bloqueo: hay al menos un check failed con severity 'error'.
 *   - advertencia: hay al menos un check failed con severity 'warning'.
 *   - valida: todos los checks pasaron.
 */
export function summarizeFiscalChecks(checks: readonly ValidationCheck[]): FiscalResponseVerdict {
  let errores = 0;
  let advertencias = 0;
  let pasados = 0;
  for (const c of checks) {
    if (c.passed) {
      pasados += 1;
      continue;
    }
    if (c.severity === 'error') errores += 1;
    else advertencias += 1;
  }
  let veredicto: 'valida' | 'advertencia' | 'bloqueo';
  if (errores > 0) veredicto = 'bloqueo';
  else if (advertencias > 0) veredicto = 'advertencia';
  else veredicto = 'valida';
  return {
    veredicto,
    totalChecks: checks.length,
    errores,
    advertencias,
    pasados,
  };
}
