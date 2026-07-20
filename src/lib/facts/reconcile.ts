// Decisión de reconciliación PURA (sin DB) — el corazón anti-duplicados.
// Patrón Mem0 (extract→update) adaptado a append-only DIAN: UPDATE se realiza
// como SUPERSEDE. El caller (db/facts.ts) pasa los hechos ACTIVOS del mismo
// kind+fiscalPeriod (ya filtrados por query) y aplica la decisión.

import type { FactContent, FactKind } from './contracts';

export type ReconcileDecision =
  | { action: 'ADD' }
  | { action: 'NOOP'; existingId: string }
  | { action: 'SUPERSEDE'; existingId: string };

/**
 * Serializa un objeto con claves ordenadas para comparación estable.
 *
 * SUPUESTO (piloto): sólo se normaliza el orden de las claves de PRIMER NIVEL.
 * `structured` se asume PLANO para los kinds del piloto (`narrative` = null,
 * `donation` = strings planos), de modo que los valores se comparan tal cual.
 * Un kind con `structured` ANIDADO (objetos/arrays dentro) necesitaría un
 * stable-stringify RECURSIVO antes de confiar en esta igualdad: el orden de
 * claves de un objeto anidado no quedaría normalizado aquí.
 */
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
 *
 * ESTRUCTURADOS (donation/leasing/loss): invariante ≤1 activo por kind+período
 * (índice `uq_active_fact`). Un contenido distinto en el mismo período es una
 * CORRECCIÓN → SUPERSEDE el MÁS RECIENTE. CONTRATO DE ORDEN: el caller pasa los
 * activos ASCENDENTE por `createdAt`, así `existingActive[length-1]` es el más reciente.
 *
 * NARRATIVOS: son memoria de contexto ACUMULATIVA — dos narrativos distintos
 * COEXISTEN (nunca supersede por período). Sólo un contenido idéntico hace NOOP
 * (idempotencia). Combinado con la normalización de su período a null en
 * `reconcileFact`, múltiples narrativos activos conviven sin chocar con el índice.
 */
export function decideReconciliation(
  candidate: FactContent,
  existingActive: Array<FactContent & { id: string }>,
  kind: FactKind,
): ReconcileDecision {
  if (existingActive.length === 0) return { action: 'ADD' };
  const match = existingActive.find((e) => factContentEquals(candidate, e));
  if (match) return { action: 'NOOP', existingId: match.id };
  if (kind === 'narrative') return { action: 'ADD' };
  return { action: 'SUPERSEDE', existingId: existingActive[existingActive.length - 1].id };
}
