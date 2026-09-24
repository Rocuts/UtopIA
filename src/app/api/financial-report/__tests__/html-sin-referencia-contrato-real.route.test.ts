// ---------------------------------------------------------------------------
// /html SIN referencia con el contrato REAL de entrada del Editor Jefe
// (revisión de la ronda final de procedencia, R2-03 / e2e-niif2-06)
// ---------------------------------------------------------------------------
// Las demás pruebas de /html sustituyen `HtmlEditorInputSchema` por un
// passthrough. Aquí corre el contrato real sobre el cuerpo que arma la UI:
//   - sin falsos positivos: informes honestos (es/en, balance con comparativo)
//     pasan el gate de /export sin referencia y lo que recibe el Editor Jefe
//     sigue cumpliendo su contrato; los firmantes que recibe son los del intake;
//   - la bandera `overwritten` de una desviación (e2e-niif2-02) no levanta un
//     JSON que no cuadra con el balance, y una reconciliación con forma inválida
//     no revienta el servidor;
//   - V5/V6 (identidad del ARCHIVO, que /html no recibe): la emitibilidad de
//     /consolidate viaja en el cuerpo de la UI y /html responde como /export.
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => null) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
vi.mock('@/lib/facts/report-facts', () => ({ getHechosEmpresaBlock: async () => '' }));
vi.mock('@/lib/db/telemetry', async (orig) => {
  const actual = await orig<typeof import('@/lib/db/telemetry')>();
  return { ...actual, resolveOwnedReportId: async () => null };
});
vi.mock('@/lib/workflows/sentinel/repository', () => ({
  upsertAlert: vi.fn(async () => undefined),
  findPendingAlertsForWorkspace: vi.fn(async () => []),
}));

import { POST as consolidate } from '../consolidate/route';
import { POST as exportReport } from '../export/route';
import { POST as html } from '../html/route';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import { HtmlEditorInputSchema } from '@/lib/agents/financial/contracts/html-editor';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { htmlInputFromPersisted } from '@/lib/reports/html-input';
import { htmlReportVerdicts } from '@/components/workspace/PipelineWorkspace';
import {
  PROVENANCE_COMPANY,
  PROVENANCE_CSV,
  consolidateBody,
  makeProvenanceParts,
} from '@/lib/reports/__tests__/provenance-fixture';
import {
  CSV_PERDIDA_COMPARATIVO,
  informeExportable,
  informeHonesto,
} from '@/lib/agents/financial/__fixtures__/perdida-comparativo-w4a';
import { withCoherentParts } from '@/lib/reports/__tests__/coherent-parts';
import type { CompanyInfo } from '@/lib/agents/financial/types';

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const PRESENTATION_META = {
  entityCity: 'Cali',
  entityType: 'SAS',
  entityLaw: 'Ley 1258/2008',
  entityGroup: 'Grupo 2',
  generatedAt: '2026-09-24T00:00:00.000Z',
  extractedAt: '2026-09-24T00:00:00.000Z',
  issuedAtHuman: '24 de septiembre de 2026',
  modelId: 'gpt-5.4-mini',
  agentVersion: '1+1 v10.1',
};

/**
 * Cuerpo de /html sin referencia como lo arma la UI (`handleGenerateHtml`): los
 * tres JSON, la empresa, una metadata que cumple el contrato, el preprocesado
 * de la sesión y los veredictos del informe (`htmlReportVerdicts`).
 */
