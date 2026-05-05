// ---------------------------------------------------------------------------
// WS2 — entry-builder: pyme_entries[] + mapeos → CreateEntryInput[]
// ---------------------------------------------------------------------------
// Responsabilidad: dada una lista de entries agrupados y sus cuentas
// resueltas, construye CreateEntryInput[] listos para `createEntry`.
//
// Trazabilidad bidireccional sin alterar schema:
//   journalEntries.sourceType = 'ai_generated'
//   journalEntries.sourceRef  = 'pyme_book:<bookId>'
//   journalEntries.metadata   = { promotedFromPymeEntryIds: [...] }
//
// Regla contable simplificada (MVP):
//   ingreso → Db 1105 Caja / Cr <cuenta ingreso>
//   egreso  → Db <cuenta gasto/costo> / Cr 1105 Caja
//
// Cuando applyTaxEngine=true y el entry sugiere factura, el caller
// (index.ts) ya habrá resuelto líneas adicionales y las pasa en
// `extraLines`. Este módulo las incorpora respetando la partida doble.
// ---------------------------------------------------------------------------

import type { CreateEntryInput, JournalLineInput } from '@/lib/accounting/types';
import type { EntryGroup } from './types';

export interface BuildGroupInput {
  group: EntryGroup;
  periodId: string;
  workspaceId: string;
  bookId: string;
  /** UUID de la cuenta de caja (1105 05). */
  cajaAccountId: string;
  /** UUID de la cuenta de ingreso/gasto para este grupo (null → caller ya lo marcó skipped). */
  primaryAccountId: string;
  /**
   * Líneas adicionales del tax engine (opcionales). Si se proveen, reemplazan
   * la línea de caja simple y el builder ajusta el cuadre automáticamente.
   */
  taxEngineLines?: JournalLineInput[];
}

export interface BuildGroupResult {
  input: CreateEntryInput;
  /** IDs de pyme_entries incluidos en este journal_entry. */
  sourceEntryIds: string[];
}

/**
 * Construye un `CreateEntryInput` para un grupo (fecha, kind).
 * Suma todos los montos del grupo → una sola entrada de libro mayor.
 */
export function buildGroupEntry(args: BuildGroupInput): BuildGroupResult {
  const { group, periodId, workspaceId, bookId, cajaAccountId, primaryAccountId, taxEngineLines } = args;

  const sourceEntryIds = group.entries.map((e) => e.id);

  // Suma total del grupo (string NUMERIC → BigInt para exactitud).
  const totalCentavos = group.entries.reduce((acc, e) => {
    const centavos = parseToCentavos(e.amount);
    return acc + centavos;
  }, BigInt(0));

  const totalStr = centavosToNumericStr(totalCentavos);

  // Descripción: "Promoción OCR – <kind> – <dateKey> (<N> renglones)"
  const kindLabel = group.kind === 'ingreso' ? 'Ingresos' : 'Egresos';
  const description =
    group.entries.length === 1
      ? `OCR Pyme – ${kindLabel} – ${group.dateKey}: ${group.entries[0].description.slice(0, 80)}`
      : `OCR Pyme – ${kindLabel} – ${group.dateKey} (${group.entries.length} renglones)`;

  // Fecha del entry: primer día del grupo (todos tienen el mismo dateKey).
  const entryDate = parseDateKey(group.dateKey);

  // ── Construir líneas ────────────────────────────────────────────────────
  let lines: JournalLineInput[];

  if (taxEngineLines && taxEngineLines.length > 0) {
    // Tax engine proveyó líneas completas. Las usamos directamente.
    // El engine ya garantiza que el conjunto está cuadrado (debit = credit).
    lines = taxEngineLines;
  } else {
    // Líneas simples: Caja + cuenta primaria.
    lines = buildSimpleLines(group.kind, totalStr, primaryAccountId, cajaAccountId);
  }

  const input: CreateEntryInput = {
    workspaceId,
    periodId,
    entryDate,
    description,
    sourceType: 'ai_generated',
    sourceRef: `pyme_book:${bookId}`,
    metadata: {
      promotedFromPymeEntryIds: sourceEntryIds,
      promotedAt: new Date().toISOString(),
      groupKind: group.kind,
      groupDate: group.dateKey,
      entryCount: group.entries.length,
    },
    lines,
    status: 'draft',
  };

  return { input, sourceEntryIds };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSimpleLines(
  kind: 'ingreso' | 'egreso',
  totalStr: string,
  primaryAccountId: string,
  cajaAccountId: string,
): JournalLineInput[] {
  if (kind === 'ingreso') {
    // Ingreso: Débito Caja, Crédito Cuenta de ingreso
    return [
      {
        accountId: cajaAccountId,
        debit: totalStr,
        credit: '0.00',
        description: 'Caja – cobro ingreso OCR',
      },
      {
        accountId: primaryAccountId,
        debit: '0.00',
        credit: totalStr,
        description: 'Ingreso OCR pyme',
      },
    ];
  } else {
    // Egreso: Débito Cuenta de gasto, Crédito Caja
    return [
      {
        accountId: primaryAccountId,
        debit: totalStr,
        credit: '0.00',
        description: 'Gasto OCR pyme',
      },
      {
        accountId: cajaAccountId,
        debit: '0.00',
        credit: totalStr,
        description: 'Caja – pago egreso OCR',
      },
    ];
  }
}

/**
 * Convierte string NUMERIC (ej. "12345.67") a BigInt centavos.
 * Usa split en '.' para evitar pérdida de precisión de floating point.
 */
function parseToCentavos(numeric: string): bigint {
  const clean = (numeric ?? '0').trim();
  const [intPart, fracPart = ''] = clean.split('.');
  const cents = fracPart.padEnd(2, '0').slice(0, 2);
  return BigInt(intPart || '0') * BigInt(100) + BigInt(cents);
}

/** Convierte BigInt centavos → string "12345.67" (dos decimales fijos). */
function centavosToNumericStr(centavos: bigint): string {
  const ZERO = BigInt(0);
  const HUNDRED = BigInt(100);
  const abs = centavos < ZERO ? -centavos : centavos;
  const sign = centavos < ZERO ? '-' : '';
  const intPart = abs / HUNDRED;
  const fracPart = String(abs % HUNDRED).padStart(2, '0');
  return `${sign}${intPart}.${fracPart}`;
}

/** Parsea 'YYYY-MM-DD' → Date UTC mediodía (consistente con orchestrator PYME). */
function parseDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return new Date();
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

// ---------------------------------------------------------------------------
// Agrupar pyme_entries por (entryDate → 'YYYY-MM-DD', kind)
// ---------------------------------------------------------------------------

import type { GroupedPymeEntry } from './types';

/**
 * Agrupa entries por (dateKey, kind). Dentro de cada grupo el orden es el
 * de la query original (por entryDate ASC, createdAt ASC).
 */
export function groupEntries(entries: GroupedPymeEntry[]): EntryGroup[] {
  const map = new Map<string, EntryGroup>();

  for (const e of entries) {
    const dateKey = toDateKey(e.entryDate);
    const key = `${dateKey}|${e.kind}`;

    const existing = map.get(key);
    if (existing) {
      existing.entries.push(e);
    } else {
      map.set(key, {
        dateKey,
        kind: e.kind as 'ingreso' | 'egreso',
        entries: [e],
      });
    }
  }

  return Array.from(map.values());
}

function toDateKey(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
