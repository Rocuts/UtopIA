// ---------------------------------------------------------------------------
// auditoria-calidad-10 — overallScore y grade derivados en código
// ---------------------------------------------------------------------------
// El meta-auditor LLM emitía overallScore ("ponderando las 14 dimensiones" sin
// pesos definidos) y grade libres: Zod acepta {overallScore: 40, grade: 'A+'}.
// Con dimensiones en 50 y overallScore 96/A+, el Markdown decía "REQUIERE
// CORRECCIÓN" y el badge de la UI y la PDF "A+ · 96/100".
//
// Ahora overallScore = score global v2.1 (promedio de las dimensiones
// evaluadas, 0-10) × 10 y el grade sale de los cortes documentados
// (A+ ≥ 95, A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F < 60); el tope a 59 por sello
// bloqueado (auditoria-calidad-03) se conserva.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import type { QualityReportJson } from '../../contracts/quality-report';
import { buildQualityV21View } from '../v21-mapping';

vi.mock('@/lib/agents/financial/agents/runtime', () => ({ callFinancialAgent: vi.fn() }));

import { deriveQualityScore, gradeFromScore, toLegacyQualityAssessment } from '../agent';

function makeJson(dimScore: number, llm: { overallScore: number; grade: QualityReportJson['grade'] }): QualityReportJson {
  return {
    overallScore: llm.overallScore,
    grade: llm.grade,
    executiveSummary: 'Resumen.',
    dimensions: Array.from({ length: 14 }, (_, i) => ({
      name: `D${i + 1} Dimensión`, score: dimScore, framework: 'ISO 25012', findings: [], recommendations: [],
    })),
    dataQuality: { completeness: dimScore, accuracy: dimScore, consistency: dimScore, timeliness: dimScore, validity: dimScore },
    aiGovernance: { traceability: dimScore, explainability: dimScore, antiHallucination: dimScore, humanOversight: dimScore },
    ifrs18Readiness: { ready: false, score: dimScore, gaps: [] },
    priorityRecommendations: [],
    conclusion: 'Conclusión.',
  };
}

describe('auditoria-calidad-10 — el score y el grade del LLM no se publican sin validar', () => {
  it('dimensiones en 50 con "96 / A+" del LLM → 50 / F y sello "requiere corrección"', () => {
    const res = toLegacyQualityAssessment(makeJson(50, { overallScore: 96, grade: 'A+' }));
    expect(res.overallScore).toBe(50);
    expect(res.grade).toBe('F');
    expect(res.fullReport).toContain('CALIDAD REQUIERE CORRECCIÓN 1+1');
  });

  it('dimensiones en 85 con "40 / F" del LLM → 85 / B (el LLM tampoco puede rebajarlo sin base)', () => {
    const res = toLegacyQualityAssessment(makeJson(85, { overallScore: 40, grade: 'F' }));
    expect(res.overallScore).toBe(85);
    expect(res.grade).toBe('B');
    expect(res.fullReport).toContain('CALIDAD CERTIFICADA 1+1');
  });

  it('cortes documentados del grade', () => {
    const cases: Array<[number, string]> = [
      [100, 'A+'], [95, 'A+'], [94, 'A'], [90, 'A'], [89, 'B'], [80, 'B'],
      [79, 'C'], [70, 'C'], [69, 'D'], [60, 'D'], [59, 'F'], [0, 'F'],
    ];
    for (const [score, grade] of cases) expect(gradeFromScore(score), String(score)).toBe(grade);
  });

  it('el grade nunca contradice el sello: B o mejor ⇔ sello certificado (sin bloqueos)', () => {
    for (let s = 0; s <= 100; s += 1) {
      const view = buildQualityV21View(makeJson(s, { overallScore: 0, grade: 'F' }));
      const d = deriveQualityScore(view);
      expect(d.overallScore).toBe(s);
      const gradeOk = ['A+', 'A', 'B'].includes(d.grade!);
      expect(gradeOk, `score ${s}`).toBe(view.sello.type === 'certificada');
    }
  });

  it('sello bloqueado por integridad: tope 59 / F (auditoria-calidad-03 se conserva)', () => {
    const view = buildQualityV21View(makeJson(98, { overallScore: 98, grade: 'A+' }), {
      integrity: { status: 'con_bloqueantes', motivos: ['V1'] },
    });
    expect(deriveQualityScore(view)).toMatchObject({ overallScore: 59, grade: 'F', capped: true });
  });
});
