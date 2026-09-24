// ---------------------------------------------------------------------------
// Procedencia servidor (fase 2, P1) — versión persistida del informe
// ---------------------------------------------------------------------------
// Unidad pura: huella canónica reproducible tras el viaje por jsonb, integridad
// de la versión (informe y balance), referencia que viaja con la UI, partes que
// recibe /consolidate, entrada del HTML desde la versión y sello impreso en los
// artefactos. Las pruebas de rutas con almacenamiento controlado viven en
// src/app/api/financial-report/__tests__/procedencia-servidor.route.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { parseTrialBalanceCSV, preprocessTrialBalance } from '@/lib/preprocessing/trial-balance';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { PREPROCESSOR_CONTRACT_VERSION } from '@/lib/api/trial-balances';
import { canonicalHash, canonicalJson } from '../canonical';
import {
  buildFinancialReportVersion,
  FINANCIAL_REPORT_CONTRACT_VERSION,
  FINANCIAL_REPORT_VERSION_FORMAT,
  provenanceOf,
  REPORT_PREPROCESSOR_VERSION,
  verifyFinancialReportVersion,
} from '../financial-report-version';
import {
  attachServerVersion,
  detachServerVersion,
  parseReportRef,
  readReportRef,
  readServerVersion,
  SERVER_VERSION_FIELD,
  type ReportProvenance,
} from '../report-ref';
import { parseReportParts, REPORT_PARTS_MAX_CHARS } from '../report-parts';
import { countStrategyAlerts, htmlInputFromPersisted } from '../html-input';
import {
  appendPdfProvenance,
  provenanceHeaders,
  provenanceLines,
  stampHtmlProvenance,
  withExcelProvenance,
  type ArtifactProvenance,
} from '../provenance-stamp';
import { PROVENANCE_CSV, makeProvenanceParts } from './provenance-fixture';

const preprocessed = () => preprocessTrialBalance(parseTrialBalanceCSV(PROVENANCE_CSV));
/** Lo que devuelve `jsonb`: un viaje JSON. */
const jsonb = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function version() {
  return buildFinancialReportVersion({
    report: makeExportableReport(),
    preprocessed: preprocessed(),
    rawData: PROVENANCE_CSV,
    createdAt: '2026-09-24T12:00:00.000Z',
  });
}

const PROVENANCE: ReportProvenance = {
  reportId: '0b9c7d1e-2f3a-4b5c-8d6e-7f8091a2b3c4',
  reportHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rawDataHash: 'c'.repeat(64),
  contractVersion: FINANCIAL_REPORT_CONTRACT_VERSION,
  preprocessorVersion: REPORT_PREPROCESSOR_VERSION,
  createdAt: '2026-09-24T12:00:00.000Z',
};
const VERIFIED: ArtifactProvenance = { kind: 'verified', provenance: PROVENANCE };
const UNVERIFIED: ArtifactProvenance = { kind: 'unverified' };

describe('huella canónica', () => {
  it('no depende del orden de las claves; bigint viaja como decimal; undefined se omite', () => {
    expect(canonicalJson({ b: 1, a: { d: BigInt(12), c: undefined } })).toBe('{"a":{"d":"12"},"b":1}');
    expect(canonicalHash({ x: 1, y: [2, 3] })).toBe(canonicalHash({ y: [2, 3], x: 1 }));
    expect(canonicalHash({ y: [3, 2] })).not.toBe(canonicalHash({ y: [2, 3] }));
  });
});

