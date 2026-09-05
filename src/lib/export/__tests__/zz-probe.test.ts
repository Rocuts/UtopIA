import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { generateFinancialExcel } from '../excel-export';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  const report = makeExportableReport();
  return {
    company: report.company,
    auditorResults: [],
    overallScore: 91,
    opinionType: 'con_salvedades',
    opinionText: 'x',
    consolidatedFindings: [],
    findingCounts: { critico: 0, alto: 0, medio: 0, bajo: 0, informativo: 0 },
    executiveSummary: 's',
    consolidatedReport: '# r',
    generatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  } as AuditReport;
}

describe('probe', () => {
  it('quality without nested objects', async () => {
    const quality = { overallScore: 1, grade: 'F', dimensions: [], executiveSummary: '', fullReport: '', generatedAt: 'x' } as unknown as QualityAssessment;
    await expect(generateFinancialExcel({ report: makeExportableReport(), qualityReport: quality })).resolves.toBeTruthy();
  });

  it('very long description', async () => {
    const long = 'A'.repeat(40000);
    const audit = makeAudit({ consolidatedFindings: [{
      code: 'X-1', severity: 'critico', domain: 'niif', title: long, description: long,
      normReference: 'n', recommendation: long, impact: 'i',
    }] });
    const buf = await generateFinancialExcel({ report: makeExportableReport(), auditReport: audit, auditExaminedStage: 'complete' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Auditoria')!;
    let seen = 0;
    ws.eachRow(r => { (r.values as unknown[]).forEach(v => { if (typeof v === 'string' && v.length > 32767) seen = v.length; }); });
    console.log('LONGEST CELL', seen, 'bytes', buf.length);
  });

  it('unknown severity/domain', async () => {
    const audit = makeAudit({ consolidatedFindings: [{
      code: 'X-2', severity: 'critica' as never, domain: 'sostenibilidad' as never, title: 't',
      description: 'd', normReference: 'n', recommendation: 'r', impact: 'i',
    }] });
    await expect(generateFinancialExcel({ report: makeExportableReport(), auditReport: audit })).resolves.toBeTruthy();
  });

  it('audit missing findingCounts and opinionType', async () => {
    const audit = { ...makeAudit(), findingCounts: undefined, opinionType: undefined, overallScore: undefined } as unknown as AuditReport;
    await expect(generateFinancialExcel({ report: makeExportableReport(), auditReport: audit })).resolves.toBeTruthy();
  });
});
