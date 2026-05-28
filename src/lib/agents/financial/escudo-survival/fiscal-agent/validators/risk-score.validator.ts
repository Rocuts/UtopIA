// ---------------------------------------------------------------------------
// EL ESCUDO — Capa 4 (Agente Fiscal) — Módulo 3 · Risk Score DIAN
// ---------------------------------------------------------------------------
//
// Elite Protocol 3 capas para el Risk Score DIAN (0-100):
//
//   L1 — Aritmética
//        L1.1 score ∈ [0, 100]
//        L1.2 factor1 ∈ [0, 30], factor2 ∈ [0, 25], factor3 ∈ [0, 20],
//             factor4 ∈ [0, 15], factor5 ∈ [0, 10]
//        L1.3 score = suma exacta de factores
//
//   L2 — Lógica de negocio
//        L2.1 interpretación coherente con score
//        L2.2 TET < 15% (Art. 240 → tarifa nominal 35%) → Factor 1 ≥ 20
//
//   L3 — Defensa tributaria
//        L3.1 score > 60 → modoSupervivenciaActivo === true
//             (Módulo 8: el output debe declararlo explícitamente)
//
// Cero LLM. Cero red. Cero filesystem. Solo TypeScript + Math.
// ---------------------------------------------------------------------------

import type { Modulo3RiskScore, ValidationCheck } from './types';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const RANGO_FACTOR_1 = { min: 0, max: 30 } as const;
const RANGO_FACTOR_2 = { min: 0, max: 25 } as const;
const RANGO_FACTOR_3 = { min: 0, max: 20 } as const;
const RANGO_FACTOR_4 = { min: 0, max: 15 } as const;
const RANGO_FACTOR_5 = { min: 0, max: 10 } as const;

/** Umbral TET 2026 — por debajo de 15% el riesgo de cruce DIAN escala. */
const UMBRAL_TET_RIESGO_PCT = 15;

/** Factor 1 mínimo cuando TET < umbral. */
const FACTOR_1_MIN_TET_BAJA = 20;

/** Umbral activación Modo Supervivencia (Módulo 8). */
const UMBRAL_MODO_SUPERVIVENCIA = 60;

// Intervalos de interpretación
const INTERPRETACIONES: ReadonlyArray<{
  readonly min: number;
  readonly max: number;
  readonly label: Modulo3RiskScore['interpretacion'];
}> = [
  { min: 0, max: 20, label: 'BAJO' },
  { min: 21, max: 40, label: 'MEDIO' },
  { min: 41, max: 60, label: 'ALTO' },
  { min: 61, max: 80, label: 'MUY_ALTO' },
  { min: 81, max: 100, label: 'CRITICO' },
];

function interpretacionEsperada(score: number): Modulo3RiskScore['interpretacion'] | null {
  for (const i of INTERPRETACIONES) {
    if (score >= i.min && score <= i.max) return i.label;
  }
  return null;
}

function dentroRango(v: number, rango: { min: number; max: number }): boolean {
  return Number.isFinite(v) && v >= rango.min && v <= rango.max;
}

// ---------------------------------------------------------------------------
// CAPA 1 — Aritmética
// ---------------------------------------------------------------------------

