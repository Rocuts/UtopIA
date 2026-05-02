import { NextResponse } from 'next/server';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import {
  seedPucForWorkspace,
  AccountConflictError,
} from '@/lib/accounting/chart-of-accounts';

// ---------------------------------------------------------------------------
// POST /api/accounting/accounts/seed
// ---------------------------------------------------------------------------
// Inserta el catálogo PUC PYMES (Decreto 2706/2012 + 2420/2015 Anexo 2) en
// el workspace activo. Idempotente: ON CONFLICT (workspace_id, code) DO
// NOTHING. Llamarlo dos veces no duplica filas.
//
// Devuelve `{ inserted, skipped, total }`. Útil para que el cliente decida
// si onboarding terminó (`inserted === 0` ⇒ ya estaba sembrado).
//
// Body: ninguno requerido. POST sin payload está OK.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

// Sembrar el PUC ejecuta una transacción con varios cientos de INSERTs.
// 60s del default es suficiente; lo dejamos explícito por documentación.
export const maxDuration = 60;

export async function POST() {
  try {
    const ws = await getOrCreateWorkspace();
    const result = await seedPucForWorkspace(ws.id);
    return NextResponse.json({
      ok: true,
      workspaceId: ws.id,
      ...result,
    });
  } catch (err) {
    if (err instanceof AccountConflictError) {
      return NextResponse.json(
        { ok: false, error: 'conflict', message: err.message },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : 'internal_error';
    // Si el seed catalog no existe todavía (Agente 1.A no ha terminado),
    // devolvemos 503 — la API existe pero la dependencia no está lista.
    if (msg.includes('Catálogo PUC PYMES no encontrado')) {
      return NextResponse.json(
        { ok: false, error: 'seed_unavailable', message: msg },
        { status: 503 },
      );
    }
    console.error('[accounting/accounts/seed][POST]', err);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 },
    );
  }
}
