import { NextResponse } from 'next/server';
import { getTaxCalendar } from '@/lib/tools/tax-calendar';
import { taxCalendarRequestSchema } from '@/lib/validation/schemas';

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = taxCalendarRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid parameters. Required: nitLastDigit (0-9), year, taxpayerType. Optional: city.',
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    }

    const { nitLastDigit, year, taxpayerType, city } = parsed.data;
    const result = await getTaxCalendar(nitLastDigit, year, taxpayerType, city);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Tax calendar API error.', error);
    return NextResponse.json(
      { error: 'Failed to retrieve tax calendar.' },
      { status: 500 },
    );
  }
}
