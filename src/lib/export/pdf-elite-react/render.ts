// render.ts — server-only thin wrapper around @react-pdf/renderer.
// ─────────────────────────────────────────────────────────────────────────────
// We use `renderToStream` (not `pdf().toBuffer()`) because in 4.5.x the
// `toBuffer` method actually returns a NodeJS.ReadableStream (despite the name)
// and `renderToStream` is the documented API for one-shot server rendering.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { renderToBuffer, renderToStream, type DocumentProps } from '@react-pdf/renderer';
import type { Readable } from 'node:stream';

import type { EditorialReport, TocAnchorId } from './types';
import { registerEditorialFonts } from './fonts';
import { EditorialReportDoc } from './EditorialReportDoc';
import { resolveTocEntries } from './toc';

function docElement(
  doc: EditorialReport,
  onTocAnchor?: (anchor: TocAnchorId, page: number) => void,
): React.ReactElement<DocumentProps> {
  return React.createElement(EditorialReportDoc, { doc, onTocAnchor }) as unknown as React.ReactElement<DocumentProps>;
}

/**
 * Numera la tabla de contenido con las páginas reales (reportes-export-21).
 * react-pdf no expone la paginación antes de maquetar: una primera pasada
 * (descartada) registra la página de cada `<TocAnchor>` y la segunda imprime
 * los números. El número de páginas no cambia entre pasadas: la tabla ocupa
 * una sola página y sólo cambian las cifras de su columna o se omiten
 * entradas de secciones que no se imprimieron. El informe BLOQUEADO no tiene
 * tabla de contenido.
 */
export async function withResolvedToc(doc: EditorialReport): Promise<EditorialReport> {
  if (doc.meta.watermark === 'BLOQUEADO' || doc.toc.entries.length === 0) return doc;
  const pages = new Map<TocAnchorId, number>();
  await renderToBuffer(
    docElement(doc, (anchor, page) => {
      const prev = pages.get(anchor);
      if (prev === undefined || page < prev) pages.set(anchor, page);
    }),
  );
  return { ...doc, toc: { ...doc.toc, entries: resolveTocEntries(doc.toc.entries, pages) } };
}

/**
 * Render an `EditorialReport` IR to a Node Readable PDF stream.
 *
 * Idempotent font registration runs first; the call is cheap on repeat. The
 * returned stream is suitable for piping into a Response body or saving to
 * disk. The table of contents is numbered first (`withResolvedToc`).
 */
export async function renderEditorialReportToStream(
  doc: EditorialReport,
): Promise<Readable> {
  registerEditorialFonts();
  const resolved = await withResolvedToc(doc);
  const stream = await renderToStream(docElement(resolved));
  return stream as unknown as Readable;
}
