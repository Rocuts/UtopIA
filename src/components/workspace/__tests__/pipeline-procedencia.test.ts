// Procedencia servidor (fase 2, P1) — contratos cliente → servidor de la UI.
//
//   · /consolidate recibe las tres partes completas (`reportParts`) para
//     persistir la versión del informe; sus textos salen de `fullContent`.
//   · Con versión persistida, /export y /html se piden POR REFERENCIA: el
//     cuerpo no lleva el informe ni sus fuentes (el servidor los ignora).
//   · pipeline-flujo-19: "Generar HTML" sin preprocesado en la sesión ya no se
//     queda en silencio: con referencia lo toma el servidor; sin ninguna fuente
//     la UI lo explica (mensaje i18n).
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  auditDownloadNotice,
  buildAuditRequestBody,
  buildConsolidationRequestBody,
  buildExportRequestBody,
  buildQualityRequestBody,
  exportAuditFields,
  persistPreprocessedForResume,
  recallAdjustmentLedgerForResume,
  pairCachedSource,
  recallPreprocessedForResume,
  resolveHtmlSource,
} from '../PipelineWorkspace';
import { attachServerVersion, detachServerVersion, type ReportProvenance } from '@/lib/reports/report-ref';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { dict } from '@/lib/i18n/dictionaries';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';

const PROVENANCE: ReportProvenance = {
  reportId: '0b9c7d1e-2f3a-4b5c-8d6e-7f8091a2b3c4',
  reportHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rawDataHash: null,
  contractVersion: 'informe-niif-2026-09-24.1',
  preprocessorVersion: 'tb-2026-09-24.2',
  createdAt: '2026-09-24T12:00:00.000Z',
};
const REF = { reportId: PROVENANCE.reportId, reportHash: PROVENANCE.reportHash };
const LEDGER = {
  adjustments: [
    {
      id: 'a1', accountCode: '1105', accountName: 'Caja', amount: 1000, rationale: 'ajuste',
      status: 'applied' as const, proposedAt: '2026-09-24T00:00:00.000Z',
    },
  ],
};

describe('buildExportRequestBody', () => {
  it('con versión persistida viaja sólo la referencia y la presentación', () => {
    const report = attachServerVersion(makeExportableReport(), PROVENANCE);
    const body = buildExportRequestBody({
      report,
      rawData: 'codigo,nombre,saldo',
      preprocessed: { periods: [] },
      adjustmentLedger: LEDGER,
      presentation: { format: 'pdf-elite', language: 'es' },
    });
    expect(body).toEqual({ reportRef: REF, format: 'pdf-elite', language: 'es' });
  });

  it('sin versión persistida (o tras editar el informe) viaja el informe con sus fuentes', () => {
    const report = detachServerVersion(attachServerVersion(makeExportableReport(), PROVENANCE));
    const body = buildExportRequestBody({
      report,
      rawData: 'csv',
      preprocessed: { primary: {} },
      adjustmentLedger: LEDGER,
      presentation: {},
    });
    expect(body).toEqual({ report, rawData: 'csv', preprocessed: { primary: {} }, adjustmentLedger: LEDGER });
    expect('reportRef' in body).toBe(false);
  });
});

describe('resolveHtmlSource (pipeline-flujo-19)', () => {
  it('referencia > preprocesado de la sesión > ninguna fuente', () => {
    const persisted = attachServerVersion(makeExportableReport(), PROVENANCE);
    expect(resolveHtmlSource(persisted, null)).toEqual({ kind: 'ref', ref: REF });
    expect(resolveHtmlSource(makeExportableReport(), { primary: {} })).toEqual({ kind: 'preprocessed' });
    expect(resolveHtmlSource(makeExportableReport(), null)).toEqual({ kind: 'missing' });
    expect(resolveHtmlSource(makeExportableReport(), undefined)).toEqual({ kind: 'missing' });
  });

  it('el motivo de "no se puede generar el HTML" existe en español e inglés', () => {
    expect(dict.es.reportProvenance.htmlMissingSource).toMatch(/No se puede generar el HTML/);
    expect(dict.en.reportProvenance.htmlMissingSource).toMatch(/cannot be generated/);
  });
});

