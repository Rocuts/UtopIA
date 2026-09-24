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
// Procedencia servidor (fase 2, P1): con `reportRef: {reportId, reportHash}`
// los JSON, la empresa, el preprocesado, los veredictos y las cifras de la
// metadata salen de la versión persistida del workspace de la sesión
// (`htmlInputFromPersisted`); el cuerpo sólo aporta presentación. Referencia
// inválida → 400, ajena o inexistente → 404, huella distinta → 409. El HTML
// sale sellado con la procedencia (verificada o "no verificada").
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
import { financialExportBlockers } from '@/lib/export/financial-export-validation';
import { revivePreprocessedBalance, toJsonSafe } from '@/lib/preprocessing/json-safe';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type { GovernanceReportJson } from '@/lib/agents/financial/contracts/governance-report';
import type { CompanyInfo } from '@/lib/agents/financial/types';
import type { FinancialReport } from '@/lib/agents/financial/types';
import type { Adjustment } from '@/lib/agents/repair/types';
import type { applyAdjustments } from '@/lib/agents/repair/adjustments';
import { serverActaVerdict } from '@/lib/reports/part-verdicts';
import {
  withServerRenderedClientReport,
  withServerRenderedPersisted,
} from '@/lib/reports/part-markdown';
import { resolvePersistedReport } from '@/lib/reports/persisted-report-request';
import { htmlClientReport, htmlInputFromPersisted } from '@/lib/reports/html-input';
import {
  readAppliedAdjustments,
  rederivePreprocessedFromRows,
} from '@/lib/reports/preprocessed-integrity';
import {
  isProvisionalDraft,
  provenanceHeaders,
  stampHtmlProvenance,
  withDraftReasons,
  type ArtifactProvenance,
} from '@/lib/reports/provenance-stamp';

/**
 * Idioma del HTML: el `language` explícito del cuerpo o, con versión
 * persistida, el de esa versión (e2e-niif2-05); sin ninguno, español.
 */
function htmlLanguage(body: unknown, persisted: 'es' | 'en' | null): 'es' | 'en' {
  const requested = (body as { language?: unknown } | null)?.language;
  return requested === 'en' || requested === 'es' ? requested : (persisted ?? 'es');
}

/**
 * Procedencia del HTML generado (procedencia-R2-06): un HTML que el Editor
 * Jefe declaró no emitible sale estampado BORRADOR por `runHtmlEditor`; el
 * sello de procedencia lo aclara en vez de decir "verificada" a secas.
 */
function generatedProvenance(provenance: ArtifactProvenance, generated: HtmlEditorOutput): ArtifactProvenance {
  return generated.emittable === false ? withDraftReasons(provenance, [{ kind: 'not-emittable' }]) : provenance;
}

export const runtime = 'nodejs';
export const maxDuration = 800;

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

const ACTA_QUALIFIED_BLOCKER =
  'Las notas o el acta de asamblea (Parte III) contienen cifras que no coinciden con el balance o con ' +
  'la aritmética determinista del acta.';
const STRATEGY_QUALIFIED_BLOCKER =
  'El análisis estratégico (Parte II) contiene cifras sin respaldo en el balance.';

/**
 * Bloqueantes de las Partes II y III para /html, con la misma regla que
 * /export (auditoría 2026-09-24, e2e-niif-16; integración P1 × P3):
 *   - la Parte III se RECALCULA en el servidor contra el preprocesado de la
 *     petición (`serverActaVerdict`: la aritmética determinista del acta —la
 *     misma que alimentó el prompt del Especialista de Gobierno— y las cifras
 *     citadas en la prosa de las notas y del acta); sin preprocesado, una
 *     destinación o capitalización con monto no tiene ancla y tampoco se emite;
 *   - los veredictos que el cliente reenvía (`actaQualifications`,
 *     `strategyQualifications`) bloquean cuando traen `clean: false`. Un
 *     `clean: true` del cliente no levanta nada: el recálculo de la Parte III y
 *     el cruce de la Parte II contra sus anclas y su prosa
 *     (`niifArithmeticBlockers` → `reconcileStrategyAnchors`) corren igual.
 */
