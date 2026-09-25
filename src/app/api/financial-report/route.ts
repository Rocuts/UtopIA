import { NextResponse } from 'next/server';
import { adjustmentLedgerSchema } from '@/lib/reports/adjustment-ledger';
import { z } from 'zod';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import {
  orchestrateFinancialReport,
  BalanceValidationError,
} from '@/lib/agents/financial/orchestrator';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import { preprocessUploadedTrialBalanceText } from '@/lib/preprocessing/raw-data';
import type { FinancialProgressEvent } from '@/lib/agents/financial/types';
import type {
  AdjustmentLedger,
  ProvisionalFlag,
} from '@/lib/agents/repair/types';
import { toFriendlyError } from '@/lib/agents/utils/gateway-errors';
import { classifyError, formatErrorAsUserNote } from '@/lib/agents/financial/prompts/resilience-section0';
import { preprocessedAnchorMismatches, toJsonSafe } from '@/lib/preprocessing/json-safe';
import {
  PREPROCESSED_MISMATCH_CODE,
  resolveClientPreprocessed,
} from '@/lib/reports/client-preprocessed';
import { applyRequestConfirmations } from '@/lib/reports/ingest-confirmations';
import { createSafeSse } from '@/lib/api/sse-safe';
import { requireAuthSession } from '@/lib/auth/require-session';

// Schema inline para el flag `provisional` — opcional, no se reusa en otras
// rutas. Si esta presente, ambos campos son obligatorios.
const provisionalFlagSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().min(1).max(2_000),
  })
  .optional();

// Adjustment ledger (Phase 2 — Doctor de Datos): contrato único de las rutas
// financieras (`src/lib/reports/adjustment-ledger.ts`, incluye `period`).

// ---------------------------------------------------------------------------
// POST /api/financial-report
// ---------------------------------------------------------------------------
// Accepts raw accounting data + company metadata, runs the 3-agent sequential
// pipeline, and returns a consolidated NIIF financial report.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
//
// @deprecated (Wave 3.F1) — preferir los 3 endpoints separados:
//   * POST /api/financial-report/niif       (Stage 1 — NIIF Analyst chunked)
//   * POST /api/financial-report/strategy   (Stage 2 — Strategy Director)
//   * POST /api/financial-report/governance (Stage 3 — Governance Specialist)
// Cada uno tiene su propio `maxDuration` y SSE stream — eliminan el timeout
// production al desacoplar las latencias acumuladas. Este endpoint sigue vivo
// para callers que no requieren el control por-fase (export route + tests).
// ---------------------------------------------------------------------------

