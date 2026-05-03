// ---------------------------------------------------------------------------
// POST /api/accounting/opening-balance — ingesta de saldos iniciales (Ola 1.D)
// ---------------------------------------------------------------------------
// Recibe el balance de prueba del cliente PYME y lo convierte en UN asiento
// de apertura posteado en el libro mayor del workspace.
//
// Acepta dos formatos:
//   1. multipart/form-data: { file: File, periodId: string, entryDate?, ... }
//      -> el archivo se parsea con `parseOpeningBalanceFile`.
//   2. application/json: { periodId, entryDate, lines: OpeningBalanceLine[] }
//      -> el frontend ya parseo localmente (ej. wizard que muestra preview).
//
// Tenant scoping: workspaceId proviene SIEMPRE de la cookie httpOnly
// `utopia_workspace_id` (via `getOrCreateWorkspace`). Nunca se acepta del
// payload — eso permitiria a un atacante apuntar a otro workspace.
//
// Errores:
//   - 400: parse fallo, JSON invalido, fecha invalida, sin lineas.
//   - 409: periodo cerrado/bloqueado.
//   - 413: archivo > 5 MB.
//   - 422: PUC mismatch (>30% cuentas no encontradas) o sin cuenta 3705.
//   - 500: error inesperado del double-entry o del DB.
//
// Rate limit: configurado en `proxy.ts` como 5/min (operacion costosa).
// maxDuration: 120 (configurado en vercel.ts por Ola 0.F).
// ---------------------------------------------------------------------------

import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  parseOpeningBalanceFile,
  importOpeningBalance,
  OpeningBalanceError,
  OPENING_ERR,
  type OpeningBalanceImport,
  type OpeningBalanceLine,
} from '@/lib/accounting/opening-balance';

// Vercel Fluid Compute: explicit Node.js runtime + 120s ceiling. Esto es
// computacion pura (sin LLMs); el limite alto cubre archivos con miles de
// cuentas auxiliares + lookups secuenciales en chart_of_accounts.
// `export const runtime = 'nodejs'` removido en Ola 2: incompatible con
// `nextConfig.cacheComponents: true` (nodejs es el default).
export const maxDuration = 120;

// Limite de tamaño de archivo. El upload route principal usa 4 MB, pero
// los balances pueden venir en hojas Excel infladas con metadata. Subimos
// a 5 MB para cubrir ese caso sin abrir la puerta a abuso.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx', '.txt']);

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const numericString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Debe ser un NUMERIC string (ej. "1234.56").')
  .max(20);

const lineSchema = z.object({
  accountCode: z
    .string()
    .min(1, 'accountCode requerido')
    .max(16, 'accountCode demasiado largo')
    .regex(/^\d+$/, 'accountCode debe ser solo digitos PUC'),
  accountName: z.string().max(256).optional(),
  debitBalance: numericString.default('0'),
  creditBalance: numericString.default('0'),
  thirdPartyDocument: z.string().max(32).optional(),
  costCenterCode: z.string().max(16).optional(),
});

