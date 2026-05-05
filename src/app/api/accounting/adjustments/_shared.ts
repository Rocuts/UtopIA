// ─── WS4 — Shared helpers for /api/accounting/adjustments/* ─────────────────
//
// Schemas Zod locales + helpers de respuesta específicos de este submódulo.
// No tocar otros _shared.ts del proyecto.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AdjustmentsError, ADJ_ERR } from '@/lib/accounting/adjustments/types';
import { DoubleEntryError } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// Error → HTTP
// ---------------------------------------------------------------------------

export function statusForAdjErr(code: string): number {
  switch (code) {
    case ADJ_ERR.PERIOD_NOT_FOUND:
      return 404;
    case ADJ_ERR.PERIOD_NOT_OPEN:
      return 422;
    case ADJ_ERR.ALREADY_APPLIED:
      return 409;
    case ADJ_ERR.CONFIG_MISSING:
      return 422;
    case ADJ_ERR.INVALID_INPUT:
      return 400;
    case ADJ_ERR.ENGINE_DISABLED:
      return 503;
    default:
      return 500;
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof AdjustmentsError) {
    return NextResponse.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      { status: statusForAdjErr(err.code), headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (err instanceof DoubleEntryError) {
    return NextResponse.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
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
    if (code === '23503') {
      return NextResponse.json(
        { error: 'fk_violation', message: 'Referencia inválida' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  console.error('[adjustments]', err);
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

export function disabled503() {
  return NextResponse.json(
    {
      error: ADJ_ERR.ENGINE_DISABLED,
      message:
        'NIIF Auto-Adjustments no está habilitado. Agrega UTOPIA_ENABLE_AUTO_ADJUSTMENTS=true al entorno.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const periodIdSchema = z.object({
  periodId: z.string().uuid('periodId debe ser un UUID válido'),
});

export const previewBodySchema = z.object({
  periodId: z.string().uuid(),
  /** Fecha del asiento. ISO-8601. Opcional — default: último día del período. */
  entryDate: z.string().datetime({ offset: true }).optional(),
});

export const runBodySchema = z.object({
  periodId: z.string().uuid(),
  entryDate: z.string().datetime({ offset: true }).optional(),
  /** Si true, crea y postea el asiento; si false (default), solo preview. */
  post: z.boolean().optional().default(false),
});

// ── Fixed Assets ──────────────────────────────────────────────────────────

export const fixedAssetCreateSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  category: z.string().min(1).max(32),
  assetAccountId: z.string().uuid(),
  depreciationAccountId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  acquisitionDate: z.string().datetime({ offset: true }),
  acquisitionCost: z.string().regex(/^\d+(\.\d{1,2})?$/, 'NUMERIC string requerido'),
  salvageValue: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default('0'),
  usefulLifeMonths: z.number().int().min(1).max(1200),
  depreciationMethod: z
    .enum(['straight_line', 'units_of_production', 'accelerated'])
    .optional()
    .default('straight_line'),
  notes: z.string().optional().nullable(),
});

export const fixedAssetUpdateSchema = fixedAssetCreateSchema.partial().extend({
  active: z.boolean().optional(),
  disposedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// ── Deferred Assets ───────────────────────────────────────────────────────

export const deferredAssetCreateSchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1).max(32).optional().default('other'),
  assetAccountId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  totalAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  amortizationStart: z.string().datetime({ offset: true }),
  amortizationEnd: z.string().datetime({ offset: true }),
});

export const deferredAssetUpdateSchema = deferredAssetCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });

// ── Provisions Config ─────────────────────────────────────────────────────

export const provisionsConfigCreateSchema = z.object({
  provisionType: z.string().min(1).max(32),
  rate: z.string().regex(/^\d+(\.\d{1,6})?$/),
  baseAccountCodes: z.array(z.string()).optional().default([]),
  expenseAccountId: z.string().uuid(),
  liabilityAccountId: z.string().uuid(),
  cadence: z.enum(['monthly', 'annual']).optional().default('monthly'),
  active: z.boolean().optional().default(true),
});

export const provisionsConfigUpdateSchema =
  provisionsConfigCreateSchema.partial();
