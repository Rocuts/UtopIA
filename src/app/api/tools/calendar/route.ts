import { NextResponse } from 'next/server';
import { getTaxCalendar } from '@/lib/tools/tax-calendar';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { nitLastDigit, year, taxpayerType } = body;

    if (
      typeof nitLastDigit !== 'number' ||
      nitLastDigit < 0 || nitLastDigit > 9 ||
      typeof year !== 'number' ||
      !['persona_juridica', 'persona_natural', 'gran_contribuyente'].includes(taxpayerType)
    ) {
      return NextResponse.json(
        { error: 'Invalid parameters. Required: nitLastDigit (0-9), year, taxpayerType.' },
        { status: 400 }
      );
    }

    const result = await getTaxCalendar(nitLastDigit, year, taxpayerType);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Tax calendar API error.');
    return NextResponse.json(
      { error: 'Failed to retrieve tax calendar.' },
      { status: 500 }
    );
  }
}
