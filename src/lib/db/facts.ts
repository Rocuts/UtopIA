import 'server-only';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
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
import { resolveRule } from '@/lib/normativa/rules-registry';
import { art257Params, computeCredito257 } from '@/lib/normativa/descuento-donaciones-257';

// Patrón lazy getDb() (igual a pyme.ts). Tenant scoping: TODAS las funciones
// filtran por workspaceId — el caller (handler API/tool) lo resuelve server-side.

/**
 * Tipo del objeto `tx` que `db.transaction(async (tx) => …)` entrega — derivado
 * del cliente drizzle para no acoplarnos a la firma genérica de `PgTransaction`.
 * `reconcileFactCore` corre TODAS sus queries sobre este `tx` provisto, de modo
 * que `confirmFactWithDecision` pueda componer reconcile + decision record en
 * UNA sola transacción.
 */
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

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
 * Cuerpo del reconcile corriendo sobre una txn PROVISTA (`tx`) — no abre txn
 * propia. Extraído de `reconcileFact` para que `confirmFactWithDecision` pueda
 * componer reconcile + decision record en la MISMA transacción (atomicidad).
 * Comportamiento idéntico al original: normalización narrativa→null, rama
 * supersedesId explícita, contrato de orden ASC-createdAt y NOOP sin escritura.
 */
async function reconcileFactCore(
  tx: DbTx,
  input: {
    workspaceId: string;
    kind: FactKind;
    content: FactContent;
    fiscalPeriod: string | null;
    source: 'chat' | 'manual';
    supersedesId?: string | null;
  },
): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  // Narrativos son ATEMPORALES: se normaliza el período a null (contexto que
  // alimenta TODOS los reportes). Los NULL son distintos en `uq_active_fact`,
  // así múltiples narrativos activos coexisten sin colisión.
  const fiscalPeriod = input.kind === 'narrative' ? null : input.fiscalPeriod;
  const supersedesId = input.supersedesId ?? null;

  const insertValues = {
    workspaceId: input.workspaceId,
    kind: input.kind,
    title: input.content.title,
    body: input.content.body,
    structured: input.content.structured ?? null,
    fiscalPeriod,
    source: input.source,
  };

  // Edición explícita por id: revoca ese hecho exacto (si sigue activo) e inserta
  // la versión nueva enlazada. No reconcilia por período — el usuario editó ESE hecho.
  if (supersedesId) {
    const [revoked] = await tx
      .update(workspaceFacts)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workspaceFacts.id, supersedesId),
          eq(workspaceFacts.workspaceId, input.workspaceId),
          eq(workspaceFacts.status, 'active'),
        ),
      )
      .returning();
    const [created] = await tx.insert(workspaceFacts).values(insertValues).returning();
    // NOTA: si el objetivo ya estaba revocado (edición concurrente) y para un kind
    // ESTRUCTURADO existe otro activo del mismo (kind, período), este insert degradado
    // a ADD viola uq_active_fact (23505) → rollback + throw. Es fail-hard intencional
    // (preferimos el error a un doble conteo silencioso, Art. 647). Los narrativos
    // nunca colisionan (período null es distinto en el índice).
    if (revoked) {
      await tx
        .update(workspaceFacts)
        .set({ supersededById: created.id })
        .where(
          and(eq(workspaceFacts.id, supersedesId), eq(workspaceFacts.workspaceId, input.workspaceId)),
        );
      return { decision: { action: 'SUPERSEDE', existingId: supersedesId }, fact: created };
    }
    // El objetivo ya no estaba activo (revocado en otra pestaña): degradar a ADD.
    return { decision: { action: 'ADD' }, fact: created };
  }

  // Reconciliación por (kind, período) — captura por chat o registro nuevo del panel.
  const periodClause =
    fiscalPeriod === null
      ? isNull(workspaceFacts.fiscalPeriod)
      : eq(workspaceFacts.fiscalPeriod, fiscalPeriod);
  const existing = await tx
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
    // Orden ASCENDENTE: contrato con decideReconciliation → el último es el más reciente.
    .orderBy(asc(workspaceFacts.createdAt));

  const decision = decideReconciliation(
    input.content,
    existing.map((e) => ({ id: e.id, title: e.title, body: e.body, structured: e.structured ?? null })),
    input.kind,
  );

  if (decision.action === 'NOOP') {
    const kept = existing.find((e) => e.id === decision.existingId) ?? null;
    return { decision, fact: kept };
  }

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
  const [created] = await tx.insert(workspaceFacts).values(insertValues).returning();
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
}

/**
 * Reconcilia un hecho candidato contra los activos del mismo kind+período.
 * ADD → inserta. NOOP → no muta, devuelve el existente. SUPERSEDE → marca el
 * viejo revoked+supersededById e inserta el nuevo (append-only, auditable).
 * Envuelve `reconcileFactCore` en una transacción propia.
 */
export async function reconcileFact(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
  /** Edición explícita (panel): supersede EXACTAMENTE este hecho por id. */
  supersedesId?: string | null;
}): Promise<{ decision: ReconcileDecision; fact: WorkspaceFact | null }> {
  const db = getDb();
  return db.transaction((tx) => reconcileFactCore(tx, input));
}

/**
 * Confirma un hecho Y, si es una donación con fila nueva, computa el crédito
 * Art. 257 determinista y persiste su decision record — TODO en UNA transacción
 * (cierra el gap de atomicidad Ola-0). El tope (25% del impuesto) NO se aplica
 * aquí: necesita el impuesto (report-time). Fail-loud: si no hay regla vigente,
 * la txn hace rollback y el hecho NO se guarda.
 */
export async function confirmFactWithDecision(input: {
  workspaceId: string;
  kind: FactKind;
  content: FactContent;
  fiscalPeriod: string | null;
  source: 'chat' | 'manual';
  supersedesId?: string | null;
}): Promise<{
  decision: ReconcileDecision;
  fact: WorkspaceFact | null;
  decisionRecord: FactDecisionRecord | null;
}> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const { decision, fact } = await reconcileFactCore(tx, input);

    // Sólo donaciones con fila NUEVA (ADD/SUPERSEDE) generan decision record.
    if (input.kind !== 'donation' || fact === null || decision.action === 'NOOP') {
      return { decision, fact, decisionRecord: null };
    }

    // Donación material → período no-nulo garantizado por assertFactInputValid.
    const period = input.fiscalPeriod ?? fact.fiscalPeriod;
    if (period === null) {
      throw new Error('confirmFactWithDecision: donación sin período — inválida (assertFactInputValid).');
    }
    const rule = resolveRule('descuento_donaciones_257', period); // fail-loud
    const { tasaDescuentoPct } = art257Params(rule);
    const montoCentavos =
      typeof (fact.structured as { montoCentavos?: unknown } | null)?.montoCentavos === 'string'
        ? (fact.structured as { montoCentavos: string }).montoCentavos
        : '0';
    const creditoCents = computeCredito257(montoCentavos, tasaDescuentoPct);

    const [decisionRecord] = await tx
      .insert(factDecisionRecords)
      .values({
        workspaceId: input.workspaceId,
        factId: fact.id,
        ruleKey: 'descuento_donaciones_257',
        ruleVersion: rule.version,
        inputs: { montoCentavos, tasaDescuentoPct },
        resultado: { creditoCents },
      })
      .returning();

    return { decision, fact, decisionRecord };
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
