// ---------------------------------------------------------------------------
// POST /api/financial-report/html (v10.1)
// ---------------------------------------------------------------------------
//
// Stage 4 del pipeline financiero — cap-stone visual. Corre el Editor Jefe HTML
// que compone el documento HTML autocontenido de 15 páginas A4 portrait
// siguiendo `docs/spec/financial-report-v10.1.md`.
//
// Patrón idéntico a `/api/financial-report/niif/route.ts`:
//
//   - SSE streaming opt-in via header `X-Stream: true` o query `?stream=1`.
//   - Modo no-streaming devuelve `{ html, metadata, checklistFailures }`.
//   - `maxDuration = 800` para acomodar HTML 32-48K tokens en gpt-5.5
//     (~45-90s end-to-end con cache miss).
//
// SSE events:
//   - `event: progress`     FinancialProgressEvent
//   - `event: html_phase`   payload completo HtmlEditorOutput
//   - `event: done`         { stage: 'html' }
//   - `event: error`        { error, code, detail }
//
// Refs:
//   - src/app/api/financial-report/niif/route.ts (patrón a replicar)
//   - docs/spec/financial-report-v10.1.md
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import {
  HtmlEditorInputSchema,
  type HtmlEditorOutput,
} from '@/lib/agents/financial/contracts/html-editor';
import { runHtmlEditor } from '@/lib/agents/financial/agents/html-editor';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
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
import { NiifReportSchema } from '@/lib/agents/financial/contracts/niif-report';
import { StrategyReportSchema } from '@/lib/agents/financial/contracts/strategy-report';
import { validateNiifReportJson } from '@/lib/agents/financial/validators/niif-json-validator';
import {
  checkCashFlowInvariants,
  formatCashFlowViolations,
} from '@/lib/agents/financial/contracts/deterministic-breakdown';
import { reconcileStrategyAnchors } from '@/lib/agents/financial/validators/strategy-anchors';
import { buildNiifValidatorOptions } from '@/lib/agents/financial/orchestrator';
import { revivePreprocessedBalance } from '@/lib/preprocessing/json-safe';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

export const runtime = 'nodejs';
export const maxDuration = 800;

/**
 * Gate aritmético servidor del HTML — la MISMA regla que Excel/PDF
 * (`financialExportBlockers` en /export): errores del validador JSON NIIF, E15
 * promovido a bloqueante e invariantes del EFE; más el cruce de la Parte II
 * contra sus anclas. Si el cliente envía el preprocesado que usó /niif, el JSON
 * se cruza además contra esas anclas (mismo validador que /niif).
 *
 * Antes /html sólo validaba la forma: un JSON NIIF con Activo ≠ Pasivo +
 * Patrimonio producía un HTML "emitible" (pipeline-flujo-10). La UI deshabilita
 * el botón con reconciliation.clean=false, pero la API aceptaba cualquier JSON.
 *
 * TODO(cross-dep WP06): extraer con `financialExportBlockers` un helper común
 * sobre el JSON NIIF para que las tres superficies compartan una sola función.
 */
function htmlArithmeticBlockers(
  niifReport: unknown,
  strategyReport: unknown,
  preprocessed: PreprocessedBalance | undefined,
): string[] {
  const niif = NiifReportSchema.safeParse(niifReport);
  if (!niif.success) {
    return ['Faltan cifras estructuradas válidas. Regenera el informe antes de exportar.'];
  }
  const blockers: string[] = [];
  const validation = validateNiifReportJson(
    niif.data,
    preprocessed ? buildNiifValidatorOptions(preprocessed) : undefined,
  );
  blockers.push(...validation.errors);
  // Un balance impreso sin detalle que lo soporte no es descargable (igual que /export).
  blockers.push(...validation.warnings.filter((w) => w.startsWith('E15.')));
  blockers.push(...formatCashFlowViolations(checkCashFlowInvariants(niif.data.cashFlow)));

  const strategy = StrategyReportSchema.safeParse(strategyReport);
  if (strategy.success) {
    const check = reconcileStrategyAnchors(strategy.data, {
      primary: preprocessed?.primary,
      comparative: preprocessed ? (preprocessed.comparative ?? null) : undefined,
      niif: niif.data,
    });
    blockers.push(...check.deviations.map((d) => `Parte II — ${d}`));
  }
  return Array.from(new Set(blockers));
}

/**
 * Deja rastro en el servidor cuando el informe no superó la verificación
 * numérica. Sin esto el único testigo de un entregable defectuoso sería el
 * banner del navegador, que nadie audita a posteriori.
 */
