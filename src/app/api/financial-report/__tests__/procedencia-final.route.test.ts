// ---------------------------------------------------------------------------
// Procedencia — ronda final de la fase 2 (re-auditoría 2 del 2026-09-24)
// ---------------------------------------------------------------------------
// Reproducciones de la re-auditoría final portadas a la suite real, con el
// mismo arnés que procedencia-servidor.route.test.ts (almacenamiento fake que
// evalúa las condiciones SQL reales; workspace fijado por prueba) y el
// composer REAL del PDF (sólo se sustituye el render a bytes):
//   - e2e-niif2-02: una desviación que /niif ya corrigió en el JSON
//     (`overwritten: true`, informe limpio) no sella la versión persistida.
//   - procedencia-R2-06: todo artefacto marcado BORRADOR (HTML no emitible,
//     PDF con marca de agua) lleva la variante BORRADOR del sello y
//     X-Report-Draft.
//   - procedencia-R2-05: la referencia {reportId, reportHash} ata la versión
//     entera (informe, balance, huellas, contrato, fecha, ajustes, idioma).
//   - procedencia-R2-03 + e2e-niif2-06: /html sin referencia aplica el mismo
//     gate que /export sin referencia (V1–V15, identidad II/III, prosa de la
//     Parte I, post-proceso de la Parte II) antes de pagar el Editor Jefe.
// ---------------------------------------------------------------------------

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const state = vi.hoisted(() => ({ db: null as unknown, workspace: null as string | null }));

vi.mock('@/lib/auth/require-session', () => ({ requireAuthSession: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/db/client', () => ({ getDb: () => state.db }));
vi.mock('@/lib/db/workspace', () => ({ getCurrentWorkspaceId: vi.fn(async () => state.workspace) }));
vi.mock('@/lib/export/excel-export', () => ({ generateFinancialExcel: vi.fn(async () => Buffer.from('xlsx')) }));
vi.mock('@/lib/export/pdf-elite-react', async (orig) => {
  const actual = await orig<typeof import('@/lib/export/pdf-elite-react')>();
  return {
    ...actual,
    composeEditorialReport: vi.fn(actual.composeEditorialReport),
    renderEditorialReportToStream: vi.fn(async () => Readable.from(['%PDF-test'])),
  };
});
vi.mock('@/lib/agents/financial/agents/html-editor', () => ({ runHtmlEditor: vi.fn() }));
vi.mock('@/lib/agents/financial/contracts/html-editor', () => ({
  HtmlEditorInputSchema: { safeParse: (body: unknown) => ({ success: true, data: body }) },
}));
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
import { generateFinancialExcel } from '@/lib/export/excel-export';
import { composeEditorialReport } from '@/lib/export/pdf-elite-react';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { NiifReportJson } from '@/lib/agents/financial/contracts/niif-report';
import type { StrategyReportJson } from '@/lib/agents/financial/contracts/strategy-report';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { canonicalHash } from '@/lib/reports/canonical';
import {
  PROVENANCE_COMPANY,
  PROVENANCE_CSV,
  consolidateBody,
  makeProvenanceParts,
  makeReportsTableFake,
} from '@/lib/reports/__tests__/provenance-fixture';

const W1 = '11111111-1111-4111-8111-111111111111';

let fake: ReturnType<typeof makeReportsTableFake>;
const previousDbUrl = process.env.DATABASE_URL;

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

type Ref = { reportId: string; reportHash: string };
type ConsolidateJson = { report: FinancialReport; reportRef?: Ref; provenance: Record<string, unknown> };

async function consolidateWith(
  parts: ReturnType<typeof makeProvenanceParts>,
  extra: Record<string, unknown> = {},
): Promise<ConsolidateJson> {
  const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ reportParts: parts, ...extra })));
  const json = (await res.json()) as ConsolidateJson;
  if (res.status !== 200) throw new Error(`consolidate ${res.status}: ${JSON.stringify(json).slice(0, 1500)}`);
  return json;
}

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://fake-for-tests';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  if (previousDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDbUrl;
});
beforeEach(() => {
  vi.clearAllMocks();
  fake = makeReportsTableFake();
  state.db = fake.db;
  state.workspace = W1;
  vi.mocked(runHtmlEditor).mockResolvedValue({
    html: '<html><head></head><body><main>Informe</main></body></html>',
    metadata: {},
    checklistFailures: [],
    emittable: true,
  } as never);
});

