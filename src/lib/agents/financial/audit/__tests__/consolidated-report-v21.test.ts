// consolidated-report-v21.test.ts — verify the v2.1 visual frame around the
// consolidated audit report. The per-auditor `fullContent` blocks are owned
// by Teams A/B (NIIF, Tax, Legal, Fiscal Reviewer) — this test only checks
// that THIS module's wrapper renders the banners, summary, findings matrices
// and preserves each auditor's `fullContent` verbatim.

import { describe, it, expect } from 'vitest';
import { __test_buildConsolidatedAuditReport } from '../orchestrator';
import type {
  AuditorResult,
  AuditFinding,
  AuditOpinionType,
  FindingSeverity,
} from '../types';
import type { CompanyInfo } from '../../types';

const COMPANY: CompanyInfo = {
  name: 'Acme SAS',
  nit: '900.123.456-7',
  fiscalPeriod: '2025',
};

function makeFinding(opts: Partial<AuditFinding> & { code: string }): AuditFinding {
  return {
    code: opts.code,
    severity: opts.severity ?? 'medio',
    domain: opts.domain ?? 'niif',
    title: opts.title ?? 'Hallazgo de prueba',
    description: opts.description ?? 'Descripción.',
    normReference: opts.normReference ?? 'NIC 1 §54',
    recommendation: opts.recommendation ?? 'Recomendación.',
    impact: opts.impact ?? 'Impacto.',
  };
}

function makeResult(opts: Partial<AuditorResult> & { domain: AuditorResult['domain'] }): AuditorResult {
  const domainName: Record<AuditorResult['domain'], string> = {
    niif: 'Auditor NIIF/Contable',
    tributario: 'Auditor Tributario',
    legal: 'Auditor Legal/Societario',
    revisoria: 'Auditor de Revisoría Fiscal',
  };
  return {
    domain: opts.domain,
    auditorName: opts.auditorName ?? domainName[opts.domain],
    complianceScore: opts.complianceScore ?? 85,
    findings: opts.findings ?? [],
    summary: opts.summary ?? 'Resumen del auditor.',
    fullContent: opts.fullContent ?? `Contenido del auditor ${opts.domain} — verbatim.`,
    failed: opts.failed ?? false,
  };
}

const DEFAULT_COUNTS: Record<FindingSeverity, number> = {
  critico: 0,
  alto: 0,
  medio: 0,
  bajo: 0,
  informativo: 0,
};

// ---------------------------------------------------------------------------
// Frame markers
// ---------------------------------------------------------------------------

describe('buildConsolidatedAuditReport — v2.1 visual frame', () => {
  it('emits a top banner with the company info', () => {
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      [],
      [],
      DEFAULT_COUNTS,
      85,
      'favorable',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toMatch(/^╔═{60,}╗/m);
    expect(md).toMatch(/╚═{60,}╝/);
    expect(md).toContain('INFORME DE AUDITORÍA INTEGRAL 1+1 — Spec v2.1');
    expect(md).toContain('Acme SAS');
    expect(md).toContain('900.123.456-7');
  });

  it('emits a closing banner at the bottom of the report', () => {
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      [],
      [],
      DEFAULT_COUNTS,
      90,
      'favorable',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('FIN DEL INFORME DE AUDITORÍA INTEGRAL');
    expect(md).toContain('Score Global 90/100');
  });

  it('emits a findings matrix (count by severity)', () => {
    // Build 15 findings whose counts match the severity table
    const findings: AuditFinding[] = [
      makeFinding({ code: 'F-001', severity: 'critico' }),
      makeFinding({ code: 'F-002', severity: 'alto' }),
      makeFinding({ code: 'F-003', severity: 'alto' }),
      makeFinding({ code: 'F-004', severity: 'medio' }),
      makeFinding({ code: 'F-005', severity: 'medio' }),
      makeFinding({ code: 'F-006', severity: 'medio' }),
      makeFinding({ code: 'F-007', severity: 'bajo' }),
      makeFinding({ code: 'F-008', severity: 'bajo' }),
      makeFinding({ code: 'F-009', severity: 'bajo' }),
      makeFinding({ code: 'F-010', severity: 'bajo' }),
      makeFinding({ code: 'F-011', severity: 'informativo' }),
      makeFinding({ code: 'F-012', severity: 'informativo' }),
      makeFinding({ code: 'F-013', severity: 'informativo' }),
      makeFinding({ code: 'F-014', severity: 'informativo' }),
      makeFinding({ code: 'F-015', severity: 'informativo' }),
    ];
    const counts: Record<FindingSeverity, number> = {
      critico: 1,
      alto: 2,
      medio: 3,
      bajo: 4,
      informativo: 5,
    };
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      [],
      findings,
      counts,
      75,
      'con_salvedades',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('MATRIZ DE HALLAZGOS — CONTEO POR SEVERIDAD');
    expect(md).toContain('| Crítico | 1 |');
    expect(md).toContain('| Alto | 2 |');
    expect(md).toContain('| Medio | 3 |');
    expect(md).toContain('| Bajo | 4 |');
    expect(md).toContain('| Informativo | 5 |');
    expect(md).toContain('| **TOTAL** | **15** |');
  });
});

