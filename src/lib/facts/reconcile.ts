// Decisión de reconciliación PURA (sin DB) — el corazón anti-duplicados.
// Patrón Mem0 (extract→update) adaptado a append-only DIAN: UPDATE se realiza
// como SUPERSEDE. El caller (db/facts.ts) pasa los hechos ACTIVOS del mismo
// kind+fiscalPeriod (ya filtrados por query) y aplica la decisión.

import type { FactContent } from './contracts';

export type ReconcileDecision =
  | { action: 'ADD' }
  | { action: 'NOOP'; existingId: string }
  | { action: 'SUPERSEDE'; existingId: string };

/** Serializa un objeto con claves ordenadas para comparación estable. */
function stableStringify(value: Record<string, unknown> | null): string {
  if (value === null) return 'null';
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys.map((k) => [k, value[k]]));
}

export function factContentEquals(a: FactContent, b: FactContent): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    stableStringify(a.structured) === stableStringify(b.structured)
  );
}

/**
 * Decide qué hacer con `candidate` frente a los hechos activos equivalentes.
 * Invariante mantenida por la reconciliación: ≤1 activo por kind+período. El
 * caso defensivo (>1 activo) supersede el ÚLTIMO del array (el más reciente,
 * por orden `createdAt desc` que garantiza el caller).
 */
export function decideReconciliation(
  candidate: FactContent,
  existingActive: Array<FactContent & { id: string }>,
): ReconcileDecision {
  if (existingActive.length === 0) return { action: 'ADD' };
  const match = existingActive.find((e) => factContentEquals(candidate, e));
  if (match) return { action: 'NOOP', existingId: match.id };
  return { action: 'SUPERSEDE', existingId: existingActive[existingActive.length - 1].id };
}
