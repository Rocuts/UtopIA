// ---------------------------------------------------------------------------
// Errores de /api/escudo-survival y /api/escudo/fiscal para la UI (I4-escudo 1)
// ---------------------------------------------------------------------------
// Un balance que no sirve de base para cifras fiscales llega como 422 (JSON)
// o como evento SSE `error`, ambos con `code: 'BALANCE_VALIDATION_FAILED'` y
// `reasons` (mismo contrato que /niif). Los hooks del Escudo mostraban sólo
// `error` (o el cuerpo JSON crudo del 4xx): el usuario no veía por qué. Estas
// funciones puras extraen el encabezado y las razones para el panel.
// ---------------------------------------------------------------------------

export interface EscudoErrorInfo {
  /** Mensaje principal para el usuario. */
  error: string;
  /** Razones del bloqueo del balance (vacío si el error no las trae). */
  reasons: string[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
    : [];
}

/** Cuerpo de una respuesta HTTP no-OK (JSON del route handler o texto plano). */
export function escudoErrorFromHttp(status: number, bodyText: string): EscudoErrorInfo {
  const text = (bodyText ?? '').trim();
  try {
    const parsed = JSON.parse(text) as { error?: unknown; reasons?: unknown };
    if (parsed && typeof parsed === 'object') {
      const error =
        typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error : `HTTP ${status}`;
      return { error, reasons: stringArray(parsed.reasons) };
    }
  } catch {
    // Texto plano (p. ej. un proxy): se muestra tal cual.
  }
  return { error: text || `HTTP ${status}`, reasons: [] };
}

/** `data` de un evento SSE `error` (`{ error, detail?, code?, reasons? }`). */
export function escudoErrorFromSse(data: string, fallback: string): EscudoErrorInfo {
  try {
    const parsed = JSON.parse(data) as { error?: unknown; reasons?: unknown };
    const error =
      parsed && typeof parsed.error === 'string' && parsed.error.trim() ? parsed.error : fallback;
    return { error, reasons: stringArray(parsed?.reasons) };
  } catch {
    return { error: fallback, reasons: [] };
  }
}
