// auditoria-calidad-30 — en la página de Meta-auditoría de la PDF el sello
// v2.1 va DESPUÉS de la meta-auditoría (spec v2.1, "REGLAS DE INTEGRACIÓN"),
// no como encabezado, y no anticipa la firma del representante legal.
import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Document, renderToBuffer } from '@react-pdf/renderer';

import { makeExportableReport } from '@/lib/agents/financial/__fixtures__/coherent-niif-report';
import type { QualityAssessment } from '@/lib/agents/financial/quality/types';
import { composeEditorialReport } from '../compose';
import { registerEditorialFonts } from '../fonts';
import { QualityMetaAuditPage } from '../pages/QualityMetaAuditPage';

async function pdfText(el: React.ReactElement): Promise<string> {
  const buf = await renderToBuffer(<Document>{el}</Document>);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  return (await parser.getText()).text.replace(/[\u0000-\u0008]/g, 'A');
}

function quality(dimScore: number): QualityAssessment {
  return {
    overallScore: dimScore,
    grade: 'B',
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

describe('auditoria-calidad-30 — sello al final de la página de meta-auditoría', () => {
  it('el sello se imprime después del detalle D1–D14', async () => {
    const doc = composeEditorialReport({
      report: makeExportableReport(), preprocessed: null, pillars: null, language: 'es',
      assuranceProvenance: 'server-persisted', qualityReport: quality(90),
    });
    const text = await pdfText(<QualityMetaAuditPage doc={doc} />);
    const selloIdx = text.indexOf('CALIDAD CERTIFICADA 1+1');
    expect(selloIdx).toBeGreaterThan(-1);
    expect(selloIdx).toBeGreaterThan(text.indexOf('D14 Dimensión'));
    expect(selloIdx).toBeGreaterThan(text.indexOf('Completitud'));
    expect(text).not.toMatch(/representante\s+legal/i);
  }, 30_000);
});
