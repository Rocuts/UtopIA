// ---------------------------------------------------------------------------
// Tests — Módulo 3 · Risk Score DIAN
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  validateRiskScore,
  validateRiskScoreL1,
  validateRiskScoreL2,
  validateRiskScoreL3,
} from '../validators/risk-score.validator';
import type { Modulo3RiskScore } from '../validators/types';
import {
  RESP_RISK_SCORE_BAJO,
  RESP_RISK_SCORE_CRITICO,
} from '../__fixtures__/respuestas-prueba.fixture';

const M3_BAJO = RESP_RISK_SCORE_BAJO.modulo3 as Modulo3RiskScore;
const M3_CRITICO = RESP_RISK_SCORE_CRITICO.modulo3 as Modulo3RiskScore;

function findCheck(checks: ReturnType<typeof validateRiskScore>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Risk Score Validator — L1 Aritmética', () => {
  it('M3.L1.1: score 15 está en rango [0, 100]', () => {
    const checks = validateRiskScoreL1(M3_BAJO);
    const c = findCheck(checks, 'M3.L1.1_score_rango');
    expect(c?.passed).toBe(true);
  });

  it('M3.L1.1: score 150 fuera de rango', () => {
    const bad: Modulo3RiskScore = { ...M3_BAJO, score: 150 };
    const checks = validateRiskScoreL1(bad);
    const c = findCheck(checks, 'M3.L1.1_score_rango');
    expect(c?.passed).toBe(false);
  });

  it('M3.L1.2: factor 1 = 35 (excede max 30) detecta error', () => {
    const bad: Modulo3RiskScore = { ...M3_BAJO, factor1_tetVsSector: 35 };
    const checks = validateRiskScoreL1(bad);
    const c = findCheck(checks, 'M3.L1.2_factor1_tetVsSector_rango');
    expect(c?.passed).toBe(false);
  });

  it('M3.L1.3: score = suma exacta de factores en fixture BAJO', () => {
    const checks = validateRiskScoreL1(M3_BAJO);
    const c = findCheck(checks, 'M3.L1.3_score_suma_factores');
    expect(c?.passed).toBe(true);
  });

  it('M3.L1.3: detecta suma incorrecta de factores', () => {
    const bad: Modulo3RiskScore = { ...M3_BAJO, score: 99 }; // suma es 15
    const checks = validateRiskScoreL1(bad);
    const c = findCheck(checks, 'M3.L1.3_score_suma_factores');
    expect(c?.passed).toBe(false);
  });
});

describe('Risk Score Validator — L2 Lógica de negocio', () => {
  it('M3.L2.1: interpretación BAJO coherente con score 15', () => {
    const checks = validateRiskScoreL2(M3_BAJO);
    const c = findCheck(checks, 'M3.L2.1_interpretacion_coherente');
    expect(c?.passed).toBe(true);
  });

  it('M3.L2.1: interpretación CRITICO con score 30 es incoherente', () => {
    const bad: Modulo3RiskScore = {
      ...M3_BAJO,
      score: 30,
      // ajustamos factores para que sume 30
      factor1_tetVsSector: 10,
      factor2_rentaPresuntiva: 10,
      factor3_proporcionDeducciones: 5,
      factor4_consistenciaIVA: 3,
      factor5_historicoSanciones: 2,
      interpretacion: 'CRITICO',
    };
    const checks = validateRiskScoreL2(bad);
    const c = findCheck(checks, 'M3.L2.1_interpretacion_coherente');
    expect(c?.passed).toBe(false);
  });

  it('M3.L2.2: TET 7.2% < 15% requiere Factor 1 ≥ 20 (caso CRITICO pasa)', () => {
    const checks = validateRiskScoreL2(M3_CRITICO);
    const c = findCheck(checks, 'M3.L2.2_factor1_coherencia_tet_baja');
    expect(c?.passed).toBe(true);
  });

  it('M3.L2.2: TET 5% pero Factor 1 = 10 → falla', () => {
    const bad: Modulo3RiskScore = {
      ...M3_CRITICO,
      tetActualPct: 5,
      factor1_tetVsSector: 10,
      score: 10 + 22 + 18 + 12 + 5, // recomputado para no fallar L1.3
    };
    const checks = validateRiskScoreL2(bad);
    const c = findCheck(checks, 'M3.L2.2_factor1_coherencia_tet_baja');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('Inconsistente');
  });
});

describe('Risk Score Validator — L3 Defensa tributaria', () => {
  it('M3.L3.1: score 85 + Modo Supervivencia ACTIVO pasa', () => {
    const checks = validateRiskScoreL3(M3_CRITICO);
    const c = findCheck(checks, 'M3.L3.1_modo_supervivencia_score_alto');
    expect(c?.passed).toBe(true);
  });

  it('M3.L3.1: score 70 sin Modo Supervivencia activo falla', () => {
    const bad: Modulo3RiskScore = {
      ...M3_CRITICO,
      score: 70,
      factor1_tetVsSector: 25,
      factor2_rentaPresuntiva: 20,
      factor3_proporcionDeducciones: 15,
      factor4_consistenciaIVA: 7,
      factor5_historicoSanciones: 3,
      interpretacion: 'MUY_ALTO',
      modoSupervivenciaActivo: false,
    };
    const checks = validateRiskScoreL3(bad);
    const c = findCheck(checks, 'M3.L3.1_modo_supervivencia_score_alto');
    expect(c?.passed).toBe(false);
  });

  it('M3.L3.1: score 50 NO requiere Modo Supervivencia', () => {
    const ok: Modulo3RiskScore = {
      score: 50,
      factor1_tetVsSector: 20,
      factor2_rentaPresuntiva: 15,
      factor3_proporcionDeducciones: 10,
      factor4_consistenciaIVA: 3,
      factor5_historicoSanciones: 2,
      interpretacion: 'ALTO',
      modoSupervivenciaActivo: false,
      tetActualPct: 18,
    };
    const checks = validateRiskScoreL3(ok);
    const c = findCheck(checks, 'M3.L3.1_modo_supervivencia_score_alto');
    expect(c?.passed).toBe(true);
  });
});

describe('Risk Score Validator — Entry point composite', () => {
  it('validateRiskScore corre L1 + L2 + L3', () => {
    const all = validateRiskScore(M3_CRITICO);
    expect(all.some((c) => c.name.startsWith('M3.L1.'))).toBe(true);
    expect(all.some((c) => c.name.startsWith('M3.L2.'))).toBe(true);
    expect(all.some((c) => c.name.startsWith('M3.L3.'))).toBe(true);
  });
});
