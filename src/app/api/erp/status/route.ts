import { NextResponse } from 'next/server';
import { ERP_PROVIDERS } from '@/lib/erp/registry';
import { requireAuthSession } from '@/lib/auth/require-session';

export async function GET() {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;
  // In a production app, this would check stored connections in a database.
  // For now, return available providers and their capabilities.
  return NextResponse.json({
    availableProviders: Object.keys(ERP_PROVIDERS).length,
    providers: Object.values(ERP_PROVIDERS).map(p => ({
      id: p.id,
      name: p.name,
      country: p.country,
      authType: p.authType,
      supportsPUC: p.supportsPUC,
      supportsDIAN: p.supportsDIAN,
      capabilityCount: p.capabilities.length,
    })),
  });
}
