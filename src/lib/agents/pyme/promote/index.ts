import 'server-only';
// ---------------------------------------------------------------------------
// WS2 — OCR → Journal Entry Bridge: punto de entrada público
// ---------------------------------------------------------------------------
// Algoritmo (ver spec):
//   1. Cargar pyme_entries confirmados y validar ownership.
//   2. Agrupar por (entryDate, kind) → una journal_entry por grupo.
//   3. Para cada grupo:
//      3a. Resolver cuentas via account-mapper.
//      3b. Opcional: invocar tax engine dinámicamente.
//      3c. Llamar createEntry (status='draft').
//   4. Retornar PromoteResult.
//
// Trazabilidad: journalEntries.metadata.promotedFromPymeEntryIds: string[]
// El bridge NO modifica pyme_entries.status — eso queda para el futuro
// auto-promote (D2 diferido). El usuario puede ver en /contabilidad/asientos
// los drafts creados y postearlos manualmente.
// ---------------------------------------------------------------------------

import { createEntry } from '@/lib/accounting/double-entry';
import { DoubleEntryError } from '@/lib/accounting/types';
import type { PromoteInput, PromoteResult, SkippedEntry } from './types';
import { loadConfirmedEntries, extractBookId } from './repository';
import { mapCategoryToAccount, resolveCajaAccount } from './account-mapper';
import {
  groupEntries,
  buildGroupEntry,
  groupTotalNumeric,
  parseDateKey,
  PromoteUnbalancedError,
  type TaxEngineGroupLines,
} from './entry-builder';
import { isTaxEngineEnabled } from '@/lib/accounting/tax-engine/types';
import type { TaxEvaluationInput, TaxEvaluationResult } from '@/lib/accounting/tax-engine/types';

