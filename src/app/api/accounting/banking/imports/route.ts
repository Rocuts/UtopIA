// ---------------------------------------------------------------------------
// /api/accounting/banking/imports
// POST → import a bank statement CSV
//
// Accepts multipart/form-data OR application/json with base64 content.
//
// Multipart: field "file" (File/Blob) + field "bankAccountId" (string)
// JSON:      { bankAccountId, filename, contentBase64 }
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { importStatement } from '@/lib/accounting/banking';
import { checkEnabled, bankingErrorResponse, badRequestZod, ok } from '../_shared';

const jsonSchema = z.object({
  bankAccountId: z.string().uuid(),
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
});

export async function POST(req: Request) {
  const guard = checkEnabled();
  if (guard) return guard;

  try {
    const ws = await getOrCreateWorkspace();
    const contentType = req.headers.get('content-type') ?? '';

    let bankAccountId: string;
    let filename: string;
    let content: Buffer;

    if (contentType.includes('multipart/form-data')) {
      // Multipart upload
      const formData = await req.formData();
      const file = formData.get('file');
      const baId = formData.get('bankAccountId');

      if (!file || typeof file === 'string') {
        return ok({ error: 'invalid_body', message: 'Campo "file" requerido (Blob/File)' }, 400);
      }
      if (!baId || typeof baId !== 'string') {
        return ok({ error: 'invalid_body', message: 'Campo "bankAccountId" requerido' }, 400);
      }

      bankAccountId = baId;
      filename = (file as File).name ?? 'extracto.csv';
      const arrayBuffer = await (file as Blob).arrayBuffer();
      content = Buffer.from(arrayBuffer);
    } else {
      // JSON with base64
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return ok({ error: 'invalid_json' }, 400);
      }
      const parsed = jsonSchema.safeParse(raw);
      if (!parsed.success) return badRequestZod(parsed.error);

      bankAccountId = parsed.data.bankAccountId;
      filename = parsed.data.filename;
      content = Buffer.from(parsed.data.contentBase64, 'base64');
    }

    const result = await importStatement({
      workspaceId: ws.id,
      bankAccountId,
      filename,
      content,
    });

    return ok(result, 201);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}
