import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';

import { getCurrentWorkspaceId } from '@/lib/db/workspace';
import { getDb } from '@/lib/db/client';
import { reports } from '@/lib/db/schema';
import {
  upsertAlert,
  findPendingAlertsForWorkspace,
} from '@/lib/workflows/sentinel/repository';
import {
  fiscalAlertaToInsight,
  alertRowToView,
  type AlertView,
} from '@/lib/agents/financial/escudo-survival/fiscal-anchor/alert-mapping';
import type { FiscalSnapshot } from '@/lib/agents/financial/types';

// ---------------------------------------------------------------------------
// /api/escudo/fiscal-anchor — persistencia workspace-aware del FiscalSnapshot
// ---------------------------------------------------------------------------
// POST: upsert fila `reports` (kind='escudo_fiscal') + mapea las alertas del
//       anchor a `sentinel_alerts` via upsertAlert (idempotente por dedupKey).
// GET:  devuelve el último snapshot del workspace + las alertas Escudo
//       pendientes/snoozed como AlertView[].
//
// Sin workspace (cookie utopia_workspace_id ausente o inválida) → 401.
// Contrato: docs/wave-notes/escudo-autowire-contract.md §4.3.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

const ESCUDO_FISCAL_KIND = 'escudo_fiscal';
const MAX_JSON_BODY = 1 * 1024 * 1024; // 1MB — el snapshot es ligero

// Validación de forma mínima del body. El FiscalSnapshot es un tipo TS puro
// (no viaja al LLM) ⇒ no aplica el contrato Zod strict-mode. Validamos lo
// estructural mínimo (presencia de anchor.alertas + period) y luego persistimos
// el OBJETO ORIGINAL (no `parsed.data`) porque Zod `.object()` haría strip de
// las claves no declaradas (f01-f10, calendarioDian, fuente). El validador es
// solo un gate de forma — el snapshot completo se guarda tal cual.
const postBodySchema = z.object({
  fiscalSnapshot: z.object({
    anchor: z.object({ alertas: z.array(z.unknown()).nullable() }),
    riskScore: z.unknown(),
    period: z.string().min(1).max(20),
    computedAt: z.string().min(1).max(40),
  }),
  company: z.unknown(),
});

export async function POST(req: Request) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 401 });
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_JSON_BODY) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_input',
        details: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      },
      { status: 400 },
    );
  }

  // Persistimos el snapshot ORIGINAL (sin strip de Zod) — ver nota del schema.
  const fiscalSnapshot = (body as { fiscalSnapshot: unknown })
    .fiscalSnapshot as FiscalSnapshot;
  const { period, anchor } = fiscalSnapshot;
  const generatedAt = fiscalSnapshot.computedAt ?? new Date().toISOString();

  const db = getDb();

  // --- Upsert fila `reports`: una por (workspace, kind, period). La tabla no
  // tiene unique compuesto, así que buscamos la existente por título (codifica
  // el periodo) y actualizamos su `data`; si no existe, insertamos. ----------
  const title = `Âncora Fiscal ${period}`;
  const existing = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.workspaceId, workspaceId),
        eq(reports.kind, ESCUDO_FISCAL_KIND),
        eq(reports.title, title),
      ),
    )
    .limit(1);

  let reportId: string;
  if (existing.length > 0) {
    const [updated] = await db
      .update(reports)
      .set({ data: fiscalSnapshot as unknown as Record<string, unknown> })
      .where(eq(reports.id, existing[0].id))
      .returning({ id: reports.id });
    reportId = updated.id;
  } else {
    const [inserted] = await db
      .insert(reports)
      .values({
        workspaceId,
        kind: ESCUDO_FISCAL_KIND,
        title,
        data: fiscalSnapshot as unknown as Record<string, unknown>,
        controlTotals: null,
      })
      .returning({ id: reports.id });
    reportId = inserted.id;
  }

  // --- Mapear alertas del anchor → Insight → upsertAlert (idempotente). ------
  let alertsUpserted = 0;
  for (const alerta of anchor.alertas ?? []) {
    const insight = fiscalAlertaToInsight(
      alerta,
      anchor,
      period,
      workspaceId,
      generatedAt,
    );
    try {
      await upsertAlert(db, insight, { workspaceId });
      alertsUpserted += 1;
    } catch (err) {
      console.warn(
        '[escudo/fiscal-anchor] upsertAlert falló para',
        alerta.codigo,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return NextResponse.json({ ok: true, reportId, alertsUpserted });
}

export async function GET(req: Request) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 401 });
  }

  const period = new URL(req.url).searchParams.get('period');
  const db = getDb();

  const conditions = [
    eq(reports.workspaceId, workspaceId),
    eq(reports.kind, ESCUDO_FISCAL_KIND),
  ];
  if (period) {
    conditions.push(eq(reports.title, `Âncora Fiscal ${period}`));
  }

  const rows = await db
    .select({ data: reports.data })
    .from(reports)
    .where(and(...conditions))
    .orderBy(desc(reports.createdAt))
    .limit(1);

  const fiscalSnapshot =
    rows.length > 0 ? (rows[0].data as unknown as FiscalSnapshot) : null;

  const pending = await findPendingAlertsForWorkspace(db, workspaceId);
  const alertas: AlertView[] = pending
    .filter((row) => row.pillar === 'escudo')
    .map(alertRowToView);

  return NextResponse.json({
    hasData: fiscalSnapshot !== null,
    fiscalSnapshot,
    alertas,
  });
}
