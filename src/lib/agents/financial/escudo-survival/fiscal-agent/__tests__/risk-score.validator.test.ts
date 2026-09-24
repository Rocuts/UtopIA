// ---------------------------------------------------------------------------
// Tests — Módulo 3 · Risk Score DIAN
// ---------------------------------------------------------------------------
// Fase 2 de la auditoría 2026-09-24 (pendiente #8): el contrato anterior
// probaba una fórmula de cinco factores («TET vs sector», «renta presuntiva»,
// «consistencia IVA», umbral TET 15% ⇒ factor 1 ≥ 20) que el agente nunca
// produjo. Estas pruebas validan el Score que se publica: los siete factores
// de `computeRiskScore`, su publicabilidad y la prosa del modelo que lo cita.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';

import {
  scoresCitadosEnProsa,
  validateRiskScore,
  validateRiskScoreL1,
  validateRiskScoreL2,
  validateRiskScoreL3,
} from '../validators/risk-score.validator';
import type { Modulo3RiskScore } from '../validators/types';
import { RESP_RISK_SCORE_BAJO, RESP_RISK_SCORE_CRITICO } from '../__fixtures__/respuestas-prueba.fixture';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { buildFiscalAnchor } from '../../fiscal-anchor';
import { computeRiskScore } from '../tools/risk-score-calculator';

const M3_BAJO = RESP_RISK_SCORE_BAJO.modulo3 as Modulo3RiskScore;
const M3_CRITICO = RESP_RISK_SCORE_CRITICO.modulo3 as Modulo3RiskScore;

function findCheck(checks: ReturnType<typeof validateRiskScore>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Risk Score Validator — L1 Aritmética', () => {
  it('M3.L1.1: score 15 está en rango', () => {
    expect(findCheck(validateRiskScoreL1(M3_BAJO), 'M3.L1.1_score_rango')?.passed).toBe(true);
  });

  it('M3.L1.1: score 150 o fraccionario fuera de contrato', () => {
    expect(findCheck(validateRiskScoreL1({ ...M3_BAJO, score: 150 }), 'M3.L1.1_score_rango')?.passed).toBe(false);
    expect(findCheck(validateRiskScoreL1({ ...M3_BAJO, score: 15.5 }), 'M3.L1.1_score_rango')?.passed).toBe(false);
  });

  it('M3.L1.2: tet_baja = 35 excede su máximo (30)', () => {
    const bad: Modulo3RiskScore = {
      ...M3_BAJO,
      factores: M3_BAJO.factores.map((f) => (f.factor === 'tet_baja' ? { ...f, puntos: 35 } : f)),
    };
    expect(findCheck(validateRiskScoreL1(bad), 'M3.L1.2_tet_baja_rango')?.passed).toBe(false);
  });

  it('M3.L1.2: el factor de saldo a favor no puede sumar puntos (F04 no es saldo a favor)', () => {
    const bad: Modulo3RiskScore = {
      ...M3_BAJO,
      factores: M3_BAJO.factores.map((f) => (f.factor === 'saldo_favor_sin_solicitar' ? { ...f, puntos: 10 } : f)),
    };
    expect(findCheck(validateRiskScoreL1(bad), 'M3.L1.2_saldo_favor_sin_solicitar_rango')?.passed).toBe(false);
  });

  it('M3.L1.2: un factor ajeno al modelo determinista falla', () => {
    const bad: Modulo3RiskScore = { ...M3_BAJO, factores: [...M3_BAJO.factores, { factor: 'renta_presuntiva', puntos: 0 }] };
    expect(findCheck(validateRiskScoreL1(bad), 'M3.L1.2_renta_presuntiva_rango')?.passed).toBe(false);
  });

  it('M3.L1.3: score = min(100, Σ factores)', () => {
    expect(findCheck(validateRiskScoreL1(M3_BAJO), 'M3.L1.3_score_suma_factores')?.passed).toBe(true);
    expect(findCheck(validateRiskScoreL1({ ...M3_BAJO, score: 20 }), 'M3.L1.3_score_suma_factores')?.passed).toBe(false);
  });
});

