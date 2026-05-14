// render-v21.test.ts — assertions on the v2.1 visual frame emitted by the
// Quality Meta-Auditor renderMarkdown. The renderer is not exported, but
// runQualityAudit goes through it; for test purposes we drive it through the
// adapter (toLegacyQualityAssessment) indirectly by importing the agent module
// — `renderMarkdown` is invoked from `toLegacyQualityAssessment`.
//
// To keep the test free of LLM dependencies we mount a local copy of the
// renderer via the public surface: we call buildQualityV21View directly and
// re-derive expectations, but we ALSO need to verify the actual Markdown the
// agent file produces. Solution: re-export `renderMarkdown` via the agent for
// tests (kept as `__test_renderMarkdown`) — but the spec says "minor updates
// only" for the agent. Compromise: directly import the renderer via a thin
// re-export and verify markers exist via output string scanning.

import { describe, it, expect } from 'vitest';
import { buildQualityV21View } from '../v21-mapping';
import type { QualityReportJson } from '../../contracts/quality-report';

// We import the agent module to access the renderer via the public adapter
// pathway. Since renderMarkdown is internal, we test the FULL output that
// flows into QualityAssessment.fullReport.
import { __test_renderMarkdown } from '../agent';

function makeJson(opts: { defaultScore: number; rawScore?: number } = { defaultScore: 80 }): QualityReportJson {
  const raw = opts.rawScore ?? opts.defaultScore;
  const dimensions = [];
  for (let n = 1; n <= 14; n++) {
    dimensions.push({
      name: `D${n} Dimension ${n}`,
      score: opts.defaultScore,
      framework: 'ISO 25012',
      findings: [`Finding for D${n}`],
      recommendations: [`Recommendation for D${n}`],
    });
  }
  return {
    overallScore: opts.defaultScore,
    grade: 'B',
    executiveSummary: 'Resumen ejecutivo de prueba — un párrafo único.',
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
    ifrs18Readiness: { ready: false, score: raw, gaps: ['Adoptar nuevo formato P&L NIIF 18.'] },
    priorityRecommendations: [
      { action: 'Validar conciliación caja vs PUC 11', framework: 'NIC 7', priority: 'alta' },
    ],
    conclusion: 'Conclusión final.',
  };
}

const COMPANY = { name: 'Acme SAS', nit: '900.123.456-7', fiscalPeriod: '2025' };

// ---------------------------------------------------------------------------
// Frame markers
// ---------------------------------------------------------------------------

describe('renderMarkdown — v2.1 visual frame markers', () => {
  it('emits the top frame banner with company info', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }), COMPANY);
    expect(md).toMatch(/╔════/);
    expect(md).toMatch(/╚════/);
    expect(md).toContain('META-AUDITORÍA DE CALIDAD 1+1');
    expect(md).toContain('SPEC v2.1 (Parte V)');
    expect(md).toContain('Acme SAS');
    expect(md).toContain('900.123.456-7');
    expect(md).toContain('2025');
  });

  it('emits the EVALUACIÓN EN 12 DIMENSIONES subtitle and scale legend', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('EVALUACIÓN EN 12 DIMENSIONES');
    expect(md).toContain('aprobado');
    expect(md).toContain('en revisión');
    expect(md).toContain('requiere corrección');
  });

  it('emits 3 block frames (A, B, C) with their full titles', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('BLOQUE A — ISO 25012 — Calidad de Datos Financieros');
    expect(md).toContain('BLOQUE B — ISO/IEC 42001 — Gobernanza de IA');
    expect(md).toContain('BLOQUE C — IASB Conceptual Framework — Características Cualitativas');
    // The block frames use ┌ and └
    expect(md).toMatch(/┌────/);
    expect(md).toMatch(/└────/);
  });
});

// ---------------------------------------------------------------------------
// 12 DIM labels
// ---------------------------------------------------------------------------

describe('renderMarkdown — 12 DIM labels', () => {
  it('emits one DIM N header per v2.1 dimension (1..12)', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    for (let n = 1; n <= 12; n++) {
      expect(md).toContain(`### DIM ${n} ·`);
    }
  });

  it('every DIM block contains Definición, Verificación, Puntos detectados, Score, Estado', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    // Count occurrences — at least one per DIM
    const countMatches = (s: string, term: string) => (s.match(new RegExp(term, 'g')) ?? []).length;
    expect(countMatches(md, 'Definición:')).toBeGreaterThanOrEqual(12);
    expect(countMatches(md, 'Verificación:')).toBeGreaterThanOrEqual(12);
    expect(countMatches(md, 'Puntos detectados:')).toBeGreaterThanOrEqual(12);
    expect(countMatches(md, 'Score:')).toBeGreaterThanOrEqual(12);
    expect(countMatches(md, 'Estado:')).toBeGreaterThanOrEqual(12);
  });

  it('every DIM cites its framework', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('Marco:** ISO 25012');
    expect(md).toContain('Marco:** ISO/IEC 42001');
    expect(md).toContain('Marco:** IASB Conceptual Framework');
  });
});