describe('versión persistida', () => {
  it('se reproduce tras el viaje por jsonb: mismas huellas y balance revivido con BigInt', () => {
    const v = version();
    expect(v.format).toBe(FINANCIAL_REPORT_VERSION_FORMAT);
    expect(v.contractVersion).toBe(FINANCIAL_REPORT_CONTRACT_VERSION);
    expect(v.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.rawDataHash).toMatch(/^[0-9a-f]{64}$/);
    const out = verifyFinancialReportVersion(jsonb(v));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.reportHash).toBe(v.reportHash);
    expect(out.preprocessed?.primary.controlTotals.cents?.activo).toBe(BigInt(1_000_000));
    expect(out.report.company.name).toBe('Empresa Prueba SAS');
  });

  it('un informe alterado dentro de la fila no pasa la verificación de integridad', () => {
    const stored = jsonb(version());
    stored.report.niifAnalysis.json!.balanceSheet.totalAssetsPrimary = '99999900';
    const out = verifyFinancialReportVersion(stored);
    expect(out).toEqual({ ok: false, reason: 'el informe persistido no coincide con su huella' });
  });

  it('un balance alterado dentro de la fila no pasa la verificación de integridad', () => {
    const stored = jsonb(version()) as unknown as { preprocessed: { primary: { controlTotals: { activo: number } } } };
    stored.preprocessed.primary.controlTotals.activo = 1;
    const out = verifyFinancialReportVersion(stored);
    expect(out).toEqual({ ok: false, reason: 'el balance persistido no coincide con su huella' });
  });

  it('formato desconocido o sin huella → no se reconoce', () => {
    expect(verifyFinancialReportVersion({ ...jsonb(version()), format: 'otro' }).ok).toBe(false);
    expect(verifyFinancialReportVersion(null).ok).toBe(false);
    expect(verifyFinancialReportVersion({ ...jsonb(version()), reportHash: 'x' }).ok).toBe(false);
  });

  it('sin balance: sourceHash null y la versión sigue verificándose', () => {
    const v = buildFinancialReportVersion({ report: makeExportableReport(), preprocessed: null, rawData: null });
    expect(v.sourceHash).toBeNull();
    expect(v.rawDataHash).toBeNull();
    const out = verifyFinancialReportVersion(jsonb(v));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.preprocessed).toBeUndefined();
  });

  it('la procedencia expone referencia, huellas y contrato', () => {
    const v = version();
    expect(provenanceOf(PROVENANCE.reportId, v)).toMatchObject({
      reportId: PROVENANCE.reportId,
      reportHash: v.reportHash,
      sourceHash: v.sourceHash,
      contractVersion: FINANCIAL_REPORT_CONTRACT_VERSION,
      preprocessorVersion: REPORT_PREPROCESSOR_VERSION,
      createdAt: '2026-09-24T12:00:00.000Z',
    });
  });

  it('deriva: el contrato del preprocesador es el mismo que publica el API v1', () => {
    expect(REPORT_PREPROCESSOR_VERSION).toBe(PREPROCESSOR_CONTRACT_VERSION);
  });
});

describe('referencia {reportId, reportHash}', () => {
  it('ausente no es error; forma inválida sí; el uuid se normaliza a minúsculas', () => {
    expect(parseReportRef(undefined)).toEqual({ kind: 'absent' });
    expect(parseReportRef(null)).toEqual({ kind: 'absent' });
    expect(parseReportRef('x')).toEqual({ kind: 'invalid' });
    expect(parseReportRef({ reportId: 'no-uuid', reportHash: 'a'.repeat(64) })).toEqual({ kind: 'invalid' });
    expect(parseReportRef({ reportId: PROVENANCE.reportId, reportHash: 'A'.repeat(64) })).toEqual({ kind: 'invalid' });
    expect(
      parseReportRef({ reportId: PROVENANCE.reportId.toUpperCase(), reportHash: PROVENANCE.reportHash }),
    ).toEqual({ kind: 'ok', ref: { reportId: PROVENANCE.reportId, reportHash: PROVENANCE.reportHash } });
  });

  it('la UI adjunta y suelta la procedencia sin tocar el resto del informe', () => {
    const report = makeExportableReport();
    const attached = attachServerVersion(report, PROVENANCE);
    expect(readReportRef(attached)).toEqual({ reportId: PROVENANCE.reportId, reportHash: PROVENANCE.reportHash });
    expect(readServerVersion(attached)?.contractVersion).toBe(FINANCIAL_REPORT_CONTRACT_VERSION);
    const detached = detachServerVersion(attached);
    expect(SERVER_VERSION_FIELD in detached).toBe(false);
    expect(readReportRef(detached)).toBeNull();
    expect(detachServerVersion(report)).toBe(report);
    expect(readReportRef({ serverVersion: { reportId: 'x', reportHash: 'y' } })).toBeNull();
  });
});