export const maxDuration = 800; // 800s para acomodar gpt-5.5 medium con outputs 30-50K tokens (latencia medida ~24min en pipeline secuencial NIIF→Strategy→Governance)

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

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

    const { company, language, instructions } = parsed.data;
    // Mismas confirmaciones de ingesta que /niif (unidad, vencimientos).
    const confirmed = applyRequestConfirmations(body, parsed.data.rawData);
    if (!confirmed.ok) return confirmed.response;
    const rawData = confirmed.rawData;

    // Override del usuario (repair chat). Validamos opcionalmente — si viene
    // mal formado, devolvemos 400 para que el caller corrija en lugar de
    // silenciar el flag.
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

    // Phase 2: ledger de ajustes confirmados via Doctor de Datos. Validamos
    // explicitamente para que un body mal formado devuelva 400 en vez de
    // silenciar los ajustes.
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

    // Preprocesado (cross-dep P1, mismo cruce que /export): el balance se lee
    // de `rawData` con el helper de /upload, /niif y /export (ingesta-01: CSV,
    // bloques XLSX `[period=…]`, informe de validación antepuesto) y es la
    // fuente autoritativa. El `preprocessed` que manda el cliente (el del
    // upload, sin ajustes: el orquestador aplica el ledger después) ya no se
    // usa tal cual: forma inválida → 400; se RE-DERIVA desde sus filas y, si
    // hay `rawData` legible, se cruza con él; totales distintos → 422. Sin
    // filas en ninguno, el orquestador decide (balance tabular ilegible → 422).
    const read = preprocessUploadedTrialBalanceText(rawData);
    if (read.kind === 'rejected') {
      return NextResponse.json(
        {
          error: 'El balance de prueba tiene inconsistencias criticas.',
          code: 'BALANCE_VALIDATION_FAILED',
          reasons: read.reasons,
          suggestedAccounts: [],
        },
        { status: 422 },
      );
    }
    const client = resolveClientPreprocessed((body as { preprocessed?: unknown }).preprocessed, null);
    if (!client.ok) return client.response;
    if (client.preprocessed && read.kind === 'ok') {
      const mismatches = preprocessedAnchorMismatches(client.preprocessed, read.preprocessed);
      if (mismatches.length > 0) {
        return NextResponse.json(
          {
            error: 'El balance preprocesado enviado no corresponde al balance de la solicitud.',
            code: PREPROCESSED_MISMATCH_CODE,
            details: [
              'Fuentes incoherentes — el balance preprocesado enviado no corresponde al balance de la ' +
                'solicitud re-derivado por el servidor.',
              ...mismatches,
            ],
          },
          { status: 422 },
        );
      }
    }
    const preprocessed: PreprocessedBalance | undefined =
      read.kind === 'ok' ? read.preprocessed : client.preprocessed;

    // Enhance data with validation report and clean auxiliary data
    const enhancedData = preprocessed
      ? `${preprocessed.validationReport}\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${preprocessed.cleanData}`
      : rawData;

    // Las cifras vinculantes (actual + comparativo + variación) viajan SÓLO en
    // el bindingTotalsBlock del orquestador, construido con los controlTotals
    // post-curator. Aquí sólo se completan los periodos detectados.
    const enhancedInstructions = instructions || '';
    let effectiveCompany = company;
    if (preprocessed) {
      // NM-16 (re-auditoría 2026-09-24): aquí se publicaba un segundo bloque
      // "TOTALES PRE-CALCULADOS (VINCULANTES)" con `summary` PREVIO al curator
      // (Activo sin la reclasificación R1) y la Σ bruta de la clase 4 como
      // "Total Ingresos" (+ su YoY). El orquestador ya inyecta el bloque
      // vinculante único (renderSnapshotLines sobre controlTotals post-curator,
      // ingresos netos y operacionales, discrepancias y regla multiperiodo):
      // dos anclas distintas para la misma cifra confundían al modelo.
      // Autocomplete `comparativePeriod` si el caller no lo declaró pero el
      // preprocesador detectó >= 2 periodos; `detectedPeriods` para prompts y UI.
      const detected = preprocessed.periods.map((s) => s.period);
      if (
        !effectiveCompany.comparativePeriod &&
        detected.length >= 2
      ) {
        effectiveCompany = {
          ...effectiveCompany,
          comparativePeriod: detected[detected.length - 2],
          detectedPeriods: detected,
        };
      } else if (!effectiveCompany.detectedPeriods) {
        effectiveCompany = { ...effectiveCompany, detectedPeriods: detected };
      }
    }

    // Check for streaming request
    const stream =
      req.headers.get('X-Stream') === 'true' ||
      new URL(req.url).searchParams.get('stream') === '1';

    if (stream) {
      return handleStreaming(
        enhancedData,
        effectiveCompany,
        language,
        enhancedInstructions,
        preprocessed,
        provisional,
        adjustmentLedger,
      );
    }

    // Non-streaming: run the full pipeline and return JSON
    const report = await orchestrateFinancialReport(
      {
        rawData: enhancedData,
        company: effectiveCompany,
        language,
        instructions: enhancedInstructions,
      },
      { preprocessed, provisional, adjustmentLedger },
    );

    return NextResponse.json(toJsonSafe(report));
  } catch (error) {
    if (error instanceof BalanceValidationError) {
      // 422 Unprocessable Entity: el archivo es valido estructuralmente pero
      // los numeros no permiten generar un reporte. El usuario debe corregir.
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
      '[financial-report] API error:',
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: 'Internal server error during financial report generation.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// SSE streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(
  rawData: string,
  company: Parameters<typeof orchestrateFinancialReport>[0]['company'],
  language: 'es' | 'en',
  instructions: string | undefined,
  preprocessed: PreprocessedBalance | undefined,
  provisional: ProvisionalFlag | undefined,
  adjustmentLedger: AdjustmentLedger | undefined,
) {
  const readableStream = new ReadableStream({
    async start(controller) {
      const sse = createSafeSse(controller);
      const send = sse.send;

      try {
        const report = await orchestrateFinancialReport(
          { rawData, company, language, instructions },
          {
            onProgress: (event: FinancialProgressEvent) => {
              // El orchestrator emite eventos `warning` cuando el override
              // provisional convierte errores en advertencias. Los pasamos a
              // un canal SSE dedicado para que la UI los muestre como banner.
              // Seccion 0.6: formatear cada warning con formatErrorAsUserNote
              // para mensajes coherentes con la doctrina de resiliencia.
              if (event.type === 'warning') {
                const message = event.warnings
                  .map((w) => {
                    const classified = classifyError(new Error(w));
                    if (classified.tier === 'B') {
                      return formatErrorAsUserNote({
                        tier: 'B',
                        step: 'validacion contable del reporte',
                        service: 'validador determinista',
                      });
                    }
                    return formatErrorAsUserNote({
                      tier: classified.tier,
                      step: 'generacion del reporte financiero',
                      service: 'pipeline financiero',
                    });
                  })
                  .join(' | ');
                // `raw` conserva el detalle diagnostico original (E1..E9 del
                // validator) — la nota formateada sola lo perdia.
                send('warning', { message, raw: event.warnings });
                return;
              }
              send('progress', event);
            },
            preprocessed,
            provisional,
            adjustmentLedger,
          },
        );
        send('result', report);
      } catch (error) {
        if (error instanceof BalanceValidationError) {
          // El balance no cuadra — no gastamos tokens en un reporte mediocre.
          // La UI muestra las razones + cuentas a revisar al usuario.
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
            '[financial-report] Pipeline error:',
            error instanceof Error ? error.message : error,
          );
          // Traduce errores conocidos del Gateway (billing, quota, model, auth)
          // al idioma del usuario y agrega un `code` para que la UI pueda
          // diferenciar "el LLM rebote" de "tu cuenta no tiene tarjeta".
          const friendly = toFriendlyError(error, language);
          send('error', {
            error:
              language === 'en'
                ? 'Error during financial report generation.'
                : 'Error durante la generacion del reporte financiero.',
            detail: friendly.message,
            code: friendly.code,
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
