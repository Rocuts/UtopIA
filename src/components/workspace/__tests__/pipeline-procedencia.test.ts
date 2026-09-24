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

import {
  buildConsolidationRequestBody,
  buildExportRequestBody,
  persistPreprocessedForResume,
  recallAdjustmentLedgerForResume,
  recallPreprocessedForResume,
  resolveEffectiveAdjustmentLedger,
  resolveHtmlSource,
} from '../PipelineWorkspace';
import { attachServerVersion, detachServerVersion, type ReportProvenance } from '@/lib/reports/report-ref';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { dict } from '@/lib/i18n/dictionaries';
import type { CompanyInfo } from '@/lib/agents/financial/types';

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

  it('el ledger de la corrida vigente manda; sin corrida se usa el recuperado', () => {
    expect(resolveEffectiveAdjustmentLedger({ adjustmentLedger: LEDGER }, null)).toBe(LEDGER);
    // Una corrida nueva sin ajustes no hereda el ledger de otra conversación.
    expect(resolveEffectiveAdjustmentLedger({}, LEDGER)).toBeNull();
    expect(resolveEffectiveAdjustmentLedger(null, LEDGER)).toBe(LEDGER);
    expect(resolveEffectiveAdjustmentLedger(null, null)).toBeNull();
  });

  it('el cuerpo de /export sin referencia lleva el ledger recuperado junto al preprocesado', () => {
    const s = memoryStorage();
    persistPreprocessedForResume('report-1', pp, s, LEDGER);
    const ledger = resolveEffectiveAdjustmentLedger(null, recallAdjustmentLedgerForResume('report-1', s));
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
