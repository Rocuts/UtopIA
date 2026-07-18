import { NextResponse } from 'next/server';
import { calculateSanction } from '@/lib/tools/sanction-calculator';
import { sanctionRequestSchema } from '@/lib/validation/schemas';
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

    const result = calculateSanction(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Error calculating sanction.' },
      { status: 500 }
    );
  }
}