// ---------------------------------------------------------------------------
// Heurística "¿es una factura?" para decidir si llamar al tax engine.
// Criterio MVP: el pucHint empieza con '41' (ingreso) o '51' (gasto) Y
// la descripción o categoría contiene palabras que sugieren factura/proveedor.
// Intencionalmente conservador: false positivos son más costosos que falsos
// negativos (crear líneas tributarias erróneas > no crearlas).
// ---------------------------------------------------------------------------
function looksLikeInvoice(pucHint: string | null, description: string, category: string | null): boolean {
  if (!pucHint) return false;
  const hint = pucHint.trim();
  if (!hint.startsWith('41') && !hint.startsWith('51')) return false;
  const combined = `${description} ${category ?? ''}`.toLowerCase();
  const invoiceKeywords = ['factura', 'fv', 'proveedor', 'nit', 'iva', 'compra'];
  return invoiceKeywords.some((kw) => combined.includes(kw));
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

export async function promoteEntries(input: PromoteInput): Promise<PromoteResult> {
  const { workspaceId, pymeEntryIds, periodId, applyTaxEngine = false, costCenterId = null } = input;

  if (pymeEntryIds.length === 0) {
    return { promotedCount: 0, journalEntryIds: [], skipped: [], warnings: [] };
  }

  const warnings: string[] = [];
  const skipped: SkippedEntry[] = [];
  const journalEntryIds: string[] = [];

  // ── 1. Cargar entries confirmados con validación de workspace ────────────
  const confirmedEntries = await loadConfirmedEntries(pymeEntryIds, workspaceId);

  // Entries que no volvieron (no existen, no son confirmed, o son de otro ws)
  const confirmedIds = new Set(confirmedEntries.map((e) => e.id));
  for (const id of pymeEntryIds) {
    if (!confirmedIds.has(id)) {
      skipped.push({ pymeEntryId: id, reason: 'not_found_or_not_confirmed' });
    }
  }

  if (confirmedEntries.length === 0) {
    return { promotedCount: 0, journalEntryIds: [], skipped, warnings };
  }

  // ── Resolver cuenta de caja (contrapartida universal del MVP) ────────────
  const cajaAccount = await resolveCajaAccount(workspaceId);
  if (!cajaAccount) {
    // Sin caja no podemos construir ningún asiento.
    for (const e of confirmedEntries) {
      skipped.push({
        pymeEntryId: e.id,
        reason: 'caja_account_not_found_in_chart_of_accounts',
      });
    }
    return { promotedCount: 0, journalEntryIds: [], skipped, warnings };
  }

  // ── 2. Agrupar por (entryDate, kind) ─────────────────────────────────────
  const groups = groupEntries(confirmedEntries);

  // ── 3. Procesar cada grupo ───────────────────────────────────────────────
  for (const group of groups) {
    const bookId = extractBookId(group.entries) ?? 'unknown';

    // ── 3a. Resolver cuenta primaria para el grupo ───────────────────────
    // Usamos el primer entry del grupo como representante del pucHint.
    // Si hay varios pucHints distintos en el grupo, el fallback heurístico
    // los promedia implícitamente (toma el del primer entry).
    const rep = group.entries[0];
    const mapping = await mapCategoryToAccount(
      workspaceId,
      rep.pucHint,
      group.kind,
      rep.description,
      rep.category,
      { costCenterId },
    );

    if (!mapping.accountId) {
      // No se encontró cuenta válida (puede ser que requires_cost_center=true
      // pero no se proveyó costCenterId, o que no existe ninguna cuenta para
      // el kind en el PUC del workspace).
      const reason =
        mapping.requiresCostCenter && !costCenterId
          ? `requires_cost_center_no_default_provided:${mapping.accountCode ?? 'unknown'}`
          : `account_not_found_for_code:${mapping.accountCode ?? mapping.fallbackCode ?? 'unknown'}`;

      for (const e of group.entries) {
        skipped.push({ pymeEntryId: e.id, reason });
      }
      continue;
    }

    // Si la cuenta primaria requiere CC y tenemos uno → lo propagamos.
    // Si la requiere y NO tenemos → ya fue capturado arriba (accountId=null).
    const primaryCostCenterId =
      mapping.requiresCostCenter && costCenterId ? costCenterId : null;

    // ── 3b. Tax engine (opcional) ────────────────────────────────────────
    let taxEngine: TaxEngineGroupLines | undefined;

    const taxEngineRequested = applyTaxEngine && isTaxEngineEnabled();
    if (taxEngineRequested) {
      const entryLooksLikeInvoice = looksLikeInvoice(rep.pucHint, rep.description, rep.category);
      if (entryLooksLikeInvoice) {
        try {
          // Importación dinámica para no crear dependencia estática en el bundle.
          // WS1 puede no estar implementado todavía; si el import falla, continuamos
          // sin líneas tributarias y emitimos un warning.
          const mod = await import('@/lib/accounting/tax-engine');
          if (mod && typeof mod.evaluate === 'function') {
            // Auditoría 2026-09 (tributario-calc-08 / -10):
            //  · la suma diaria del libro pyme es el valor pagado/cobrado
            //    según el soporte, IVA incluido → amountIncludesTax: true (el
            //    motor obtiene la base con el Art. 447 E.T. o rechaza si la
            //    tarifa es ambigua);
            //  · la fecha es la del grupo, no la de hoy, para que apliquen las
            //    ventanas de vigencia de las reglas;
            //  · el total se suma en centavos exactos.
            const transactionType = group.kind === 'ingreso' ? 'sale' : 'purchase';
            const evalInput: TaxEvaluationInput = {
              workspaceId,
              transactionType,
              subtotalCop: groupTotalNumeric(group),
              amountIncludesTax: true,
              transactionDate: parseDateKey(group.dateKey),
              baseAccountCode: mapping.accountCode ?? undefined,
              contextRef: `pyme_promote:${group.dateKey}:${group.kind}`,
            };
            const result = await (mod.evaluate as (input: TaxEvaluationInput) => Promise<TaxEvaluationResult>)(
              evalInput,
            );
            const baseAmountCop = result?.proposedLines?.[0]?.baseAmountCop;
            if (result?.journalLines?.length > 0 && baseAmountCop) {
              taxEngine = {
                baseAmountCop,
                taxLines: result.journalLines,
                totalPayableCop: result.totalPayableCop,
              };
            }
          }
        } catch (err) {
          warnings.push(
            `tax_engine_unavailable:${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // ── 3c. Construir y persistir journal_entry ──────────────────────────
    try {
      const { input: entryInput } = buildGroupEntry({
        group,
        periodId,
        workspaceId,
        bookId,
        cajaAccountId: cajaAccount.id,
        primaryAccountId: mapping.accountId,
        primaryCostCenterId,
        taxEngine,
      });

      const result = await createEntry(entryInput);
      journalEntryIds.push(result.entry.id);
    } catch (err) {
      const reason =
        err instanceof PromoteUnbalancedError
          ? `unbalanced_entry:${err.totalDebit}/${err.totalCredit}`
          : err instanceof DoubleEntryError
          ? `double_entry_error:${err.code}:${err.message}`
          : err instanceof Error
          ? `unexpected_error:${err.message}`
          : 'unexpected_error:unknown';

      for (const e of group.entries) {
        skipped.push({ pymeEntryId: e.id, reason });
      }
    }
  }

  // promotedCount = entries que formaron parte de un journal_entry creado exitosamente.
  const promotedEntryIds = new Set<string>();
  for (const jeid of journalEntryIds) {
    // El entry builder pone los IDs en metadata; no los re-leemos de DB —
    // simplemente marcamos como promovidos todos los que NO están en skipped.
    void jeid;
  }
  // Más simple y correcto: promoted = confirmed - skipped.
  const skippedIds = new Set(skipped.map((s) => s.pymeEntryId));
  for (const e of confirmedEntries) {
    if (!skippedIds.has(e.id)) promotedEntryIds.add(e.id);
  }

  return {
    promotedCount: promotedEntryIds.size,
    journalEntryIds,
    skipped,
    warnings,
  };
}

// Feature flag helper re-exportado para uso en el route handler.
export function isOcrPromoteEnabled(): boolean {
  return process.env.UTOPIA_ENABLE_OCR_PROMOTE === 'true';
}
