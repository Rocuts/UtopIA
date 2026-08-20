// ─── GET /api/v1/openapi.json — contrato OpenAPI 3.1.2 (público) ────────────
// Generado desde los schemas Zod (cero drift de entrada). Público a propósito
// (OWASP API9 — inventario): el contrato no es un secreto, las llaves sí.

import { NextResponse } from 'next/server';

import { buildOpenApiDocument } from '@/lib/api/openapi';

export const maxDuration = 15;

export async function GET() {
  return NextResponse.json(buildOpenApiDocument(), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