describe('partes I–III que recibe /consolidate', () => {
  it('ausentes → camino histórico; válidas → se conservan sólo las claves del informe', () => {
    expect(parseReportParts(undefined)).toEqual({ kind: 'absent' });
    const parts = makeProvenanceParts();
    const out = parseReportParts({
      ...parts,
      niifAnalysis: { ...parts.niifAnalysis, inyectado: 'x' },
    });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.parts.niifAnalysis.fullContent).toBe(parts.niifAnalysis.fullContent);
    expect('inyectado' in out.parts.niifAnalysis).toBe(false);
    expect(out.parts.niifAnalysis.json).toEqual(parts.niifAnalysis.json);
  });

  it('sin fullContent, con tipos inválidos o por encima del tope → inválidas', () => {
    const parts = makeProvenanceParts();
    const noFull = parseReportParts({ ...parts, governance: { ...parts.governance, fullContent: '' } });
    expect(noFull.kind).toBe('invalid');
    const badJson = parseReportParts({ ...parts, strategicAnalysis: { ...parts.strategicAnalysis, json: 'x' } });
    expect(badJson.kind).toBe('invalid');
    expect(parseReportParts([]).kind).toBe('invalid');
    const huge = parseReportParts({
      ...parts,
      niifAnalysis: { ...parts.niifAnalysis, technicalNotes: 'x'.repeat(REPORT_PARTS_MAX_CHARS) },
    });
    expect(huge.kind).toBe('invalid');
  });
});

describe('entrada del HTML desde la versión persistida', () => {
  it('JSON, empresa, balance, veredictos y cifras de la metadata salen de la versión; el cuerpo sólo aporta presentación', () => {
    const v = verifyFinancialReportVersion(jsonb(version()));
    if (!v.ok) throw new Error('fixture');
    const body = {
      niifReport: { alterado: true },
      strategyReport: { alterado: true },
      governanceReport: { alterado: true },
      company: { name: 'Otra SAS', nit: '1', fiscalPeriod: '1999' },
      preprocessed: { alterado: true },
      actaQualifications: { clean: true },
      metadata: {
        entityCity: 'Cali',
        entityName: 'Otra SAS',
        coverageByClass: [],
        auxiliariesProcessed: 99_999,
        alertsCounts: { high: 0, medium: 0, low: 0 },
        reportHashSha256: 'f'.repeat(64),
        periodYear: '1999',
      },
      language: 'es',
    };
    const out = htmlInputFromPersisted(body, {
      report: v.report,
      preprocessed: v.preprocessed,
      provenance: { ...PROVENANCE, reportHash: v.data.reportHash },
    });
    expect(out.niifReport).toEqual(v.report.niifAnalysis.json);
    expect(out.strategyReport).toEqual(v.report.strategicAnalysis.json ?? null);
    expect(out.governanceReport).toEqual(v.report.governance.json ?? null);
    expect(out.company).toEqual(v.report.company);
    expect((out.preprocessed as { primary: { controlTotals: { activo: number } } }).primary.controlTotals.activo).toBe(10000);
    expect(out.actaQualifications).toBeNull();
    const meta = out.metadata as Record<string, unknown>;
    expect(meta.entityCity).toBe('Cali');
    expect(meta.entityName).toBe('Empresa Prueba SAS');
    expect(meta.auxiliariesProcessed).toBe(v.preprocessed?.auxiliaryCount);
    expect(meta.reportHashSha256).toBe(v.data.reportHash);
    expect(meta.periodYear).toBe('2025');
    expect(meta.periodEnd).toBe('2025-12-31');
    expect((meta.coverageByClass as unknown[]).length).toBeGreaterThan(0);
    expect(out.language).toBe('es');
  });

  it('alertas de la Parte II por severidad', () => {
    expect(
      countStrategyAlerts({ technicalAlerts: [{ severity: 'red' }, { severity: 'amber' }, { severity: 'red' }, null] }),
    ).toEqual({ high: 2, medium: 1, low: 0 });
    expect(countStrategyAlerts(null)).toEqual({ high: 0, medium: 0, low: 0 });
  });
});

