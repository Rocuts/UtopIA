/**
 * GET /api/calendar/verified?year=YYYY
 *
 * Devuelve los plazos tributarios verificados (Resolución DIAN) para un año.
 * Wrapper sobre `getVerifiedNational()` exposed para que Client Components
 * (ej. `ExecutiveDashboard`) puedan consumir el calendario sin romper el
 * bundling con la cadena `pg → tls/dns/net` (ver Ola 2 build fix).
 *
 * Read-only, sin auth — los plazos son data pública.
 */
import { NextResponse } from 'next/server';
import { getVerifiedNational } from '@/lib/calendars/source';

export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get('year');
    const year = yearParam ? Number(yearParam) : new Date().getFullYear();

    if (!Number.isInteger(year) || year < 2020 || year > 2030) {
      return NextResponse.json(
        { error: 'Invalid year. Must be integer between 2020 and 2030.' },
        { status: 400 },
      );
    }

    const verified = await getVerifiedNational(year);
    return NextResponse.json(verified, {
      headers: {
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/calendar/verified] error', err);
    return NextResponse.json(
      { source: 'none', deadlines: [], error: 'internal' },
      { status: 500 },
    );
  }
}
