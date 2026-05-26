import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { MODELS } from '@/lib/config/models';

export async function GET() {
  const started = Date.now();
  try {
    const result = await generateText({
      model: MODELS.CHAT,
      prompt: 'ping',
      maxOutputTokens: 5,
    });
    return NextResponse.json({
      ok: true,
      elapsedMs: Date.now() - started,
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
    });
  } catch (error) {
    const err = error as { name?: string; message?: string; status?: number; statusCode?: number; cause?: unknown };
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        name: err.name ?? null,
        message: err.message ?? String(error),
        status: err.status ?? err.statusCode ?? null,
        cause: err.cause ? String(err.cause) : null,
      },
      { status: 500 },
    );
  }
}