function uiHtmlBody(report: FinancialReport, preprocessedJson: unknown, language: 'es' | 'en', extra: Record<string, unknown> = {}) {
  const base = htmlInputFromPersisted(
    { metadata: PRESENTATION_META, language },
    {
      report,
      preprocessed: undefined,
      provenance: { reportId: 'x', reportHash: 'a'.repeat(64) } as never,
    },
  );
  return {
    ...base,
    preprocessed: preprocessedJson,
    ...htmlReportVerdicts(report),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DATABASE_URL;
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

describe('/html sin referencia con el contrato real — sin falsos positivos', () => {
  const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
  if (read.kind !== 'ok') throw new Error('fixture');
  const PP = toJsonSafe(read.preprocessed);

  for (const language of ['es', 'en'] as const) {
    it(`informe honesto (${language}) → 200 y el Editor Jefe recibe la entrada validada`, async () => {
      const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ language })));
      expect(res.status).toBe(200);
      const { report } = (await res.json()) as { report: FinancialReport };
      const body = uiHtmlBody(report, PP, language);
      expect(HtmlEditorInputSchema.safeParse(body).success).toBe(true);
      const h = await html(req('/api/financial-report/html', body));
      expect(h.status, await h.clone().text()).toBe(200);
      expect(runHtmlEditor).toHaveBeenCalledTimes(1);
      const input = vi.mocked(runHtmlEditor).mock.calls[0][0];
      // Lo que recibe el Editor Jefe sigue cumpliendo su contrato de entrada.
      expect(HtmlEditorInputSchema.safeParse(input).success).toBe(true);
    });
  }

  it('balance con comparativo (pérdida) honesto: /export y /html sin referencia coinciden (200)', async () => {
    const r = preprocessUploadedTrialBalanceText(CSV_PERDIDA_COMPARATIVO);
    if (r.kind !== 'ok') throw new Error('fixture');
    const company: CompanyInfo = { name: 'Demo Perdidas SAS', nit: '900123456-8', fiscalPeriod: '2025', entityType: 'SAS', niifGroup: 2 };
    const report = withCoherentParts({ ...informeExportable(informeHonesto(r.preprocessed)), company }, r.preprocessed);
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: CSV_PERDIDA_COMPARATIVO, format: 'excel', language: 'es' }),
    );
    expect(ex.status, await ex.clone().text()).toBe(200);
    const body = uiHtmlBody(report, toJsonSafe(r.preprocessed), 'es');
    const parsed = HtmlEditorInputSchema.safeParse(body);
    expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
    const h = await html(req('/api/financial-report/html', body));
    expect(h.status, await h.clone().text()).toBe(200);
  });

  it('firmantes: el Editor Jefe recibe los del intake, no los del JSON recibido', async () => {
    const company = {
      ...PROVENANCE_COMPANY,
      legalRepresentative: 'Luisa Legal Intake',
      legalRepresentativeId: '52111222',
    };
    const parts = makeProvenanceParts();
    const g = parts.governance.json as GovernanceReportJson;
    g.shareholderMinutes.signatures = [
      { role: 'presidente_asamblea', name: 'Pedro Presidente', identification: null },
      { role: 'secretario_asamblea', name: 'Sara Secretaria', identification: null },
      { role: 'representante_legal', name: 'Rodrigo Impostor', identification: 'C.C. 9.999.999' },
    ];
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts, company })));
    const { report } = (await res.json()) as { report: FinancialReport };
    // La UI reenvía el JSON de la fase (aquí se simula el del modelo).
    const body = { ...uiHtmlBody(report, PP, 'es'), governanceReport: g, company: report.company };
    const h = await html(req('/api/financial-report/html', body));
    expect(h.status, await h.clone().text()).toBe(200);
    const input = vi.mocked(runHtmlEditor).mock.calls[0][0] as unknown as { governanceReport: GovernanceReportJson };
    expect(JSON.stringify(input.governanceReport)).not.toContain('Rodrigo Impostor');
    expect(JSON.stringify(input.governanceReport)).toContain('Luisa Legal Intake');
  });
});

describe('e2e-niif2-02 — la bandera overwritten no levanta un JSON que no cuadra', () => {
  it('/export sin referencia: total del ESF falso + desviación "overwritten" + clean:true → 422', async () => {
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody()));
    const { report } = (await res.json()) as { report: FinancialReport };
    const r = structuredClone(report);
    const n = r.niifAnalysis.json as unknown as { balanceSheet: Record<string, unknown> };
    // A = P + K se conserva (activo y patrimonio +$100) pero el balance dice otra cosa.
    n.balanceSheet.totalAssetsPrimary = String(BigInt(n.balanceSheet.totalAssetsPrimary as string) + BigInt(10000));
    n.balanceSheet.totalEquityPrimary = String(BigInt(n.balanceSheet.totalEquityPrimary as string) + BigInt(10000));
    r.niifAnalysis.reconciliation = {
      deviations: [
        {
          period: 'primary', field: 'balanceSheet.totalAssetsPrimary', label: 'Total Activo', key: 'activo',
          emitted: '1', expected: '1', gapCents: '0', overwritten: true,
        },
      ],
      lineGaps: [], repairAttempted: false, clean: true,
    } as never;
    const ex = await exportReport(
      req('/api/financial-report/export', { report: r, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(422);
    const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
    if (read.kind !== 'ok') throw new Error('fixture');
    const h = await html(req('/api/financial-report/html', uiHtmlBody(r, toJsonSafe(read.preprocessed), 'es')));
    expect(h.status).toBe(422);
  });

  it('reconciliación con forma basura no revienta el servidor (/export y /html)', async () => {
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody()));
    const { report } = (await res.json()) as { report: FinancialReport };
    const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
    if (read.kind !== 'ok') throw new Error('fixture');
    const garbage = { clean: false, deviations: [null, { emitted: 'x' }], lineGaps: 'zz', repairAttempted: 1 };
    const r = { ...structuredClone(report), niifAnalysis: { ...report.niifAnalysis, reconciliation: garbage } } as never;
    const ex = await exportReport(
      req('/api/financial-report/export', { report: r, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect([400, 422]).toContain(ex.status);
    const h = await html(
      req('/api/financial-report/html', { ...uiHtmlBody(report, toJsonSafe(read.preprocessed), 'es'), niifReconciliation: garbage }),
    );
    expect([400, 422]).toContain(h.status);
  });
});

describe('V5/V6 (identidad del ARCHIVO) en /html sin referencia', () => {
  it('NIT del archivo con DV inválido: /export (con rawData) y /html (cuerpo de la UI, sin rawData) responden 422', async () => {
    const CSV_V6 = PROVENANCE_CSV.replace('NIT: 900.123.456-8', 'NIT: 900.123.456-1');
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ rawData: CSV_V6 })));
    const { report } = (await res.json()) as { report: FinancialReport };
    expect(report.emittability?.kind).toBe('no-emitible');
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: CSV_V6, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(422);
    const read = preprocessUploadedTrialBalanceText(CSV_V6);
    if (read.kind !== 'ok') throw new Error('fixture');
    const body = uiHtmlBody(report, toJsonSafe(read.preprocessed), 'es');
    expect(HtmlEditorInputSchema.safeParse(body).success).toBe(true);
    const h = await html(req('/api/financial-report/html', body));
    expect(h.status).toBe(422);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });
});
