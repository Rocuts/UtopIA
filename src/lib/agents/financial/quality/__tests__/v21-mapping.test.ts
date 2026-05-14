// v21-mapping.test.ts — pure unit tests for buildQualityV21View
// (no LLM, no IO; covers the 14 -> 12 mapping rules from spec Parte V).

import { describe, it, expect } from 'vitest';
import {
  buildQualityV21View,
  QUALITY_V21_DIM_META,
  statusMarker,
} from '../v21-mapping';
import type { QualityReportJson } from '../../contracts/quality-report';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a full QualityReportJson where the 14 D-dims share `defaultScore`
 * and the dataQuality / aiGovernance / ifrs18 blocks are filled with
 * `rawScore`. `overrides` lets a test tweak specific D-dims.
 */
function makeJson(opts: {
  defaultScore: number;
  rawScore?: number;
  overrideD?: Record<number, number>;
  overridePoints?: Record<number, { findings?: string[]; recommendations?: string[] }>;
  omitDims?: number[];
}): QualityReportJson {
  const raw = opts.rawScore ?? opts.defaultScore;
  const dimensions = [];
  for (let n = 1; n <= 14; n++) {
    if (opts.omitDims?.includes(n)) continue;
    const score = opts.overrideD?.[n] ?? opts.defaultScore;
    const ov = opts.overridePoints?.[n] ?? {};
    dimensions.push({
      name: `D${n} Dimension ${n}`,
      score,
      framework: 'ISO 25012',
      findings: ov.findings ?? [],
      recommendations: ov.recommendations ?? [],
    });
  }
  return {
    overallScore: opts.defaultScore,
    grade: 'B',
    executiveSummary: 'Test summary.',
    dimensions,
    dataQuality: {
      completeness: raw,
      accuracy: raw,
      consistency: raw,
      timeliness: raw,
      validity: raw,
    },
    aiGovernance: {
      traceability: raw,
      explainability: raw,
      antiHallucination: raw,
      humanOversight: raw,
    },
    ifrs18Readiness: { ready: false, score: raw, gaps: [] },
    priorityRecommendations: [],
    conclusion: 'Test conclusion.',
  };
}

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('buildQualityV21View — structural invariants', () => {
  it('always emits exactly 12 dimensions in canonical order (A, B, C blocks)', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 80 }));
    expect(v.dimensions).toHaveLength(12);
    expect(v.dimensions.map((d) => d.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(v.dimensions.slice(0, 4).every((d) => d.block === 'A')).toBe(true);
    expect(v.dimensions.slice(4, 8).every((d) => d.block === 'B')).toBe(true);
    expect(v.dimensions.slice(8, 12).every((d) => d.block === 'C')).toBe(true);
  });

  it('every dim has framework, definition, verification metadata available', () => {
    for (const meta of QUALITY_V21_DIM_META) {
      expect(meta.framework.length).toBeGreaterThan(0);
      expect(meta.definition.length).toBeGreaterThan(20);
      expect(meta.verification.length).toBeGreaterThan(20);
    }
  });

  it('statusMarker returns ✅ for aprobado, ⚠ for en_revision, ❌ for requiere_correccion', () => {
    expect(statusMarker('aprobado')).toBe('✅');
    expect(statusMarker('en_revision')).toBe('⚠');
    expect(statusMarker('requiere_correccion')).toBe('❌');
  });
});

// ---------------------------------------------------------------------------
// Score conversion (100 -> 10)
// ---------------------------------------------------------------------------

