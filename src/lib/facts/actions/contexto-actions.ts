'use server';
// ---------------------------------------------------------------------------
// Server Actions — Panel "Contexto de la empresa" (Hechos del negocio, Ola 1D)
// ---------------------------------------------------------------------------
// Comparten el MISMO handler de mutaciones (reconcileFact/revokeFact) que la
// captura por chat, así panel y chat nunca divergen. Cada acción:
//   1. Gate de sesión (requireAuthSession — fase 1 = no-op).
//   2. Deriva workspaceId del cookie (NUNCA del input).
//   3. Valida input (Zod registrarHechoInputSchema) + guard duro
//      (assertFactInputValid — kinds materiales exigen período + structured).
//   4. Llama reconcileFact({source:'manual'}) / revokeFact.
//   5. revalidatePath('/workspace/contexto') para refrescar el server component.
// ---------------------------------------------------------------------------

import { revalidatePath } from 'next/cache';
import { requireAuthSession } from '@/lib/auth/require-session';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { reconcileFact, revokeFact } from '@/lib/db/facts';
import { registrarHechoInputSchema } from '@/lib/facts/contracts';
import { assertFactInputValid } from '@/lib/facts/tool-guards';

const ROUTE = '/workspace/contexto';

export type FactActionError = {
  ok: false;
  code: 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'GUARD' | 'INTERNAL';
  message: string;
  issues?: Array<{ path: string; message: string }>;
};

export type RegisterFactResult =
  | { ok: true; action: 'ADD' | 'SUPERSEDE' | 'NOOP'; factId: string | null }
  | FactActionError;

export type RevokeFactResult = { ok: true; revoked: boolean } | FactActionError;

export async function registerManualFactAction(
  rawInput: unknown,
  supersedesId?: string | null,
): Promise<RegisterFactResult> {
  const gate = await requireAuthSession();
  if (!gate.ok) return { ok: false, code: 'UNAUTHENTICATED', message: 'Sesión requerida.' };

  const parsed = registrarHechoInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Datos del hecho inválidos.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const input = parsed.data;
  const guardErr = assertFactInputValid(input);
  if (guardErr) return { ok: false, code: 'GUARD', message: guardErr };

  try {
    const ws = await getOrCreateWorkspace();
    const { decision, fact } = await reconcileFact({
      workspaceId: ws.id,
      kind: input.kind,
      content: { title: input.title, body: input.body, structured: input.structured },
      fiscalPeriod: input.fiscalPeriod,
      source: 'manual',
      supersedesId: supersedesId ?? null,
    });
    revalidatePath(ROUTE);
    return { ok: true, action: decision.action, factId: fact?.id ?? null };
  } catch (err) {
    console.error('[facts/actions/contexto] register', err);
    return { ok: false, code: 'INTERNAL', message: 'Error interno al registrar el hecho.' };
  }
}

export async function revokeFactAction(rawFactId: unknown): Promise<RevokeFactResult> {
  const gate = await requireAuthSession();
  if (!gate.ok) return { ok: false, code: 'UNAUTHENTICATED', message: 'Sesión requerida.' };

  if (typeof rawFactId !== 'string' || rawFactId.trim() === '') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Falta el id del hecho.' };
  }

  try {
    const ws = await getOrCreateWorkspace();
    const updated = await revokeFact(ws.id, rawFactId);
    revalidatePath(ROUTE);
    return { ok: true, revoked: updated !== null };
  } catch (err) {
    console.error('[facts/actions/contexto] revoke', err);
    return { ok: false, code: 'INTERNAL', message: 'Error interno al revocar el hecho.' };
  }
}
