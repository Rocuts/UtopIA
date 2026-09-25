/**
 * Normaliza la respuesta de POST /api/accounting/opening-balance para la UI.
 *
 * Integración IW5b (auditoría 2026-09-24): el uploader leía `inserted` y
 * `warnings` en la raíz y `error` como string, pero la API responde
 * `{ ok: true, result: { linesInserted, warnings, … } }` y
 * `{ ok: false, error: { code, message } }`. Resultado: «Importadas 0 líneas»
 * tras una importación correcta, advertencias perdidas y, en error, un objeto
 * pintado como hijo de React (la pantalla fallaba).
 */

export interface OpeningBalanceUiResult {
  ok: boolean;
  /** Líneas del asiento de apertura; null si la API no lo informó. */
  inserted: number | null;
  warnings: string[];
  error: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function normalizeOpeningBalanceResponse(
  httpOk: boolean,
  json: unknown,
): OpeningBalanceUiResult {
  const body = asRecord(json) ?? {};
  const result = asRecord(body.result);
  const errObj = asRecord(body.error);
  const error =
    typeof body.error === 'string'
      ? body.error
      : typeof errObj?.message === 'string'
        ? errObj.message
        : typeof errObj?.code === 'string'
          ? errObj.code
          : null;

  const ok = httpOk && body.ok !== false && error === null;
  const insertedRaw = result?.linesInserted ?? body.inserted;
  return {
    ok,
    inserted: typeof insertedRaw === 'number' && Number.isFinite(insertedRaw) ? insertedRaw : null,
    warnings: [...asStrings(result?.warnings), ...asStrings(body.warnings)],
    error: ok ? null : error ?? 'import_failed',
  };
}
