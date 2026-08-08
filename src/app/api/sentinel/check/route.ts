// ---------------------------------------------------------------------------
// POST /api/sentinel/check
// Body: { periodId?: string, recipient?: string, dryRun?: boolean }
// Effect: dispara `runSentinelCheck` (workflow durable Vercel WDK).
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { accountingPeriods } from '@/lib/db/schema';
import { notificationSubscriptions } from '@/lib/db/schema-notifications';
import { getOrCreateWorkspace } from '@/lib/db/workspace';
import { runSentinelCheck } from '@/lib/workflows/sentinel/orchestrator';
import {
  findComparativePeriod,
  getCachedPreprocessedBalance,
  getLatestOpenPeriod,
} from '@/lib/cache/preprocessed-balance';
import { requireAuthSession } from '@/lib/auth/require-session';

export const maxDuration = 60;

export async function POST(req: Request) {
  const gate = await requireAuthSession();
  if (!gate.ok) return gate.response;

  let body: { periodId?: string; recipient?: string; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body opcional
  }

  try {
    const ws = await getOrCreateWorkspace();
    const db = getDb();

    // ---------------------------------------------------------------------
    // Resolver periodo target: explícito o último abierto del workspace.
    //
    // El `periodId` del body se filtra SIEMPRE por workspace. Sin ese filtro
    // la consulta aceptaba el id de un período de otro tenant y su balance
    // terminaba alimentando el reporte del Centinela — y el correo — de quien
    // hiciera la petición. Auditoría 2026-08.
    // ---------------------------------------------------------------------
    let targetPeriod = null;
    if (body.periodId) {
      const rows = await db
        .select()
        .from(accountingPeriods)
        .where(
          and(
            eq(accountingPeriods.id, body.periodId),
            eq(accountingPeriods.workspaceId, ws.id),
          ),
        )
        .limit(1);
      targetPeriod = rows[0] ?? null;
      if (!targetPeriod) {
        return NextResponse.json(
          { error: 'Período no encontrado' },
          { status: 404, headers: { 'Cache-Control': 'no-store' } },
        );
      }
    } else {
      targetPeriod = await getLatestOpenPeriod(ws.id);
    }

    // ---------------------------------------------------------------------
    // Destinatario del correo.
    //
    // El `recipient` NO puede venir del cliente sin control: este endpoint
    // dispara un envío desde el dominio de UtopIA, así que aceptar una
    // dirección arbitraria lo convertía en un relay para enviar correo con la
    // reputación del remitente a cualquier buzón. Sólo se admite una dirección
    // ya suscrita y activa en ESTE workspace; en cualquier otro caso se cae a
    // la suscripción registrada, y si no hay ninguna no se envía nada.
    // Auditoría 2026-08 — `sentinel-recipient-arbitrario`.
    // ---------------------------------------------------------------------
    const subs = await db
      .select({ email: notificationSubscriptions.email })
      .from(notificationSubscriptions)
      .where(
        and(
          eq(notificationSubscriptions.workspaceId, ws.id),
          eq(notificationSubscriptions.channel, 'email'),
          eq(notificationSubscriptions.active, true),
        ),
      );
    const allowed = new Set(
      subs
        .map((s) => s.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    );
    const requested = body.recipient?.trim().toLowerCase();
    const recipient =
      requested && allowed.has(requested)
        ? requested
        : (subs[0]?.email?.trim().toLowerCase() ?? undefined);

    // Cargar preprocessed (con curator inyectado) si hay periodo.
    let preprocessed = null;
    if (targetPeriod) {
      const comparative = await findComparativePeriod(ws.id, targetPeriod);
      const result = await getCachedPreprocessedBalance(
        ws.id,
        targetPeriod.id,
        comparative?.id,
      );
      preprocessed = result.balance;
    }

    const report = await runSentinelCheck(
      {
        workspaceId: ws.id,
        periodId: targetPeriod?.id ?? null,
        recipient,
        dryRun: body.dryRun ?? false,
      },
      preprocessed,
    );

    return NextResponse.json(
      { ok: true, report },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sentinel_check_failed';
    console.warn('[api/sentinel/check] error:', msg);
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
