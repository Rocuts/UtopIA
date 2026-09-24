// reportes-export-11 — narrativa, notas, dictamen y sello de calidad se
// exportaban sin validar cifras ni procedencia; null → 0 / 'F'.
import { describe, expect, it } from 'vitest';
import { composeEditorialReport } from '../compose';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import { NARRATIVE_DISCLAIMER } from '../../statement-presentation';

function report() {
  const r = makeExportableReport();
  r.governance.financialNotes = '## Nota 4 Efectivo\nEl efectivo asciende a $77.777.777,00.';
  r.governance.shareholderMinutes = 'Acta: se aprueban utilidades por $999.999.999,00.';
  r.strategicAnalysis.strategicRecommendations = '1. **Subir precios**\n   ROE 87,5 %.';
  r.strategicAnalysis.breakEvenAnalysis = 'PE $1,00';
  r.strategicAnalysis.projectedCashFlow = 'Saldo $2,00';
  r.niifAnalysis.json!.technicalNotes = [{ ref: null, norma: null, body: 'Mapeo PUC → NIIF.' }];
  return r;
}

const audit = {
  overallScore: 97, opinionType: 'favorable', opinionText: 'Sin salvedades', auditorResults: [],
  consolidatedFindings: [], findingCounts: {}, executiveSummary: 'ok',
} as unknown as AuditReport;
const quality = {
  overallScore: 99, grade: 'A+', dimensions: [], ifrs18Readiness: null, dataQuality: null, aiGovernance: null,
  executiveSummary: 'ok',
} as unknown as QualityAssessment;

describe('reportes-export-11 — narrativa LLM rotulada como no auditada', () => {
  it('notas, recomendaciones, acta, punto de equilibrio y proyección llevan el aviso', () => {
    const doc = composeEditorialReport({ report: report(), preprocessed: null, pillars: null, language: 'es' });
    expect(doc.notes.blocks[0].bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
    expect(doc.recommendations.items[0].bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
    expect(doc.shareholderMinutes?.bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
    expect(doc.breakEven?.bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
    expect(doc.projectedCashFlow?.bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
  });

  it('las notas técnicas del JSON validado no llevan el aviso (sí son contrato)', () => {
    const doc = composeEditorialReport({ report: report(), preprocessed: null, pillars: null, language: 'es' });
    const tech = doc.notes.blocks.find((b) => b.heading === 'Notas técnicas de los estados financieros')!;
    expect(tech.bodyMarkdown).not.toContain(NARRATIVE_DISCLAIMER);
  });
});

describe('reportes-export-11 — dictamen y sello sólo con procedencia de servidor', () => {
  it('auditReport/qualityReport enviados por el cliente se omiten y se explica en el apéndice', () => {
    const doc = composeEditorialReport({
      report: report(), preprocessed: null, pillars: null, language: 'es', auditReport: audit, qualityReport: quality,
    });
    expect(doc.auditFindings).toBeUndefined();
    expect(doc.qualityScores).toBeUndefined();
    expect(doc.appendix.validationWarnings?.join(' ')).toMatch(/no pueden verificarse contra una versión persistida/);
  });

  it('con procedencia de servidor se renderizan y los null quedan N/D, no 0 ni "F"', () => {
    const doc = composeEditorialReport({
      report: report(), preprocessed: null, pillars: null, language: 'es',
      auditReport: audit, qualityReport: { ...quality, grade: null, overallScore: null } as unknown as QualityAssessment,
      assuranceProvenance: 'server-persisted',
    });
    expect(doc.auditFindings?.overallScore).toBe(97);
    expect(doc.qualityScores?.grade).toBeNull();
    expect(doc.qualityScores?.overallScore).toBeNull();
    expect(doc.qualityScores?.ifrs18Score).toBeNull();
    expect(doc.qualityScores?.dataQuality.completeness).toBeNull();
  });
});
