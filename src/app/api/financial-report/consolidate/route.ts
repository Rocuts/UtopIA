import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  financialReportRequestSchema,
  HANDOFF_MAX_CHARS,
} from '@/lib/validation/schemas';
import {
  prepareFinancialContext,
  BalanceValidationError,
  buildAdjustmentsAuditSection,
} from '@/lib/agents/financial/orchestrator';
import { consolidateSplitReport } from '@/lib/agents/financial/split-consolidation';
import type { AdjustmentLedger, ProvisionalFlag } from '@/lib/agents/repair/types';
import type { FinancialReport } from '@/lib/agents/financial/types';
import { ancoraOrNull } from '@/lib/agents/financial/ancora/build-ancora';
import { requireAuthSession } from '@/lib/auth/require-session';
import { toJsonSafe } from '@/lib/preprocessing/json-safe';
import { withServerPartVerdicts } from '@/lib/reports/part-verdicts';
import { applyRequestConfirmations } from '@/lib/reports/ingest-confirmations';
import { parseReportParts } from '@/lib/reports/report-parts';
import { buildFinancialReportVersion } from '@/lib/reports/financial-report-version';
import {
  persistFinancialReportVersion,
  resolveReportWorkspaceId,
} from '@/lib/reports/financial-report-store';

// ---------------------------------------------------------------------------
// POST /api/financial-report/consolidate (pipeline-flujo-16)
// ---------------------------------------------------------------------------
// Paso servidor del camino partido: tras /niif, /strategy y /governance, el
// cliente envía las tres partes y el rawData. El servidor:
//   1. Re-deriva el preprocesado desde rawData (mismo Stage 0 que /niif, con
//      los ajustes confirmados) — no confía en cifras del cliente.
//   2. Ensambla el consolidado (Partes I/II/III).
//   3. Ejecuta `validateConsolidatedReport` y `auditReportEmittable` SIN
//      `skipReportTextChecks` (V8/V9/V10/V15 sobre el texto).
// Devuelve { consolidatedReport, validation, emittability }. El cliente los
// pliega en el reporte: la descarga se bloquea si validation.ok === false o
// emittability.kind === 'no-emitible' (y /export los ve vía
// financialExportBlockers).
//
// Procedencia servidor (fase 2, P1): si además llegan las tres partes
// completas (`reportParts`), el servidor ensambla el informe final —partes,
// consolidado, veredictos plegados, snapshot fiscal y Âncora calculados AQUÍ
// desde el balance re-derivado— y lo persiste como `reports.kind =
// 'financial_report'` del workspace de la sesión, con la huella del informe,
// la del balance preprocesado y la versión del contrato de reglas. Responde
// además { report, reportRef, provenance }: la UI guarda la referencia y la
// reenvía a /export, /html y /api/escudo/fiscal-anchor, que usan ESA versión.
// Sin DB o sin workspace (modo anónimo sin almacenamiento) no hay referencia:
// `provenance.status = 'not_persisted'` y las descargas se rotulan
// "procedencia no verificada".
//
// No llama a ningún LLM: es determinista y rápido.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 60;

// Mismo contrato que /niif (schemas inline para mantener cada endpoint autónomo).
const adjustmentSchema = z.object({
  id: z.string().min(1).max(100),
  accountCode: z.string().min(1).max(10),
  accountName: z.string().min(1).max(200),
  amount: z.number().refine((n) => Number.isFinite(n), 'amount debe ser finito'),
  rationale: z.string().min(1).max(2_000),
  status: z.enum(['proposed', 'applied', 'rejected']),
  proposedAt: z.string().min(1).max(40),
  appliedAt: z.string().min(1).max(40).optional(),
  rejectedAt: z.string().min(1).max(40).optional(),
});
const adjustmentLedgerSchema = z
  .object({ adjustments: z.array(adjustmentSchema).max(50) })
  .optional();
