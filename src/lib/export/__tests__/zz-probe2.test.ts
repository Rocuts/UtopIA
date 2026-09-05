import { describe, expect, it } from 'vitest';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { composeEditorialReport, renderEditorialReportToStream } from '../pdf-elite-react';
import type { AuditReport } from '@/lib/agents/financial/audit/types';

function audit(over: Partial<AuditReport>): AuditReport {
  const r = makeExportableReport();
  return {
    company: r.company,
    auditorResults: [
      { domain: 'niif', auditorName: 'A', complianceScore: 90, findings: [], summary: 's', fullContent: '', failed: false },
      { domain: 'sostenibilidad' as never, auditorName: 'B', complianceScore: 80, findings: [], summary: 's', fullContent: '', failed: false },
    ],
    overallScore: 80,
    opinionType: 'desfavorable',
    opinionText: 'o',
    consolidatedFindings: [],
    findingCounts: { critico: 3, alto: 2, medio: 0, bajo: 0, informativo: 0 },
    executiveSummary: 'e',
    consolidatedReport: 'c',
    generatedAt: 'g',
    ...over,
  } as AuditReport;
}

describe('pdf probe', () => {
  it('renders with unknown domain, empty findings, desfavorable opinion', async () => {
    const doc = composeEditorialReport({
      report: makeExportableReport(), preprocessed: null, pillars: null, language: 'es',
      auditReport: audit({}), auditExaminedStage: 'niif',
    });
    console.log('COVERAGE', doc.auditFindings?.coverageNote);
    console.log('COUNTS', JSON.stringify(doc.auditFindings?.findingCounts), 'top', doc.auditFindings?.topFindings.length);
    const stream = await renderEditorialReportToStream(doc);
    const chunks: Buffer[] = [];
    await new Promise<void>((res, rej) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => res());
      stream.on('error', rej);
    });
    const buf = Buffer.concat(chunks);
    console.log('PDF bytes', buf.length);
    expect(buf.length).toBeGreaterThan(1000);
  }, 120000);
});