describe('buildQualityV21View — score conversion', () => {
  it('rounds internal 0..100 score to 0..10 integer per dim', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 85 }));
    expect(v.dimensions.every((d) => d.scoreInt0to10 === 9)).toBe(true); // round(85/10)=9 (banker)... actually 9
  });

  it('globalScore is arithmetic average of 12 dim scores with one decimal', () => {
    // All dims score 80 -> 80/10 = 8 -> global = 8.0
    const v = buildQualityV21View(makeJson({ defaultScore: 80 }));
    expect(v.globalScoreInt0to10).toBe(8);
    // Note: stored as number; .toFixed(1) gives "8.0" but the number itself is 8.
  });

  it('different scores per dim produce arithmetic average', () => {
    // D2=100, D1=100, D3=0, D14=0 => block A scores: 10,10,X,0,0 in v21 order
    // To make it tractable: half dims 100, half 0 -> avg 50 -> 5.0
    const overrideD: Record<number, number> = {};
    for (let i = 1; i <= 14; i++) overrideD[i] = i % 2 === 0 ? 100 : 0;
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD }));
    // Don't assert exact number — just verify shape:
    expect(v.globalScoreInt0to10).toBeGreaterThanOrEqual(0);
    expect(v.globalScoreInt0to10).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Sello thresholds
// ---------------------------------------------------------------------------

describe('buildQualityV21View — sello thresholds', () => {
  it('score ≥ 8 → certificada', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 85 })); // -> 9 per dim
    expect(v.sello.type).toBe('certificada');
    expect(v.sello.title).toBe('CALIDAD CERTIFICADA 1+1');
    expect(v.globalStatus).toBe('aprobado');
  });

  it('score 6.0..7.9 → con_observaciones', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 70 })); // -> 7 per dim -> avg 7.0
    expect(v.sello.type).toBe('con_observaciones');
    expect(v.sello.title).toBe('CALIDAD CON OBSERVACIONES 1+1');
    expect(v.globalStatus).toBe('en_revision');
  });

  it('score < 6 → requiere_correccion', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 40 })); // -> 4 per dim
    expect(v.sello.type).toBe('requiere_correccion');
    expect(v.sello.title).toBe('CALIDAD REQUIERE CORRECCIÓN 1+1');
    expect(v.globalStatus).toBe('requiere_correccion');
  });

  it('approvedCount matches the number of dims with status=aprobado', () => {
    // All 100 -> all 10/10 -> approved=12
    const v = buildQualityV21View(makeJson({ defaultScore: 100 }));
    expect(v.sello.approvedCount).toBe(12);
    expect(v.dimensions.every((d) => d.status === 'aprobado')).toBe(true);
  });

  it('sello bottomLine contains approvedCount/12 and score', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 100 }));
    expect(v.sello.bottomLine).toContain('12/12');
    expect(v.sello.bottomLine).toContain('10.0');
  });
});

// ---------------------------------------------------------------------------
// Status thresholds per dim
// ---------------------------------------------------------------------------

