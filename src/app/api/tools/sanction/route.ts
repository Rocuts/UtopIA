import { NextResponse } from 'next/server';
import { calculateSanction } from '@/lib/tools/sanction-calculator';
import { sanctionRequestSchema } from '@/lib/validation/schemas';

export async function POST(req: Request) {
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
