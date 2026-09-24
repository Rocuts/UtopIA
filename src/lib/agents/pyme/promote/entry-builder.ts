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
// (index.ts) ya evaluó el motor tributario y pasa `taxEngine`: la base
// gravable, las líneas de impuesto y el neto a pagar/cobrar. El asiento
// COMBINA línea base + líneas de impuesto + contrapartida neta en caja
// (auditoría 2026-09, tributario-calc-10: antes las líneas del motor
// reemplazaban todo el asiento y quedaba sin gasto/ingreso ni caja). El cuadre
// se valida aquí, antes de createEntry.
// ---------------------------------------------------------------------------

import type { CreateEntryInput, JournalLineInput } from '@/lib/accounting/types';
import type { EntryGroup } from './types';

export interface BuildGroupInput {
  group: EntryGroup;
  periodId: string;
  workspaceId: string;
  bookId: string;
  /** UUID de la cuenta de caja (110505). */
  cajaAccountId: string;
  /** UUID de la cuenta de ingreso/gasto para este grupo (null → caller ya lo marcó skipped). */
  primaryAccountId: string;
  /**
   * Si la cuenta primaria tiene requires_cost_center=true, este UUID se asigna
   * a esa línea. Si es null/undefined y la cuenta lo requiere, el caller ya
   * debería haber descartado el grupo (skipped). Se incluye aquí solo como
   * mecanismo de propagación para líneas simples.
   */
  primaryCostCenterId?: string | null;
  /**
   * Resultado del motor tributario (opcional). Con él el asiento es:
   *   egreso  → Db gasto (base) + líneas de impuesto + Cr caja (neto)
   *   ingreso → Db caja (neto) + Cr ingreso (base) + líneas de impuesto
   */
  taxEngine?: TaxEngineGroupLines;
}

export interface TaxEngineGroupLines {
  /** Base gravable resuelta por el motor (sin IVA), NUMERIC string. */
  baseAmountCop: string;
  /** Líneas de impuesto del motor (IVA, retenciones), ya con su lado. */
  taxLines: JournalLineInput[];
  /** Neto pagado / cobrado = base + IVA − retenciones (contrapartida en caja). */
  totalPayableCop: string;
}

/** El asiento armado no cuadra o tiene una contrapartida no positiva. */
export class PromoteUnbalancedError extends Error {
  constructor(
    message: string,
    readonly totalDebit: string,
    readonly totalCredit: string,
  ) {
    super(message);
    this.name = 'PromoteUnbalancedError';
  }
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
  const {
    group,
    periodId,
    workspaceId,
    bookId,
    cajaAccountId,
    primaryAccountId,
    primaryCostCenterId,
    taxEngine,
  } = args;

  const sourceEntryIds = group.entries.map((e) => e.id);

  // Suma total del grupo (string NUMERIC → BigInt para exactitud).
  const totalStr = groupTotalNumeric(group);

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

  if (taxEngine && taxEngine.taxLines.length > 0) {
    lines = buildTaxEngineLines(
      group.kind,
      taxEngine,
      primaryAccountId,
      cajaAccountId,
      primaryCostCenterId ?? null,
    );
  } else {
    // Líneas simples: Caja + cuenta primaria.
    lines = buildSimpleLines(
      group.kind,
      totalStr,
      primaryAccountId,
      cajaAccountId,
      primaryCostCenterId ?? null,
    );
  }

  assertBalanced(lines);

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

/** Suma exacta (BigInt centavos) de los montos del grupo, "12345.67". */
export function groupTotalNumeric(group: EntryGroup): string {
  const total = group.entries.reduce(
    (acc, e) => acc + parseToCentavos(e.amount),
    BigInt(0),
  );
  return centavosToNumericStr(total);
}

function buildTaxEngineLines(
  kind: 'ingreso' | 'egreso',
  taxEngine: TaxEngineGroupLines,
  primaryAccountId: string,
  cajaAccountId: string,
  primaryCostCenterId: string | null,
): JournalLineInput[] {
  const baseStr = centavosToNumericStr(parseToCentavos(taxEngine.baseAmountCop));
  const netStr = centavosToNumericStr(parseToCentavos(taxEngine.totalPayableCop));
  if (parseToCentavos(netStr) <= BigInt(0) || parseToCentavos(baseStr) <= BigInt(0)) {
    throw new PromoteUnbalancedError(
      `Base ${baseStr} o neto ${netStr} no positivo: no se arma el asiento con impuestos.`,
      baseStr,
      netStr,
    );
  }
  const cc = primaryCostCenterId ? { costCenterId: primaryCostCenterId } : {};
  if (kind === 'ingreso') {
    return [
      { accountId: cajaAccountId, debit: netStr, credit: '0.00', description: 'Caja – cobro ingreso OCR (neto)' },
      { accountId: primaryAccountId, debit: '0.00', credit: baseStr, description: 'Ingreso OCR pyme (base)', ...cc },
      ...taxEngine.taxLines,
    ];
  }
  return [
    { accountId: primaryAccountId, debit: baseStr, credit: '0.00', description: 'Gasto OCR pyme (base)', ...cc },
    ...taxEngine.taxLines,
    { accountId: cajaAccountId, debit: '0.00', credit: netStr, description: 'Caja – pago egreso OCR (neto)' },
  ];
}

/** Partida doble exacta en centavos; si no cuadra, no se llama a createEntry. */
function assertBalanced(lines: JournalLineInput[]): void {
  let debit = BigInt(0);
  let credit = BigInt(0);
  for (const l of lines) {
    debit += parseToCentavos(l.debit);
    credit += parseToCentavos(l.credit);
  }
  if (debit !== credit || debit <= BigInt(0)) {
    const d = centavosToNumericStr(debit);
    const c = centavosToNumericStr(credit);
    throw new PromoteUnbalancedError(`Asiento descuadrado: débitos ${d} ≠ créditos ${c}.`, d, c);
  }
}

function buildSimpleLines(
  kind: 'ingreso' | 'egreso',
  totalStr: string,
  primaryAccountId: string,
  cajaAccountId: string,
  primaryCostCenterId: string | null,
): JournalLineInput[] {
  if (kind === 'ingreso') {
    // Ingreso: Débito Caja, Crédito Cuenta de ingreso
    return [
      {
        accountId: cajaAccountId,
        debit: totalStr,
        credit: '0.00',
        description: 'Caja – cobro ingreso OCR',
        // Caja (110505) no tiene requires_cost_center en el seed, pero si
        // acaso lo tuviera en el futuro, no aplicamos CC aquí; solo en la
        // cuenta primaria (ingreso/gasto) que lo requiere.
      },
      {
        accountId: primaryAccountId,
        debit: '0.00',
        credit: totalStr,
        description: 'Ingreso OCR pyme',
        ...(primaryCostCenterId ? { costCenterId: primaryCostCenterId } : {}),
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
        ...(primaryCostCenterId ? { costCenterId: primaryCostCenterId } : {}),
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
  const raw = (numeric ?? '0').trim();
  const negative = raw.startsWith('-');
  const clean = negative ? raw.slice(1) : raw;
  const [intPart, fracPart = ''] = clean.split('.');
  const cents = fracPart.padEnd(2, '0').slice(0, 2);
  const abs = BigInt(intPart || '0') * BigInt(100) + BigInt(cents);
  return negative ? -abs : abs;
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
export function parseDateKey(dateKey: string): Date {
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
