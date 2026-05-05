// ---------------------------------------------------------------------------
// /api/accounting/banking/accounts/[id]
// GET    → get single bank account
// PATCH  → update bank account
// DELETE → soft delete (active = false)
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { getBankAccount, updateBankAccount, softDeleteBankAccount } from '@/lib/accounting/banking';
import { checkEnabled, bankingErrorResponse, badRequestZod, ok } from '../../_shared';

const patchSchema = z.object({
  bankName: z.string().min(1).max(100).optional(),
  accountNumber: z.string().min(1).max(32).optional(),
  accountKind: z.enum(['savings', 'checking', 'fiduciary', 'other']).optional(),
  holderName: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  accountId: z.string().uuid().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = checkEnabled();
  if (guard) return guard;

  try {
    const { id } = await params;
    const ws = await getOrCreateWorkspace();
    const account = await getBankAccount(ws.id, id);
    if (!account) {
      return ok({ error: 'not_found' }, 404);
    }
    return ok(account);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = checkEnabled();
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return ok({ error: 'invalid_json' }, 400);
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const { id } = await params;
    const ws = await getOrCreateWorkspace();
    const updated = await updateBankAccount(ws.id, id, parsed.data);
    if (!updated) return ok({ error: 'not_found' }, 404);
    return ok(updated);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = checkEnabled();
  if (guard) return guard;

  try {
    const { id } = await params;
    const ws = await getOrCreateWorkspace();
    const updated = await softDeleteBankAccount(ws.id, id);
    if (!updated) return ok({ error: 'not_found' }, 404);
    return ok({ deleted: true, id });
  } catch (err) {
    return bankingErrorResponse(err);
  }
}
