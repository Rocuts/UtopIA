// ---------------------------------------------------------------------------
// Procedencia — ronda final de la fase 2 (re-auditoría 2 del 2026-09-24)
// ---------------------------------------------------------------------------
// Reproducciones de la re-auditoría final portadas a la suite real, con el
// mismo arnés que procedencia-servidor.route.test.ts (almacenamiento fake que
// evalúa las condiciones SQL reales; workspace fijado por prueba) y el
// composer REAL del PDF (sólo se sustituye el render a bytes):
//   - e2e-niif2-02: una desviación que /niif ya corrigió en el JSON
//     (`overwritten: true`, informe limpio) no sella la versión persistida.
//   - procedencia-R2-02: el PDF y el HTML divulgan los ajustes confirmados del
//     Doctor de Datos (anexo) y el sello nombra la huella de cada balance.
//   - procedencia-R2-04: firmantes y Revisor Fiscal del acta salen del intake
//     (o "a completar al firmar"), nunca del JSON de la Parte III.
//   - procedencia-R2-07: las ediciones "Aplicar al reporte" no se descartan en
//     silencio en /export sin referencia (aviso en el artefacto, cabecera y UI).
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
import { applyAdjustments } from '@/lib/agents/repair/adjustments';
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

  it('V5/V6 (identidad del ARCHIVO): los bloqueantes que /consolidate calculó con el archivo viajan en el cuerpo de la UI y /html responde 422 como /export', async () => {
    // /html no recibe `rawData`: sin la emitibilidad de /consolidate un NIT del
    // encabezado con DV inválido (V6) salía en HTML mientras /export (que sí
    // lleva el archivo) respondía 422.
    const CSV_V6 = PROVENANCE_CSV.replace('NIT: 900.123.456-8', 'NIT: 900.123.456-1');
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody({ rawData: CSV_V6 })));
    const { report } = (await res.json()) as { report: FinancialReport };
    expect(report.emittability?.kind).toBe('no-emitible');
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: CSV_V6, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(422);

    const { htmlReportVerdicts } = await import('@/components/workspace/PipelineWorkspace');
    const read6 = preprocessUploadedTrialBalanceText(CSV_V6);
    if (read6.kind !== 'ok') throw new Error('fixture');
    const h = await html(
      req('/api/financial-report/html', {
        ...htmlBody(report),
        preprocessed: toJsonSafe(read6.preprocessed),
        ...htmlReportVerdicts(report),
      }),
    );
    expect(h.status).toBe(422);
    expect(((await h.json()) as { details: string[] }).details.join('\n')).toMatch(/salvedades o validaciones bloqueantes/);
    expect(runHtmlEditor).not.toHaveBeenCalled();
  });

  it('emitibilidad y validación reenviadas sólo endurecen: "emittable" o formas inválidas no levantan ni revientan', async () => {
    const report = await honestReport();
    const { htmlReportVerdicts } = await import('@/components/workspace/PipelineWorkspace');
    const ok = await html(req('/api/financial-report/html', { ...htmlBody(report), ...htmlReportVerdicts(report) }));
    expect(ok.status).toBe(200);
    const lifted = await html(
      req('/api/financial-report/html', {
        ...htmlBody(report),
        emittability: { kind: 'emittable', blockers: 'x', suggestedAdjustments: 7 },
        validation: { ok: 'sí' },
      }),
    );
    expect(lifted.status).toBe(200);
    for (const hardening of [
      { emittability: { kind: 'no-emitible', blockers: 'x' } },
      { validation: { ok: false, errors: [1, 'E1. descuadre'] } },
    ]) {
      const res = await html(req('/api/financial-report/html', { ...htmlBody(report), ...hardening }));
      expect(res.status).toBe(422);
    }
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

// ---------------------------------------------------------------------------
// procedencia-R2-02 — ajustes del Doctor de Datos en las salidas verificadas
// ---------------------------------------------------------------------------

describe('R2-02 — el PDF y el HTML divulgan los ajustes confirmados y el sello nombra ambas huellas', () => {
  // Caja registrada $500 de menos (balance descuadrado) y ajuste confirmado +$500.
  const CSV_DESCUADRADO = PROVENANCE_CSV.replace('110505,Caja,Auxiliar,1,1700', '110505,Caja,Auxiliar,1,1200');
  const LEDGER = {
    adjustments: [
      {
        id: 'adj-caja-arqueo-0001',
        accountCode: '110505',
        accountName: 'Caja',
        amount: 500,
        rationale: 'Arqueo de caja al cierre no registrado (confirmado por el usuario)',
        status: 'applied',
        proposedAt: '2026-09-24T00:00:00Z',
        appliedAt: '2026-09-24T00:05:00Z',
      },
    ],
  };

  it('por referencia: anexo de ajustes en el PDF y en el HTML; sello con N ajustes y las dos huellas (es)', async () => {
    const out = await consolidateWith(makeProvenanceParts(), { rawData: CSV_DESCUADRADO, adjustmentLedger: LEDGER });
    expect(out.provenance.status).toBe('persisted');
    expect(out.report.consolidatedReport).toMatch(/Ajustes contables aplicados/);

    const pdf = await exportReport(
      req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite', language: 'es' }),
    );
    expect(pdf.status).toBe(200);
    const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
      appendix: { adjustmentsTable?: Array<{ cuenta: string; descripcion: string; ajuste: number }>; validationWarnings?: string[] };
    };
    expect(doc.appendix.adjustmentsTable).toHaveLength(1);
    const row = doc.appendix.adjustmentsTable![0];
    expect(row.cuenta).toBe('110505');
    expect(row.ajuste).toBe(500);
    expect(row.descripcion).toContain('adj-caja');
    expect(row.descripcion).toMatch(/Arqueo de caja/);
    expect(row.descripcion).toMatch(/\$1\.200,00.*\$1\.700,00/);
    const stamp = (doc.appendix.validationWarnings ?? []).find((w) => w.startsWith('PROCEDENCIA VERIFICADA'))!;
    expect(stamp).toMatch(/1 ajuste\(s\) confirmado\(s\) por el usuario/);
    expect(stamp).toMatch(/balance preprocesado \(con los ajustes confirmados\)/);
    expect(stamp).toMatch(/balance recibido \(antes de los ajustes confirmados\)/);

    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(200);
    const excel = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excel.report.consolidatedReport).toMatch(/1 ajuste\(s\) confirmado\(s\) por el usuario/);

    const h = await html(req('/api/financial-report/html', { reportRef: out.reportRef, language: 'es' }));
    expect(h.status).toBe(200);
    const page = ((await h.json()) as { html: string }).html;
    expect(page).toMatch(/Ajustes confirmados por el usuario/);
    expect(page).toContain('adj-caja-arqueo-0001');
    expect(page).toContain('110505');
    expect(page).toMatch(/\$1\.200,00/);
    expect(page).toMatch(/\$1\.700,00/);
    expect(page).toMatch(/Arqueo de caja/);
  });

  it('sin referencia: el PDF lleva el anexo con el ledger de la petición; el HTML también', async () => {
    const out = await consolidateWith(makeProvenanceParts(), { rawData: CSV_DESCUADRADO, adjustmentLedger: LEDGER });
    const { serverVersion: _sv, ...report } = out.report as FinancialReport & { serverVersion?: unknown };
    void _sv;
    const pdf = await exportReport(
      req('/api/financial-report/export', {
        report,
        rawData: CSV_DESCUADRADO,
        adjustmentLedger: LEDGER,
        format: 'pdf-elite',
        language: 'en',
      }),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('X-Report-Provenance')).toBe('unverified');
    const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
      appendix: { adjustmentsTable?: Array<{ descripcion: string }>; validationWarnings?: string[] };
    };
    expect(doc.appendix.adjustmentsTable).toHaveLength(1);
    const stamp = (doc.appendix.validationWarnings ?? []).find((w) => w.startsWith('UNVERIFIED PROVENANCE'))!;
    expect(stamp).toMatch(/1 adjustment\(s\) confirmed by the user/);

    const read = preprocessUploadedTrialBalanceText(CSV_DESCUADRADO);
    if (read.kind !== 'ok') throw new Error('fixture');
    const h = await html(
      req('/api/financial-report/html', {
        niifReport: report.niifAnalysis.json,
        strategyReport: report.strategicAnalysis.json,
        governanceReport: report.governance.json,
        company: PROVENANCE_COMPANY,
        metadata: { reportMode: 'LINEA_BASE' },
        // El que usó /niif (ya ajustado), como lo reenvía la UI.
        preprocessed: toJsonSafe(applyAdjustments(read.preprocessed, LEDGER.adjustments as never).balance),
        adjustmentLedger: LEDGER,
        language: 'es',
      }),
    );
    expect(h.status, await h.clone().text()).toBe(200);
    const page = ((await h.json()) as { html: string }).html;
    expect(page).toMatch(/PROCEDENCIA NO VERIFICADA/);
    expect(page).toMatch(/Ajustes confirmados por el usuario/);
    expect(page).toContain('adj-caja-arqueo-0001');
  });
});

