import 'server-only';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { getDb } from './client';
import {
  factDecisionRecords,
  workspaceFacts,
  type FactDecisionRecord,
  type NewFactDecisionRecord,
  type WorkspaceFact,
} from './schema';
import type { FactKind, FactContent } from '@/lib/facts/contracts';
import { decideReconciliation, type ReconcileDecision } from '@/lib/facts/reconcile';

// Patrón lazy getDb() (igual a pyme.ts). Tenant scoping: TODAS las funciones
// filtran por workspaceId — el caller (handler API/tool) lo resuelve server-side.

/** Activos cuyo período cubre el del reporte: match exacto o sin período. */
export async function getActiveFacts(
  workspaceId: string,
  fiscalPeriod: string | null,
): Promise<WorkspaceFact[]> {
  const db = getDb();
  const periodClause =
    fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : or(eq(workspaceFacts.fiscalPeriod, fiscalPeriod), isNull(workspaceFacts.fiscalPeriod));
  return db
    .select()
    .from(workspaceFacts)
    .where(
      and(
        eq(workspaceFacts.workspaceId, workspaceId),
        eq(workspaceFacts.status, 'active'),
        periodClause,
      ),
    )
    .orderBy(desc(workspaceFacts.createdAt));
}

/** Todos los hechos del workspace (incl. revoked) para el panel Contexto. */
export async function listFacts(workspaceId: string): Promise<WorkspaceFact[]> {
  const db = getDb();
  return db
    .select()
    .from(workspaceFacts)
    .where(eq(workspaceFacts.workspaceId, workspaceId))
    .orderBy(desc(workspaceFacts.createdAt));
}

/**
 * Reconcilia un hecho candidato contra los activos del mismo kind+período.
 * ADD → inserta. NOOP → no muta, devuelve el existente. SUPERSEDE → marca el
 * viejo revoked+supersededById e inserta el nuevo (append-only, auditable).
 */
export async function reconcileFact(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
}): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  const db = getDb();
  // Activos del mismo kind+período exacto (la reconciliación es por período).
  const periodClause =
    input.fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : eq(workspaceFacts.fiscalPeriod, input.fiscalPeriod);
  const existing = await db
    .select()
    .from(workspaceFacts)
    .where(
      and(
        eq(workspaceFacts.workspaceId, input.workspaceId),
        eq(workspaceFacts.kind, input.kind),
        eq(workspaceFacts.status, 'active'),
        periodClause,
      ),
    )
    .orderBy(desc(workspaceFacts.createdAt));

  const decision = decideReconciliation(
    input.content,
    existing.map((e) => ({
      id: e.id,
      title: e.title,
      body: e.body,
      structured: e.structured ?? null,
    })),
  );

  if (decision.action === 'NOOP') {
    const kept = existing.find((e) => e.id === decision.existingId) ?? null;
    return { decision, fact: kept };
  }

  return db.transaction(async (tx) => {
    if (decision.action === 'SUPERSEDE') {
      await tx
        .update(workspaceFacts)
        .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(workspaceFacts.id, decision.existingId),
            eq(workspaceFacts.workspaceId, input.workspaceId),
          ),
        );
    }
    const [created] = await tx
      .insert(workspaceFacts)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        title: input.content.title,
        body: input.content.body,
        structured: input.content.structured ?? null,
        fiscalPeriod: input.fiscalPeriod,
        source: input.source,
      })
      .returning();
    // Cierre de la cadena de versiones: el viejo apunta al nuevo.
    if (decision.action === 'SUPERSEDE') {
      await tx
        .update(workspaceFacts)
        .set({ supersededById: created.id })
        .where(
          and(
            eq(workspaceFacts.id, decision.existingId),
            eq(workspaceFacts.workspaceId, input.workspaceId),
          ),
        );
    }
    return { decision, fact: created };
  });
}

/** Soft-delete: marca revoked. Nunca borra (auditabilidad DIAN). */
export async function revokeFact(
  workspaceId: string,
  factId: string,
): Promise<WorkspaceFact | null> {
  const db = getDb();
  // Guarda `status='active'`: un doble-revoke es no-op (devuelve null) y NO
  // sobrescribe el `revokedAt` original — preserva el valor de auditoría.
  const [updated] = await db
    .update(workspaceFacts)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceFacts.id, factId),
        eq(workspaceFacts.workspaceId, workspaceId),
        eq(workspaceFacts.status, 'active'),
      ),
    )
    .returning();
  return updated ?? null;
}

/** Persiste un decision record inmutable (audit trail de cálculo). */
export async function persistDecisionRecord(
  rec: NewFactDecisionRecord,
): Promise<FactDecisionRecord> {
  const db = getDb();
  const [created] = await db.insert(factDecisionRecords).values(rec).returning();
  return created;
}