function partQualificationBlockers(
  body: unknown,
  input: {
    niifReport: unknown;
    governanceReport: GovernanceReportJson;
    company: { name: string; nit: string; fiscalPeriod: string; entityType: string | null };
    language: 'es' | 'en';
  },
  preprocessed: PreprocessedBalance | undefined,
): string[] {
  const out: string[] = [];
  const raw = (body ?? {}) as {
    actaQualifications?: { clean?: unknown; motivos?: unknown };
    strategyQualifications?: { clean?: unknown };
    company?: Record<string, unknown>;
  };
  if (raw.actaQualifications?.clean === false) out.push(ACTA_QUALIFIED_BLOCKER);
  if (raw.strategyQualifications?.clean === false) out.push(STRATEGY_QUALIFIED_BLOCKER);

  // Régimen de la reserva legal: tipo societario del contrato y, si el cliente
  // lo envía, lo que declaran los estatutos (mismo insumo que usó /governance).
  const company = {
    ...(raw.company ?? {}),
    name: input.company.name,
    nit: input.company.nit,
    fiscalPeriod: input.company.fiscalPeriod,
    entityType: input.company.entityType ?? undefined,
  } as CompanyInfo;
  const verdict = serverActaVerdict(input.governanceReport, {
    company,
    preprocessed,
    niifJson: input.niifReport,
    language: input.language,
  });
  if (verdict && !verdict.clean) out.push(ACTA_QUALIFIED_BLOCKER, ...verdict.motivos);
  return Array.from(new Set(out));
}

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const rawBody: unknown = await req.json();
    // Versión persistida: prevalece sobre las cifras del cuerpo. Sus Partes
    // pasan por el MISMO recálculo que /export por referencia
    // (`withServerRenderedPersisted`): veredictos con las reglas vigentes
    // (invariantes del JSON NIIF, Parte II/III sin JSON válido sellada) y la
    // Parte II con sus cifras derivadas fijadas por el código. Sin esto una
    // versión que /export rechaza (o con reglas anteriores) salía en HTML
    // "procedencia verificada" (revisión I3).
    const resolved = await resolvePersistedReport(rawBody);
    if (resolved.kind === 'error') return resolved.response;
    const persisted =
      resolved.kind === 'ok'
        ? {
            ...resolved,
            report: withServerRenderedPersisted(
              resolved.report,
              resolved.preprocessed,
              htmlLanguage(rawBody, resolved.language),
            ),
          }
        : resolved;
    // BORRADOR (pipeline-flujo-21): con versión persistida lo dice su
    // consolidado; sin ella, el override que reenvía el cliente (sólo puede
    // añadir la aclaración, nunca quitarla).
    const draft =
      persisted.kind === 'ok'
        ? isProvisionalDraft(persisted.report)
        : (rawBody as { provisional?: { active?: unknown } } | null)?.provisional?.active === true;
    let provenance: ArtifactProvenance =
      persisted.kind === 'ok'
        ? {
            kind: 'verified',
            provenance: persisted.provenance,
            ...(draft ? { draft } : {}),
            // procedencia-R2-02: el aviso de procedencia lista los ajustes.
            adjustments: persisted.adjustments,
          }
        : { kind: 'unverified', ...(draft ? { draft } : {}) };
    const body: unknown =
      persisted.kind === 'ok' && rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? {
            ...htmlInputFromPersisted(rawBody as Record<string, unknown>, persisted),
            language: htmlLanguage(rawBody, persisted.language),
          }
        : rawBody;
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

    // Preprocesado (el que usó /niif): habilita el cruce contra anclas. Con
    // versión persistida es el que el servidor re-derivó al consolidar. Sin
    // ella (niif-preproceso-33) el del cliente se RE-DERIVA desde sus propias
    // filas con los ajustes confirmados que reenvía (`adjustmentLedger`) y se
    // usa el re-derivado; si sus totales de control difieren → 422.
    let preprocessed: PreprocessedBalance | undefined;
    let adjustments: { applied: Adjustment[]; affected: ReturnType<typeof applyAdjustments>['affected'] } | null =
      null;
    if (persisted.kind === 'ok') {
      preprocessed = persisted.preprocessed;
    } else {
      const bodyPreprocessed = (body as { preprocessed?: unknown }).preprocessed;
      if (bodyPreprocessed !== undefined && bodyPreprocessed !== null) {
        const revived = revivePreprocessedBalance(bodyPreprocessed);
        const applied = readAppliedAdjustments(
          (body as { adjustmentLedger?: unknown }).adjustmentLedger,
        );
        if (!revived || !applied) {
          return NextResponse.json(
            { error: revived ? 'Invalid adjustmentLedger format.' : 'Invalid preprocessed format.' },
            { status: 400 },
          );
        }
        const rederived = rederivePreprocessedFromRows(revived, applied);
        if (!rederived.ok) {
          return NextResponse.json(
            { error: 'Report is not exportable.', details: rederived.details },
            { status: 422 },
          );
        }
        preprocessed = rederived.preprocessed;
        if (applied.length > 0) {
          adjustments = { applied, affected: rederived.affected };
          provenance = { ...provenance, adjustments };
        }
      }
    }

    // Gate ANTES de pagar el Editor Jefe (32-48K tokens): el MISMO que
    // Excel/PDF (`financialExportBlockers`: validación post-render,
    // emitibilidad, salvedades, completitud, identidad y el gate aritmético
    // `niifArithmeticBlockers` —validador JSON NIIF con E15/E6 promovidos,
    // invariantes del EFE, columna comparativa, subtotales, códigos del ERI y
    // Parte II contra sus anclas—), sobre un informe cuyas Partes ya pasaron
    // por el recálculo del servidor:
    //   - con versión persistida, ESA versión (`withServerRenderedPersisted`,
    //     arriba);
    //   - sin ella (procedencia-R2-03, e2e-niif2-06), el MISMO camino que
    //     /export sin referencia (`withServerRenderedClientReport`):
    //     veredictos de las tres Partes recalculados contra el balance
    //     re-derivado (invariantes y prosa de la Parte I, anclas y prosa de la
    //     Parte II, aritmética y prosa del acta, identidad de las Partes II/III),
    //     post-proceso de la Parte II y gate de emisión V1–V15 sobre el texto
    //     que produce el servidor. Antes sólo corrían el gate aritmético y el
    //     acta: un informe que /export rechaza salía en HTML y el Editor Jefe
    //     recibía el JSON de la Parte II sin post-procesar.
    let serverReport: FinancialReport;
    if (persisted.kind === 'ok') {
      serverReport = persisted.report;
    } else {
      const received = htmlClientReport(body as Record<string, unknown>, parsed.data);
      serverReport =
        withServerRenderedClientReport(received, { preprocessed, adjustments, rawData: null }, parsed.data.language) ??
        received;
    }
    const blockers = financialExportBlockers(serverReport, preprocessed);
    blockers.push(...partQualificationBlockers(body, parsed.data, preprocessed));
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: 'Report is not exportable.', details: blockers },
        { status: 422 },
      );
    }
    // El Editor Jefe (reconciliación §1.1 y contexto) usa el MISMO preprocesado
    // con que se acaba de validar: el re-derivado o el de la versión persistida.
    // Sin referencia, los JSON que ve el Editor Jefe son los que el servidor
    // acaba de verificar (la Parte II con sus cifras derivadas fijadas por el
    // código), no los recibidos.
    const editorInput = {
      ...parsed.data,
      ...(persisted.kind === 'ok'
        ? {}
        : {
            niifReport: serverReport.niifAnalysis.json ?? parsed.data.niifReport,
            strategyReport: serverReport.strategicAnalysis.json ?? parsed.data.strategyReport,
            governanceReport: serverReport.governance.json ?? parsed.data.governanceReport,
          }),
      preprocessed: preprocessed ? toJsonSafe(preprocessed) : null,
    };

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
      // Con versión persistida la medición se ata a ESA fila `reports`.
      reportId:
        persisted.kind === 'ok'
          ? persisted.provenance.reportId
          : await resolveOwnedReportId((body as { reportId?: unknown }).reportId, telemetryWorkspaceId),
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
      const generated = await runWithTelemetryContext(telemetryCtx, () =>
        runHtmlEditor(editorInput, undefined, undefined, hechosEmpresa),
      );
      logIfNotEmittable(generated);
      const stamp = generatedProvenance(provenance, generated);
      const result = {
        ...generated,
        html: stampHtmlProvenance(generated.html, stamp, parsed.data.language),
      };
      return NextResponse.json(result, {
        // El payload sigue viajando con 200 aunque no sea emitible: el HTML ya
        // viene estampado como BORRADOR por `runHtmlEditor` y devolver 422
        // dejaría al contador sin entregable tras ~10 min de pipeline por un
        // eventual falso positivo del checklist. La bandera `emittable` y la
        // cabecera son la señal máquina-legible para gatear la descarga.
        headers: {
          'X-Report-Emittable': result.emittable ? 'true' : 'false',
          ...provenanceHeaders(stamp),
        },
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

          const generated = await runHtmlEditor(editorInput, onProgress, req.signal, hechosEmpresa);
          logIfNotEmittable(generated);
          // Las cabeceras del stream ya salieron: el BORRADOR del HTML no
          // emitible viaja en el sello impreso y en su <meta> (draft=true).
          const result = {
            ...generated,
            html: stampHtmlProvenance(generated.html, generatedProvenance(provenance, generated), language),
          };

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
        ...provenanceHeaders(provenance),
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
