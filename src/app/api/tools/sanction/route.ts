import { NextResponse } from 'next/server';
import { calculateSanction } from '@/lib/tools/sanction-calculator';

export async function POST(req: Request) {
  try {
    const params = await req.json();
    const result = calculateSanction(params);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
