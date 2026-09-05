import { requireReportWorkspace, loadFinancialVersion, saveFinancialVersion, ReportVersionError } from '@/lib/db/financial-report-versions';
import { NextResponse } from 'next/server';
import { strategyPhaseRequestSchema } from '@/lib/validation/schemas';
import { runStrategyPhase } from '@/lib/agents/financial/orchestrator';
import type {
  FinancialProgressEvent,
  NiifAnalysisResult,
} from '@/lib/agents/financial/types';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import { createSafeSse } from '@/lib/api/sse-safe';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import { requireAuthSession } from '@/lib/auth/require-session';
import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getHechosEmpresaBlock } from '@/lib/facts/report-facts';
import { excludedFactIdsSchema } from '@/lib/validation/schemas';
import {
  runWithTelemetryContext,
  asTelemetryUuid,
  resolveOwnedReportId,
  type TelemetryContext,
} from '@/lib/db/telemetry';

// ---------------------------------------------------------------------------
// POST /api/financial-report/strategy (Wave 3.F1)
// ---------------------------------------------------------------------------
// Stage 2 del pipeline financiero — corre el Director de Estrategia.
// Sin referencia de versión, consume el output de /niif (niifResult + bindingTotals +
// preprocessed) y devuelve el StrategicAnalysisResult.
//
// SSE events:
//   - `event: progress` FinancialProgressEvent (stage_start, stage_progress,
//                                               stage_complete)
//   - `event: strategy_phase` payload = { strategy: StrategicAnalysisResult }
//   - `event: done`
//   - `event: error`    { error, detail, code }
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 800;

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    let body = await req.json();
    const versionId = body?.reportVersionId;
    const reportWorkspace = versionId !== undefined ? await requireReportWorkspace() : null;
    const stored = reportWorkspace ? await loadFinancialVersion(reportWorkspace, versionId) : null;
    if (stored && stored.stage !== 'niif') {
      throw new ReportVersionError(409, 'Report version is not ready for this phase.');
    }
    // All financial inputs and generation options come from the authorized snapshot.
    if (stored) body = { ...stored };
    const parsed = strategyPhaseRequestSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    const { niifResult, bindingTotals, preprocessed, company, language, instructions } =
      parsed.data;

    // Ola 2 — Hechos del negocio: bloque narrativo <hechos_empresa> para el
    // <context> del Director de Estrategia. Tenancy: workspaceId SOLO del
    // servidor (nunca del body). Degrada SEGURO a '' ante cualquier fallo.
    const workspaceId = reportWorkspace?.id ?? (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
    const hechosEmpresa = await getHechosEmpresaBlock(
      workspaceId,
      company.fiscalPeriod,
      language,
      { excludedFactIds },
    );

    // Telemetría — mismo cableado que /niif: el tenant se fija en el contexto
    // AQUÍ, dentro del scope del request. Dentro del stream SSE la cookie ya no
    // es legible y `persistAgentTelemetry` descartaba cada medición del
    // Director de Estrategia. Ver src/lib/db/telemetry.ts.
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
      reportId: stored ? versionId : await resolveOwnedReportId(
        (body as { reportId?: unknown }).reportId,
        telemetryWorkspaceId,
      ),
    };

    const persistPhase: PersistPhase = async (strategy) => {
      if (!reportWorkspace || !stored) return {};
      const reportVersionId = await saveFinancialVersion(reportWorkspace, {
        ...stored, parentId: versionId, stage: 'strategy', strategyResult: strategy,
      });
      return { reportVersionId };
    };

    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    // Cast a tipos full: el schema valida solo lo critico (fullContent), el
    // resto del shape se preserva pasando el body. Misma estrategia que
    // /api/financial-audit/route.ts. `preprocessed` viene del round-trip JSON
    // de /niif: se valida estructuralmente y se reviven los BigInt (cents).
    const typedNiif = niifResult as unknown as NiifAnalysisResult;
    let typedPp: PreprocessedBalance | undefined;
    if (preprocessed !== undefined && preprocessed !== null) {
      const revived = revivePreprocessedBalance(preprocessed);
      if (!revived) {
        return NextResponse.json(
          { error: 'Invalid preprocessed format.' },
          { status: 400 },
        );
      }
      typedPp = revived;
    }

    if (stream) {
      return runWithTelemetryContext(telemetryCtx, () =>
        handleStreaming({
          niifResult: typedNiif,
          bindingTotals,
          preprocessed: typedPp,
          company,
          language,
          instructions,
          hechosEmpresa,
          persistPhase,
        }),
      );
    }

    const strategy = await runWithTelemetryContext(telemetryCtx, () =>
      runStrategyPhase({
        niifResult: typedNiif,
        bindingTotals,
        preprocessed: typedPp,
        company,
        language,
        instructions,
        elite: hechosEmpresa ? { hechosEmpresa } : undefined,
      }),
    );

    return NextResponse.json({ strategy, ...await persistPhase(strategy) });
  } catch (error) {
    if (error instanceof ReportVersionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(
      '[financial-report/strategy] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during Strategy phase.' },
      { status: 500 },
    );
  }
}

type PersistPhase = (result: Awaited<ReturnType<typeof runStrategyPhase>>) => Promise<{ reportVersionId?: string }>;

function handleStreaming(args: {
  niifResult: NiifAnalysisResult;
  bindingTotals: string;
  preprocessed: PreprocessedBalance | undefined;
  company: Parameters<typeof runStrategyPhase>[0]['company'];
  language: 'es' | 'en';
  instructions: string | undefined;
  hechosEmpresa: string;
  persistPhase: PersistPhase;
}) {
  const { niifResult, bindingTotals, preprocessed, company, language, instructions, hechosEmpresa, persistPhase } =
    args;

  const readableStream = new ReadableStream({
    async start(controller) {
      const sse = createSafeSse(controller);
      const send = sse.send;

      try {
        const strategy = await runStrategyPhase(
          {
            niifResult,
            bindingTotals,
            preprocessed,
            company,
            language,
            instructions,
            elite: hechosEmpresa ? { hechosEmpresa } : undefined,
          },
          {
            onProgress: (event: FinancialProgressEvent) => {
              if (event.type === 'warning') {
                send('warning', { warnings: event.warnings });
                return;
              }
              send('progress', event);
            },
          },
        );

        send('strategy_phase', { strategy, ...await persistPhase(strategy) });
        send('done', { stage: 'strategy' });
      } catch (error) {
        console.error(
          '[financial-report/strategy] Pipeline error:',
          error instanceof Error ? error.message : error,
        );
        const friendly = toFriendlyError(error, language);
        send('error', {
          error:
            language === 'en'
              ? 'Error during Strategy phase.'
              : 'Error durante la fase de Estrategia.',
          detail: friendly.message,
          code: friendly.code,
        });
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
