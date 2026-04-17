// ---------------------------------------------------------------------------
// Gateway error translation — Vercel AI Gateway → user-friendly bilingual
// ---------------------------------------------------------------------------
// El Vercel AI Gateway devuelve mensajes en ingles tecnico (billing, rate
// limits, model not found, OIDC). El usuario final ve esos mensajes a traves
// del SSE `error.detail`. Este helper detecta los patrones conocidos y los
// reemplaza por mensajes accionables en es/en.
//
// Si el patron no matchea, se devuelve el mensaje original (ya estaba en el
// shape esperado por la UI). Asi nunca degradamos un mensaje util.
// ---------------------------------------------------------------------------

export type Lang = 'es' | 'en';

export interface FriendlyError {
  /** Mensaje listo para mostrar al usuario, en el idioma pedido. */
  message: string;
  /** Codigo machine-readable opcional para que la UI haga branching (CTA, link, etc.). */
  code?:
    | 'gateway_billing_required'
    | 'gateway_quota_exceeded'
    | 'gateway_model_not_found'
    | 'gateway_unauthorized'
    | 'gateway_rate_limited'
    | 'pipeline_validation_failed';
}

const PATTERNS: Array<{
  test: (msg: string) => boolean;
  build: (lang: Lang) => FriendlyError;
}> = [
  {
    // "AI Gateway requires a valid credit card on file to service requests..."
    test: (m) =>
      /credit card.*on file/i.test(m) ||
      /add a card.*unlock.*free credits/i.test(m) ||
      /modal=add-credit-card/i.test(m),
    build: (lang) => ({
      code: 'gateway_billing_required',
      message:
        lang === 'en'
          ? 'The Vercel AI Gateway requires a credit card on file to process requests. ' +
            'Add a card at https://vercel.com/dashboard/[team]/~/ai (Add credit card) and retry. ' +
            'No charges occur until the included free credits are exhausted.'
          : 'El Vercel AI Gateway requiere una tarjeta de credito en la cuenta para procesar peticiones. ' +
            'Agrega una tarjeta en https://vercel.com/dashboard/[team]/~/ai (Add credit card) y reintenta. ' +
            'No se cobra hasta que se agoten los creditos gratuitos incluidos.',
    }),
  },
  {
    test: (m) => /quota.*exceed/i.test(m) || /usage.*limit.*reach/i.test(m),
    build: (lang) => ({
      code: 'gateway_quota_exceeded',
      message:
        lang === 'en'
          ? 'AI Gateway monthly quota exceeded. Increase your spend limit in the Vercel dashboard or wait until the next cycle.'
          : 'Cuota mensual del AI Gateway agotada. Aumenta el limite de gasto en el dashboard de Vercel o espera al proximo ciclo.',
    }),
  },
  {
    test: (m) => /invalid model/i.test(m) || /model.*not found/i.test(m),
    build: (lang) => ({
      code: 'gateway_model_not_found',
      message:
        lang === 'en'
          ? 'The configured model is not available on the AI Gateway. Verify the OPENAI_MODEL_* env vars or src/lib/config/models.ts.'
          : 'El modelo configurado no esta disponible en el AI Gateway. Revisa las env vars OPENAI_MODEL_* o src/lib/config/models.ts.',
    }),
  },
  {
    test: (m) => /unauthorized/i.test(m) || /401/.test(m) || /invalid.*api.?key/i.test(m),
    build: (lang) => ({
      code: 'gateway_unauthorized',
      message:
        lang === 'en'
          ? 'AI Gateway authentication failed. Verify AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN in production) is set correctly.'
          : 'Fallo de autenticacion del AI Gateway. Verifica que AI_GATEWAY_API_KEY (o VERCEL_OIDC_TOKEN en produccion) este correctamente configurada.',
    }),
  },
  {
    test: (m) => /rate.?limit/i.test(m) || /\b429\b/.test(m),
    build: (lang) => ({
      code: 'gateway_rate_limited',
      message:
        lang === 'en'
          ? 'Rate limited by the AI Gateway. The pipeline retried 3 times and gave up. Wait a few seconds and try again.'
          : 'Limite de tasa del AI Gateway alcanzado. El pipeline reintento 3 veces sin exito. Espera unos segundos y vuelve a intentar.',
    }),
  },
];

/**
 * Translate any error into a user-facing FriendlyError. Falls back to the raw
 * error message if no pattern matches (so we never lose information).
 */
export function toFriendlyError(error: unknown, lang: Lang = 'es'): FriendlyError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  for (const p of PATTERNS) {
    if (p.test(raw)) return p.build(lang);
  }

  return { message: raw };
}
