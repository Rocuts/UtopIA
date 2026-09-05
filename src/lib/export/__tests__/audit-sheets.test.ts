import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import { generateFinancialExcel } from '../excel-export';
import { composeEditorialReport } from '../pdf-elite-react';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';

// The route-level tests replace the exporters with mocks, so the audit
// rendering itself is only exercised here, against real ExcelJS output and the
// real PDF composer.

function makeAudit(overrides: Partial<AuditReport> = {}): AuditReport {
  const report = makeExportableReport();
  const domains = ['niif', 'tributario', 'legal', 'revisoria'] as const;
  return {
    company: report.company,
    auditorResults: domains.map(domain => ({
      domain, auditorName: `Auditor ${domain}`, complianceScore: 91,
      findings: [], summary: `Resumen ${domain}`, fullContent: '', failed: false,
    })),
    overallScore: 91,
    opinionType: 'con_salvedades',
    opinionText: 'Con salvedades.',
    consolidatedFindings: [{
      code: 'TRIB-004', severity: 'critico', domain: 'tributario',
      title: 'Retención no practicada', description: 'Pago sin retención en la fuente.',
      normReference: 'Art. 383 E.T.', recommendation: 'Practicar y declarar.',
      impact: 'Sanción por inexactitud.',
    }],
    findingCounts: { critico: 1, alto: 0, medio: 0, bajo: 0, informativo: 0 },
    executiveSummary: 'Una salvedad tributaria.',
    consolidatedReport: '# Auditoría consolidada',
    generatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuality(): QualityAssessment {
  return {
    overallScore: 84, grade: 'B',
    dimensions: [
      { name: 'Trazabilidad', score: 88, framework: 'ISO 42001', findings: ['Origen documentado'], recommendations: ['Mantener'] },
      { name: 'Completitud', score: 80, framework: 'ISO 25012', findings: [], recommendations: [] },
    ],
    ifrs18Readiness: { ready: false, score: 70, gaps: ['Categorías de resultado'] },
    dataQuality: { completeness: 90, accuracy: 92, consistency: 88, timeliness: 80, validity: 91 },
    aiGovernance: { traceability: 90, explainability: 85, antiHallucination: 95, humanOversight: 80 },
    executiveSummary: 'Calidad aceptable.',
    fullReport: '# Meta-auditoría',
    generatedAt: '2026-09-05T00:00:00.000Z',
  };
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return wb;
}
function rows(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow(row => out.push((row.values as unknown[]).slice(1)));
  return out;
}

describe('audit and meta-audit rendering in the workbook', () => {
  it('omits both sheets when no stored result was bound to the version', async () => {
    const wb = await load(await generateFinancialExcel({ report: makeExportableReport() }));
    expect(wb.getWorksheet('Auditoria')).toBeUndefined();
    expect(wb.getWorksheet('Meta-auditoria')).toBeUndefined();
  });

  it('writes the opinion, the auditors and every consolidated finding', async () => {
    const wb = await load(await generateFinancialExcel({
      report: makeExportableReport(), auditReport: makeAudit(), auditExaminedStage: 'complete',
    }));
    const flat = rows(wb.getWorksheet('Auditoria')!).flat();
    expect(flat).toContain('Con salvedades');
    expect(flat).toContain('Auditor revisoria');
    expect(flat).toContain('TRIB-004');
    expect(flat).toContain('Art. 383 E.T.');
    expect(flat).toContain('Crítico');
    expect(flat.join(' ')).toContain('Auditoría realizada sobre el informe completo');
  });

  it('states the examined material so a partial audit is not read as a full review', async () => {
    // Los auditores sólo reciben `consolidatedReport`, que en una versión no
    // completa lleva únicamente el contenido NIIF. La fase estratégica debe
    // declarar lo mismo que la NIIF: afirmar que se examinó la estrategia
    // sería una cobertura que no ocurrió.
    for (const stage of ['niif', 'strategy'] as const) {
      const wb = await load(await generateFinancialExcel({
        report: makeExportableReport(), auditReport: makeAudit(), auditExaminedStage: stage,
      }));
      const text = rows(wb.getWorksheet('Auditoria')!).flat().join(' ');
      expect(text, stage).toContain('sobre el contenido NIIF');
      expect(text, stage).toContain('el análisis estratégico y el gobierno corporativo no formaban parte');
      expect(text, stage).not.toContain('informe completo');
    }
  });

  it('declares a failed auditor instead of scoring the domain it did not cover', async () => {
    const audit = makeAudit();
    audit.auditorResults[1] = { ...audit.auditorResults[1], failed: true, complianceScore: 0 };
    const wb = await load(await generateFinancialExcel({ report: makeExportableReport(), auditReport: audit }));
    const all = rows(wb.getWorksheet('Auditoria')!);
    const failed = all.find(r => r[0] === 'Tributario')!;
    const healthy = all.find(r => r[0] === 'NIIF')!;
    // The placeholder score the orchestrator uses for a dead auditor is never
    // presented as a compliance measurement.
    expect(failed[1]).toBe('No disponible');
    expect(failed[3]).toBe('Auditor no completó');
    expect(healthy[1]).toBe(91);
    expect(healthy[3]).toBe(0);
  });

  it('writes the 12-dimension meta-audit with its frameworks and gaps', async () => {
    const wb = await load(await generateFinancialExcel({
      report: makeExportableReport(), qualityReport: makeQuality(),
    }));
    const flat = rows(wb.getWorksheet('Meta-auditoria')!).flat();
    expect(flat).toContain('Trazabilidad');
    expect(flat).toContain('ISO 25012');
    expect(flat).toContain('Categorías de resultado');
    expect(flat).toContain('B');
    expect(flat).toContain(95); // anti-alucinación (ISO 42001)
  });

  it('keeps every cell within the size Excel can open, and says where it cut', async () => {
    // El texto de un hallazgo lo escribe un agente y el contrato no lo acota.
    // Una celda de más de 32.767 caracteres produce un libro que Excel se niega
    // a abrir, sin ningún aviso: peor que un texto recortado y declarado.
    const long = 'A'.repeat(40_000);
    const audit = makeAudit({ consolidatedFindings: [{
      code: 'X-1', severity: 'critico', domain: 'niif', title: 'Hallazgo extenso',
      description: long, normReference: 'NIC 1', recommendation: long, impact: 'i',
    }] });
    const wb = await load(await generateFinancialExcel({ report: makeExportableReport(), auditReport: audit }));
    const values = rows(wb.getWorksheet('Auditoria')!).flat();
    const longest = Math.max(...values.map(v => (typeof v === 'string' ? v.length : 0)));
    expect(longest).toBeLessThanOrEqual(32_767);
    expect(values.some(v => typeof v === 'string' && v.includes('texto recortado'))).toBe(true);
  });

  it('omits a meta-audit block that the stored row does not carry', async () => {
    // Las filas se verifican por checksum, no por forma. Un bloque ausente no
    // puede tumbar la descarga del informe completo.
    const partial = {
      overallScore: 60, grade: 'D', dimensions: [],
      executiveSummary: '', fullReport: '# x', generatedAt: 'x',
    } as unknown as QualityAssessment;
    const wb = await load(await generateFinancialExcel({
      report: makeExportableReport(), qualityReport: partial,
    }));
    const flat = rows(wb.getWorksheet('Meta-auditoria')!).flat();
    expect(flat).toContain('D');
    expect(flat).not.toContain('IFRS 18');
    expect(flat).not.toContain('Gobernanza de IA (ISO 42001)');
  });

  it('survives agent output with missing arrays and nested fields', async () => {
    const audit = { ...makeAudit(), auditorResults: undefined, consolidatedFindings: undefined } as unknown as AuditReport;
    const quality = { ...makeQuality(), dimensions: undefined } as unknown as QualityAssessment;
    const wb = await load(await generateFinancialExcel({
      report: makeExportableReport(), auditReport: audit, qualityReport: quality,
    }));
    expect(wb.getWorksheet('Auditoria')).toBeDefined();
    expect(wb.getWorksheet('Meta-auditoria')).toBeDefined();
  });
});

describe('audit and meta-audit rendering in the editorial PDF', () => {
  it('composes both pages only from a bound result and carries the coverage note', () => {
    const report = makeExportableReport();
    const bare = composeEditorialReport({ report, preprocessed: null, pillars: null, language: 'es' });
    expect(bare.auditFindings).toBeUndefined();
    expect(bare.qualityScores).toBeUndefined();

    const doc = composeEditorialReport({
      report, preprocessed: null, pillars: null, language: 'es',
      auditReport: makeAudit(), qualityReport: makeQuality(), auditExaminedStage: 'niif',
    });
    expect(doc.auditFindings?.opinionType).toBe('con_salvedades');
    expect(doc.auditFindings?.topFindings[0]?.code).toBe('TRIB-004');
    expect(doc.auditFindings?.coverageNote).toContain('sobre el contenido NIIF');
    expect(doc.qualityScores?.grade).toBe('B');
  });

  it('does not claim strategy coverage for an audit that only read the NIIF content', () => {
    const doc = composeEditorialReport({
      report: makeExportableReport(), preprocessed: null, pillars: null, language: 'es',
      auditReport: makeAudit(), auditExaminedStage: 'strategy',
    });
    expect(doc.auditFindings?.coverageNote).toContain('sobre el contenido NIIF');
    expect(doc.auditFindings?.coverageNote).not.toContain('informe completo');
  });

  it('leaves the coverage note absent when the examined phase is unknown', () => {
    const doc = composeEditorialReport({
      report: makeExportableReport(), preprocessed: null, pillars: null, language: 'es',
      auditReport: makeAudit(),
    });
    expect(doc.auditFindings).toBeDefined();
    expect(doc.auditFindings?.coverageNote).toBeNull();
  });
});