function logIfNotEmittable(result: HtmlEditorOutput): void {
  // `!== false` y no `!emittable`: sólo se alerta ante una negativa explícita
  // del agente, nunca ante un payload sin la bandera.
  if (result.emittable !== false) return;
  const blocking = result.checklistFailures.filter((f) => f.severity === 'block');
  console.warn(
    `[financial-report/html] NO EMITIBLE — entidad=${result.metadata.entityNit} ` +
      `periodo=${result.metadata.periodEnd} bloqueantes=${blocking.length}: ` +
      blocking.map((f) => f.rule).join(' | '),
  );
}

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = HtmlEditorInputSchema.safeParse(body);

    if (!parsed.success) {
      const errors = parsed.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      );
      return NextResponse.json(
        { error: 'Invalid request format.', details: errors },
        { status: 400 },
      );
    }

    // Preprocesado opcional (el que usó /niif): habilita el cruce contra anclas.
    const bodyPreprocessed = (body as { preprocessed?: unknown }).preprocessed;
    let preprocessed: PreprocessedBalance | undefined;
    if (bodyPreprocessed !== undefined && bodyPreprocessed !== null) {
      const revived = revivePreprocessedBalance(bodyPreprocessed);
      if (!revived) {
        return NextResponse.json({ error: 'Invalid preprocessed format.' }, { status: 400 });
      }
      preprocessed = revived;
    }

    // Gate aritmético ANTES de pagar el Editor Jefe (32-48K tokens): misma
    // regla que Excel/PDF. Un informe que no cuadra no produce HTML.
    const blockers = htmlArithmeticBlockers(
      parsed.data.niifReport,
      parsed.data.strategyReport,
      preprocessed,
    );
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: 'Report is not exportable.', details: blockers },
        { status: 422 },
      );
    }

    // Hechos del negocio (Ola 2) — resueltos SERVER-SIDE, nunca desde el body
    // del cliente (tenancy). El bloque <hechos_empresa> viaja al <context> del
    // user-content del Editor Jefe vía el param dedicado de `runHtmlEditor`.
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? undefined;
    const excludedFactIds =
      excludedFactIdsSchema.safeParse((body as { excludedFactIds?: unknown }).excludedFactIds).data ?? null;
    const hechosEmpresa = await getHechosEmpresaBlock(
      workspaceId,
      parsed.data.company.fiscalPeriod,
      parsed.data.language,
      { excludedFactIds },
    );

    // Telemetría — mismo cableado que /niif: el tenant se fija en el contexto
    // AQUÍ, dentro del scope del request. Dentro del stream SSE la cookie ya no
    // es legible y `persistAgentTelemetry` descartaba la medición del Editor
    // Jefe HTML, que es la llamada más cara del pipeline (32-48K tokens de
    // output). Ver src/lib/db/telemetry.ts.
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

    // El header X-Stream o el query param ?stream=1 activan SSE. Espejado de
    // los otros endpoints financieros (niif/strategy/governance) para
    // consistencia con el cliente.
    const wantsStream =
      req.headers.get('x-stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (!wantsStream) {
      // Non-streaming: ejecuta y devuelve el output completo en una sola
      // respuesta JSON. Útil para invocaciones server-to-server o tests.
      const result = await runWithTelemetryContext(telemetryCtx, () =>
        runHtmlEditor(parsed.data, undefined, undefined, hechosEmpresa),
      );
      logIfNotEmittable(result);
      return NextResponse.json(result, {
        // El payload sigue viajando con 200 aunque no sea emitible: el HTML ya
        // viene estampado como BORRADOR por `runHtmlEditor` y devolver 422
        // dejaría al contador sin entregable tras ~10 min de pipeline por un
        // eventual falso positivo del checklist. La bandera `emittable` y la
        // cabecera son la señal máquina-legible para gatear la descarga.
        headers: { 'X-Report-Emittable': result.emittable ? 'true' : 'false' },
      });
    }

    // Streaming SSE — emite progress events durante la generación y el
    // payload final como `event: html_phase`.
    const language = parsed.data.language;

    const makeStream = () =>
      new ReadableStream({
      async start(controller) {
        const sse = createSafeSse(controller);
        const send = sse.send;

        try {
          const onProgress = (event: FinancialProgressEvent) => {
            if (event.type === 'warning') {
              send('warning', { warnings: event.warnings });
              return;
            }
            send('progress', event);
          };

          const result = await runHtmlEditor(parsed.data, onProgress, req.signal, hechosEmpresa);
          logIfNotEmittable(result);

          send('html_phase', result);
          send('done', { stage: 'html' });
        } catch (err) {
          console.error(
            '[financial-report/html] Pipeline error:',
            err instanceof Error ? err.message : err,
          );
          const friendly = toFriendlyError(err, language);
          send('error', {
            error:
              language === 'en'
                ? 'Error during HTML editor phase.'
                : 'Error durante la fase del Editor Jefe HTML.',
            detail: friendly.message,
            code: friendly.code,
          });
        } finally {
          sse.close();
        }
      },
    });

    // El contexto de telemetría envuelve la CONSTRUCCIÓN del stream: `start` se
    // invoca dentro de ella, así que el pipeline y todas sus continuaciones
    // async heredan el AsyncLocalStorage con el tenant.
    const stream = runWithTelemetryContext(telemetryCtx, makeStream);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        // x-accel-buffering: no — pista a proxies (nginx, Vercel edge) para
        // no buffer-ar el stream y dejar que los eventos lleguen en tiempo
        // real al cliente.
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error(
      '[financial-report/html] API error:',
      err instanceof Error ? err.message : err,
    );
    // Sin `detail` con err.message: puede filtrar internals (SQL, paths).
    return NextResponse.json(
      { error: 'Internal server error during HTML editor phase.' },
      { status: 500 },
    );
  }
}