describe('Risk Score Validator — L2 Coherencia de lo publicado', () => {
  it('M3.L2.1: nivel coherente con el score', () => {
    expect(findCheck(validateRiskScoreL2(M3_BAJO), 'M3.L2.1_nivel_coherente')?.passed).toBe(true);
    expect(findCheck(validateRiskScoreL2({ ...M3_BAJO, nivel: 'critico' }), 'M3.L2.1_nivel_coherente')?.passed).toBe(false);
  });

  it('M3.L2.2: F01 = 0 exige score no publicable con motivo', () => {
    const cero = { ...M3_BAJO, f01Cents: '0' };
    expect(findCheck(validateRiskScoreL2(cero), 'M3.L2.2_publicabilidad_coherente')?.passed).toBe(false);
    const ok = { ...cero, publicable: false, noPublicableMotivo: 'Sin base gravable.', narrativa: 'Score no determinable.' };
    expect(findCheck(validateRiskScoreL2(ok), 'M3.L2.2_publicabilidad_coherente')?.passed).toBe(true);
    const sinMotivo = { ...ok, noPublicableMotivo: null };
    expect(findCheck(validateRiskScoreL2(sinMotivo), 'M3.L2.2_publicabilidad_coherente')?.passed).toBe(false);
  });

  it('M3.L2.3: la prosa no puede citar un score distinto', () => {
    const bad = { ...M3_BAJO, narrativa: 'Score global 72/100: riesgo muy alto.' };
    const c = findCheck(validateRiskScoreL2(bad), 'M3.L2.3_narrativa_cita_score_determinista');
    expect(c?.passed).toBe(false);
    expect(c?.detail).toContain('72/100');
  });

  it('M3.L2.3: score no publicable ⇒ la prosa no cita «0/100»', () => {
    const noPub = {
      ...M3_BAJO,
      score: 0,
      factores: [],
      f01Cents: '0',
      publicable: false,
      noPublicableMotivo: 'Sin base gravable.',
      narrativa: 'Score 0/100 — riesgo bajo.',
    };
    expect(findCheck(validateRiskScoreL2(noPub), 'M3.L2.3_narrativa_cita_score_determinista')?.passed).toBe(false);
  });

  it('scoresCitadosEnProsa ignora porcentajes y leyes', () => {
    expect(scoresCitadosEnProsa('Score 45/100; Ley 1625/100? no; 20 de 100 % no')).toEqual([45]);
    expect(scoresCitadosEnProsa('Decreto 1625/2016 y Art. 100')).toEqual([]);
  });
});

describe('Risk Score Validator — L3 Modo Supervivencia', () => {
  it('score 85 con Modo Supervivencia activo pasa', () => {
    expect(findCheck(validateRiskScoreL3(M3_CRITICO), 'M3.L3.1_modo_supervivencia_score_alto')?.passed).toBe(true);
  });

  it('score 85 sin Módulo 8 ni recomendación falla', () => {
    const bad = { ...M3_CRITICO, modoSupervivenciaActivo: null, narrativa: 'Score 85/100.', recomendaciones: [] };
    const c = findCheck(validateRiskScoreL3(bad), 'M3.L3.1_modo_supervivencia_score_alto');
    expect(c?.passed).toBe(false);
    expect(c?.severity).toBe('error');
  });

  it('score 85 fuera del modo supervivencia pasa si lo recomienda', () => {
    const ok = { ...M3_CRITICO, modoSupervivenciaActivo: null };
    expect(findCheck(validateRiskScoreL3(ok), 'M3.L3.1_modo_supervivencia_score_alto')?.passed).toBe(true);
  });
});

describe('Risk Score Validator — contra computeRiskScore real', () => {
  it('el breakdown determinista cumple todos los invariantes L1/L2', () => {
    const CSV = `codigo,nombre,nivel,transaccional,Saldo 2025
110505,Caja general,Auxiliar,1,18000000
135515,Retencion en la fuente,Auxiliar,1,20000000
413550,Comercio al por mayor y al por menor,Auxiliar,1,1240000000
613550,Costo de venta de mercancias,Auxiliar,1,760000000
510506,Sueldos de personal administrativo,Auxiliar,1,158000000
540505,Impuesto de renta y complementarios,Auxiliar,1,30000000
`;
    const p = preprocessTrialBalance(parseTrialBalanceCSV(CSV));
    const anchor = buildFiscalAnchor({ preprocessed: p, company: { name: 'X' }, hoy: new Date('2026-09-23T12:00:00Z') });
    const b = computeRiskScore({ anchor, preprocessed: p });
    const m3: Modulo3RiskScore = {
      score: b.score,
      nivel: b.nivel,
      factores: b.factores,
      publicable: b.publicable,
      noPublicableMotivo: b.noPublicableMotivo,
      f01Cents: anchor.f01,
      narrativa: `Score ${b.score}/100.`,
      recomendaciones: ['Activar Modo Supervivencia Élite (Módulo 8) si el score supera 60.'],
      modoSupervivenciaActivo: null,
    };
    const fallidos = validateRiskScore(m3).filter((c) => !c.passed);
    expect(fallidos).toEqual([]);
  });
});
