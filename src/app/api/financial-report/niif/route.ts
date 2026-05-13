import { NextResponse } from 'next/server';
import { z } from 'zod';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import {
  runNiifPhase,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import {
  parseTrialBalanceCSV,
  preprocessTrialBalance,
  type PreprocessedBalance,
} from '@/lib/preprocessing/trial-balance';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
import type {
  AdjustmentLedger,
  ProvisionalFlag,
} from '@/lib/agents/repair/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';

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

    // Reutiliza el `preprocessed` enviado por el cliente (idempotencia con
    // /api/upload). Sino, lo re-procesamos aqui — `runNiifPhase` tambien sabe
    // hacerlo internamente; lo precomputamos por consistencia con /route.ts.
    const bodyPreprocessed = (body as { preprocessed?: PreprocessedBalance | null }).preprocessed;
    let preprocessed: PreprocessedBalance | undefined;
    if (bodyPreprocessed && typeof bodyPreprocessed === 'object') {
      preprocessed = bodyPreprocessed;
    } else {
      const rows = parseTrialBalanceCSV(rawData);
      preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
    }

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming({
        rawData,
        company,
        language,
        instructions,
        preprocessed,
        provisional,
        adjustmentLedger,
      });
    }

    // Non-streaming
    const phase = await runNiifPhase(
      { rawData, company, language, instructions },
      { preprocessed, provisional, adjustmentLedger },
    );

    return NextResponse.json({
      niif: phase.niif,
      context: extractSerializableContext(phase.context),
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
      '[financial-report/niif] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during NIIF phase.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Extrae los campos serializables del FinancialPipelineContext para pasarlos
// por SSE/JSON. `bigint` (eliteSaldoAFavorImpuestoCents,
// reclasificacionesNoCompensacion[].saldo_invertido_centavos) no es JSON-safe
// — los normalizamos a string para que el caller los re-deserialize si los
// necesita. ppForAgents queda como `unknown` en el JSON; los endpoints
// downstream lo reciben en su shape original.
// ---------------------------------------------------------------------------
function extractSerializableContext(
  ctx: Awaited<ReturnType<typeof runNiifPhase>>['context'],
): SerializableNiifContext {
  return {
    bindingTotals: ctx.bindingTotalsBlock,
    preprocessed: ctx.ppForAgents,
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
}) {
  const { rawData, company, language, instructions, preprocessed, provisional, adjustmentLedger } =
    args;
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

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
          },
        );

        send('niif_phase', {
          niif: phase.niif,
          context: extractSerializableContext(phase.context),
        });
        send('done', { stage: 'niif' });
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
        }
      } finally {
        controller.close();
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
