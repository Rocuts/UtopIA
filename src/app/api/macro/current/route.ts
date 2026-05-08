/**
 * GET /api/macro/current — Factores macro Colombia actuales.
 *
 * Endpoint público (info pública BanRep/DANE).
 * Cache: s-maxage=3600 (CDN cache 1h), stale-while-revalidate=86400 (24h).
 * El cache Postgres del servicio evita llamadas externas redundantes.
 */

import { NextResponse } from 'next/server';
import { getMacroFactors } from '@/lib/macro/service';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const macro = await getMacroFactors();
    return NextResponse.json(macro, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/macro/current] Error:', err);
    return NextResponse.json(
      { error: 'No se pudieron obtener los factores macro' },
      { status: 500 },
    );
  }
}
