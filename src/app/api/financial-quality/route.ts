import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthSession } from '@/lib/auth/require-session';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
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
//
// Auditoría 2026-09 (auditoria-calidad-11): el cuerpo se valida con Zod y
// `preprocessed` (round-trip JSON de /niif) se revive y valida
// estructuralmente; sin él la meta-auditoría declara que el número de
// periodos y la ecuación no están verificados y D14 no es evaluable. Las
// banderas de integridad del informe sólo pueden degradar el sello.
//
// POST-MVP: este endpoint deberia migrar a Vercel Workflow DevKit como un
// `step.do("quality-meta-audit", ...)` dentro del workflow durable que tambien
// ejecute Fase 1 y Fase 2. Ver `docs/POST_MVP_WORKFLOW_MIGRATION.md`.
// ---------------------------------------------------------------------------

// 300s = maximo default de Fluid Compute (2026). Igualamos Fases 1 y 2 para
// que la meta-auditoria no sea el eslabon mas debil del pipeline.
export const maxDuration = 300;

// Validación de forma mínima del cuerpo (no viaja al LLM). El informe se usa
// completo tras validar para conservar sus banderas de reconciliación.
const QualityRequestSchema = z.object({
  report: z.object({
    company: z.object({
      name: z.string().min(1),
      nit: z.string().min(1),
      fiscalPeriod: z.string().min(1),
    }),
    consolidatedReport: z.string().min(1),
  }),
  auditReport: z
    .object({
      consolidatedReport: z.string(),
      overallScore: z.number(),
      opinionType: z.string(),
      consolidatedFindings: z.array(z.unknown()),
    })
    .nullable()
    .optional(),
  preprocessed: z.unknown().optional(),
  language: z.enum(['es', 'en']).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = QualityRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'A financial report with company and consolidatedReport is required.', details: errors },
        { status: 400 },
      );
    }

    let preprocessed: PreprocessedBalance | undefined;
    if (parsed.data.preprocessed !== undefined && parsed.data.preprocessed !== null) {
      const revived = revivePreprocessedBalance(parsed.data.preprocessed);
      if (!revived) {
        return NextResponse.json({ error: 'Invalid preprocessed format.' }, { status: 400 });
      }
      preprocessed = revived;
    }

    const raw = body as { report: unknown; auditReport?: unknown };
    const result = await runQualityAudit({
      report: raw.report as FinancialReport,
      auditReport: (raw.auditReport ?? undefined) as AuditReport | undefined,
      preprocessed,
      language: parsed.data.language ?? 'es',
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
