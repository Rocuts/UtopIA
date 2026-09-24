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

  // e2e-niif-10 (re-auditoría 2026-09): el JSON valida la FORMA de las notas
  // técnicas (Pass-3), no sus cifras: "El patrimonio … es $77.777.777,00 y el
  // ROE fue 25,0%" salía sin aviso. Se rotulan igual que el resto de la prosa.
  it('las notas técnicas (prosa del Pass-3, cifras sin anclar) llevan el aviso', () => {
    const doc = composeEditorialReport({ report: report(), preprocessed: null, pillars: null, language: 'es' });
    const tech = doc.notes.blocks.find((b) => b.heading === 'Notas técnicas de los estados financieros')!;
    expect(tech.bodyMarkdown).toContain(NARRATIVE_DISCLAIMER);
    expect(tech.bodyMarkdown).toContain('Mapeo PUC → NIIF.');
  });

  it('las notas en prosa bajo el ESF, el ERI y el ECP llevan el aviso; sin notas no se agrega', () => {
    const r = report();
    const json = r.niifAnalysis.json!;
    json.balanceSheet.notes = [{ ref: 'Nota 2', norma: null, body: 'El efectivo al cierre asciende a $9.999.999,00.' }];
    json.incomeStatement.notes = [{ ref: 'Nota 3', norma: null, body: 'La utilidad neta fue de $44.444.444,00.' }];
    json.equityChanges.notes = [];
    const doc = composeEditorialReport({ report: r, preprocessed: null, pillars: null, language: 'es' });
    expect(doc.statements.balance.footnotes?.[0]).toBe(NARRATIVE_DISCLAIMER);
    expect(doc.statements.balance.footnotes).toContain('Nota 2 — El efectivo al cierre asciende a $9.999.999,00.');
    expect(doc.statements.income.footnotes?.[0]).toBe(NARRATIVE_DISCLAIMER);
    expect(doc.statements.equity.footnotes ?? []).not.toContain(NARRATIVE_DISCLAIMER);
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
