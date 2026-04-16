import { NextResponse } from 'next/server';
import { getProvidersByCountry, ERP_PROVIDERS } from '@/lib/erp/registry';

export async function GET() {
  const { colombian, international } = getProvidersByCountry();

  return NextResponse.json({
    colombian,
    international,
    total: Object.keys(ERP_PROVIDERS).length,
  });
}
