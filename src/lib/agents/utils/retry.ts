// ---------------------------------------------------------------------------
// Retry utility with exponential backoff for LLM and external API calls
// ---------------------------------------------------------------------------

/**
 * Configuration for the retry wrapper.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including the first one). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms before first retry. Doubles on each subsequent retry. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 8000 */
  maxDelayMs?: number;
  /** Abort signal for timeout. The retry loop respects this on each attempt. */
  signal?: AbortSignal;
  /** Label for logging. */
  label?: string;
}

/** Errors that are safe to retry — transient network/server issues. */
function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // OpenAI rate limit (429)
    if (msg.includes('rate limit') || msg.includes('429')) return true;
    // OpenAI server errors (500, 502, 503)
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
    if (msg.includes('server error') || msg.includes('internal error')) return true;
    // Network errors
    if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed')) return true;
    if (msg.includes('network') || msg.includes('socket hang up')) return true;
    // OpenAI overloaded
    if (msg.includes('overloaded') || msg.includes('capacity')) return true;
  }
  return false;
}

/**
 * Execute an async function with exponential backoff retries.
 *
 * Only retries on transient errors (rate limits, 5xx, network).
 * Non-retryable errors (4xx validation, auth) are thrown immediately.
 *
 * @example
 * const result = await withRetry(() => openai.chat.completions.create({...}), {
 *   label: 'classifier',
 *   maxAttempts: 3,
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 8000,
    signal,
    label = 'api_call',
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Respect abort signal
    if (signal?.aborted) {
      throw new Error(`[${label}] Aborted before attempt ${attempt}.`);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on non-retryable errors or last attempt
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s... capped at maxDelayMs
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} failed (${error instanceof Error ? error.message : 'unknown'}). Retrying in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create an AbortSignal that fires after the given timeout in ms.
 */
export function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