// Override del Doctor de Datos ("Continuar de todas formas"), mismo contrato
// que /niif (pipeline-flujo-21): con `active` el consolidado sale BORRADOR.
const provisionalFlagSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().min(1).max(2_000),
  })
  .optional();

// Los textos de las partes pueden omitirse cuando llegan `reportParts`: se
// toman de su `fullContent` (si llegan ambos, deben coincidir).
const partsSchema = z.object({
  niifContent: z.string().min(1).max(HANDOFF_MAX_CHARS).optional(),
  strategyContent: z.string().min(1).max(HANDOFF_MAX_CHARS).optional(),
  governanceContent: z.string().min(1).max(HANDOFF_MAX_CHARS).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const base = financialReportRequestSchema.safeParse(body);
  const parts = partsSchema.safeParse(body);
  const ledger = adjustmentLedgerSchema.safeParse(
    (body as { adjustmentLedger?: unknown } | null)?.adjustmentLedger,
  );
  const provisional = provisionalFlagSchema.safeParse(
    (body as { provisional?: unknown } | null)?.provisional,
  );
  const reportParts = parseReportParts((body as { reportParts?: unknown } | null)?.reportParts);
  if (
    !base.success || !parts.success || !ledger.success || !provisional.success ||
    reportParts.kind === 'invalid'
  ) {
    const issues = [
      ...(base.success ? [] : base.error.issues),
      ...(parts.success ? [] : parts.error.issues),
      ...(ledger.success ? [] : ledger.error.issues),
      ...(provisional.success
        ? []
        : provisional.error.issues.map((i) => ({ ...i, path: ['provisional', ...i.path] }))),
    ];
    return NextResponse.json(
      {
        error: 'Invalid request format.',
        details: [
          ...issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          ...(reportParts.kind === 'invalid' ? reportParts.details : []),
        ],
      },
      { status: 400 },
    );
  }

  // Texto de cada parte: el campo suelto o el `fullContent` de `reportParts`.
  const fromParts = reportParts.kind === 'ok' ? reportParts.parts : null;
  const contents = {
    niifContent: parts.data.niifContent ?? fromParts?.niifAnalysis.fullContent,
    strategyContent: parts.data.strategyContent ?? fromParts?.strategicAnalysis.fullContent,
    governanceContent: parts.data.governanceContent ?? fromParts?.governance.fullContent,
  };
  const contentErrors: string[] = [];
  for (const [key, value] of Object.entries(contents)) {
    if (typeof value !== 'string' || value.length === 0) contentErrors.push(`${key}: Required`);
  }
  if (
    fromParts &&
    (contents.niifContent !== fromParts.niifAnalysis.fullContent ||
      contents.strategyContent !== fromParts.strategicAnalysis.fullContent ||
      contents.governanceContent !== fromParts.governance.fullContent)
  ) {
    contentErrors.push('reportParts: el fullContent de cada parte debe coincidir con el texto enviado');
  }
  if (contentErrors.length > 0) {
    return NextResponse.json(
      { error: 'Invalid request format.', details: contentErrors },
      { status: 400 },
    );
  }

  const { company, language } = base.data;
  // P4 × P1: la unidad confirmada y los vencimientos declarados que /niif
  // recibió como campos se aplican igual aquí; sin ellos la re-derivación del
  // balance volvería a bloquear un archivo "en miles" (422 falso).
  const confirmed = applyRequestConfirmations(body, base.data.rawData);
  if (!confirmed.ok) return confirmed.response;
  const rawData = confirmed.rawData;
  try {
    const ctx = await prepareFinancialContext(
      { rawData, company, language },
      { adjustmentLedger: ledger.data as AdjustmentLedger | undefined },
    );
    const result = consolidateSplitReport({
      company: ctx.effectiveCompany,
      preprocessed: ctx.ppForAgents,
      rawData: ctx.effectiveRawData,
      niifContent: contents.niifContent as string,
      strategyContent: contents.strategyContent as string,
      governanceContent: contents.governanceContent as string,
      language,
      // pipeline-flujo-21: el override marca BORRADOR el consolidado (y con él
      // la versión persistida, el PDF y el sello de procedencia); no levanta
      // ningún gate.
      provisional: provisional.data as ProvisionalFlag | undefined,
    });
    // Traza auditable de los ajustes confirmados del Doctor de Datos: la MISMA
    // sección que el legacy agrega al consolidado (pipeline-flujo-16). Va al
    // final, fuera de las Partes I–III que validan los gates post-render.
    if (ctx.adjustmentsApplicationDetail && ctx.appliedAdjustments.length > 0) {
      result.consolidatedReport +=
        '\n\n' +
        buildAdjustmentsAuditSection(
          ctx.appliedAdjustments,
          ctx.adjustmentsApplicationDetail.affected,
          language,
        );
    }
    if (!fromParts) return NextResponse.json(result);

    // ─── Versión persistida (procedencia servidor) ─────────────────────────
    // El informe final lo ensambla el servidor. Los veredictos de las Partes II
    // y III se RECALCULAN contra el balance re-derivado con las mismas
    // funciones que las fases (`withServerPartVerdicts`): aritmética del acta,
    // cifras en la prosa de notas y acta (P3) y anclas + prosa de la Parte II.
    // Un veredicto omitido o reescrito por el cliente no llega a la versión:
    // el del servidor sólo endurece el recibido. Las salvedades se pliegan
    // sobre la reconciliación NIIF con la misma regla que la UI; el snapshot
    // fiscal y el Âncora son los que `prepareFinancialContext` acaba de
    // calcular desde el balance re-derivado (no los que el navegador recibió
    // de /niif).
    const ancora = ancoraOrNull(ctx.ancora);
    const report: FinancialReport = withServerPartVerdicts(
      {
        company: ctx.effectiveCompany,
        niifAnalysis: fromParts.niifAnalysis,
        strategicAnalysis: fromParts.strategicAnalysis,
        governance: fromParts.governance,
        consolidatedReport: result.consolidatedReport,
        validation: result.validation,
        ...(result.emittability ? { emittability: result.emittability } : {}),
        generatedAt: new Date().toISOString(),
        ...(ctx.fiscalSnapshot ? { fiscalSnapshot: ctx.fiscalSnapshot } : {}),
        ...(ancora ? { ancora } : {}),
      },
      ctx.ppForAgents,
      language,
    );
    const version = buildFinancialReportVersion({
      report,
      preprocessed: ctx.ppForAgents,
      rawData: ctx.effectiveRawData,
    });
    const workspaceId = await resolveReportWorkspaceId();
    const persisted = await persistFinancialReportVersion({
      workspaceId,
      version,
      controlTotals: ctx.ppForAgents?.primary?.controlTotals
        ? toJsonSafe(ctx.ppForAgents.primary.controlTotals)
        : null,
    });
    return NextResponse.json({
      ...result,
      // Forma canónica: exactamente lo persistido (o lo que se habría
      // persistido), para que la UI conserve el mismo contenido que la huella.
      report: version.report,
      ...(persisted.status === 'persisted'
        ? {
            reportRef: {
              reportId: persisted.provenance.reportId,
              reportHash: persisted.provenance.reportHash,
            },
            provenance: { status: 'persisted' as const, ...persisted.provenance },
          }
        : {
            provenance: {
              status: 'not_persisted' as const,
              reason: persisted.reason,
              reportHash: version.reportHash,
              sourceHash: version.sourceHash,
              contractVersion: version.contractVersion,
            },
          }),
    });
  } catch (error) {
    if (error instanceof BalanceValidationError) {
      return NextResponse.json(
        {
          error: 'El balance de prueba tiene inconsistencias criticas.',
          code: 'BALANCE_VALIDATION_FAILED',
          reasons: error.reasons,
          suggestedAccounts: error.suggestedAccounts,
        },
        { status: 422 },
      );
    }
    console.error(
      '[financial-report/consolidate] error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during consolidation.' },
      { status: 500 },
    );
  }
}
