// ---------------------------------------------------------------------------
// POST /api/sentinel/check
// Body: { periodId?: string, recipient?: string, dryRun?: boolean }
// Effect: dispara `runSentinelCheck` (workflow durable Vercel WDK).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { runSentinelCheck } from '@/lib/workflows/sentinel';

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { periodId?: string; recipient?: string; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body opcional
  }

  try {
    const ws = await getOrCreateWorkspace();

    // El preprocessed balance debe venir desde el upload reciente; aquí
    // disparamos el workflow sin él para forzar a que el cliente envíe
    // el TB pre-procesado en una versión futura. Por ahora retornamos
    // un report vacío.
    const report = await runSentinelCheck(
      {
        workspaceId: ws.id,
        periodId: body.periodId ?? null,
        recipient: body.recipient,
        dryRun: body.dryRun ?? false,
      },
      null, // preprocessed: TODO en P8 — pasar desde último cálculo persistido
    );

    return NextResponse.json(
      { ok: true, report },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_check_failed';
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