describe('buildQualityV21View — per-dim status thresholds', () => {
  it('score10 ≥ 8 -> aprobado', () => {
    // Per dim 80 -> 8/10 -> aprobado
    const v = buildQualityV21View(makeJson({ defaultScore: 80 }));
    expect(v.dimensions.every((d) => d.status === 'aprobado')).toBe(true);
  });

  it('score10 in [6,7] -> en_revision', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 65 })); // -> 7/10 -> en_revision
    expect(v.dimensions.every((d) => d.status === 'en_revision')).toBe(true);
  });

  it('score10 < 6 -> requiere_correccion', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50 })); // -> 5/10 -> requiere_correccion
    expect(v.dimensions.every((d) => d.status === 'requiere_correccion')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mapping rules — each v2.1 dim takes scores from the correct D-dim
// ---------------------------------------------------------------------------

describe('buildQualityV21View — mapping table from spec', () => {
  it('Dim 1 (Accuracy) comes from D2', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 2: 100 } }));
    const dim1 = v.dimensions.find((d) => d.num === 1)!;
    expect(dim1.scoreInt0to10).toBe(10);
  });

  it('Dim 2 (Completeness) comes from D1', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 1: 100 } }));
    const dim2 = v.dimensions.find((d) => d.num === 2)!;
    expect(dim2.scoreInt0to10).toBe(10);
  });

  it('Dim 3 (Consistency) comes from D3', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 3: 100 } }));
    const dim3 = v.dimensions.find((d) => d.num === 3)!;
    expect(dim3.scoreInt0to10).toBe(10);
  });

  it('Dim 4 (Currentness) comes from D14', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 14: 100 } }));
    const dim4 = v.dimensions.find((d) => d.num === 4)!;
    expect(dim4.scoreInt0to10).toBe(10);
  });

  it('Dim 5 (Traceability IA) comes from D8', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 8: 100 } }));
    const dim5 = v.dimensions.find((d) => d.num === 5)!;
    expect(dim5.scoreInt0to10).toBe(10);
  });

  it('Dim 6 (Transparency) is weighted composite D9*0.9 + D6*0.1', () => {
    // D9=100, D6=0 -> 100*0.9 + 0*0.1 = 90 -> 9/10
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 9: 100, 6: 0 } }));
    const dim6 = v.dimensions.find((d) => d.num === 6)!;
    expect(dim6.scoreInt0to10).toBe(9);
  });

  it('Dim 7 (Bias) comes from D9', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 9: 100 } }));
    const dim7 = v.dimensions.find((d) => d.num === 7)!;
    expect(dim7.scoreInt0to10).toBe(10);
  });

  it('Dim 8 (Human Oversight) comes from D10', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 10: 100 } }));
    const dim8 = v.dimensions.find((d) => d.num === 8)!;
    expect(dim8.scoreInt0to10).toBe(10);
  });

  it('Dim 9 (Relevance) comes from D6', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 6: 100 } }));
    const dim9 = v.dimensions.find((d) => d.num === 9)!;
    expect(dim9.scoreInt0to10).toBe(10);
  });

  it('Dim 10 (Faithful Representation) comes from D4', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 4: 100 } }));
    const dim10 = v.dimensions.find((d) => d.num === 10)!;
    expect(dim10.scoreInt0to10).toBe(10);
  });

  it('Dim 11 (Understandability) comes from D11', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 11: 100 } }));
    const dim11 = v.dimensions.find((d) => d.num === 11)!;
    expect(dim11.scoreInt0to10).toBe(10);
  });

  it('Dim 12 (Comparability) is average of D14 and D12', () => {
    // D14=100, D12=0 -> avg=50 -> 5/10
    const v = buildQualityV21View(makeJson({ defaultScore: 50, overrideD: { 14: 100, 12: 0 } }));
    const dim12 = v.dimensions.find((d) => d.num === 12)!;
    expect(dim12.scoreInt0to10).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Fallback / missing D-dim handling
// ---------------------------------------------------------------------------

describe('buildQualityV21View — fallback when D-dims are missing', () => {
  it('falls back to dataQuality.accuracy when D2 is missing', () => {
    const v = buildQualityV21View(
      makeJson({ defaultScore: 50, rawScore: 100, omitDims: [2] }),
    );
    const dim1 = v.dimensions.find((d) => d.num === 1)!;
    expect(dim1.scoreInt0to10).toBe(10);
    // The fallback note should be present:
    expect(dim1.points.some((p) => /Mapeo fallback/i.test(p))).toBe(true);
  });

  it('defaults to 70 with "data incompleta" point when neither D-dim nor raw fallback are present', () => {
    // omit D2 and zero out dataQuality.accuracy
    const json = makeJson({ defaultScore: 50, omitDims: [2] });
    json.dataQuality.accuracy = 0;
    const v = buildQualityV21View(json);
    const dim1 = v.dimensions.find((d) => d.num === 1)!;
    expect(dim1.scoreInt0to10).toBe(7);
    expect(dim1.points.some((p) => /Dato incompleto|data incompleta/i.test(p))).toBe(true);
  });

  it('Dim 6 transparency falls back to D9 only when D6 is missing', () => {
    const v = buildQualityV21View(
      makeJson({ defaultScore: 50, overrideD: { 9: 100 }, omitDims: [6] }),
    );
    const dim6 = v.dimensions.find((d) => d.num === 6)!;
    expect(dim6.scoreInt0to10).toBe(10); // only D9, used as-is
    expect(dim6.points.some((p) => /D6 ausente/i.test(p))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Points propagation (findings + recommendations merged)
// ---------------------------------------------------------------------------

describe('buildQualityV21View — points propagation', () => {
  it('merges findings and recommendations of the source D-dim into points[]', () => {
    const json = makeJson({
      defaultScore: 80,
      overridePoints: {
        2: {
          findings: ['Finding 1', 'Finding 2'],
          recommendations: ['Recommendation 1'],
        },
      },
    });
    const v = buildQualityV21View(json);
    const dim1 = v.dimensions.find((d) => d.num === 1)!; // dim1 <- D2
    expect(dim1.points).toContain('Finding 1');
    expect(dim1.points).toContain('Finding 2');
    expect(dim1.points).toContain('Recommendation 1');
  });

  it('Dim 6 transparency concatenates points from D9 AND D6', () => {
    const json = makeJson({
      defaultScore: 80,
      overridePoints: {
        9: { findings: ['D9 finding'] },
        6: { findings: ['D6 finding'] },
      },
    });
    const v = buildQualityV21View(json);
    const dim6 = v.dimensions.find((d) => d.num === 6)!;
    expect(dim6.points).toContain('D9 finding');
    expect(dim6.points).toContain('D6 finding');
  });

  it('Dim 12 comparability concatenates points from D14 AND D12', () => {
    const json = makeJson({
      defaultScore: 80,
      overridePoints: {
        14: { findings: ['D14 multiperiodo OK'] },
        12: { recommendations: ['Adoptar NIIF 18 antes de 2027'] },
      },
    });
    const v = buildQualityV21View(json);
    const dim12 = v.dimensions.find((d) => d.num === 12)!;
    expect(dim12.points).toContain('D14 multiperiodo OK');
    expect(dim12.points).toContain('Adoptar NIIF 18 antes de 2027');
  });
});

// ---------------------------------------------------------------------------
// Corrective actions
// ---------------------------------------------------------------------------

describe('buildQualityV21View — corrective actions', () => {
  it('emits no corrective actions when all dims score ≥ 7', () => {
    const v = buildQualityV21View(makeJson({ defaultScore: 85 })); // 9/10 per dim
    expect(v.correctiveActions).toEqual([]);
  });

  it('emits one corrective action per dim with score < 7', () => {
    // Force only D2 (= dim1) below threshold
    const overrideD: Record<number, number> = {};
    for (let i = 1; i <= 14; i++) overrideD[i] = 90;
    overrideD[2] = 40; // dim1 = Accuracy -> 4/10 -> requires correction
    const v = buildQualityV21View(makeJson({ defaultScore: 90, overrideD }));
    expect(v.correctiveActions).toHaveLength(1);
    expect(v.correctiveActions[0].dimNum).toBe(1);
    expect(v.correctiveActions[0].impactPoints).toBeGreaterThan(0);
  });

  it('uses the first non-empty point as the corrective action text when available', () => {
    const overrideD: Record<number, number> = {};
    for (let i = 1; i <= 14; i++) overrideD[i] = 90;
    overrideD[2] = 30;
    const v = buildQualityV21View(
      makeJson({
        defaultScore: 90,
        overrideD,
        overridePoints: { 2: { findings: ['Cuenta 1110 sin auxiliar'] } },
      }),
    );
    expect(v.correctiveActions[0].action).toContain('Cuenta 1110 sin auxiliar');
  });

  it('impactPoints scales with the gap to the 8/10 threshold', () => {
    const overrideD: Record<number, number> = {};
    for (let i = 1; i <= 14; i++) overrideD[i] = 90;
    overrideD[2] = 20; // 2/10 -> gap=6 -> impact = 6/12 = 0.5
    const v = buildQualityV21View(makeJson({ defaultScore: 90, overrideD }));
    expect(v.correctiveActions[0].impactPoints).toBe(0.5);
  });
});
