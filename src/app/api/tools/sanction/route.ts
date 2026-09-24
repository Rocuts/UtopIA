import { NextResponse } from 'next/server';
import { calculateSanction, SanctionInputError } from '@/lib/tools/sanction-calculator';
// Contrato compartido con la tool LLM y la voz Realtime: transmite todos los
// campos que usa `calculateSanction` (saldoAFavor, netEquityPriorYear,
// correccionStage, reduccion640, ...). Ver src/lib/tools/sanction-contract.ts.
import { sanctionRequestSchema, toSanctionCalculation } from '@/lib/tools/sanction-contract';
import { requireAuthSession } from '@/lib/auth/require-session';

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = sanctionRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid parameters.' }, { status: 400 });
    }

    const result = calculateSanction(toSanctionCalculation(parsed.data));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SanctionInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Error calculating sanction.' },
      { status: 500 }
    );
  }
}
