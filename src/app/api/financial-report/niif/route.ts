import { NextResponse } from 'next/server';
import { z } from 'zod';
import { financialReportRequestSchema, excludedFactIdsSchema } from '@/lib/validation/schemas';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import {
  runNiifPhase,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import {
  revivePreprocessedBalance,
  toJsonSafe,
} from '@/lib/preprocessing/json-safe';
import { createSafeSse } from '@/lib/api/sse-safe';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
import type {
  AdjustmentLedger,
  ProvisionalFlag,
} from '@/lib/agents/repair/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import { logActivity } from '@/lib/db/activity-log';
import { requireAuthSession } from '@/lib/auth/require-session';
import {
  runWithTelemetryContext,
  asTelemetryUuid,
  resolveOwnedReportId,
  type TelemetryContext,
} from '@/lib/db/telemetry';

// ---------------------------------------------------------------------------
// POST /api/financial-report/niif (Wave 3.F1)
// ---------------------------------------------------------------------------
// Stage 1 del pipeline financiero — corre el Analista Contable NIIF (chunked
// en 3 pases internos) + Stage 0 (preprocess + gate + bindingTotals).
//
// SSE events:
//   - `event: progress`   FinancialProgressEvent (stage_start, stage_progress,
//                                                stage_complete, warning)
//   - `event: niif_phase` payload = { niif: NiifAnalysisResult, context: {
//                                     bindingTotals, preprocessed,
//                                     effectiveCompany } } — el caller la
//                                     reenvia a /strategy y /governance.
//   - `event: done`
//   - `event: error`      { error, detail, code }
//
// `maxDuration` independiente para cada fase: el cuello de botella historico
// era el pipeline acumulado (NIIF + Strategy + Governance) excediendo el
// budget Vercel Pro+Fluid Compute. Cada fase aislada tiene techo propio.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 800;

// Inline schemas duplicados desde route.ts legacy para mantener cada endpoint
// autonomo. `provisional` y `adjustmentLedger` siguen el mismo contrato.
const provisionalFlagSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().min(1).max(2_000),
  })
  .optional();

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
  .object({
    adjustments: z.array(adjustmentSchema).max(50),
  })
  .optional();

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  try {
    const body = await req.json();
    const parsed = financialReportRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { rawData, company, language, instructions } = parsed.data;

    const provisionalParsed = provisionalFlagSchema.safeParse(
      (body as { provisional?: unknown }).provisional,
    );
    if (!provisionalParsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid provisional flag.',
          details: provisionalParsed.error.issues.map(
            (i) => `provisional.${i.path.join('.')}: ${i.message}`,
          ),
        },
        { status: 400 },
      );
    }
    const provisional = provisionalParsed.data as ProvisionalFlag | undefined;

    const adjustmentLedgerParsed = adjustmentLedgerSchema.safeParse(
      (body as { adjustmentLedger?: unknown }).adjustmentLedger,
    );
    if (!adjustmentLedgerParsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid adjustmentLedger format.',
          details: adjustmentLedgerParsed.error.issues.map(
            (i) => `adjustmentLedger.${i.path.join('.')}: ${i.message}`,
          ),
        },
        { status: 400 },
      );
    }
    const adjustmentLedger = adjustmentLedgerParsed.data as AdjustmentLedger | undefined;

    // Ola 2 — tenancy SOLO desde la cookie (nunca del body) + IDs a excluir en
    // esta corrida (confirmación pre-reporte; no muta la DB).
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;

    // Telemetría — contexto del tenant para TODO el pipeline.
    //
    // Por qué aquí y no dentro del pipeline: `persistAgentTelemetry` (que dispara
    // `callFinancialAgent` ~40 veces por corrida) resolvía el tenant leyendo
    // `cookies()`. Esa lectura ocurre dentro del callback de la ReadableStream
    // SSE / bajo `waitUntil`, donde ya no hay scope de request: lanzaba y la
    // fila se descartaba ("sin workspaceId para niif-analyst-pass1", medido en
    // runtime 2026-08). Aquí sí estamos en el scope del request, así que el
    // workspaceId ya resuelto arriba se fija en un AsyncLocalStorage que viaja
    // con las continuaciones async del pipeline.
    //
    // El contexto se abre incluso con `workspaceId` nulo: así `reportId` viaja
    // igual y la fila sin tenant se registra degradada en vez de perderse.
    // El contexto lleva el valor CRUDO, no el filtrado: quien clasifica el modo
    // de fallo es `persistAgentTelemetry` (`workspace-no-uuid` vs
    // `sin-workspace`), y esa distincion es justo el diagnostico que el
    // operador necesita. Si filtraramos aqui, una cookie `utopia_workspace_id`
    // corrupta llegaria al contexto como `null`, la persistencia caeria al
    // fallback de `cookies()` — que dentro del stream SSE lanza — y la medicion
    // quedaria registrada como `sin-workspace`: el operador buscaria un route
    // handler sin cablear en vez de la cookie corrupta, que es el bug real.
    // El filtro de uuid sigue existiendo aguas abajo, antes del INSERT.
    const telemetryWorkspaceId = asTelemetryUuid(workspaceId);
    const telemetryCtx: TelemetryContext = {
      workspaceId: workspaceId ?? null,
      reportId: await resolveOwnedReportId(
        (body as { reportId?: unknown }).reportId,
        telemetryWorkspaceId,
      ),
    };

    // Reutiliza el `preprocessed` enviado por el cliente (idempotencia con
    // /api/upload). Sino, lo re-procesamos aqui — `runNiifPhase` tambien sabe
    // hacerlo internamente; lo precomputamos por consistencia con /route.ts.
    // El payload del cliente se valida estructuralmente y se reviven los
    // BigInt (cents) — un shape inválido es 400, nunca cast ciego.
    const bodyPreprocessed = (body as { preprocessed?: unknown }).preprocessed;
    let preprocessed: PreprocessedBalance | undefined;
    if (bodyPreprocessed !== undefined && bodyPreprocessed !== null) {
      const revived = revivePreprocessedBalance(bodyPreprocessed);
      if (!revived) {
        return NextResponse.json(
          { error: 'Invalid preprocessed format.' },
          { status: 400 },
        );
      }
      preprocessed = revived;
    } else {
      const rows = parseTrialBalanceCSV(rawData);
      preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
    }

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      // `handleStreaming` construye la ReadableStream de forma síncrona y el
      // callback `start` se invoca dentro de esa construcción — por eso abrir
      // el contexto AQUÍ alcanza para que el pipeline entero corra dentro de él.
      return runWithTelemetryContext(telemetryCtx, () =>
        handleStreaming({
          rawData,
          company,
          language,
          instructions,
          preprocessed,
          provisional,
          adjustmentLedger,
          workspaceId,
          excludedFactIds,
          startedAt,
        }),
      );
    }

    // Non-streaming
    const phase = await runWithTelemetryContext(telemetryCtx, () =>
      runNiifPhase(
        { rawData, company, language, instructions },
        { preprocessed, provisional, adjustmentLedger, workspaceId, excludedFactIds },
      ),
    );

    void logActivity({
      category: 'financial',
      action: 'financial-report.niif.completed',
      level: 'info',
      message: 'Fase NIIF completada',
      durationMs: Date.now() - startedAt,
      resourceType: 'financial_report',
      metadata: { language, mode: 'sync' },
    });

    return NextResponse.json(
      toJsonSafe({
        niif: phase.niif,
        ancora: phase.ancora,
        fiscalSnapshot: phase.fiscalSnapshot ?? null,
        context: extractSerializableContext(phase.context),
      }),
    );
  } catch (error) {
    if (error instanceof BalanceValidationError) {
      void logActivity({
        category: 'financial',
        action: 'financial-report.niif.validation_failed',
        level: 'warn',
        message: 'Balance de prueba con inconsistencias críticas',
        durationMs: Date.now() - startedAt,
        resourceType: 'financial_report',
        metadata: { reasons: error.reasons },
      });
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
      '[financial-report/niif] API error:',
      error instanceof Error ? error.message : error,
    );
    void logActivity({
      category: 'financial',
      action: 'financial-report.niif.failed',
      level: 'error',
      message: `Error en fase NIIF: ${error instanceof Error ? error.message : 'desconocido'}`,
      durationMs: Date.now() - startedAt,
      resourceType: 'financial_report',
    });
    return NextResponse.json(
      { error: 'Internal server error during NIIF phase.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Extrae los campos serializables del FinancialPipelineContext para pasarlos
// por SSE/JSON. `bigint` (controlTotals.cents.*,
// reclasificacionesNoCompensacion[].saldo_invertido_centavos) no es JSON-safe
// — `toJsonSafe` los convierte a string decimal; /strategy y /governance los
// reviven en intake con `revivePreprocessedBalance`.
// ---------------------------------------------------------------------------
function extractSerializableContext(
  ctx: Awaited<ReturnType<typeof runNiifPhase>>['context'],
): SerializableNiifContext {
  return {
    bindingTotals: ctx.bindingTotalsBlock,
    preprocessed: toJsonSafe(ctx.ppForAgents),
    company: ctx.effectiveCompany,
  };
}

interface SerializableNiifContext {
  bindingTotals: string;
  preprocessed: PreprocessedBalance | undefined;
  company: Awaited<ReturnType<typeof runNiifPhase>>['context']['effectiveCompany'];
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(args: {
  rawData: string;
  company: Parameters<typeof runNiifPhase>[0]['company'];
  language: 'es' | 'en';
  instructions: string | undefined;
  preprocessed: PreprocessedBalance | undefined;
  provisional: ProvisionalFlag | undefined;
  adjustmentLedger: AdjustmentLedger | undefined;
  workspaceId: string | undefined;
  excludedFactIds: string[] | null;
  startedAt: number;
}) {
  const {
    rawData,
    company,
    language,
    instructions,
    preprocessed,
    provisional,
    adjustmentLedger,
    workspaceId,
    excludedFactIds,
    startedAt,
  } = args;
  const readableStream = new ReadableStream({
    async start(controller) {
      const sse = createSafeSse(controller);
      const send = sse.send;

      try {
        const phase = await runNiifPhase(
          { rawData, company, language, instructions },
          {
            onProgress: (event: FinancialProgressEvent) => {
              if (event.type === 'warning') {
                send('warning', { warnings: event.warnings });
                return;
              }
              send('progress', event);
            },
            preprocessed,
            provisional,
            adjustmentLedger,
            workspaceId,
            excludedFactIds,
          },
        );

        // Emisión separada del Bloque Âncora — los consumidores (UI Escudo,
        // Strategy/Governance handoff) lo leen sin tener que parsear el
        // payload pesado de `niif_phase`. El payload de `niif_phase` lo
        // incluye también para callers legacy que ignoran el evento nuevo.
        send('niif_ancora', { ancora: phase.ancora });
        // Capa El Escudo (Capa 5) — evento ligero ANTES de `niif_phase` para
        // que la UI auto-puebla El Escudo sin parsear el payload pesado.
        // FiscalSnapshot es JSON-safe (strings de centavos + numbers).
        send('fiscal_snapshot', { fiscalSnapshot: phase.fiscalSnapshot ?? null });
        send('niif_phase', {
          niif: phase.niif,
          ancora: phase.ancora,
          fiscalSnapshot: phase.fiscalSnapshot ?? null,
          context: extractSerializableContext(phase.context),
        });
        send('done', { stage: 'niif' });
        void logActivity({
          category: 'financial',
          action: 'financial-report.niif.completed',
          level: 'info',
          message: 'Fase NIIF completada',
          durationMs: Date.now() - startedAt,
          resourceType: 'financial_report',
          metadata: { language, mode: 'stream' },
        });
      } catch (error) {
        if (error instanceof BalanceValidationError) {
          const intro =
            language === 'en'
              ? 'The trial balance has critical inconsistencies. Fix the file and try again.'
              : 'El balance de prueba tiene inconsistencias criticas. Corrige el archivo y vuelve a intentar.';
          const reasonsBlock = error.reasons.map((r) => `• ${r}`).join('\n');
          const accountsBlock =
            error.suggestedAccounts.length > 0
              ? `\n\n${language === 'en' ? 'Accounts to review' : 'Cuentas a revisar'}:\n` +
                error.suggestedAccounts.map((a) => `• ${a}`).join('\n')
              : '';
          send('error', {
            error: intro,
            detail: `${intro}\n\n${reasonsBlock}${accountsBlock}`,
            code: 'BALANCE_VALIDATION_FAILED',
            reasons: error.reasons,
            suggestedAccounts: error.suggestedAccounts,
          });
          void logActivity({
            category: 'financial',
            action: 'financial-report.niif.validation_failed',
            level: 'warn',
            message: 'Balance de prueba con inconsistencias críticas',
            durationMs: Date.now() - startedAt,
            resourceType: 'financial_report',
            metadata: { reasons: error.reasons },
          });
        } else {
          console.error(
            '[financial-report/niif] Pipeline error:',
            error instanceof Error ? error.message : error,
          );
          const friendly = toFriendlyError(error, language);
          send('error', {
            error:
              language === 'en'
                ? 'Error during NIIF phase.'
                : 'Error durante la fase NIIF.',
            detail: friendly.message,
            code: friendly.code,
          });
          void logActivity({
            category: 'financial',
            action: 'financial-report.niif.failed',
            level: 'error',
            message: `Error en fase NIIF: ${friendly.code}`,
            durationMs: Date.now() - startedAt,
            resourceType: 'financial_report',
            metadata: { code: friendly.code },
          });
        }
      } finally {
        sse.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
