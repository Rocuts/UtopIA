// /api/financial-report/export-preview
// ─────────────────────────────────────────────────────────────────────────────
// Dev-only smoke endpoint: renders the canonical sample EditorialReport fixture
// to PDF and returns it inline so designers/iterating layout can refresh the
// browser tab and see changes without burning LLM calls. Production builds
// disable the route (404).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  renderEditorialReportToStream,
  type EditorialReport,
} from '@/lib/export/pdf-elite-react';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  try {
    const fixturePath = path.join(
      process.cwd(),
      'src',
      'lib',
      'export',
      'pdf-elite-react',
      '__fixtures__',
      'sample-doc.json',
    );
    const raw = await fs.readFile(fixturePath, 'utf-8');
    const doc = JSON.parse(raw) as EditorialReport;

    const stream = await renderEditorialReportToStream(doc);
    const web = Readable.toWeb(stream) as unknown as ReadableStream;

    return new Response(web, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="editorial-preview.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[export-preview] render failed:', err);
    return NextResponse.json(
      { error: 'preview render failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
