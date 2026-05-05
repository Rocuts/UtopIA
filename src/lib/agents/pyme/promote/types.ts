// ---------------------------------------------------------------------------
// WS2 — OCR → Journal Entry Bridge: tipos locales
// ---------------------------------------------------------------------------
// Estos tipos son propios del bridge. No se exportan desde @/lib/accounting/*
// porque son específicos del proceso de promoción de pyme_entries, no del
// núcleo contable de partida doble.
// ---------------------------------------------------------------------------

import type { JournalLineInput } from '@/lib/accounting/types';

// ---------------------------------------------------------------------------
// Input del bridge
// ---------------------------------------------------------------------------

export interface PromoteInput {
  workspaceId: string;
  /** UUIDs de pyme_entries a promover. Deben ser de este workspace y status='confirmed'. */
  pymeEntryIds: string[];
  /** UUID de accounting_periods donde crear los journal_entries (debe estar 'open'). */
  periodId: string;
  /**
   * Si true y UTOPIA_ENABLE_TAX_ENGINE='true', el bridge intenta llamar al motor
   * de impuestos cuando la categoría sugiere una factura (pucHint 41xx/51xx + tercero).
   * Si el motor no está disponible (flag OFF), se ignora silenciosamente.
   */
  applyTaxEngine?: boolean;
  /**
   * UUID de cost_centers por defecto para líneas en cuentas con requires_cost_center=true.
   * Si no se pasa (o es null), el mapper filtrará a cuentas que NO requieran centro de
   * costo; si ninguna existe para el kind, el entry va a skipped.
   */
  costCenterId?: string | null;
}

// ---------------------------------------------------------------------------
// Output del bridge
// ---------------------------------------------------------------------------

export interface PromoteResult {
  /** Número de pyme_entries efectivamente procesados. */
  promotedCount: number;
  /** UUIDs de journal_entries creados (estado 'draft'). */
  journalEntryIds: string[];
  /** Entries que no pudieron promoverse, con su razón. */
  skipped: SkippedEntry[];
  /** Advertencias no fatales (ej. tax engine no disponible). */
  warnings: string[];
}

export interface SkippedEntry {
  pymeEntryId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Mapping de cuenta propuesto por account-mapper
// ---------------------------------------------------------------------------

export interface AccountMapping {
  pymeEntryId: string;
  /** UUID en chart_of_accounts. null = no se encontró cuenta válida. */
  accountId: string | null;
  /** Código PUC encontrado (para mostrar en la UI). */
  accountCode: string | null;
  /** Nombre de la cuenta (para la columna "Propuesto" del diálogo). */
  accountName: string | null;
  /** true = vino de chart_of_accounts exacto; false = fallback heurístico. */
  isExact: boolean;
  /** Código fallback PUC usado si !isExact. */
  fallbackCode: string | null;
  /** true si la cuenta resuelta tiene requires_cost_center=true en chart_of_accounts. */
  requiresCostCenter: boolean;
}

// ---------------------------------------------------------------------------
// Agrupación interna de entries por (fecha, kind)
// ---------------------------------------------------------------------------

export interface EntryGroup {
  /** 'YYYY-MM-DD' */
  dateKey: string;
  kind: 'ingreso' | 'egreso';
  entries: GroupedPymeEntry[];
}

export interface GroupedPymeEntry {
  id: string;
  bookId: string;
  entryDate: Date;
  description: string;
  kind: string;
  amount: string;
  category: string | null;
  pucHint: string | null;
}

// ---------------------------------------------------------------------------
// Propuesta de líneas antes de confirmar (para el diálogo de revisión)
// ---------------------------------------------------------------------------

export interface PromotePreviewLine {
  description: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  source: 'base' | 'tax_engine';
}

export interface PromotePreviewEntry {
  pymeEntryId: string;
  description: string;
  amount: string;
  kind: string;
  category: string | null;
  pucHint: string | null;
  proposedAccountCode: string | null;
  proposedAccountName: string | null;
  isExactMatch: boolean;
  lines: PromotePreviewLine[];
}

// Re-export para uso en el route handler
export type { JournalLineInput };