// ---------------------------------------------------------------------------
// e2e-niif2-02
// ---------------------------------------------------------------------------

describe('e2e-niif2-02 — total del ESF corregido por /niif (overwritten) en un informe limpio', () => {
  function partsWithDeviation(overwritten: boolean) {
    const parts = makeProvenanceParts();
    // Lo que persiste `runNiifAnalyst` cuando el Pass-1 emitió el Total Activo
    // +1 centavo y `reconcileAnchors` lo sobrescribió: el JSON final es el
    // honesto (Activo $10.000,00) y la desviación queda como traza.
    parts.niifAnalysis.reconciliation = {
      deviations: [
        {
          period: 'primary',
          field: 'balanceSheet.totalAssetsPrimary',
          label: 'Total Activo',
          key: 'totalAssets',
          emitted: '1000001',
          expected: '1000000',
          gapCents: '1',
          overwritten,
        },
      ],
      lineGaps: [],
      repairAttempted: false,
      clean: true,
    } as never;
    return parts;
  }

  it('la versión persistida queda limpia y Excel, PDF y HTML por referencia salen 200 sin sello', async () => {
    const out = await consolidateWith(partsWithDeviation(true));
    expect(out.report.niifAnalysis.reconciliation?.clean).toBe(true);
    expect(out.report.consolidatedReport).not.toMatch(/REPORTE CON SALVEDADES|NO es firmable/);

    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('X-Report-Provenance')).toBe('verified');
    const excel = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excel.report.consolidatedReport).not.toMatch(/REPORTE CON SALVEDADES/);

    const pdf = await exportReport(
      req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite', language: 'es' }),
    );
    expect(pdf.status).toBe(200);
    const h = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(h.status).toBe(200);
  });

  it('control: una desviación NO corregida sella la versión y bloquea la exportación', async () => {
    const out = await consolidateWith(partsWithDeviation(false));
    expect(out.report.niifAnalysis.reconciliation?.clean).toBe(false);
    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// procedencia-R2-03 + e2e-niif2-06 (modo sin base de datos)
// ---------------------------------------------------------------------------

describe('R2-03 / e2e-niif2-06 — /html sin referencia con el gate de /export sin referencia', () => {
  const read = preprocessUploadedTrialBalanceText(PROVENANCE_CSV);
  if (read.kind !== 'ok') throw new Error('fixture');
  const PP = toJsonSafe(read.preprocessed);

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    state.workspace = null;
  });
  afterEach(() => {
    process.env.DATABASE_URL = 'postgres://fake-for-tests';
  });

  /** Informe honesto tal como /consolidate lo devuelve sin DB (lo que la UI guarda). */
  async function honestReport(): Promise<FinancialReport> {
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody()));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { report: FinancialReport; provenance: { status: string } };
    expect(out.provenance.status).toBe('not_persisted');
    return out.report;
  }

  /** Cuerpo de /html sin referencia como lo arma la UI (`handleGenerateHtml`). */
  const htmlBody = (report: FinancialReport) => ({
    niifReport: report.niifAnalysis.json,
    strategyReport: report.strategicAnalysis.json,
    governanceReport: report.governance.json,
    company: PROVENANCE_COMPANY,
    metadata: { reportMode: 'LINEA_BASE' },
    preprocessed: PP,
    language: 'es',
    actaQualifications: report.governance.actaQualifications ?? null,
    strategyQualifications: report.strategicAnalysis.strategyQualifications ?? null,
  });

  it('control: el informe honesto sale 200 "no verificada" en /export y en /html', async () => {
    const report = await honestReport();
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(200);
    const h = await html(req('/api/financial-report/html', htmlBody(report)));
    expect(h.status).toBe(200);
    expect(h.headers.get('X-Report-Provenance')).toBe('unverified');
    expect(runHtmlEditor).toHaveBeenCalledTimes(1);
  });

  type Mutation = (r: FinancialReport) => void;
  const REJECTED: Array<[string, Mutation]> = [
    [
      'Parte III de OTRA empresa (identidad I5-2)',
      (r) => {
        const g = r.governance.json as GovernanceReportJson;
        g.company = { ...g.company, name: 'Compañía Ajena Ltda', nit: '800999888-1' };
      },
    ],
    [
      'nota técnica con utilidad neta falsa (prosa Parte I, I5-3)',
      (r) => {
        const n = r.niifAnalysis.json as NiifReportJson;
        n.technicalNotes = [
          ...n.technicalNotes,
          { ref: null, norma: null, body: 'La utilidad neta del ejercicio fue de $9.000.000,00.' },
        ] as NiifReportJson['technicalNotes'];
      },
    ],
    [
      'nota del ERI con la utilidad neta falsa (e2e-niif2-06)',
      (r) => {
        const n = r.niifAnalysis.json as NiifReportJson;
        n.incomeStatement.notes = [
          { ref: 'Nota 3', norma: null, body: 'La utilidad neta del ejercicio 2025 fue de $44.444.444,00.' },
        ] as NiifReportJson['incomeStatement']['notes'];
      },
    ],
    [
      'Parte I sin declaración de impracticabilidad (V15)',
      (r) => {
        (r.niifAnalysis.json as NiifReportJson).technicalNotes = [];
      },
    ],
  ];

  it.each(REJECTED)('%s → 422 en /export y en /html, sin llamar al Editor Jefe', async (_label, mutate) => {
    const report = structuredClone(await honestReport());
    mutate(report);
    // El cliente declara todo limpio.
    report.emittability = { kind: 'emittable', blockers: [], suggestedAdjustments: [] } as never;
    report.validation = { ok: true } as never;
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(422);
    const h = await html(req('/api/financial-report/html', htmlBody(report)));
    expect(h.status).toBe(422);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('la reconciliación del analista que reenvía la UI sólo endurece: `clean: false` bloquea /html', async () => {
    const report = await honestReport();
    const h = await html(
      req('/api/financial-report/html', {
        ...htmlBody(report),
        niifReconciliation: { clean: false, deviations: [], lineGaps: [], repairAttempted: true },
      }),
    );
    expect(h.status).toBe(422);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('punto de equilibrio alterado en el JSON de la Parte II: el Editor Jefe recibe el derivado por el código', async () => {
    const report = structuredClone(await honestReport());
    const s = report.strategicAnalysis.json as StrategyReportJson;
    s.breakEven = {
      ...s.breakEven!,
      fixedCostsCop: '100000000',
      variableCostsCop: '50000000',
      revenueCop: '200000000',
      breakEvenPointCop: '777777700',
      marginOfSafetyPct: '61,1',
    };
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(200);
    const exported = vi.mocked(generateFinancialExcel).mock.calls[0][0].report.strategicAnalysis
      .json as StrategyReportJson;
    expect(exported.breakEven?.breakEvenPointCop).not.toBe('777777700');

    const h = await html(req('/api/financial-report/html', htmlBody(report)));
    expect(h.status).toBe(200);
    const input = vi.mocked(runHtmlEditor).mock.calls[0][0] as unknown as { strategyReport: StrategyReportJson };
    expect(input.strategyReport.breakEven?.breakEvenPointCop).toBe(exported.breakEven?.breakEvenPointCop);
  });
});

// ---------------------------------------------------------------------------
// procedencia-R2-06 — el sello aclara BORRADOR en todo artefacto marcado así
// ---------------------------------------------------------------------------

describe('R2-06 — variante BORRADOR del sello y X-Report-Draft', () => {
  it('HTML por referencia NO emitible (checklist del Editor Jefe): sello BORRADOR, X-Report-Draft y draft=true', async () => {
    const out = await consolidateWith(makeProvenanceParts());
    vi.mocked(runHtmlEditor).mockResolvedValue({
      html:
        '<html><head></head><body><div class="utopia-borrador"><strong>BORRADOR</strong> — este documento no superó la verificación numérica automática</div>' +
        '<main>Total activos $99.999.999,00</main></body></html>',
      metadata: {},
      checklistFailures: [{ rule: '§1.1', detail: 'Total activo distinto', severity: 'block' }],
      emittable: false,
    } as never);
    const res = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
    expect(res.headers.get('X-Report-Emittable')).toBe('false');
    expect(res.headers.get('X-Report-Draft')).toBe('true');
    const body = (await res.json()) as { html: string };
    expect(body.html).toContain('PROCEDENCIA VERIFICADA — BORRADOR');
    expect(body.html).not.toContain('<strong>PROCEDENCIA VERIFICADA</strong>');
    expect(body.html).toMatch(/utopia-report-provenance" content="status=verified;[^"]*draft=true"/);
    expect(body.html).toMatch(/no superó la verificación numérica automática/);
  });

  it('HTML emitible por referencia: sin BORRADOR (control)', async () => {
    const out = await consolidateWith(makeProvenanceParts());
    const res = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(res.headers.get('X-Report-Draft')).toBeNull();
    const body = (await res.json()) as { html: string };
    expect(body.html).toContain('<strong>PROCEDENCIA VERIFICADA</strong>');
  });

  it('PDF por referencia con marca de agua BORRADOR (comparativos impracticables): sello y cabeceras lo aclaran (es/en)', async () => {
    const out = await consolidateWith(makeProvenanceParts());
    for (const language of ['es', 'en'] as const) {
      vi.mocked(composeEditorialReport).mockClear();
      const pdf = await exportReport(
        req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite', language }),
      );
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('X-Report-Provenance')).toBe('verified');
      expect(pdf.headers.get('X-Report-Draft')).toBe('true');
      const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
        meta: { watermark?: string };
        appendix: { validationWarnings?: string[] };
      };
      expect(doc.meta.watermark).toBe('BORRADOR');
      const title = language === 'es' ? 'PROCEDENCIA VERIFICADA — BORRADOR' : 'VERIFIED PROVENANCE — DRAFT';
      const stamp = (doc.appendix.validationWarnings ?? []).find((w) => w.startsWith(title.split(' — ')[0]))!;
      expect(stamp.startsWith(title)).toBe(true);
      expect(stamp).toMatch(language === 'es' ? /COMPARATIVOS IMPRACTICABLES/ : /COMPARATIVES IMPRACTICABLE/);
    }
  });
});

// ---------------------------------------------------------------------------
// procedencia-R2-05 — la referencia ata la versión entera, no sólo el informe
// ---------------------------------------------------------------------------

describe('R2-05 — fila alterada con huellas recalculadas', () => {
  type Row = {
    format: string;
    reportHash: string;
    preprocessed: { auxiliaryCount?: number };
    sourceHash: string;
    contractVersion: string;
    createdAt: string;
  };

  it('balance, sourceHash, contrato o fecha alterados en la fila → 409 de integridad en /export y /html', async () => {
    const alterations: Array<[string, (d: Row) => void]> = [
      [
        'balance con sourceHash recalculado',
        (d) => {
          d.preprocessed.auxiliaryCount = 4242;
          d.sourceHash = canonicalHash(d.preprocessed);
        },
      ],
      ['contrato', (d) => void (d.contractVersion = 'contrato-inventado-9.9')],
      ['fecha', (d) => void (d.createdAt = '1999-01-01T00:00:00.000Z')],
    ];
    for (const [label, alter] of alterations) {
      fake = makeReportsTableFake();
      state.db = fake.db;
      const out = await consolidateWith(makeProvenanceParts());
      alter(fake.rows[0].data as Row);
      const ex = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
      expect(ex.status, label).toBe(409);
      expect(((await ex.json()) as { code: string }).code, label).toBe('REPORT_VERSION_INTEGRITY');
      const h = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
      expect(h.status, label).toBe(409);
    }
    expect(generateFinancialExcel).not.toHaveBeenCalled();
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('control: la fila intacta sale verificada y una versión v1 (huella sólo del informe) se sigue leyendo', async () => {
    const out = await consolidateWith(makeProvenanceParts());
    const ok = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(ok.status).toBe(200);

    // Versión persistida antes de esta ronda: formato v1, huella del informe.
    const data = fake.rows[0].data as Row & { report: FinancialReport; adjustments?: unknown; language?: unknown };
    const legacy: Record<string, unknown> = { ...data, format: 'utopia.financial-report-version.v1' };
    delete legacy.adjustments;
    delete legacy.language;
    legacy.reportHash = canonicalHash(data.report);
    fake.rows[0].data = legacy;
    const res = await exportReport(
      req('/api/financial-report/export', {
        reportRef: { reportId: out.reportRef!.reportId, reportHash: legacy.reportHash },
        format: 'excel',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Report-Provenance')).toBe('verified');
  });
});
