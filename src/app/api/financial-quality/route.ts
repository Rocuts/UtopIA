import { NextResponse } from 'next/server';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { AuditReport } from '@/lib/agents/financial/audit/types';

// ---------------------------------------------------------------------------
// POST /api/financial-quality
// ---------------------------------------------------------------------------
// Meta-audit: evaluates the ENTIRE pipeline output against 2026 best
// practices (IASB, IFRS 18, ISO 25012, ISO 42001, CTCP Colombia).
//
// Input: { report, auditReport?, preprocessed?, language }
// Output: QualityAssessment with 12-dimension scores + IFRS 18 readiness
// ---------------------------------------------------------------------------

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.report?.consolidatedReport) {
      return NextResponse.json(
        { error: 'A financial report with consolidatedReport is required.' },
        { status: 400 },
      );
    }

    const result = await runQualityAudit({
      report: body.report as FinancialReport,
      auditReport: body.auditReport as AuditReport | undefined,
      preprocessed: body.preprocessed,
      language: body.language || 'es',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[financial-quality] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Error during quality assessment.' },
      { status: 500 },
    );
  }
}
