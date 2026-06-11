import { NextResponse } from 'next/server';
import { getProvidersByCountry, ERP_PROVIDERS } from '@/lib/erp/registry';
import { requireAuthSession } from '@/lib/auth/require-session';

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  const { colombian, international } = getProvidersByCountry();

  return NextResponse.json({
    colombian,
    international,
    total: Object.keys(ERP_PROVIDERS).length,
  });
}
