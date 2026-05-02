'use server';
// ---------------------------------------------------------------------------
// Server Actions — Saldos de apertura (Ola 1.F)
// ---------------------------------------------------------------------------
// Wrap de `importOpeningBalance` para flujos donde el cliente YA parseo el
// archivo localmente (CSV en navegador, JSON proveniente de un wizard, datos
// desde otra integracion in-memory). Para uploads de archivos grandes
// (>4.5MB) seguimos usando el Route Handler dedicado en
// /api/accounting/opening-balance/upload — Server Actions tienen limite de
// payload de form data y no soportan streaming binario eficiente.
//
// Esta accion:
//   1. Deriva `workspaceId` del cookie.
//   2. Valida el payload (lineas + periodo + fecha + lista de saldos) con Zod.
//   3. Llama a `importOpeningBalance` (que internamente llama a `createEntry`
//      con sourceType='opening', status='posted').
//   4. Emite `updateTag(\`libro-mayor:${ws.id}:${periodId}\`)` y
//      `updateTag(\`asientos:${ws.id}\`)` para invalidar el ledger del
//      periodo y el listado global.
//
// Errores especificos del importer (`OpeningBalanceError`) se mapean a
// codigos serializables: PARSE_FAILED / INVALID_INPUT / EMPTY_INPUT /
// PUC_MISMATCH / NO_BALANCING_ACCOUNT / PERIOD_NOT_OPEN / DOWNSTREAM.
// ---------------------------------------------------------------------------

import { updateTag } from 'next/cache';
import { z } from 'zod';

import { importOpeningBalance } from '@/lib/accounting/opening-balance/import';
import {
  OPENING_ERR,
  OpeningBalanceError,
  type ImportResult,
  type OpeningBalanceErrorCode,
  type OpeningBalanceLine,
} from '@/lib/accounting/opening-balance/types';
import { getOrCreateWorkspace } from '@/lib/db/workspace';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Mismo regex que journal-actions: NUMERIC string sin signo, hasta 8 decimales.
const NUMERIC_RE = /^\d+(\.\d{1,8})?$|^\.\d{1,8}$/;
const NUMERIC_STRING = z
  .string()
  .min(1)
  .max(28)
  .regex(NUMERIC_RE, 'monto debe ser NUMERIC sin signo');

const openingLineSchema = z.object({
  accountCode: z
    .string()
    .min(1)
    .max(16)
    .regex(/^\d+$/, 'accountCode debe ser numerico'),
  accountName: z.string().max(200).optional(),
  debitBalance: NUMERIC_STRING,
  creditBalance: NUMERIC_STRING,
  thirdPartyDocument: z.string().max(32).optional(),
  costCenterCode: z.string().max(16).optional(),
});

const importOpeningBalanceSchema = z.object({
  periodId: z.string().uuid(),
  entryDate: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'entryDate invalid'),
  description: z.string().max(2_000).optional(),
  companyName: z.string().max(200).optional(),
  sourceFilename: z.string().max(200).optional(),
  // Tope ALTO: un balance de PYME tipico tiene <500 cuentas, pero algunos
  // ERPs exportan auxiliares con miles de filas. 5000 es coherente con el
  // limite del listado del PUC en queries.ts.
  lines: z.array(openingLineSchema).min(1).max(5_000),
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type OpeningBalanceActionError = {
  ok: false;
  code: OpeningBalanceErrorCode | 'INVALID_INPUT' | 'INTERNAL';
  message: string;
  issues?: Array<{ path: string; message: string }>;
};

export type ImportOpeningBalanceResult =
  | { ok: true; result: ImportResult }
  | OpeningBalanceActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodToActionError(error: z.ZodError): OpeningBalanceActionError {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: 'Datos del balance de apertura invalidos.',
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

function toSerializableError(err: unknown): OpeningBalanceActionError {
  if (err instanceof OpeningBalanceError) {
    return {
      ok: false,
      code: err.code,
      message: err.message,
    };
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code?: unknown }).code ?? '');
    if (code === '40001' || code === '40P01') {
      return {
        ok: false,
        code: OPENING_ERR.DOWNSTREAM,
        message: 'Conflicto de concurrencia, reintenta',
      };
    }
  }
  console.error('[accounting/actions/opening-balance]', err);
  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Error interno al importar el balance de apertura.',
  };
}

// ---------------------------------------------------------------------------
// importOpeningBalanceAction
//
// Valida el payload, ejecuta el importer y revalida cache. NO acepta archivos
// — el caller ya parseo a `OpeningBalanceLine[]`. Si el flujo es upload (file
// del usuario), use el Route Handler /api/accounting/opening-balance/upload.
// ---------------------------------------------------------------------------

export async function importOpeningBalanceAction(
  rawInput: unknown,
): Promise<ImportOpeningBalanceResult> {
  const parsed = importOpeningBalanceSchema.safeParse(rawInput);
  if (!parsed.success) return zodToActionError(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();

    const lines: OpeningBalanceLine[] = parsed.data.lines.map((l) => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      debitBalance: l.debitBalance,
      creditBalance: l.creditBalance,
      thirdPartyDocument: l.thirdPartyDocument,
      costCenterCode: l.costCenterCode,
    }));

    const result = await importOpeningBalance({
      workspaceId: ws.id,
      periodId: parsed.data.periodId,
      entryDate: new Date(parsed.data.entryDate),
      description: parsed.data.description,
      companyName: parsed.data.companyName,
      sourceFilename: parsed.data.sourceFilename,
      lines,
    });

    // El balance de apertura crea UN asiento posted: invalidar ledger del
    // periodo, listado global y detalle del asiento creado.
    updateTag(`libro-mayor:${ws.id}:${parsed.data.periodId}`);
    updateTag(`asientos:${ws.id}`);
    updateTag(`asiento:${ws.id}:${result.entryId}`);

    return { ok: true, result };
  } catch (err) {
    return toSerializableError(err);
  }
}
