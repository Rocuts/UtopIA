// toc.ts — numeración de la tabla de contenido del PDF editorial.
// ───────────────────────────────────────────────────────────────────────────
// Auditoría 2026-09-24 (reportes-export-21): la tabla de contenido imprimía
// '—' en lugar de números y listaba secciones que el documento no tenía
// (un "Resumen ejecutivo" sin página; pilares o KPIs omitidos por el toggle).
// `render.ts` maqueta una vez con `TocAnchorContext` para saber en qué página
// real empieza cada sección y pasa ese mapa a `resolveTocEntries`.
// ───────────────────────────────────────────────────────────────────────────

import type { TocAnchorId, TocEntry } from './types';

const TOPIC_PREFIX = /^(TEMA|TOPIC)\s+\d+\s*:\s*/i;

/**
 * Entradas numeradas con la página real de su ancla, en orden de página. Se
 * omiten las que no tienen ancla o cuya sección no se imprimió. Los "TEMA N"
 * se renumeran 1..N en el orden resultante, para que el índice no salte
 * (TEMA 3 → TEMA 5) cuando una sección se omite. Sin anclas medidas (mapa
 * vacío) devuelve las entradas tal cual: mejor '—' que un índice vacío.
 */
export function resolveTocEntries(
  entries: readonly TocEntry[],
  pages: ReadonlyMap<TocAnchorId, number>,
): TocEntry[] {
  if (pages.size === 0) return [...entries];
  const resolved = entries
    .map((entry, index) => ({ entry, index, page: entry.anchor ? pages.get(entry.anchor) : undefined }))
    .filter((x): x is { entry: TocEntry; index: number; page: number } => typeof x.page === 'number' && x.page > 1)
    .sort((a, b) => a.page - b.page || a.index - b.index);
  let topic = 0;
  return resolved.map(({ entry, page }) => {
    const m = TOPIC_PREFIX.exec(entry.label);
    if (!m) return { ...entry, page };
    topic += 1;
    return { ...entry, page, label: `${m[1]} ${topic}: ${entry.label.slice(m[0].length)}` };
  });
}
