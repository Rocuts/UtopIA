// ─── WS1 — POST /api/accounting/tax-engine/preview ───────────────────────────
//
// Evalúa una transacción y devuelve propuestas de líneas tributarias.
// NO persiste journal_entries — solo propone (preview).
//
// Auth: workspaceId derivado de cookie utopia_workspace_id (NUNCA del body).
// Feature flag: UTOPIA_ENABLE_TAX_ENGINE=true (OFF por defecto).
//
// Request body: TaxEvaluationInput (sin workspaceId — se inyecta desde cookie)
// Response: TaxEvaluationResult
//
// Smoke test (ver README):
//   curl -X POST http://localhost:3000/api/accounting/tax-engine/preview \
//     -H "Content-Type: application/json" \
//     -b "utopia_workspace_id=<ID>" \
//     -d '{"transactionType":"service_purchase","subtotalCop":"1000000","thirdPartyId":"<UUID>"}'

import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  taxEngine,
  isTaxEngineEnabled,
  TaxEngineError,
  TAX_ERR,
} from '@/lib/accounting/tax-engine';
import { taxErrorResponse, taxBadRequestZod, taxOk } from '../_shared';

// ---------------------------------------------------------------------------
// Zod schema del body (sin workspaceId — se inyecta desde cookie)
// ---------------------------------------------------------------------------

const taxTypeEnum = z.enum(['IVA', 'RETEFUENTE', 'RETEIVA', 'ICA', 'CREE', 'INC']);

const previewBodySchema = z.object({
  transactionType: z.enum([
    'purchase',
    'sale',
    'service_purchase',
    'service_sale',
  ]),
  /** Subtotal (base gravable) en COP como string numérico. */
  subtotalCop: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'subtotalCop debe ser numérico con máximo 2 decimales'),
  /** Año del UVT (default: año actual). */
  uvtYear: z.number().int().min(2020).max(2030).optional(),
  /** ISO 8601 date string. Default: hoy. */
  transactionDate: z.string().datetime().optional(),
  /** UUID del tercero (proveedor/cliente). Opcional pero recomendado. */
  thirdPartyId: z.string().uuid().optional(),
  /** Código PUC de la cuenta base (gasto/ingreso). Opcional. */
  baseAccountCode: z.string().max(16).optional(),
  /** Si el subtotal ya incluye impuesto. */
  amountIncludesTax: z.boolean().optional(),
  /** Para excluir tipos de impuesto específicos. */
  excludeTaxTypes: z.array(taxTypeEnum).optional(),
  /** Referencia de contexto para audit trail. */
  contextRef: z.string().max(255).optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // Feature flag check — primero, para no desperdiciar recursos
  if (!isTaxEngineEnabled()) {
    return taxErrorResponse(
      new TaxEngineError(
        TAX_ERR.ENGINE_DISABLED,
        'El motor tributario está desactivado. Configure UTOPIA_ENABLE_TAX_ENGINE=true.',
      ),
    );
  }

  // Derivar workspaceId desde cookie (NUNCA desde el body)
  const workspace = await getOrCreateWorkspace();

  // Parsear y validar body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return taxErrorResponse(
      new TaxEngineError(
        TAX_ERR.INVALID_INPUT,
        'El cuerpo de la solicitud no es JSON válido.',
      ),
    );
  }

  const parsed = previewBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return taxBadRequestZod(parsed.error);
  }

  const body = parsed.data;

  // Convertir transactionDate de string ISO a Date
  const transactionDate = body.transactionDate
    ? new Date(body.transactionDate)
    : new Date();

  try {
    const result = await taxEngine.evaluate({
      workspaceId: workspace.id,
      transactionType: body.transactionType,
      subtotalCop: body.subtotalCop,
      uvtYear: body.uvtYear ?? transactionDate.getFullYear(),
      transactionDate,
      thirdPartyId: body.thirdPartyId,
      baseAccountCode: body.baseAccountCode,
      amountIncludesTax: body.amountIncludesTax ?? false,
      excludeTaxTypes: body.excludeTaxTypes,
      contextRef: body.contextRef,
    });

    return taxOk({ ok: true, ...result });
  } catch (err) {
    return taxErrorResponse(err);
  }
}