export function validateRiskScoreL1(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L1.1 — score ∈ [0, 100]
  // -------------------------------------------------------------------
  {
    const ok = Number.isFinite(m3.score) && m3.score >= 0 && m3.score <= 100;
    checks.push({
      name: 'M3.L1.1_score_rango',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? `Score ${m3.score} ∈ [0, 100].`
        : `Score ${m3.score} fuera de [0, 100].`,
    });
  }

  // -------------------------------------------------------------------
  // L1.2 — cada factor en su rango
  // -------------------------------------------------------------------
  const factoresInfo: ReadonlyArray<{
    readonly name: string;
    readonly value: number;
    readonly rango: { min: number; max: number };
  }> = [
    { name: 'factor1_tetVsSector', value: m3.factor1_tetVsSector, rango: RANGO_FACTOR_1 },
    { name: 'factor2_rentaPresuntiva', value: m3.factor2_rentaPresuntiva, rango: RANGO_FACTOR_2 },
    { name: 'factor3_proporcionDeducciones', value: m3.factor3_proporcionDeducciones, rango: RANGO_FACTOR_3 },
    { name: 'factor4_consistenciaIVA', value: m3.factor4_consistenciaIVA, rango: RANGO_FACTOR_4 },
    { name: 'factor5_historicoSanciones', value: m3.factor5_historicoSanciones, rango: RANGO_FACTOR_5 },
  ];

  for (const f of factoresInfo) {
    const ok = dentroRango(f.value, f.rango);
    checks.push({
      name: `M3.L1.2_${f.name}_rango`,
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? `${f.name} = ${f.value} ∈ [${f.rango.min}, ${f.rango.max}].`
        : `${f.name} = ${f.value} fuera de [${f.rango.min}, ${f.rango.max}].`,
    });
  }

  // -------------------------------------------------------------------
  // L1.3 — score = suma exacta de factores
  // -------------------------------------------------------------------
  {
    const suma =
      m3.factor1_tetVsSector +
      m3.factor2_rentaPresuntiva +
      m3.factor3_proporcionDeducciones +
      m3.factor4_consistenciaIVA +
      m3.factor5_historicoSanciones;
    const ok = Math.abs(suma - m3.score) < 1e-9;
    checks.push({
      name: 'M3.L1.3_score_suma_factores',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? `Score ${m3.score} = ${m3.factor1_tetVsSector}+${m3.factor2_rentaPresuntiva}+${m3.factor3_proporcionDeducciones}+${m3.factor4_consistenciaIVA}+${m3.factor5_historicoSanciones} = ${suma}.`
        : `Score reportado ${m3.score} ≠ suma de factores ${suma} (diff ${Math.abs(suma - m3.score)}).`,
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 2 — Lógica de negocio
// ---------------------------------------------------------------------------

export function validateRiskScoreL2(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L2.1 — interpretación coherente con score
  // -------------------------------------------------------------------
  {
    const esperada = interpretacionEsperada(m3.score);
    const ok = esperada !== null && esperada === m3.interpretacion;
    checks.push({
      name: 'M3.L2.1_interpretacion_coherente',
      passed: ok,
      severity: 'error',
      norma: 'INTERNAL',
      detail: ok
        ? `Interpretación ${m3.interpretacion} coincide con score ${m3.score} (rango esperado para ${esperada}).`
        : `Interpretación reportada ${m3.interpretacion} ≠ esperada ${esperada ?? 'N/A'} para score ${m3.score}. Rangos: BAJO 0-20, MEDIO 21-40, ALTO 41-60, MUY_ALTO 61-80, CRITICO 81-100.`,
    });
  }

  // -------------------------------------------------------------------
  // L2.2 — TET < 15% → Factor 1 ≥ 20
  //
  // Why: si la TET (F09) del cliente está significativamente por debajo
  // del 35% nominal, el algoritmo de selección DIAN incrementa la
  // probabilidad de cruce de información. El Factor 1 debe reflejarlo.
  // -------------------------------------------------------------------
  {
    if (m3.tetActualPct < UMBRAL_TET_RIESGO_PCT) {
      const ok = m3.factor1_tetVsSector >= FACTOR_1_MIN_TET_BAJA;
      checks.push({
        name: 'M3.L2.2_factor1_coherencia_tet_baja',
        passed: ok,
        severity: 'error',
        norma: 'INTERNAL',
        detail: ok
          ? `TET ${m3.tetActualPct.toFixed(1)}% < ${UMBRAL_TET_RIESGO_PCT}% y Factor 1 = ${m3.factor1_tetVsSector} ≥ ${FACTOR_1_MIN_TET_BAJA} — coherente.`
          : `TET ${m3.tetActualPct.toFixed(1)}% < ${UMBRAL_TET_RIESGO_PCT}% pero Factor 1 = ${m3.factor1_tetVsSector} < ${FACTOR_1_MIN_TET_BAJA}. Inconsistente: TET baja debe disparar riesgo TET-vs-sector.`,
      });
    } else {
      checks.push({
        name: 'M3.L2.2_factor1_coherencia_tet_baja',
        passed: true,
        severity: 'warning',
        norma: 'INTERNAL',
        detail: `TET ${m3.tetActualPct.toFixed(1)}% ≥ ${UMBRAL_TET_RIESGO_PCT}% — check Factor 1 no aplica.`,
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// CAPA 3 — Defensa tributaria
// ---------------------------------------------------------------------------

export function validateRiskScoreL3(m3: Modulo3RiskScore): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // -------------------------------------------------------------------
  // L3.1 — score > 60 → Modo Supervivencia activado
  // -------------------------------------------------------------------
  {
    if (m3.score > UMBRAL_MODO_SUPERVIVENCIA) {
      const ok = m3.modoSupervivenciaActivo === true;
      checks.push({
        name: 'M3.L3.1_modo_supervivencia_score_alto',
        passed: ok,
        severity: 'error',
        norma: 'Capa 4 Módulo 8 — Modo Supervivencia',
        detail: ok
          ? `Score ${m3.score} > ${UMBRAL_MODO_SUPERVIVENCIA} y Modo Supervivencia activo — protocolo de mitigación operativo.`
          : `Score ${m3.score} > ${UMBRAL_MODO_SUPERVIVENCIA} pero Modo Supervivencia NO activo. El protocolo Módulo 8 debe declararse para limitar exposición a Art. 647 E.T.`,
      });
    } else {
      checks.push({
        name: 'M3.L3.1_modo_supervivencia_score_alto',
        passed: true,
        severity: 'warning',
        norma: 'Capa 4 Módulo 8',
        detail: `Score ${m3.score} ≤ ${UMBRAL_MODO_SUPERVIVENCIA} — Modo Supervivencia no requerido.`,
      });
    }
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
