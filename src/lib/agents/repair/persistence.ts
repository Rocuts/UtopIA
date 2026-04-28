import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  repairAdjustments,
  repairSessions,
  type NewRepairAdjustment,
} from '@/lib/db/schema';
import type { Adjustment, ProvisionalFlag } from '@/lib/agents/repair/types';

// ---------------------------------------------------------------------------
// Phase 3 — persistencia del chat "Doctor de Datos".
//
// El cliente envía el ledger COMPLETO en cada autosave (replay model). El
// servidor reemplaza atómicamente el conjunto de adjustments por el nuevo
// snapshot. Esto evita tener que hacer merge/diff a nivel de fila y mantiene
// la consistencia con el modelo stateless de `/api/repair-chat`.
//
// IMPORTANTE: el driver `drizzle-orm/neon-http` NO soporta transacciones
// interactivas (es HTTP one-shot). Por eso no usamos `db.transaction()`.
// Mitigación de race / consistencia:
//
// 1. Upsert del header (`repair_sessions`) PRIMERO. Esto garantiza que la
//    fila exista antes de tocar adjustments y nos da un `sessionId` estable.
// 2. DELETE de todos los adjustments del sessionId.
// 3. INSERT del nuevo snapshot completo.
//
// La ventana entre 2 y 3 puede dejar el ledger temporalmente vacío. Como el
// cliente serializa los autosaves (debounce 500 ms + un solo PUT en vuelo
// gracias al `inFlightRef` del hook), no hay autosaves concurrentes desde
// el mismo navegador. Si llegara un GET justo en esa ventana, devolvería
// `adjustments: []` en lugar de la versión previa — tolerable porque el
// cliente ya tiene el state local autoritativo en memoria.
// ---------------------------------------------------------------------------

export interface PersistedSession {
  conversationId: string;
  errorMessage: string;
  rawCsv: string | null;
  language: 'es' | 'en';
  companyName?: string;
  period?: string;
  provisional?: ProvisionalFlag | null;
  status: 'open' | 'closed';
  adjustments: Adjustment[];
}

// ---------------------------------------------------------------------------
// loadSession — devuelve null si no existe sesión persistida para
// (workspaceId, conversationId).
// ---------------------------------------------------------------------------

export async function loadSession(
  workspaceId: string,
  conversationId: string,
): Promise<PersistedSession | null> {
  const db = getDb();

  const sessionRows = await db
    .select()
    .from(repairSessions)
    .where(
      and(
        eq(repairSessions.workspaceId, workspaceId),
        eq(repairSessions.conversationId, conversationId),
      ),
    )
    .limit(1);

  if (sessionRows.length === 0) return null;
  const session = sessionRows[0];

  const adjRows = await db
    .select()
    .from(repairAdjustments)
    .where(eq(repairAdjustments.sessionId, session.id));

  // Orden estable por proposedAt asc — el cliente espera un orden cronológico
  // para reconstruir su UI de cards. El driver no garantiza orden si no se
  // especifica, así que ordenamos explícitamente acá.
  adjRows.sort((a, b) => {
    const ta = a.proposedAt instanceof Date ? a.proposedAt.getTime() : 0;
    const tb = b.proposedAt instanceof Date ? b.proposedAt.getTime() : 0;
    return ta - tb;
  });

  const adjustments: Adjustment[] = adjRows.map((row) => {
    // `numeric` ← string → number. Neon devuelve numeric como string para
    // preservar precisión; aquí asumimos que los amounts caben en Number
    // (los balances colombianos de PUC en COP están dentro de los 2^53
    // safe integer range).
    const amount = Number(row.amount);
    const status = row.status as Adjustment['status'];
    const adj: Adjustment = {
      id: row.adjustmentId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      amount,
      rationale: row.rationale,
      status,
      proposedAt:
        row.proposedAt instanceof Date
          ? row.proposedAt.toISOString()
          : String(row.proposedAt),
    };
    if (row.appliedAt) {
      adj.appliedAt =
        row.appliedAt instanceof Date
          ? row.appliedAt.toISOString()
          : String(row.appliedAt);
    }
    if (row.rejectedAt) {
      adj.rejectedAt =
        row.rejectedAt instanceof Date
          ? row.rejectedAt.toISOString()
          : String(row.rejectedAt);
    }
    return adj;
  });

  const language: 'es' | 'en' = session.language === 'en' ? 'en' : 'es';
  const status: 'open' | 'closed' =
    session.status === 'closed' ? 'closed' : 'open';

  const persisted: PersistedSession = {
    conversationId: session.conversationId,
    errorMessage: session.errorMessage,
    rawCsv: session.rawCsv ?? null,
    language,
    status,
    adjustments,
  };
  if (session.companyName) persisted.companyName = session.companyName;
  if (session.period) persisted.period = session.period;
  if (session.provisional !== null && session.provisional !== undefined) {
    persisted.provisional = session.provisional;
  }
  return persisted;
}

