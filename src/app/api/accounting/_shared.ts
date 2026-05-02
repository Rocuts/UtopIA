// ---------------------------------------------------------------------------
// Shared helpers for /api/accounting/* route handlers.
//
// File is name-prefixed with `_` so Next.js doesn't expose it as a route.
// (The Next App Router uses the underscore prefix as a "private folder"
// convention to opt out of routing — see Next docs.)
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DoubleEntryError, ERR } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// Map application errors to HTTP status codes.
//
// 400 — caller sent malformed/invalid input (UNBALANCED, INVALID_LINES)
// 404 — entity not found (ENTRY_NOT_FOUND, WORKSPACE_MISMATCH)
// 409 — conflict with current state (ALREADY_REVERSED, ENTRY_NOT_DRAFT,
//        CONCURRENCY, ENTRY_NOT_POSTED)
// 422 — semantically invalid given current state of related entities
//        (PERIOD_NOT_OPEN, ACCOUNT_NOT_POSTABLE)
// 500 — fallback for unexpected DoubleEntryError codes
// ---------------------------------------------------------------------------

export function statusForCode(code: string): number {
  switch (code) {
    case ERR.UNBALANCED:
    case ERR.INVALID_LINES:
      return 400;
    case ERR.ENTRY_NOT_FOUND:
    case ERR.WORKSPACE_MISMATCH:
      return 404;
    case ERR.ALREADY_REVERSED:
    case ERR.ENTRY_NOT_DRAFT:
    case ERR.ENTRY_NOT_POSTED:
    case ERR.CONCURRENCY:
      return 409;
    case ERR.PERIOD_NOT_OPEN:
    case ERR.ACCOUNT_NOT_POSTABLE:
      return 422;
    default:
      return 500;
  }
}

export function errorResponse(err: unknown, fallback = 'internal_error') {
  if (err instanceof DoubleEntryError) {
    return NextResponse.json(
      {
        error: err.code,
        message: err.message,
        details: err.details ?? null,
      },
      {
        status: statusForCode(err.code),
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
  // node-postgres error with SQLSTATE.
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === '40001' || code === '40P01') {
      return NextResponse.json(
        {
          error: ERR.CONCURRENCY,
          message: 'Conflicto de concurrencia, reintenta',
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // Unique violation / FK violation — give a hint without leaking schema.
    if (code === '23505') {
      return NextResponse.json(
        { error: 'unique_violation', message: 'Registro duplicado' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (code === '23503') {
      return NextResponse.json(
        { error: 'fk_violation', message: 'Referencia invalida' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  // Unexpected.
  console.error('[accounting]', err);
  return NextResponse.json(
    { error: fallback, message: 'Error interno' },
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

// ---------------------------------------------------------------------------
// Compute period boundaries for (year, month). Month 13 represents the
// "ajustes de cierre" period (post-December closing entries) — common in
// Colombian PUC. Year=2026, month=13 ⇒ both startsAt and endsAt = 2026-12-31
// 23:59:59.999 (everything happens at fiscal year-end).
// ---------------------------------------------------------------------------

export function computePeriodBoundaries(year: number, month: number) {
  if (month === 13) {
    // Closing pseudo-period sits at the very end of December.
    const ts = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    return { startsAt: ts, endsAt: ts };
  }
  const startsAt = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startsAt, endsAt };
}