// ---------------------------------------------------------------------------
// procedencia-R2-04 — firmantes del acta cruzados con el intake
// ---------------------------------------------------------------------------

describe('R2-04 — firmantes y Revisor Fiscal del acta salen del intake, no del JSON', () => {
  function partsWithForeignSignatories() {
    const parts = makeProvenanceParts();
    const g = parts.governance.json as GovernanceReportJson;
    g.shareholderMinutes!.signatures = [
      { role: 'presidente_asamblea', name: 'Pedro Presidente', identification: 'C.C. 1.000.001' },
      { role: 'secretario_asamblea', name: 'Sara Secretaria', identification: 'C.C. 1.000.002' },
      { role: 'representante_legal', name: 'Rodrigo Impostor', identification: 'C.C. 9.999.999' },
    ] as never;
    g.shareholderMinutes!.fiscalReviewerOpinion = {
      ...g.shareholderMinutes!.fiscalReviewerOpinion,
      applies: true,
      reviewerName: 'Rogelio Revisor Ajeno',
      reviewerTp: '99999-T',
      exemptionReason: null,
    } as never;
    return parts;
  }

  it('con firmantes en el intake: el acta del PDF verificado imprime los del intake (nombre, C.C., T.P.)', async () => {
    const company = {
      ...PROVENANCE_COMPANY,
      legalRepresentative: 'Luisa Legal Intake',
      legalRepresentativeId: '52.111.222',
      fiscalAuditor: 'Ana Revisora Intake',
      fiscalAuditorTp: '12345-T',
    };
    const out = await consolidateWith(partsWithForeignSignatories(), { company });
    const pdf = await exportReport(
      req('/api/financial-report/export', { reportRef: out.reportRef, format: 'pdf-elite', language: 'es' }),
    );
    expect(pdf.status).toBe(200);
    const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
      shareholderMinutes?: { bodyMarkdown: string };
      signatureBlock: { rendered: string };
    };
    const acta = doc.shareholderMinutes!.bodyMarkdown;
    expect(acta).toContain('Luisa Legal Intake');
    expect(acta).toContain('C.C. 52.111.222');
    expect(acta).toContain('Ana Revisora Intake — T.P. 12345-T');
    for (const foreign of ['Rodrigo Impostor', '9.999.999', 'Rogelio Revisor Ajeno', '99999-T', 'Pedro Presidente', 'Sara Secretaria']) {
      expect(acta).not.toContain(foreign);
    }
    expect(doc.signatureBlock.rendered).toContain('Ana Revisora Intake');
    // El JSON persistido (el que ven el Editor Jefe y el Excel) tampoco los lleva.
    const persistedJson = JSON.stringify(out.report.governance.json);
    expect(persistedJson).not.toContain('Rodrigo Impostor');
    expect(persistedJson).not.toContain('Rogelio Revisor Ajeno');
    expect(persistedJson).toContain('Luisa Legal Intake');
  });

  it('sin firmantes en el intake: nombres e identificaciones "a completar al firmar", nunca los del JSON', async () => {
    const out = await consolidateWith(partsWithForeignSignatories());
    expect(out.report.governance.actaQualifications?.clean).toBe(true);
    const acta = out.report.governance.shareholderMinutes;
    expect(acta).toMatch(/Representante Legal \| — \(a completar al firmar\) \|/);
    expect(acta).toMatch(/— \(a completar al firmar\), Revisor Fiscal de/);
    for (const foreign of ['Rodrigo Impostor', '9.999.999', 'Rogelio Revisor Ajeno', '99999-T', 'Pedro Presidente']) {
      expect(acta).not.toContain(foreign);
    }
    const xlsx = await exportReport(req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel' }));
    expect(xlsx.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// e2e-niif2-05 — idioma del informe persistido por defecto
// ---------------------------------------------------------------------------

describe('e2e-niif2-05 — un informe en inglés pedido sin language sale en inglés', () => {
  it('Excel por referencia con el cuerpo de la UI (buildExportRequestBody, presentación vacía)', async () => {
    const out = await consolidateWith(makeProvenanceParts(), { language: 'en' });
    expect(out.report.consolidatedReport).toMatch(/^# CONSOLIDATED FINANCIAL REPORT$/m);
    const { buildExportRequestBody } = await import('@/components/workspace/PipelineWorkspace');
    const withRef = { ...out.report, serverVersion: { ...(out.provenance as object), ...out.reportRef } };
    const body = buildExportRequestBody({
      report: withRef as never,
      rawData: PROVENANCE_CSV,
      preprocessed: null,
      adjustmentLedger: null,
      presentation: {},
    });
    expect(body.language).toBeUndefined();
    const res = await exportReport(req('/api/financial-report/export', body));
    expect(res.status).toBe(200);
    const excel = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excel.language).toBe('en');
    expect(excel.report.consolidatedReport.startsWith('# VERIFIED PROVENANCE')).toBe(true);
    expect(excel.report.consolidatedReport).not.toMatch(/PROCEDENCIA VERIFICADA/);
  });

  it('un language explícito del cuerpo prevalece (presentación)', async () => {
    const out = await consolidateWith(makeProvenanceParts(), { language: 'en' });
    const res = await exportReport(
      req('/api/financial-report/export', { reportRef: out.reportRef, format: 'excel', language: 'es' }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(generateFinancialExcel).mock.calls[0][0].language).toBe('es');
  });
});

// ---------------------------------------------------------------------------
// procedencia-R2-07 — "Aplicar al reporte" no se descarta en silencio
// ---------------------------------------------------------------------------

describe('R2-07 — ediciones del chat en /export sin referencia', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    state.workspace = null;
  });
  afterEach(() => {
    process.env.DATABASE_URL = 'postgres://fake-for-tests';
  });

  const EDIT = '## Nota añadida por el usuario desde el chat\nTexto editado por el contador antes de exportar.';

  it('Excel y PDF: el artefacto y las cabeceras declaran que la edición no se incluye; la UI lo avisa', async () => {
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody()));
    const { report } = (await res.json()) as { report: FinancialReport };
    const { applyReportPatch, buildExportRequestBody, userEditNotice } = await import(
      '@/components/workspace/PipelineWorkspace'
    );
    // Lo que hace handlePatchReport.
    const edited = applyReportPatch(report as never, `${report.consolidatedReport}\n\n${EDIT}`);
    expect(userEditNotice(edited, 'es')).toMatch(/no las incluyen/);
    expect(userEditNotice(edited, 'en')).toMatch(/do not include them/);
    expect(userEditNotice(report as never, 'es')).toBeNull();

    const body = buildExportRequestBody({
      report: edited,
      rawData: PROVENANCE_CSV,
      preprocessed: null,
      adjustmentLedger: null,
      presentation: { format: 'excel', language: 'es' },
    });
    expect(body.reportRef).toBeUndefined();
    const ex = await exportReport(req('/api/financial-report/export', body));
    expect(ex.status).toBe(200);
    expect(ex.headers.get('X-Report-Provenance')).toBe('unverified');
    expect(ex.headers.get('X-Report-Edit-Dropped')).toBe('true');
    const excel = vi.mocked(generateFinancialExcel).mock.calls[0][0];
    expect(excel.report.consolidatedReport).not.toContain('Nota añadida por el usuario');
    expect(excel.report.consolidatedReport).toMatch(/ediciones aplicadas en el navegador .*no se incluyen/i);

    const pdf = await exportReport(
      req('/api/financial-report/export', { ...body, format: 'pdf-elite', language: 'en' }),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('X-Report-Edit-Dropped')).toBe('true');
    const doc = vi.mocked(composeEditorialReport).mock.results[0].value as {
      appendix: { validationWarnings?: string[] };
    };
    const stamp = (doc.appendix.validationWarnings ?? []).find((w) => w.startsWith('UNVERIFIED PROVENANCE'))!;
    expect(stamp).toMatch(/edits applied in the browser .*are not included/i);
  });

  it('control: sin edición no hay aviso ni cabecera', async () => {
    const res = await consolidate(req('/api/financial-report/consolidate', consolidateBody()));
    const { report } = (await res.json()) as { report: FinancialReport };
    const ex = await exportReport(
      req('/api/financial-report/export', { report, rawData: PROVENANCE_CSV, format: 'excel', language: 'es' }),
    );
    expect(ex.status).toBe(200);
    expect(ex.headers.get('X-Report-Edit-Dropped')).toBeNull();
  });
});
