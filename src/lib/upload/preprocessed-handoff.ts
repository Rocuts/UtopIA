// ---------------------------------------------------------------------------
// Handoff en memoria del `preprocessed` de /api/upload al pipeline NIIF.
// ---------------------------------------------------------------------------
// El intake NIIF guarda el balance como texto (`rawData`), y ese texto se
// persiste en localStorage (borrador del intake y corrida pendiente). El
// `PreprocessedBalance` que devuelve /api/upload puede pesar varios MB, así que
// NO viaja dentro del intake: se deja aquí, en memoria del tab, asociado al
// texto EXACTO del que salió. PipelineWorkspace lo recupera al armar el body
// de /api/financial-report/niif sólo si `rawData` no cambió; tras una recarga
// o una edición manual no hay coincidencia y el servidor lo re-deriva desde
// `rawData` (que es, de todos modos, la fuente autoritativa del servidor).
//
// Un único slot: sólo interesa el último archivo subido y así no se acumula
// memoria entre corridas.
// ---------------------------------------------------------------------------

/** Tope del `preprocessed` serializado que se reenvía (el body de una Function admite 4.5 MB). */
export const MAX_FORWARDED_PREPROCESSED_CHARS = 1_000_000;

let slot: { key: string; preprocessed: unknown } | null = null;

function keyOf(rawData: string): string {
  return rawData.trim();
}

/** Recuerda el preprocesado del último upload junto al texto del que salió. */
export function rememberUploadedPreprocessed(rawData: string, preprocessed: unknown): void {
  if (!rawData || preprocessed === null || preprocessed === undefined) {
    slot = null;
    return;
  }
  slot = { key: keyOf(rawData), preprocessed };
}

/**
 * Devuelve el preprocesado del upload si `rawData` es exactamente el texto que
 * lo produjo y su tamaño serializado cabe en el body; si no, `undefined`.
 */
export function recallUploadedPreprocessed(rawData: string | null | undefined): unknown {
  if (!slot || !rawData || keyOf(rawData) !== slot.key) return undefined;
  try {
    const size = JSON.stringify(slot.preprocessed).length;
    return size <= MAX_FORWARDED_PREPROCESSED_CHARS ? slot.preprocessed : undefined;
  } catch {
    return undefined;
  }
}

/** Olvida el preprocesado recordado (p. ej. al reiniciar el intake). */
export function clearUploadedPreprocessed(): void {
  slot = null;
}
