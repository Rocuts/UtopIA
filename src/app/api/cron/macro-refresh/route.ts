/**
 * Cron: actualización diaria de factores macro Colombia.
 * Schedule: 0 12 * * * (12:00 UTC = 07:00 COT) — definido en vercel.ts.
 *
 * Auth: Bearer ${CRON_SECRET} — Vercel inyecta este header automáticamente
 * en los cron jobs (verifica contra process.env.CRON_SECRET).
 * El endpoint también está en la allowlist CSRF de src/proxy.ts.
 *
 * Retorna: { ipc, trm, tasaBanRep, fechaActualizacion, fuente }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMacroFactors } from '@/lib/macro/service';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Verificar Bearer token.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const macro = await getMacroFactors({ force: true });
    return NextResponse.json({
      ok: true,
      ipc: macro.ipc,
      trm: macro.trm,
      tasaBanRep: macro.tasaBanRep,
      fechaActualizacion: macro.fechaActualizacion,
      fuente: macro.fuente,
    });
  } catch (err) {
    console.error('[cron/macro-refresh] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