// ---------------------------------------------------------------------------
// Per-auditor content preservation
// ---------------------------------------------------------------------------

describe('buildConsolidatedAuditReport — preserves per-auditor fullContent verbatim', () => {
  it('renders each successful auditor fullContent AS-IS without reordering', () => {
    const results = [
      makeResult({ domain: 'niif', fullContent: '===NIIF_BLOCK===' }),
      makeResult({ domain: 'tributario', fullContent: '===TAX_BLOCK===' }),
      makeResult({ domain: 'legal', fullContent: '===LEGAL_BLOCK===' }),
      makeResult({ domain: 'revisoria', fullContent: '===FISCAL_BLOCK===' }),
    ];
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      results,
      [],
      DEFAULT_COUNTS,
      88,
      'favorable',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('===NIIF_BLOCK===');
    expect(md).toContain('===TAX_BLOCK===');
    expect(md).toContain('===LEGAL_BLOCK===');
    expect(md).toContain('===FISCAL_BLOCK===');

    // Order: niif before tributario before legal before revisoria
    const idxNiif = md.indexOf('===NIIF_BLOCK===');
    const idxTax = md.indexOf('===TAX_BLOCK===');
    const idxLegal = md.indexOf('===LEGAL_BLOCK===');
    const idxFiscal = md.indexOf('===FISCAL_BLOCK===');
    expect(idxNiif).toBeLessThan(idxTax);
    expect(idxTax).toBeLessThan(idxLegal);
    expect(idxLegal).toBeLessThan(idxFiscal);
  });

  it('skips failed auditors but still renders the surrounding frame', () => {
    const results = [
      makeResult({ domain: 'niif', fullContent: '===NIIF_BLOCK===' }),
      makeResult({ domain: 'tributario', failed: true, fullContent: '' }),
      makeResult({ domain: 'legal', fullContent: '===LEGAL_BLOCK===' }),
      makeResult({ domain: 'revisoria', fullContent: '===FISCAL_BLOCK===' }),
    ];
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      results,
      [],
      DEFAULT_COUNTS,
      70,
      'con_salvedades',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('===NIIF_BLOCK===');
    expect(md).not.toContain('Auditor Tributario'); // skipped — tax auditor failed
    expect(md).toContain('===LEGAL_BLOCK===');
    expect(md).toContain('===FISCAL_BLOCK===');
  });
});

// ---------------------------------------------------------------------------
// Findings listing
// ---------------------------------------------------------------------------

describe('buildConsolidatedAuditReport — findings listing', () => {
  it('renders the findings table with one row per finding', () => {
    const findings = [
      makeFinding({ code: 'NIIF-001', severity: 'critico', title: 'Equation imbalance' }),
      makeFinding({ code: 'TRIB-002', severity: 'alto', domain: 'tributario', title: 'IVA misclass' }),
    ];
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      [],
      findings,
      { ...DEFAULT_COUNTS, critico: 1, alto: 1 },
      72,
      'con_salvedades',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('NIIF-001');
    expect(md).toContain('TRIB-002');
    expect(md).toContain('Equation imbalance');
    expect(md).toContain('IVA misclass');
  });

  it('emits the no-findings stub when the findings array is empty', () => {
    const md = __test_buildConsolidatedAuditReport(
      COMPANY,
      [],
      [],
      DEFAULT_COUNTS,
      95,
      'favorable',
      'Dictamen.',
      'Resumen.',
      'es',
    );
    expect(md).toContain('No se encontraron hallazgos');
  });
});

// ---------------------------------------------------------------------------
// Opinion type rendering
// ---------------------------------------------------------------------------

describe('buildConsolidatedAuditReport — opinion type rendering', () => {
  const opinions: AuditOpinionType[] = ['favorable', 'con_salvedades', 'desfavorable', 'abstension'];

  for (const opinion of opinions) {
    it(`renders opinion=${opinion} in the metadata table and closing banner`, () => {
      const md = __test_buildConsolidatedAuditReport(
        COMPANY,
        [],
        [],
        DEFAULT_COUNTS,
        80,
        opinion,
        'Dictamen.',
        'Resumen.',
        'es',
      );
      const labelMap: Record<AuditOpinionType, string> = {
        favorable: 'FAVORABLE',
        con_salvedades: 'CON SALVEDADES',
        desfavorable: 'DESFAVORABLE',
        abstension: 'ABSTENCION',
      };
      expect(md).toContain(labelMap[opinion]);
    });
  }
});
