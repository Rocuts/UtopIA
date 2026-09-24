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
import type { AdjustmentLedger } from '@/lib/agents/repair/types';
import { requireAuthSession } from '@/lib/auth/require-session';

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

const partsSchema = z.object({
  niifContent: z.string().min(1).max(HANDOFF_MAX_CHARS),
  strategyContent: z.string().min(1).max(HANDOFF_MAX_CHARS),
  governanceContent: z.string().min(1).max(HANDOFF_MAX_CHARS),
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
  if (!base.success || !parts.success || !ledger.success) {
    const issues = [
      ...(base.success ? [] : base.error.issues),
      ...(parts.success ? [] : parts.error.issues),
      ...(ledger.success ? [] : ledger.error.issues),
    ];
    return NextResponse.json(
      {
        error: 'Invalid request format.',
        details: issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { rawData, company, language } = base.data;
  try {
    const ctx = await prepareFinancialContext(
      { rawData, company, language },
      { adjustmentLedger: ledger.data as AdjustmentLedger | undefined },
    );
    const result = consolidateSplitReport({
      company: ctx.effectiveCompany,
      preprocessed: ctx.ppForAgents,
      rawData: ctx.effectiveRawData,
      niifContent: parts.data.niifContent,
      strategyContent: parts.data.strategyContent,
      governanceContent: parts.data.governanceContent,
      language,
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
    return NextResponse.json(result);
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
