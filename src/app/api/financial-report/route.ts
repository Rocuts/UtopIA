import { NextResponse } from 'next/server';
import { z } from 'zod';
import { financialReportRequestSchema } from '@/lib/validation/schemas';
import {
  orchestrateFinancialReport,
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

// Schema inline para el flag `provisional` — opcional, no se reusa en otras
// rutas. Si esta presente, ambos campos son obligatorios.
const provisionalFlagSchema = z
  .object({
    active: z.boolean(),
    reason: z.string().min(1).max(2_000),
  })
  .optional();

// ---------------------------------------------------------------------------
// Adjustment ledger (Phase 2 — Doctor de Datos). Inline en esta ruta porque
// es un body opcional. La forma se duplica desde repair-chat/route.ts a
// proposito (ambas son consumers independientes del mismo tipo `Adjustment`).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /api/financial-report
// ---------------------------------------------------------------------------
// Accepts raw accounting data + company metadata, runs the 3-agent sequential
// pipeline, and returns a consolidated NIIF financial report.
//
// Supports SSE streaming via X-Stream: true header for real-time progress.
// ---------------------------------------------------------------------------

export const maxDuration = 300; // 5 minutes — financial analysis is compute-heavy

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

    // Si el cliente nos paso un PreprocessedBalance completo (desde /api/upload),
    // lo reusamos. Asi evitamos re-parsear el CSV y garantizamos que los totales
    // vinculantes que vio el usuario en el upload son exactamente los que
    // alimentan al orchestrator. Fallback: re-preprocesamos on-the-fly.
    const bodyPreprocessed = (body as { preprocessed?: PreprocessedBalance | null }).preprocessed;
    let preprocessed: PreprocessedBalance | undefined;
    if (bodyPreprocessed && typeof bodyPreprocessed === 'object') {
      preprocessed = bodyPreprocessed;
    } else {
      const rows = parseTrialBalanceCSV(rawData);
      preprocessed = rows.length > 0 ? preprocessTrialBalance(rows) : undefined;
    }

    // Enhance data with validation report and clean auxiliary data
    const enhancedData = preprocessed
      ? `${preprocessed.validationReport}\n\n---\n\nDATOS LIMPIOS (auxiliares validados):\n${preprocessed.cleanData}`
      : rawData;

    // Build binding constraints from pre-computed totals — multiperiodo:
    // imprimimos las cifras del periodo actual (primary) y, si existe
    // comparativo, tambien las del periodo anterior + variacion YoY. La idea
    // es que los agentes vean las dos columnas desde el bloque de
    // instrucciones, no solo desde el bindingTotalsBlock del orchestrator.
    let enhancedInstructions = instructions || '';
    let effectiveCompany = company;
    if (preprocessed) {
      const fmt = (n: number) =>
        (n < 0 ? '-' : '') +
        '$' +
        Math.abs(n).toLocaleString('es-CO', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      const p = preprocessed.primary;
      const c = preprocessed.comparative;

      // Autocomplete `comparativePeriod` si el caller no lo declaro pero el
      // preprocesador detecto >=2 periodos. Tambien hidratamos
      // `detectedPeriods` para que los prompts y la UI lo vean.
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

      enhancedInstructions += `\n\nTOTALES PRE-CALCULADOS (VINCULANTES — precision decimal desde auxiliares).`;
      enhancedInstructions += `\n\n=== Periodo actual (${p.period}) ===\n`;
      enhancedInstructions += `- Total Activos (Clase 1): ${fmt(p.summary.totalAssets)}\n`;
      enhancedInstructions += `- Total Pasivos (Clase 2): ${fmt(p.summary.totalLiabilities)}\n`;
      enhancedInstructions += `- Total Patrimonio (Clase 3): ${fmt(p.summary.totalEquity)}\n`;
      enhancedInstructions += `- Total Ingresos (Clase 4): ${fmt(p.summary.totalRevenue)}\n`;
      enhancedInstructions += `- Total Gastos (Clase 5): ${fmt(p.summary.totalExpenses)}\n`;
      enhancedInstructions += `- Total Costos de Ventas (Clase 6): ${fmt(p.summary.totalCosts)}\n`;
      enhancedInstructions += `- Costos de Produccion (Clase 7): ${fmt(p.summary.totalProduction)}\n`;
      enhancedInstructions += `- Utilidad Neta Calculada: ${fmt(p.summary.netIncome)}\n`;
      enhancedInstructions += `- Ecuacion Patrimonial: ${p.summary.equationBalanced ? 'CUADRA' : 'NO CUADRA'}`;

      if (c) {
        enhancedInstructions += `\n\n=== Periodo comparativo (${c.period}) ===\n`;
        enhancedInstructions += `- Total Activos: ${fmt(c.summary.totalAssets)}\n`;
        enhancedInstructions += `- Total Pasivos: ${fmt(c.summary.totalLiabilities)}\n`;
        enhancedInstructions += `- Total Patrimonio: ${fmt(c.summary.totalEquity)}\n`;
        enhancedInstructions += `- Total Ingresos: ${fmt(c.summary.totalRevenue)}\n`;
        enhancedInstructions += `- Total Gastos: ${fmt(c.summary.totalExpenses)}\n`;
        enhancedInstructions += `- Utilidad Neta: ${fmt(c.summary.netIncome)}`;

        const yoy = (cur: number, base: number): string => {
          if (base === 0) return cur === 0 ? '0,00%' : 'ND';
          const pct = ((cur - base) / Math.abs(base)) * 100;
          return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        };
        enhancedInstructions += `\n\n=== Variacion YoY (${p.period} vs ${c.period}) ===\n`;
        enhancedInstructions += `- Activos: ${fmt(p.summary.totalAssets - c.summary.totalAssets)} (${yoy(p.summary.totalAssets, c.summary.totalAssets)})\n`;
        enhancedInstructions += `- Pasivos: ${fmt(p.summary.totalLiabilities - c.summary.totalLiabilities)} (${yoy(p.summary.totalLiabilities, c.summary.totalLiabilities)})\n`;
        enhancedInstructions += `- Patrimonio: ${fmt(p.summary.totalEquity - c.summary.totalEquity)} (${yoy(p.summary.totalEquity, c.summary.totalEquity)})\n`;
        enhancedInstructions += `- Ingresos: ${fmt(p.summary.totalRevenue - c.summary.totalRevenue)} (${yoy(p.summary.totalRevenue, c.summary.totalRevenue)})\n`;
        enhancedInstructions += `- Utilidad Neta: ${fmt(p.summary.netIncome - c.summary.netIncome)} (${yoy(p.summary.netIncome, c.summary.netIncome)})`;
        enhancedInstructions += `\n\nREGLA MULTIPERIODO: Tus estados financieros, KPIs y notas DEBEN producir DOS columnas (actual + comparativo) + variacion. Cifras 0 -> $0,00. Cifras inexistentes -> ND. NUNCA omitas el comparativo silenciosamente.`;
      } else {
        enhancedInstructions += `\n\nNOTA: solo hay un periodo en el balance — modo single-period. Declara explicitamente "Sin periodo comparativo disponible" en cada estado financiero.`;
      }

      enhancedInstructions += `\n\nREGLA: Estos totales son VINCULANTES. Tus estados financieros DEBEN reflejarlos.`;

      // Discrepancias por periodo (si vienen).
      const allDiscrepancies = preprocessed.periods.flatMap((s) =>
        (s.discrepancies ?? []).map((d) =>
          typeof d === 'string' ? `[${s.period}] ${d}` : `[${s.period}] ${d.description ?? ''}`,
        ),
      );
      if (allDiscrepancies.length > 0) {
        enhancedInstructions += '\nADVERTENCIA: Discrepancias aritmeticas detectadas. USA totales de auxiliares, NO los reportados.';
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

    return NextResponse.json(report);
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
  const encoder = new TextEncoder();

  const readableStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const report = await orchestrateFinancialReport(
          { rawData, company, language, instructions },
          {
            onProgress: (event: FinancialProgressEvent) => {
              // El orchestrator emite eventos `warning` cuando el override
              // provisional convierte errores en advertencias. Los pasamos a
              // un canal SSE dedicado para que la UI los muestre como banner.
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