// ---------------------------------------------------------------------------
// Resumen table
// ---------------------------------------------------------------------------

describe('renderMarkdown — tabla resumen meta-auditoría', () => {
  it('emits a 12-row table (one row per v2.1 dim) plus a global row', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('TABLA RESUMEN META-AUDITORÍA');
    expect(md).toContain('| # | Bloque | Dimensión | Marco | Score | Estado |');
    // 12 numbered rows
    for (let n = 1; n <= 12; n++) {
      // The row begins with "| <n> |"
      const re = new RegExp(`^\\|\\s*${n}\\s*\\|`, 'm');
      expect(md).toMatch(re);
    }
    // Global row marker
    expect(md).toContain('SCORE GLOBAL');
    expect(md).toMatch(/8\.0\/10/); // default 80 -> 8/10 per dim -> global 8.0
  });
});

// ---------------------------------------------------------------------------
// Sello block
// ---------------------------------------------------------------------------

describe('renderMarkdown — sello de calidad', () => {
  it('emits the certificada sello when score ≥ 8', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 85 }));
    expect(md).toMatch(/┏━━━━/);
    expect(md).toMatch(/┗━━━━/);
    expect(md).toContain('CALIDAD CERTIFICADA 1+1');
    expect(md).toContain('Dimensiones aprobadas: 12/12');
  });

  it('emits the con_observaciones sello when score in [6,7.9]', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 70 })); // 7/10
    expect(md).toContain('CALIDAD CON OBSERVACIONES 1+1');
  });

  it('emits the requiere_correccion sello when score < 6', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 40 })); // 4/10
    expect(md).toContain('CALIDAD REQUIERE CORRECCIÓN 1+1');
    expect(md).toContain('Bloqueado para firma');
  });
});

// ---------------------------------------------------------------------------
// Corrective actions
// ---------------------------------------------------------------------------

describe('renderMarkdown — acciones correctivas priorizadas', () => {
  it('omits the corrective-action section when all dims score ≥ 7', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 85 }));
    expect(md).not.toContain('ACCIONES CORRECTIVAS PRIORIZADAS');
  });

  it('emits the corrective-action section when at least one dim < 7', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 50 })); // 5/10 all dims
    expect(md).toContain('ACCIONES CORRECTIVAS PRIORIZADAS');
    expect(md).toContain('| Dim # |');
    expect(md).toContain('Impacto estimado');
  });
});

// ---------------------------------------------------------------------------
// Conclusion + appendix coexist
// ---------------------------------------------------------------------------

describe('renderMarkdown — conclusion and legacy 14-dim appendix coexist', () => {
  it('emits CONCLUSIÓN section with the JSON conclusion verbatim', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('CONCLUSIÓN');
    expect(md).toContain('Conclusión final.');
  });

  it('emits the legacy 14-dim appendix AFTER the conclusion', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    const conclIdx = md.indexOf('## CONCLUSIÓN');
    const apxIdx = md.indexOf('APÉNDICE — Detalle interno (14 dimensiones D1..D14)');
    expect(conclIdx).toBeGreaterThan(-1);
    expect(apxIdx).toBeGreaterThan(-1);
    expect(apxIdx).toBeGreaterThan(conclIdx);
    // 14 D-header lines from the appendix
    for (let n = 1; n <= 14; n++) {
      expect(md).toContain(`### D${n} Dimension ${n}`);
    }
  });

  it('appendix preserves the raw ISO 25012 / 42001 / IFRS 18 blocks for backward compat', () => {
    const md = __test_renderMarkdown(makeJson({ defaultScore: 80 }));
    expect(md).toContain('Calidad de Datos (ISO 25012) — métricas raw');
    expect(md).toContain('Gobernanza IA (ISO/IEC 42001) — métricas raw');
    expect(md).toContain('Preparación NIIF 18');
  });
});

// ---------------------------------------------------------------------------
// Consistency between v21-mapping view and rendered output
// ---------------------------------------------------------------------------

describe('renderMarkdown — output uses buildQualityV21View as single source of truth', () => {
  it('global score in the table equals the view.globalScoreInt0to10', () => {
    const json = makeJson({ defaultScore: 80 });
    const view = buildQualityV21View(json);
    const md = __test_renderMarkdown(json);
    expect(md).toContain(`**${view.globalScoreInt0to10.toFixed(1)}/10**`);
  });
});
