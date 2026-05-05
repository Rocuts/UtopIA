// ─── WS1 — Tax Engine API: helpers compartidos ───────────────────────────────
//
// Mapeo de TaxEngineError.code → HTTP status.
// Separado en _shared.ts (convención Next.js: prefijo _ = no-route) para
// que route.ts sea concisa y legible.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { TaxEngineError, TAX_ERR } from '@/lib/accounting/tax-engine';

// ---------------------------------------------------------------------------
// Mapeo de error codes → HTTP status
// ---------------------------------------------------------------------------

export function taxStatusForCode(code: string): number {
  switch (code) {
    case TAX_ERR.INVALID_INPUT:
      return 400;
    case TAX_ERR.RULE_NOT_FOUND:
    case TAX_ERR.ACCOUNT_NOT_FOUND:
    case TAX_ERR.UNKNOWN_THIRD_PARTY:
      return 404;
    case TAX_ERR.INTEGRITY_VIOLATION:
      return 422;
    case TAX_ERR.ENGINE_DISABLED:
      return 503;
    default:
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Respuestas estandarizadas
// ---------------------------------------------------------------------------

export function taxErrorResponse(err: unknown) {
  if (err instanceof TaxEngineError) {
    return NextResponse.json(
      {
        error: err.code,
        message: err.message,
        details: err.details ?? null,
      },
      {
        status: taxStatusForCode(err.code),
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  // Error inesperado
  console.error('[tax-engine]', err);
  return NextResponse.json(
    {
      error: 'internal_error',
      message: 'Error interno del motor tributario',
    },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function taxBadRequestZod(error: z.ZodError) {
  return NextResponse.json(
    {
      error: 'invalid_body',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function taxOk<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
