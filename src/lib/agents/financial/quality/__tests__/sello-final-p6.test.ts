// auditoria-calidad-30 — render del sello Parte V:
//   (c) spec v2.1, "REGLAS DE INTEGRACIÓN": el SELLO DE CALIDAD es el último
//       elemento del informe; el render añadía después acciones correctivas,
//       conclusión y apéndice.
//   (d) el sello certificado añadía "y firma del representante legal", que el
//       texto de la spec ("Listo para revisión del contador") no contempla.
import { describe, expect, it } from 'vitest';

import { __test_renderMarkdown } from '../agent';
import { buildQualityV21View } from '../v21-mapping';
import type { QualityReportJson } from '../../contracts/quality-report';

function makeJson(score: number): QualityReportJson {
  return {
    overallScore: score,
    grade: 'B',
    executiveSummary: 'Resumen.',
    dimensions: Array.from({ length: 14 }, (_, i) => ({
      name: `D${i + 1} Dimensión`,
      score,
      framework: 'ISO 25012',
      findings: [`Hallazgo D${i + 1}`],
      recommendations: [],
    })),
    dataQuality: { completeness: score, accuracy: score, consistency: score, timeliness: score, validity: score },
    aiGovernance: { traceability: score, explainability: score, antiHallucination: score, humanOversight: score },
    ifrs18Readiness: { ready: false, score, gaps: [] },
    priorityRecommendations: [{ action: 'Revisar notas', framework: 'NIC 1', priority: 'media' }],
    conclusion: 'Conclusión final.',
  };
}

describe('auditoria-calidad-30 — el sello es el último elemento del informe', () => {
  it('con acciones correctivas, conclusión y apéndice, el sello va después de todos', () => {
    const md = __test_renderMarkdown(makeJson(50));
    const selloIdx = md.lastIndexOf('CALIDAD REQUIERE CORRECCIÓN 1+1');
    expect(selloIdx).toBeGreaterThan(md.indexOf('## ACCIONES CORRECTIVAS PRIORIZADAS'));
    expect(selloIdx).toBeGreaterThan(md.indexOf('## CONCLUSIÓN'));
    expect(selloIdx).toBeGreaterThan(md.indexOf('## APÉNDICE'));
    expect(selloIdx).toBeGreaterThan(md.indexOf('Recomendaciones prioritarias'));
    // Nada de contenido después del marco del sello.
    const lastLine = md.trimEnd().split('\n').pop()!;
    expect(lastLine).toMatch(/^┗━+┛$/);
    // Un solo sello.
    expect(md.split('CALIDAD REQUIERE CORRECCIÓN 1+1').length - 1).toBe(1);
  });

  it('el sello certificado no anticipa la firma del representante legal', () => {
    const view = buildQualityV21View(makeJson(90));
    expect(view.sello.type).toBe('certificada');
    expect(view.sello.bottomLine).toMatch(/Listo para revisión del contador\.$/);
    expect(view.sello.bottomLine).not.toMatch(/representante legal/i);
    expect(__test_renderMarkdown(makeJson(90))).not.toMatch(/firma del representante legal/i);
  });
});
