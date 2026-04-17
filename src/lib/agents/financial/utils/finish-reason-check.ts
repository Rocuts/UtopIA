// ---------------------------------------------------------------------------
// finish-reason-check — helper compartido para auditar el finishReason
// ---------------------------------------------------------------------------
// AI SDK v6 expone `result.finishReason` de tipo FinishReason:
//   'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown'
//
// Este helper centraliza la politica del proyecto:
//   - Para los 3 agentes principales (NIIF, Strategy, Governance): ellos LANZAN.
//   - Para el resto del pipeline: solo LOG (no rompemos produccion).
// ---------------------------------------------------------------------------

/**
 * Subconjunto minimo del resultado de `generateText` que usa este helper.
 * Lo dejamos estructural para no acoplarnos al shape exacto del SDK.
 */
export interface FinishableResult {
  finishReason?: string;
  text?: string;
}

/**
 * FinishReasons considerados "no limpios". `stop` y `tool-calls` son OK.
 * - `length`: el modelo corto porque alcanzo maxOutputTokens.
 * - `content-filter`: fue bloqueado por safety.
 * - `error`: falla del provider ya reportada por el SDK.
 * - `unknown` / `other`: raro, pero tratamos como sospechoso.
 */
const UNCLEAN_REASONS = new Set([
  'length',
  'content-filter',
  'error',
  'unknown',
  'other',
]);

/**
 * Verifica de forma "suave": loguea warning si finishReason es sospechoso.
 * Pensado para pipelines secundarios (audit, valuation, tax-planning, etc.)
 * donde preferimos degradar antes que romper.
 *
 * @param result  Resultado de `generateText`.
 * @param label   Etiqueta legible para logs (p.ej. "niif_auditor").
 */
export function assertFinishedCleanly(
  result: FinishableResult,
  label: string,
): void {
  const reason = result.finishReason;
  if (!reason || !UNCLEAN_REASONS.has(reason)) return;
  const textLen = typeof result.text === 'string' ? result.text.length : 0;
  console.warn(
    `[finish-reason] ${label}: finishReason="${reason}" (textLen=${textLen}). ` +
      'Output potencialmente truncado o bloqueado. Revisar maxOutputTokens o content filters.',
  );
}

/**
 * Variante estricta: LANZA si el finishReason no es limpio.
 * Reservado para los 3 agentes principales del financial report.
 *
 * @param result Resultado de `generateText`.
 * @param label  Etiqueta legible usada en el mensaje del error.
 */
export function assertFinishedCleanlyOrThrow(
  result: FinishableResult,
  label: string,
): void {
  const reason = result.finishReason;
  if (!reason || !UNCLEAN_REASONS.has(reason)) return;
  const textLen = typeof result.text === 'string' ? result.text.length : 0;
  const hint =
    reason === 'length'
      ? 'Considera aumentar maxOutputTokens o dividir el prompt.'
      : reason === 'content-filter'
        ? 'El output fue bloqueado por safety. Revisa el contenido enviado.'
        : 'Fallo del provider. Reintenta o revisa los logs del gateway.';
  throw new Error(
    `[${label}] hit finish_reason=${reason}: output truncado o incompleto (textLen=${textLen}). ${hint}`,
  );
}
