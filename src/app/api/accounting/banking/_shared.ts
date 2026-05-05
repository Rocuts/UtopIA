// ---------------------------------------------------------------------------
// banking/_shared.ts — Shared helpers for /api/accounting/banking/* routes.
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BankingError, isBankReconEnabled } from '@/lib/accounting/banking';

export function disabledResponse() {
  return NextResponse.json(
    { error: 'bank_recon_disabled' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function checkEnabled(): NextResponse | null {
  if (!isBankReconEnabled()) return disabledResponse();
  return null;
}

export function bankingErrorResponse(err: unknown) {
  if (err instanceof BankingError) {
    const status =
      err.code === 'BANK_ACCOUNT_NOT_FOUND' ? 404
      : err.code === 'BANK_ENGINE_DISABLED' ? 503
      : err.code === 'BANK_INVALID_INPUT' ? 400
      : err.code === 'BANK_PARSE_FAILED' ? 422
      : 500;
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === '23505') {
      return NextResponse.json(
        { error: 'unique_violation', message: 'Registro duplicado' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  console.error('[banking]', err);
  return NextResponse.json(
    { error: 'internal_error', message: 'Error interno' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function badRequestZod(error: z.ZodError) {
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

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