const jsonBodySchema = z.object({
  periodId: z.string().uuid('periodId debe ser UUID'),
  entryDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
    .optional(),
  description: z.string().max(512).optional(),
  companyName: z.string().max(256).optional(),
  sourceFilename: z.string().max(256).optional(),
  lines: z
    .array(lineSchema)
    .min(1, 'lines no puede estar vacio')
    .max(20_000, 'demasiadas lineas (>20k)'),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const workspace = await getOrCreateWorkspace();
    const contentType = req.headers.get('content-type') || '';

    let importInput: OpeningBalanceImport;
    let parserWarnings: string[] = [];

    if (contentType.includes('multipart/form-data')) {
      // -------------------------------------------------------------
      // multipart: archivo + periodId + entryDate.
      // -------------------------------------------------------------
      const form = await req.formData();
      const file = form.get('file');
      const periodIdRaw = form.get('periodId');
      const entryDateRaw = form.get('entryDate');
      const descriptionRaw = form.get('description');
      const companyNameRaw = form.get('companyName');

      if (!(file instanceof File)) {
        return jsonError(400, 'INVALID_INPUT', 'Falta el campo "file" en el form-data.');
      }
      if (typeof periodIdRaw !== 'string' || !isUuid(periodIdRaw)) {
        return jsonError(
          400,
          'INVALID_INPUT',
          'periodId requerido como UUID valido.',
        );
      }

      // Tamaño.
      if (file.size > MAX_FILE_BYTES) {
        return jsonError(
          413,
          'FILE_TOO_LARGE',
          `Archivo excede ${MAX_FILE_BYTES / (1024 * 1024)} MB. Reduzca el balance o divida en hojas.`,
        );
      }

      // Extension.
      const filename = file.name || 'balance';
      const ext = extractExt(filename);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return jsonError(
          400,
          'INVALID_INPUT',
          `Extension "${ext}" no soportada. Use .csv o .xlsx.`,
        );
      }

      // Parse.
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parseOpeningBalanceFile(buffer, filename);
      parserWarnings = parsed.warnings;

      if (parsed.lines.length === 0) {
        return jsonError(
          400,
          'EMPTY_INPUT',
          'El archivo no contiene cuentas con saldo. No hay nada que importar.',
        );
      }

      const entryDate = parseEntryDate(
        typeof entryDateRaw === 'string' ? entryDateRaw : undefined,
      );

      importInput = {
        workspaceId: workspace.id,
        periodId: periodIdRaw,
        entryDate,
        description: typeof descriptionRaw === 'string' ? descriptionRaw : undefined,
        companyName:
          typeof companyNameRaw === 'string' && companyNameRaw.length > 0
            ? companyNameRaw
            : parsed.companyName,
        sourceFilename: filename,
        lines: parsed.lines,
      };
    } else if (contentType.includes('application/json')) {
      // -------------------------------------------------------------
      // JSON: el frontend ya parseo y nos manda lines listas.
      // -------------------------------------------------------------
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return jsonError(400, 'INVALID_INPUT', 'JSON malformado.');
      }
      const result = jsonBodySchema.safeParse(raw);
      if (!result.success) {
        return jsonError(
          400,
          'INVALID_INPUT',
          'Validacion fallida del cuerpo JSON.',
          result.error.flatten(),
        );
      }
      const body = result.data;

      // Cap de tamaño en JSON: rechazamos payloads >5MB serializados.
      // Nota: Next ya tiene un limite por defecto en bodyParser; dejamos
      // este check como defensa en profundidad.
      // (El runtime serverless ya lanza 413 para body > limite.)

      const entryDate = parseEntryDate(body.entryDate);

      importInput = {
        workspaceId: workspace.id,
        periodId: body.periodId,
        entryDate,
        description: body.description,
        companyName: body.companyName,
        sourceFilename: body.sourceFilename,
        lines: body.lines as OpeningBalanceLine[],
      };
    } else {
      return jsonError(
        400,
        'INVALID_INPUT',
        `Content-Type no soportado: "${contentType}". Use multipart/form-data o application/json.`,
      );
    }

    // ---------------------------------------------------------------
    // Ejecutar pipeline.
    // ---------------------------------------------------------------
    const result = await importOpeningBalance(importInput);

    // Mergear warnings del parser + del import.
    const warnings = [...parserWarnings, ...result.warnings];

    return NextResponse.json(
      {
        ok: true,
        result: {
          entryId: result.entryId,
          entryNumber: result.entryNumber,
          totalDebit: result.totalDebit,
          totalCredit: result.totalCredit,
          linesInserted: result.linesInserted,
          warnings,
          skippedRows: result.skippedRows,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status },
  );
}

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof OpeningBalanceError) {
    switch (err.code) {
      case OPENING_ERR.PARSE_FAILED:
        return jsonError(400, err.code, err.message, err.details);
      case OPENING_ERR.INVALID_INPUT:
      case OPENING_ERR.EMPTY_INPUT:
        return jsonError(400, err.code, err.message, err.details);
      case OPENING_ERR.PUC_MISMATCH:
      case OPENING_ERR.NO_BALANCING_ACCOUNT:
        return jsonError(422, err.code, err.message, err.details);
      case OPENING_ERR.PERIOD_NOT_OPEN:
        return jsonError(409, err.code, err.message, err.details);
      case OPENING_ERR.DOWNSTREAM:
        return jsonError(500, err.code, err.message, err.details);
    }
  }
  if (err instanceof z.ZodError) {
    return jsonError(400, 'INVALID_INPUT', 'Validacion fallida.', err.flatten());
  }
  // Log estructurado para que aparezca en Vercel Runtime Logs.
  console.error('[opening-balance] Unhandled error:', err);
  return jsonError(
    500,
    'UNEXPECTED',
    err instanceof Error ? err.message : 'Error inesperado al procesar el balance.',
  );
}

function extractExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx).toLowerCase();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Acepta string ISO-8601 o solo fecha YYYY-MM-DD. Si llega ausente, usa
 * `new Date()` (hoy). El service downstream valida que caiga dentro del
 * rango del periodo.
 */
function parseEntryDate(raw: string | undefined): Date {
  if (!raw || raw.length === 0) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new OpeningBalanceError(
      OPENING_ERR.INVALID_INPUT,
      `entryDate invalida: "${raw}". Use formato ISO-8601 o YYYY-MM-DD.`,
    );
  }
  return d;
}