describe('sello de procedencia en los artefactos', () => {
  it('verificada: título, versión, huellas y contrato (es/en); no verificada: rótulo explícito', () => {
    const es = provenanceLines(VERIFIED, 'es');
    expect(es[0]).toBe('PROCEDENCIA VERIFICADA');
    expect(es.join('\n')).toContain(PROVENANCE.reportId);
    expect(es.join('\n')).toContain(`Huella SHA-256 del informe: ${PROVENANCE.reportHash}`);
    expect(es.join('\n')).toContain(`Huella SHA-256 del balance preprocesado: ${PROVENANCE.sourceHash}`);
    expect(es.join('\n')).toContain(`contrato ${FINANCIAL_REPORT_CONTRACT_VERSION}`);
    expect(provenanceLines(VERIFIED, 'en')[0]).toBe('VERIFIED PROVENANCE');
    expect(provenanceLines(UNVERIFIED, 'es')[0]).toBe('PROCEDENCIA NO VERIFICADA');
    expect(provenanceLines(UNVERIFIED, 'en')[0]).toBe('UNVERIFIED PROVENANCE');
    expect(provenanceLines({ kind: 'verified', provenance: { ...PROVENANCE, sourceHash: null } }, 'es').join('\n'))
      .toContain('no disponible en la versión persistida');
  });

  it('HTML: <meta> en <head>, comentario y aviso visible tras <body>; sin <body> se antepone', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body class="a"><p>hola</p></body></html>';
    const out = stampHtmlProvenance(html, VERIFIED, 'es');
    expect(out).toMatch(/<head><meta name="utopia-report-provenance" content="status=verified; report=/);
    expect(out).toMatch(/<body class="a"><!-- REPORT_PROVENANCE: status=verified;/);
    expect(out).toContain('data-provenance="verified"');
    expect(out.indexOf('PROCEDENCIA VERIFICADA')).toBeLessThan(out.indexOf('<p>hola</p>'));
    const bare = stampHtmlProvenance('<p>x</p>', UNVERIFIED, 'en');
    expect(bare.startsWith('<!-- REPORT_PROVENANCE: status=unverified -->')).toBe(true);
    expect(bare).toContain('UNVERIFIED PROVENANCE');
  });

  it('Excel: bloque al inicio del Resumen sobre una copia; PDF: renglón en el Anexo; cabeceras', () => {
    const report = makeExportableReport();
    const before = report.consolidatedReport;
    const stamped = withExcelProvenance(report, UNVERIFIED, 'es');
    expect(stamped.consolidatedReport.startsWith('# PROCEDENCIA NO VERIFICADA')).toBe(true);
    expect(report.consolidatedReport).toBe(before);
    const doc: { appendix?: { validationWarnings?: string[] } } = { appendix: { validationWarnings: ['previa'] } };
    appendPdfProvenance(doc, VERIFIED, 'es');
    expect(doc.appendix?.validationWarnings?.[0]).toBe('previa');
    expect(doc.appendix?.validationWarnings?.[1]).toMatch(/^PROCEDENCIA VERIFICADA — /);
    expect(provenanceHeaders(VERIFIED)).toEqual({
      'X-Report-Provenance': 'verified',
      'X-Report-Id': PROVENANCE.reportId,
      'X-Report-Hash': PROVENANCE.reportHash,
    });
    expect(provenanceHeaders(UNVERIFIED)).toEqual({ 'X-Report-Provenance': 'unverified' });
  });
});

describe('sello "procedencia no verificada"', () => {
  it('no afirma una validación contra el balance que la solicitud pudo no traer', async () => {
    const { provenanceLines } = await import('../provenance-stamp');
    for (const lang of ['es', 'en'] as const) {
      const [, body] = provenanceLines({ kind: 'unverified' }, lang);
      // Sin `preprocessed` ni `rawData` el gate sólo prueba coherencia interna.
      expect(body).toMatch(lang === 'es' ? /si lo traía/ : /if it included one/);
    }
  });
});
