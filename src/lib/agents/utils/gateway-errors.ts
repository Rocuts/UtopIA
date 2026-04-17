// ---------------------------------------------------------------------------
// LLM error translation -> user-friendly bilingual
// ---------------------------------------------------------------------------
// Las llamadas LLM van DIRECTO a OpenAI via @ai-sdk/openai (auth con
// OPENAI_API_KEY). Los errores comunes son los del provider de OpenAI:
// 401 invalid api key, 429 rate limit / quota, 404 model not found.
//
// Los patrones del Vercel AI Gateway (billing, OIDC, etc.) se conservan como
// fallback porque algunas envs de prod historicas pueden seguir devolviendo
// esos mensajes durante un transition window. Si no matchea ningun patron se
// devuelve el mensaje original.
// ---------------------------------------------------------------------------

export type Lang = 'es' | 'en';

export interface FriendlyError {
  /** Mensaje listo para mostrar al usuario, en el idioma pedido. */
  message: string;
  /** Codigo machine-readable opcional para que la UI haga branching (CTA, link, etc.). */
  code?:
    | 'openai_invalid_api_key'
    | 'openai_quota_exceeded'
    | 'openai_rate_limited'
    | 'openai_model_not_found'
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
  // -------------------------------------------------------------------------
  // OpenAI direct (provider @ai-sdk/openai)
  // -------------------------------------------------------------------------
  {
    // "Incorrect API key provided: sk-..." | "invalid_api_key"
    test: (m) =>
      /incorrect api key/i.test(m) ||
      /invalid_api_key/i.test(m) ||
      /openai.*\b401\b/i.test(m),
    build: (lang) => ({
      code: 'openai_invalid_api_key',
      message:
        lang === 'en'
          ? 'OpenAI rejected the API key (HTTP 401). Verify OPENAI_API_KEY is set correctly in your environment (and on Vercel for production).'
          : 'OpenAI rechazo la API key (HTTP 401). Verifica que OPENAI_API_KEY este correctamente configurada en tu entorno (y en Vercel para produccion).',
    }),
  },
  {
    // "You exceeded your current quota, please check your plan and billing details"
    test: (m) =>
      /exceeded your current quota/i.test(m) ||
      /insufficient_quota/i.test(m) ||
      /check your plan and billing/i.test(m),
    build: (lang) => ({
      code: 'openai_quota_exceeded',
      message:
        lang === 'en'
          ? 'OpenAI quota exhausted. Add billing credits or raise the spend limit at https://platform.openai.com/account/billing and retry.'
          : 'Cuota de OpenAI agotada. Agrega creditos o aumenta el limite de gasto en https://platform.openai.com/account/billing y reintenta.',
    }),
  },
  {
    // "The model `gpt-foo` does not exist or you do not have access to it." | "model_not_found"
    test: (m) =>
      /model_not_found/i.test(m) ||
      /the model.*does not exist/i.test(m) ||
      /you do not have access to (model|that model|it)/i.test(m),
    build: (lang) => ({
      code: 'openai_model_not_found',
      message:
        lang === 'en'
          ? 'The configured OpenAI model is not available to your account. Check src/lib/config/models.ts and the OPENAI_MODEL_* env vars (do not use the legacy "openai/" prefix when calling OpenAI directly).'
          : 'El modelo de OpenAI configurado no esta disponible para tu cuenta. Revisa src/lib/config/models.ts y las env vars OPENAI_MODEL_* (no uses el prefijo legacy "openai/" cuando llamas a OpenAI directo).',
    }),
  },
  {
    // OpenAI rate limit (429 without quota wording)
    test: (m) =>
      /rate.?limit/i.test(m) ||
      /\b429\b/.test(m) ||
      /requests per (minute|second)/i.test(m),
    build: (lang) => ({
      code: 'openai_rate_limited',
      message:
        lang === 'en'
          ? 'OpenAI rate limit reached. The pipeline retried 3 times and gave up. Wait a few seconds and try again, or raise your tier limits at https://platform.openai.com/account/limits.'
          : 'Limite de tasa de OpenAI alcanzado. El pipeline reintento 3 veces sin exito. Espera unos segundos y vuelve a intentar, o aumenta los limites de tu tier en https://platform.openai.com/account/limits.',
    }),
  },

  // -------------------------------------------------------------------------
  // Vercel AI Gateway (legacy fallback — pre-migration prod traffic)
  // -------------------------------------------------------------------------
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
          ? 'The Vercel AI Gateway requires a credit card on file to process requests. UtopIA now calls OpenAI directly with OPENAI_API_KEY — if you see this in production, your deployment is still on a pre-migration commit. Redeploy main.'
          : 'El Vercel AI Gateway requiere una tarjeta de credito en la cuenta. UtopIA ahora llama a OpenAI directo con OPENAI_API_KEY — si ves este error en produccion, tu deployment esta en un commit anterior a la migracion. Redespliega main.',
    }),
  },
  {
    test: (m) => /quota.*exceed/i.test(m) || /usage.*limit.*reach/i.test(m),
    build: (lang) => ({
      code: 'gateway_quota_exceeded',
      message:
        lang === 'en'
          ? 'AI Gateway monthly quota exceeded. (UtopIA now uses OpenAI direct — if you see this, deployment is on a pre-migration commit.)'
          : 'Cuota mensual del AI Gateway agotada. (UtopIA ahora usa OpenAI directo — si ves esto, el deployment esta en un commit pre-migracion.)',
    }),
  },
  {
    test: (m) => /invalid model/i.test(m) || /model.*not found/i.test(m),
    build: (lang) => ({
      code: 'gateway_model_not_found',
      message:
        lang === 'en'
          ? 'Configured model not available. Verify OPENAI_MODEL_* env vars or src/lib/config/models.ts.'
          : 'El modelo configurado no esta disponible. Revisa las env vars OPENAI_MODEL_* o src/lib/config/models.ts.',
    }),
  },
  {
    test: (m) => /unauthorized/i.test(m) || /401/.test(m),
    build: (lang) => ({
      code: 'gateway_unauthorized',
      message:
        lang === 'en'
          ? 'LLM provider authentication failed. Verify OPENAI_API_KEY is set in the current environment.'
          : 'Fallo de autenticacion contra el proveedor LLM. Verifica que OPENAI_API_KEY este configurada en el entorno actual.',
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
