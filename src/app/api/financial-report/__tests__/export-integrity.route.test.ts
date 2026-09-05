import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', () => ({
  composeEditorialReport: vi.fn(() => ({})),
  renderEditorialReportToStream: vi.fn(),
}));
vi.mock('@/lib/agents/financial/orchestrator', () => ({
  orchestrateFinancialReport: vi.fn(), BalanceValidationError: class extends Error {},
}));
vi.mock('@/lib/db/financial-report-versions', () => ({
  requireReportWorkspace: vi.fn(async () => ({})),
  loadFinancialVersion: vi.fn(),
  ReportVersionError: class extends Error {},
}));
import { loadFinancialVersion } from '@/lib/db/financial-report-versions';
import { POST } from '../export/route';
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { renderEditorialReportToStream } from '@/lib/export/pdf-elite-react';
import { orchestrateFinancialReport } from '@/lib/agents/financial/orchestrator';
import { Readable } from 'node:stream';

const versionId = '11111111-1111-4111-8111-111111111111';
const request = (body: unknown) => new Request('http://localhost/api/financial-report/export', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renderEditorialReportToStream).mockImplementation(async () => Readable.from(['%PDF-test']));
});
describe('Export API validates reports independently of the browser', () => {
  for (const format of ['excel', 'pdf-elite']) {
    it(`${format}: returns 422 for explicitly qualified report before rendering`, async () => {
      const report = makeExportableReport();
      report.niifAnalysis.reconciliation!.clean = false;
      vi.mocked(loadFinancialVersion).mockResolvedValue({ stage: 'complete', report, preprocessed: null, language: 'es' } as never);
      expect((await POST(request({ reportVersionId: versionId, format }))).status).toBe(422);
      expect(generateFinancialExcel).not.toHaveBeenCalled();
      expect(renderEditorialReportToStream).not.toHaveBeenCalled();
    });
    it(`${format}: forged clean flag does not bypass arithmetic validation`, async () => {
      const report = makeExportableReport();
      report.niifAnalysis.json!.equityChanges.rows[1].capitalSocial = '300001';
      vi.mocked(loadFinancialVersion).mockResolvedValue({ stage: 'complete', report, preprocessed: null, language: 'es' } as never);
      expect((await POST(request({ reportVersionId: versionId, format }))).status).toBe(422);
    });
    it(`${format}: missing JSON is not an exportable legacy report`, async () => {
      const report = makeExportableReport();
      delete report.niifAnalysis.json;
      vi.mocked(loadFinancialVersion).mockResolvedValue({ stage: 'complete', report, preprocessed: null, language: 'es' } as never);
      expect((await POST(request({ reportVersionId: versionId, format }))).status).toBe(422);
    });
    it(`${format}: a coherent report remains downloadable`, async () => {
      vi.mocked(loadFinancialVersion).mockResolvedValue({ stage: 'complete', report: makeExportableReport(), preprocessed: null, language: 'es' } as never);
      const response = await POST(request({ reportVersionId: versionId, format }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
  }
  it('rejects unsupported format before any paid pipeline invocation', async () => {
    const report = makeExportableReport();
    for (const format of ['pdf', 'csv', null]) {
      vi.mocked(loadFinancialVersion).mockResolvedValue({ stage: 'complete', report, preprocessed: null, language: 'es' } as never);
      expect((await POST(request({ reportVersionId: versionId, format }))).status).toBe(400);
    }
    expect(orchestrateFinancialReport).not.toHaveBeenCalled();
    expect(generateFinancialExcel).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON with 400', async () => {
    expect((await POST(new Request('http://localhost/api/financial-report/export', { method: 'POST', body: '{' }))).status).toBe(400);
  });
});