describe('buildConsolidationRequestBody', () => {
  it('envía las tres partes completas (texto, JSON y veredictos) y el ledger con ajustes', () => {
    const r = makeExportableReport();
    const company = { name: 'Empresa Prueba SAS', nit: '900123456', fiscalPeriod: '2025' } as CompanyInfo;
    const body = buildConsolidationRequestBody({
      rawData: 'csv',
      company,
      language: 'es',
      niifResult: r.niifAnalysis,
      strategyResult: r.strategicAnalysis,
      governanceResult: r.governance,
      adjustmentLedger: LEDGER,
    });
    expect(body).toEqual({
      rawData: 'csv',
      company,
      language: 'es',
      reportParts: { niifAnalysis: r.niifAnalysis, strategicAnalysis: r.strategicAnalysis, governance: r.governance },
      adjustmentLedger: LEDGER,
    });
    const sinLedger = buildConsolidationRequestBody({
      rawData: 'csv', company, language: 'es', niifResult: r.niifAnalysis,
      strategyResult: r.strategicAnalysis, governanceResult: r.governance,
      adjustmentLedger: { adjustments: [] },
    });
    expect('adjustmentLedger' in sinLedger).toBe(false);
  });
});

// niif-preproceso-33 × recarga: /export y /html re-derivan el preprocesado de
// la sesión con el ledger del Doctor de Datos y rechazan (422) si no casa. El
// ledger vivía sólo en el intake en memoria: tras recargar un informe ya
// terminado, el preprocesado ajustado se recuperaba de sessionStorage pero sin
// su ledger, y un informe honesto con ajustes quedaba sin descargas.
describe('ledger del Doctor de Datos tras una recarga', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      removeItem: (k: string) => {
        m.delete(k);
      },
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
    };
  }
  const pp = { primary: { period: '2025' } };
  const withProposed = {
    adjustments: [
      ...LEDGER.adjustments,
      { ...LEDGER.adjustments[0], id: 'a2', status: 'proposed' as const },
    ],
  };

  it('se guarda junto al preprocesado (sólo los confirmados) y se recupera por conversación', () => {
    const s = memoryStorage();
    expect(persistPreprocessedForResume('report-1', pp, s, withProposed)).toBe(true);
    expect(recallPreprocessedForResume('report-1', s)).toEqual(pp);
    expect(recallAdjustmentLedgerForResume('report-1', s)).toEqual(LEDGER);
    expect(recallAdjustmentLedgerForResume('report-2', s)).toBeNull();
    expect(persistPreprocessedForResume('report-3', pp, s)).toBe(true);
    expect(recallAdjustmentLedgerForResume('report-3', s)).toBeNull();
  });

  // I3-3: antes el ledger de /export y /html salía de la corrida en memoria o
  // pendiente ("la corrida vigente manda"). Tras una regeneración con ajustes
  // que falló en /niif (y una recarga) esa corrida no es la que produjo el
  // preprocesado en caché: ledger nuevo + preprocesado viejo → 422. Ahora el
  // ledger es el que produjo ESE preprocesado y viaja con él.
  it('el ledger viaja con el preprocesado que produjo (sólo confirmados); sin ajustes, null', () => {
    expect(pairCachedSource(pp, withProposed)).toEqual({ preprocessed: pp, adjustmentLedger: LEDGER });
    // Una corrida nueva sin ajustes no hereda el ledger de otra conversación.
    expect(pairCachedSource(pp, null).adjustmentLedger).toBeNull();
    expect(pairCachedSource(pp, { adjustments: [] }).adjustmentLedger).toBeNull();
    // Sin preprocesado no hay nada que re-derivar.
    expect(pairCachedSource(null, LEDGER)).toEqual({ preprocessed: null, adjustmentLedger: null });
  });

  it('el cuerpo de /export sin referencia lleva el ledger recuperado junto al preprocesado', () => {
    const s = memoryStorage();
    persistPreprocessedForResume('report-1', pp, s, LEDGER);
    const ledger = pairCachedSource(
      recallPreprocessedForResume('report-1', s),
      recallAdjustmentLedgerForResume('report-1', s),
    ).adjustmentLedger;
    const body = buildExportRequestBody({
      report: makeExportableReport(),
      rawData: 'csv',
      preprocessed: recallPreprocessedForResume('report-1', s),
      adjustmentLedger: ledger,
      presentation: {},
    });
    expect(body.preprocessed).toEqual(pp);
    expect(body.adjustmentLedger).toEqual(LEDGER);
  });
});

// ---------------------------------------------------------------------------
// Partes IV y V por referencia
// ---------------------------------------------------------------------------
// Con versión persistida la auditoría y la meta-auditoría se piden con la
// referencia de la versión (el servidor las corre sobre ella y las guarda), y
// /export recibe sólo referencias de resultados persistidos y completos.