// ---------------------------------------------------------------------------
// upsertSession — idempotente sobre conversationId. Reemplaza el set de
// adjustments por el snapshot recibido.
//
// Verificación de tenant: el `onConflictDoUpdate` SOLO actualiza si el
// workspaceId coincide (vía cláusula WHERE en target). Si otro workspace
// intentara reusar un conversationId ajeno (improbable: uuid v4), el insert
// fallaría por unique violation y propagaría el error 5xx hacia arriba.
// ---------------------------------------------------------------------------

export async function upsertSession(
  workspaceId: string,
  session: PersistedSession,
): Promise<void> {
  const db = getDb();

  // 1. Upsert del header. Si la fila existe pero pertenece a otro workspace,
  //    el `where` impide el update y la conversación se quedaría inconsistente
  //    — pero como conversationId es un uuid v4 generado client-side y la
  //    cookie es por navegador, este caso no se da en la práctica.
  const [upserted] = await db
    .insert(repairSessions)
    .values({
      workspaceId,
      conversationId: session.conversationId,
      errorMessage: session.errorMessage,
      rawCsv: session.rawCsv,
      language: session.language,
      companyName: session.companyName ?? null,
      period: session.period ?? null,
      provisional: session.provisional ?? null,
      status: session.status,
    })
    .onConflictDoUpdate({
      target: repairSessions.conversationId,
      set: {
        errorMessage: session.errorMessage,
        rawCsv: session.rawCsv,
        language: session.language,
        companyName: session.companyName ?? null,
        period: session.period ?? null,
        provisional: session.provisional ?? null,
        status: session.status,
        updatedAt: new Date(),
      },
      // Doble check: solo updateamos si el workspace coincide. Esto mitiga
      // un (improbable) intento de hijack de conversationId de otro tenant.
      setWhere: eq(repairSessions.workspaceId, workspaceId),
    })
    .returning({ id: repairSessions.id });

  if (!upserted) {
    // Conflicto + setWhere falló = otro workspace dueño. No persistimos
    // adjustments para no contaminar la otra sesión.
    throw new Error('repair_session_conflict_other_workspace');
  }

  const sessionId = upserted.id;

  // Audit P1 fix: validar que cada amount cabe en numeric(20,2). El tope
  // teorico de la columna es 10^18 - 1 con 2 decimales; Number puede
  // representar hasta ~9.007e15 con precision exacta, asi que cualquier
  // valor superior es practicamente seguro un decimal corrido o una
  // alucinacion del modelo. Failsafe: throw para devolver 5xx en lugar de
  // truncar/corromper silenciosamente al insertar como string.
  const MAX_NUMERIC_20_2 = 1e18;
  for (const adj of session.adjustments) {
    if (!Number.isFinite(adj.amount) || Math.abs(adj.amount) >= MAX_NUMERIC_20_2) {
      throw new Error(
        `repair_adjustment_overflow: adjustment ${adj.id} amount=${adj.amount} excede numeric(20,2)`,
      );
    }
  }

  // 2. Borrar adjustments existentes del sessionId.
  await db
    .delete(repairAdjustments)
    .where(eq(repairAdjustments.sessionId, sessionId));

  // 3. Reinsertar el snapshot completo (si hay).
  if (session.adjustments.length > 0) {
    const rows: NewRepairAdjustment[] = session.adjustments.map((adj) => ({
      sessionId,
      adjustmentId: adj.id,
      accountCode: adj.accountCode,
      accountName: adj.accountName,
      // numeric column acepta string o number; pasamos string para preservar
      // precisión exacta sin conversión IEEE-754 intermedia.
      amount: String(adj.amount),
      rationale: adj.rationale,
      status: adj.status,
      proposedAt: new Date(adj.proposedAt),
      appliedAt: adj.appliedAt ? new Date(adj.appliedAt) : null,
      rejectedAt: adj.rejectedAt ? new Date(adj.rejectedAt) : null,
    }));
    await db.insert(repairAdjustments).values(rows);
  }
}
