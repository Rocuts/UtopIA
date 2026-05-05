// ---------------------------------------------------------------------------
// /api/accounting/banking/accounts
// GET  → list bank accounts for workspace
// POST → create bank account
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { createBankAccount, listBankAccounts } from '@/lib/accounting/banking';
import { checkEnabled, bankingErrorResponse, badRequestZod, ok } from '../_shared';

const createSchema = z.object({
  accountId: z.string().uuid({ message: 'accountId debe ser un UUID válido (chart_of_accounts.id)' }),
  bankName: z.string().min(1).max(100),
  accountNumber: z.string().min(1).max(32),
  accountKind: z.enum(['savings', 'checking', 'fiduciary', 'other']).optional().default('savings'),
  holderName: z.string().max(200).optional(),
  currency: z.string().length(3).optional().default('COP'),
});

export async function GET() {
  const guard = checkEnabled();
  if (guard) return guard;

  try {
    const ws = await getOrCreateWorkspace();
    const accounts = await listBankAccounts(ws.id);
    return ok(accounts);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const guard = checkEnabled();
  if (guard) return guard;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return ok({ error: 'invalid_json' }, 400);
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return badRequestZod(parsed.error);

  try {
    const ws = await getOrCreateWorkspace();
    const account = await createBankAccount({
      workspaceId: ws.id,
      accountId: parsed.data.accountId,
      bankName: parsed.data.bankName,
      accountNumber: parsed.data.accountNumber,
      accountKind: parsed.data.accountKind,
      holderName: parsed.data.holderName ?? null,
      currency: parsed.data.currency,
    });
    return ok(account, 201);
  } catch (err) {
    return bankingErrorResponse(err);
  }
}
