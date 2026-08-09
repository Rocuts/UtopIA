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
import { checkCronAuth } from '@/lib/security/cron-auth';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  // FIX (audit E3): fail-CLOSED cuando CRON_SECRET no está configurado.
  // El comportamiento previo (`if (cronSecret) { verificar }`) dejaba el
  // endpoint completamente abierto en entornos sin la variable provisionada
  // (preview/staging) — riesgo de ejecución no autorizada.
  // SECURITY: comparación en tiempo constante vía helper compartido (antes
  // `!==` de strings).
  const authError = checkCronAuth(req);
  if (authError) return authError;

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