const AUDIT_REF = { resultId: '5c1d7e2f-3a4b-4c5d-8e6f-708192a3b4c5', resultHash: 'c'.repeat(64) };
const QUALITY_REF = { resultId: '6d2e8f3a-4b5c-4d6e-8f70-8192a3b4c5d6', resultHash: 'd'.repeat(64) };
const audit = (extra: Partial<AuditReport> = {}) => ({ overallScore: 90, ...extra }) as unknown as AuditReport;
const quality = (extra: Partial<QualityAssessment> = {}) => ({ grade: 'B', ...extra }) as unknown as QualityAssessment;

describe('Partes IV/V: cuerpos por referencia', () => {
  const persisted = () => attachServerVersion(makeExportableReport(), PROVENANCE);

  it('la auditoría y la meta-auditoría viajan sólo con referencias', () => {
    expect(buildAuditRequestBody({ report: persisted(), preprocessed: { periods: [] }, adjustmentLedger: LEDGER, language: 'es' }))
      .toEqual({ reportRef: REF, language: 'es' });
    expect(buildQualityRequestBody({
      report: persisted(), auditReport: audit({ auditRef: AUDIT_REF }), language: 'en', preprocessed: { periods: [] },
    })).toEqual({ reportRef: REF, language: 'en', auditRef: AUDIT_REF });
    // Una Parte IV sin referencia (no guardada) no se nombra.
    expect(buildQualityRequestBody({ report: persisted(), auditReport: audit(), language: 'es', preprocessed: null }))
      .toEqual({ reportRef: REF, language: 'es' });
  });

  it('sin versión persistida conservan el camino anterior (contenido, procedencia no verificada)', () => {
    const report = makeExportableReport();
    expect(buildAuditRequestBody({ report, preprocessed: null, language: 'es' })).toEqual({ report, language: 'es' });
    const a = audit();
    expect(exportAuditFields({ report, auditReport: a, qualityReport: null })).toEqual({ auditReport: a, qualityReport: null });
  });

  it('la descarga sólo nombra resultados persistidos y completos', () => {
    const report = persisted();
    expect(exportAuditFields({
      report,
      auditReport: audit({ auditRef: AUDIT_REF, auditComplete: true }),
      qualityReport: quality({ qualityRef: QUALITY_REF, qualityComplete: true }),
    })).toEqual({ auditRef: AUDIT_REF, qualityRef: QUALITY_REF });
    // Parcial o no guardado: fuera del archivo, sin contenido en el cuerpo.
    expect(exportAuditFields({
      report,
      auditReport: audit({ auditRef: AUDIT_REF, auditComplete: false }),
      qualityReport: quality({ qualityComplete: true }),
    })).toEqual({});
  });

  it('el aviso junto a las descargas dice qué entra en el archivo y qué no', () => {
    const report = persisted();
    const notice = auditDownloadNotice({
      report,
      auditReport: audit({ auditRef: AUDIT_REF, auditComplete: true }),
      qualityReport: quality({ qualityRef: QUALITY_REF, qualityComplete: false }),
      language: 'es',
    });
    const copy = dict.es.reportProvenance;
    expect(notice.included).toBe(copy.uiAuditIncluded.replace('{parts}', copy.uiAuditPartIv));
    expect(notice.excluded).toBe(copy.uiAuditExcluded.replace('{parts}', copy.uiAuditPartV));
    // Sin versión persistida el aviso de procedencia no verificada ya lo cubre.
    expect(auditDownloadNotice({ report: makeExportableReport(), auditReport: audit(), qualityReport: null, language: 'es' }))
      .toEqual({ included: null, excluded: null });
  });
});

describe('un informe nuevo no hereda la auditoría del anterior', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../PipelineWorkspace.tsx', import.meta.url)), 'utf8');
  it('limpia la auditoría y la meta-auditoría en toda corrida nueva, no sólo en un re-run', () => {
    // Antes sólo con `isRerun`: tras recargar, el primer informe de la sesión
    // conservaba la auditoría restaurada del anterior y salía en su descarga.
    expect(SRC).toMatch(
      /if \(start === 'niif'\) \{\s*\n\s*setAuditReport\(null\);\s*\n\s*auditReportRef\.current = null;\s*\n\s*setQualityReport\(null\);\s*\n\s*\}/,
    );
    expect(SRC).not.toMatch(/if \(isRerun\) \{\s*\n\s*setAuditReport\(null\);/);
  });
});
