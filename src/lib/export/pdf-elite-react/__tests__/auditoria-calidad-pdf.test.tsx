// ---------------------------------------------------------------------------
// PDF de Auditoría Especializada y Meta-auditoría de Calidad
// ---------------------------------------------------------------------------
//   auditoria-calidad-04 — una opinión ausente caía a 'abstension' (ABSTENCIÓN):
//                          ahora es 'no_emitida' (NO EMITIDA).
//   auditoria-calidad-21 — el score de una auditoría con dominios fallidos se
//                          imprimía como si fuera completo: ahora "PARCIAL (n/4)"
//                          o N/D sin dominios completados.
//   auditoria-calidad-10 — la PDF mostraba el grade/score libres del LLM
//                          ("A+ · 96") aunque el sello v2.1 de las mismas
//                          dimensiones dijera "requiere corrección": ahora
//                          muestra el sello y un grade interno derivado de él.
// ---------------------------------------------------------------------------

import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Document, renderToBuffer } from '@react-pdf/renderer';

import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import { composeEditorialReport } from '../compose';
import { registerEditorialFonts } from '../fonts';
import { AuditFindingsPage, auditScoreLabel } from '../pages/AuditFindingsPage';
import { QualityMetaAuditPage } from '../pages/QualityMetaAuditPage';
import type { EditorialReport } from '../types';

async function pdfText(el: React.ReactElement): Promise<string> {
  const buf = await renderToBuffer(<Document>{el}</Document>);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  return (await parser.getText()).text.replace(/[\u0000-\u0008]/g, 'A');
}

function audit(over: Partial<AuditReport> = {}): AuditReport {
  return {
    overallScore: 80, opinionType: 'favorable', opinionText: '', auditorResults: [],
    consolidatedFindings: [], findingCounts: {}, executiveSummary: 'ok', ...over,
  } as unknown as AuditReport;
}

function compose(over: { auditReport?: AuditReport; qualityReport?: QualityAssessment }): EditorialReport {
  return composeEditorialReport({
    report: makeExportableReport(), preprocessed: null, pillars: null, language: 'es',
    assuranceProvenance: 'server-persisted', ...over,
  });
}

function quality(dimScore: number, llm: { overallScore: number; grade: string }): QualityAssessment {
  return {
    overallScore: llm.overallScore,
    grade: llm.grade,
    dimensions: Array.from({ length: 14 }, (_, i) => ({
      name: `D${i + 1} Dimensión`, score: dimScore, framework: 'ISO 25012', findings: [], recommendations: [],
    })),
    ifrs18Readiness: { ready: false, score: dimScore, gaps: [] },
    dataQuality: { completeness: dimScore, accuracy: dimScore, consistency: dimScore, timeliness: dimScore, validity: dimScore },
    aiGovernance: { traceability: dimScore, explainability: dimScore, antiHallucination: dimScore, humanOversight: dimScore },
    executiveSummary: 'ok',
    fullReport: '',
    generatedAt: '2026-09-24T00:00:00Z',
  };
}

beforeAll(() => {
  registerEditorialFonts();
});

describe('auditoria-calidad-04 — opinión ausente = NO EMITIDA, no abstención', () => {
  it('compose: opinionType ausente o desconocido → no_emitida; los valores válidos se conservan', () => {
    expect(compose({ auditReport: audit({ opinionType: undefined }) }).auditFindings?.opinionType).toBe('no_emitida');
    expect(compose({ auditReport: audit({ opinionType: 'otra' as never }) }).auditFindings?.opinionType).toBe('no_emitida');
    expect(compose({ auditReport: audit({ opinionType: 'no_emitida' }) }).auditFindings?.opinionType).toBe('no_emitida');
    expect(compose({ auditReport: audit({ opinionType: 'abstension' }) }).auditFindings?.opinionType).toBe('abstension');
  });

  it('la página imprime NO EMITIDA y no afirma un dictamen favorable', async () => {
    const doc = compose({ auditReport: audit({ opinionType: 'no_emitida' }) });
    const text = await pdfText(<AuditFindingsPage doc={doc} />);
    expect(text).toContain('NO EMITIDA');
    expect(text).not.toContain('ABSTENCIÓN');
    expect(text).not.toMatch(/Dictamen favorable/);
  }, 30_000);
});

describe('auditoria-calidad-21 — score parcial rotulado', () => {
  it('compose propaga la cobertura y la etiqueta la declara', () => {
    const parcial = compose({
      auditReport: audit({ overallScore: 72, coverage: { completed: 3, total: 4, failedDomains: ['legal'], partial: true } }),
    }).auditFindings!;
    expect(parcial.coverage).toEqual({ completed: 3, total: 4, partial: true });
    expect(auditScoreLabel(parcial)).toBe('72/100 — PARCIAL (3/4 dominios)');

    const ninguno = compose({
      auditReport: audit({ overallScore: 0, coverage: { completed: 0, total: 4, failedDomains: ['niif', 'tributario', 'legal', 'revisoria'], partial: true } }),
    }).auditFindings!;
    expect(auditScoreLabel(ninguno)).toBe('N/D');

    const completo = compose({
      auditReport: audit({ overallScore: 88, coverage: { completed: 4, total: 4, failedDomains: [], partial: false } }),
    }).auditFindings!;
    expect(auditScoreLabel(completo)).toBe('88/100');
  });

  it('la página imprime PARCIAL', async () => {
    const doc = compose({
      auditReport: audit({ overallScore: 72, coverage: { completed: 3, total: 4, failedDomains: ['legal'], partial: true } }),
    });
    const text = await pdfText(<AuditFindingsPage doc={doc} />);
    expect(text).toMatch(/PARCIAL \(3\/4\s+dominios\)/);
  }, 30_000);
});

describe('auditoria-calidad-10 — la PDF muestra el sello v2.1 y un grade interno derivado', () => {
  it('dimensiones en 50 con "A+ · 96" del LLM → sello requiere corrección y grade interno F · 50', () => {
    const q = compose({ qualityReport: quality(50, { overallScore: 96, grade: 'A+' }) }).qualityScores!;
    expect(q.grade).toBe('F');
    expect(q.overallScore).toBe(50);
    expect(q.sello?.type).toBe('requiere_correccion');
    expect(q.sello?.title).toBe('CALIDAD REQUIERE CORRECCIÓN 1+1');
  });

  it('la página imprime el sello y rotula el grade como interno', async () => {
    const doc = compose({ qualityReport: quality(85, { overallScore: 40, grade: 'F' }) });
    expect(doc.qualityScores?.grade).toBe('B');
    const text = await pdfText(<QualityMetaAuditPage doc={doc} />);
    expect(text).toContain('CALIDAD CERTIFICADA 1+1');
    // El rótulo usa letterSpacing: el extractor separa las letras.
    expect(text.replace(/\s+/g, '')).toContain('GRADEINTERNO·85/100');
    expect(text).not.toContain('40/100');
  }, 30_000);
});
