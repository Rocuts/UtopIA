import { NextResponse } from 'next/server';
import { z } from 'zod';
import { incorporarConfirmaciones, TrialBalanceIngestError } from '@/lib/preprocessing/raw-data';
import { leerCampoUnidad, MAX_VENCIMIENTOS_DECLARADOS } from '@/lib/upload/ingest-directives';

// ---------------------------------------------------------------------------
// Confirmaciones de ingesta que llegan como campos de la solicitud (P4 × P1)
// ---------------------------------------------------------------------------
// /niif acepta `unitMultiplier` (1 | 1000 | 1000000) y `maturityOverrides`
// (`código → corriente | no_corriente`) y los escribe como directivas al inicio
// de `rawData`. El intake de la UI ya las escribe en el texto, pero un caller
// que las envía como campos a /niif y reenvía el `rawData` original a
// /consolidate o /export obtenía un 422 falso: esas rutas RE-DERIVAN el balance
// desde `rawData` (P1) y, sin la confirmación, un archivo "en miles de pesos"
// vuelve a bloquearse o sus totales difieren 1.000 veces del preprocesado de
// /niif. Toda ruta que re-deriva el balance desde `rawData` usa este mismo
// helper, con el mismo contrato que /niif: campo inválido → 400; contradicción
// con las directivas del texto → 422, nunca se elige una fuente en silencio.
// ---------------------------------------------------------------------------

/**
 * Excepciones de vencimiento por cuenta. Sólo cuentas de activo (1) o pasivo
 * (2). No viaja al LLM: es entrada del usuario que el preprocesador aplica de
 * forma determinista (no aplica el contrato strict-mode).
 */
export const maturityOverridesSchema = z
  .record(
    z.string().regex(/^[12]\d{1,19}$/, 'código PUC de activo (1) o pasivo (2), 2 a 20 dígitos'),
    z.enum(['corriente', 'no_corriente']),
  )
  .refine((m) => Object.keys(m).length <= MAX_VENCIMIENTOS_DECLARADOS, {
    message: `máximo ${MAX_VENCIMIENTOS_DECLARADOS} excepciones`,
  })
  .nullable()
  .optional();

export type ConfirmedRawData = { ok: true; rawData: string } | { ok: false; response: Response };

/**
 * `rawData` con las confirmaciones de la solicitud (`unitMultiplier`,
 * `maturityOverrides`) escritas como directivas de ingesta. Sin campos
 * devuelve el texto intacto.
 */
export function applyRequestConfirmations(body: unknown, rawData: string): ConfirmedRawData {
  const fields = (body && typeof body === 'object' ? body : {}) as {
    unitMultiplier?: unknown;
    maturityOverrides?: unknown;
  };
  const unit = leerCampoUnidad(fields.unitMultiplier);
  if (!unit.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid request format.', details: [`unitMultiplier: ${unit.error}`] },
        { status: 400 },
      ),
    };
  }
  const maturity = maturityOverridesSchema.safeParse(fields.maturityOverrides);
  if (!maturity.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Invalid request format.',
          details: maturity.error.issues.map((i) => `maturityOverrides.${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 },
      ),
    };
  }
  try {
    return {
      ok: true,
      rawData: incorporarConfirmaciones(rawData, {
        ...(unit.unidad ? { unidadConfirmada: unit.unidad } : {}),
        ...(maturity.data ? { vencimientos: maturity.data } : {}),
      }),
    };
  } catch (err) {
    if (err instanceof TrialBalanceIngestError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'El balance de prueba tiene inconsistencias criticas.',
            code: 'BALANCE_VALIDATION_FAILED',
            reasons: err.reasons,
            suggestedAccounts: [],
          },
          { status: 422 },
        ),
      };
    }
    throw err;
  }
}
