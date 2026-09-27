import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthSession } from '@/lib/auth/require-session';
import { runQualityAudit } from '@/lib/agents/financial/quality/agent';
import { resolveClientPreprocessed } from '@/lib/reports/client-preprocessed';
import { resolveAuditedReport } from '@/lib/reports/audited-report';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { AuditReport } from '@/lib/agents/financial/audit/types';
import { resolvePersistedReport } from '@/lib/reports/persisted-report-request';
import { resolveReportWorkspaceId } from '@/lib/reports/financial-report-store';
import { withServerRenderedPersisted } from '@/lib/reports/part-markdown';
import {
  buildAuditResultVersion,
  parseAuditResultRef,
  sameReportRef,
  type AuditResultRef,
} from '@/lib/reports/audit-result-version';
import { loadAuditResult, persistAuditResult } from '@/lib/reports/audit-result-store';

// ---------------------------------------------------------------------------
// POST /api/financial-quality
// ---------------------------------------------------------------------------
// Meta-audit: evaluates the ENTIRE pipeline output against 2026 best
// practices (IASB, IFRS 18, ISO 25012, ISO 42001, CTCP Colombia).
//
// Input: { report, auditReport?, preprocessed?, adjustmentLedger?, language }
// El texto auditado es el consolidado que el servidor produce desde el JSON de
// las Partes I–III (I5-1); un informe sin ellas → 422 REPORT_PARTS_REQUIRED.
// Output: QualityAssessment with 12-dimension scores + IFRS 18 readiness
//
// Auditoría 2026-09 (auditoria-calidad-11): el cuerpo se valida con Zod y
// `preprocessed` (round-trip JSON de /niif) se revive y valida
// estructuralmente; sin él la meta-auditoría declara que el número de
// periodos y la ecuación no están verificados y D14 no es evaluable. Las
// banderas de integridad del informe sólo pueden degradar el sello.
//
// Procedencia servidor (Parte V): con `reportRef` la meta-auditoría evalúa la
// versión persistida del workspace de la sesión y, si llega `auditRef`, la
// Parte IV persistida que examinó ESA misma versión (otra → 409). El resultado
// se guarda antes de responder, atado a la versión y a la Parte IV que leyó;
// si esa Parte IV era parcial, la Parte V tampoco es exportable. El informe y
// el dictamen del cuerpo se ignoran.
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

    const persisted = await resolvePersistedReport(body);
    if (persisted.kind === 'error') return persisted.response;
    if (persisted.kind === 'ok') return await qualityPersisted(body, persisted);

    const parsed = QualityRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'A financial report with company and consolidatedReport is required.', details: errors },
        { status: 400 },
      );
    }

    // Cross-dep P1: el preprocesado de /niif se re-deriva desde sus filas con
    // el ledger confirmado de la petición; alterado → 422.
    const client = resolveClientPreprocessed(
      parsed.data.preprocessed,
      (body as { adjustmentLedger?: unknown }).adjustmentLedger,
    );
    if (!client.ok) return client.response;
    const preprocessed: PreprocessedBalance | undefined = client.preprocessed;

    const raw = body as { report: unknown; auditReport?: unknown };
    const language = parsed.data.language ?? 'es';
    // I5-1: la meta-auditoría lee el consolidado que produce el servidor desde
    // el JSON de las Partes I–III (con sus veredictos), no el Markdown recibido.
    const audited = resolveAuditedReport(raw.report, client, language);
    if (!audited.ok) return audited.response;
    const result = await runQualityAudit({
      report: audited.report,
      auditReport: (raw.auditReport ?? undefined) as AuditReport | undefined,
      preprocessed,
      language,
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

// ---------------------------------------------------------------------------
// Parte V sobre la versión persistida
// ---------------------------------------------------------------------------

type PersistedResolution = Extract<Awaited<ReturnType<typeof resolvePersistedReport>>, { kind: 'ok' }>;

async function qualityPersisted(body: unknown, persisted: PersistedResolution): Promise<Response> {
  const raw = (body && typeof body === 'object' ? body : {}) as { language?: unknown; auditRef?: unknown };
  const language: 'es' | 'en' = raw.language === 'en' || raw.language === 'es' ? raw.language : persisted.language;
  const parsedAuditRef = parseAuditResultRef(raw.auditRef);
  if (parsedAuditRef.kind === 'invalid') {
    return NextResponse.json({ error: 'Invalid auditRef.', code: 'AUDIT_RESULT_REF_INVALID' }, { status: 400 });
  }
  const { preprocessed, provenance } = persisted;
  const reportRef = { reportId: provenance.reportId, reportHash: provenance.reportHash };
  const workspaceId = await resolveReportWorkspaceId();

  // La Parte IV que se entrega a la meta-auditoría es la persistida, y sólo si
  // examinó esta misma versión. Una parcial sí se lee (la pantalla la muestra),
  // pero deja la Parte V sin exportar.
  let auditRef: AuditResultRef | null = null;
  let auditReport: AuditReport | undefined;
  let auditComplete = false;
  if (parsedAuditRef.kind === 'ok') {
    const loaded = await loadAuditResult(workspaceId, parsedAuditRef.ref, 'iv');
    if (!loaded.ok) return NextResponse.json({ error: loaded.error, code: loaded.code }, { status: loaded.status });
    if (!sameReportRef(loaded.data.reportRef, reportRef)) {
      return NextResponse.json(
        { error: 'The audit result examined a different report version.', code: 'AUDIT_RESULT_OTHER_VERSION' },
        { status: 409 },
      );
    }
    auditRef = parsedAuditRef.ref;
    auditReport = loaded.data.result as AuditReport;
    auditComplete = loaded.data.complete;
  }

  const report = withServerRenderedPersisted(persisted.report, preprocessed, language);
  const result = await runQualityAudit({ report, auditReport, preprocessed, language });

  const version = buildAuditResultVersion({
    part: 'v', reportRef, auditRef, auditComplete, language, result,
  });
  const outcome = await persistAuditResult({ workspaceId, version, companyName: report.company?.name });
  return NextResponse.json(
    outcome.status === 'persisted'
      ? { ...result, qualityRef: outcome.ref, qualityComplete: outcome.complete, persistence: { status: 'persisted' } }
      : { ...result, qualityComplete: version.complete, persistence: { status: 'not_persisted', reason: outcome.reason } },
  );
}
