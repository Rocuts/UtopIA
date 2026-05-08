// render.ts — server-only thin wrapper around @react-pdf/renderer.
// ─────────────────────────────────────────────────────────────────────────────
// We use `renderToStream` (not `pdf().toBuffer()`) because in 4.5.x the
// `toBuffer` method actually returns a NodeJS.ReadableStream (despite the name)
// and `renderToStream` is the documented API for one-shot server rendering.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { renderToStream, type DocumentProps } from '@react-pdf/renderer';
import type { Readable } from 'node:stream';

import type { EditorialReport } from './types';
import { registerEditorialFonts } from './fonts';
import { EditorialReportDoc } from './EditorialReportDoc';

/**
 * Render an `EditorialReport` IR to a Node Readable PDF stream.
 *
 * Idempotent font registration runs first; the call is cheap on repeat. The
 * returned stream is suitable for piping into a Response body or saving to
 * disk.
 */
export async function renderEditorialReportToStream(
  doc: EditorialReport,
): Promise<Readable> {
  registerEditorialFonts();
  const element = React.createElement(EditorialReportDoc, { doc }) as unknown as React.ReactElement<DocumentProps>;
  const stream = await renderToStream(element);
  return stream as unknown as Readable;
}
