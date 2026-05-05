// ─── WS1 — Smart-Tax Engine: capa de datos ────────────────────────────────────
//
// Todas las queries a BD del motor tributario pasan por aquí.
// Patrón: getDb() lazy, eq/and/or/isNull de drizzle-orm/pg-core.
// Los callers reciben tipos Drizzle inferidos — sin mapeos adicionales.

import { and, eq, isNull, lte, gte, or } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { chartOfAccounts } from '@/lib/db/schema';
import {
  taxRules,
  taxEngineAudits,
  thirdPartyTaxProfile,
} from '@/lib/db/schema-tax';
import type { TaxRuleRow, ThirdPartyTaxProfileRow } from '@/lib/db/schema-tax';
import type { ChartOfAccountsRow } from '@/lib/db/schema';
import type { NewTaxEngineAuditRow } from '@/lib/db/schema-tax';
import type { JournalLineInput } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// Reglas tributarias
// ---------------------------------------------------------------------------

/**
 * Devuelve todas las reglas activas aplicables a `transactionDate`.
 * Incluye: (1) reglas built-in (workspace_id IS NULL) y (2) reglas del workspace.
 * Si un `code` aparece en ambos, la capa de reglas prefiere la del workspace
 * (se devuelven AMBAS — el rules-engine resuelve la precedencia).
 */
export async function getRules(
  workspaceId: string,
  transactionDate: Date,
): Promise<TaxRuleRow[]> {
  const db = getDb();
  return db
    .select()
    .from(taxRules)
    .where(
      and(
        eq(taxRules.isActive, true),
        // Workspace propio O built-in (NULL)
        or(
          eq(taxRules.workspaceId, workspaceId),
          isNull(taxRules.workspaceId),
        ),
        // valid_from <= fecha (o no tiene fecha de inicio)
        or(
          isNull(taxRules.validFrom),
          lte(taxRules.validFrom, transactionDate),
        ),
        // valid_until >= fecha (o no tiene fecha de fin)
        or(
          isNull(taxRules.validUntil),
          gte(taxRules.validUntil, transactionDate),
        ),
      ),
    );
}

// ---------------------------------------------------------------------------
// Perfil tributario del tercero
// ---------------------------------------------------------------------------

/**
 * Retorna el perfil tributario del tercero, si existe.
 * NULL = tercero sin perfil registrado — el motor emite warning y asume
 * régimen común no autorretenedor (comportamiento conservador).
 */
export async function getTaxProfile(
  workspaceId: string,
  thirdPartyId: string,
): Promise<ThirdPartyTaxProfileRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(thirdPartyTaxProfile)
    .where(
      and(
        eq(thirdPartyTaxProfile.workspaceId, workspaceId),
        eq(thirdPartyTaxProfile.thirdPartyId, thirdPartyId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Cuenta del PUC por código
// ---------------------------------------------------------------------------

/**
 * Busca la cuenta del PUC por código dentro del workspace.
 * El motor necesita el `id` (UUID) para construir `JournalLineInput.accountId`.
 * Devuelve null si la cuenta no existe o no está activa.
 */
export async function getAccountByCode(
  workspaceId: string,
  code: string,
): Promise<ChartOfAccountsRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.workspaceId, workspaceId),
        eq(chartOfAccounts.code, code),
        eq(chartOfAccounts.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Persiste una entrada en `tax_engine_audits` para trazabilidad.
 * No lanza error si falla — el motor debe seguir funcionando si el audit log
 * falla (best-effort). El caller decide si loguear el error.
 */
export async function recordAudit(params: {
  workspaceId: string;
  matchedRuleIds: string[];
  inputContext: unknown;
  proposedLines: JournalLineInput[];
  journalEntryId?: string;
}): Promise<string | null> {
  const db = getDb();
  const row: NewTaxEngineAuditRow = {
    workspaceId: params.workspaceId,
    matchedRuleIds: params.matchedRuleIds,
    inputContext: params.inputContext as Record<string, unknown>,
    proposedLines: params.proposedLines as unknown as Record<string, unknown>[],
    journalEntryId: params.journalEntryId ?? null,
  };
  const [inserted] = await db
    .insert(taxEngineAudits)
    .values(row)
    .returning({ id: taxEngineAudits.id });
  return inserted?.id ?? null;
}
