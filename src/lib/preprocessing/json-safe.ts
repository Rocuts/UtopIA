import type { PreprocessedBalance, PeriodSnapshot } from './trial-balance';

// ---------------------------------------------------------------------------
// JSON-safe serialización/revival para PreprocessedBalance.
//
// `PreprocessedBalance` transporta precisión contable en BigInt centavos
// (`controlTotals.cents.*`, `reclasificacionesNoCompensacion[].saldo_invertido_centavos`).
// BigInt NO es JSON-serializable: `JSON.stringify` lanza TypeError, lo que
// tumbaba el evento SSE `niif_phase` y la respuesta de /api/upload en el
// camino feliz (cualquier balance real preprocesado server-side).
//
// Contrato:
//   - `toJsonSafe(x)`  — borde de SALIDA: clona profundo convirtiendo
//     bigint → string decimal. Los consumidores in-process no se ven
//     afectados (reciben el objeto original); solo el wire format cambia.
//   - `revivePreprocessedBalance(x)` — borde de ENTRADA: valida el shape
//     mínimo de un `preprocessed` suministrado por el cliente (evita
//     TypeError / type-confusion con payloads arbitrarios) y restaura los
//     BigInt conocidos desde sus strings. Devuelve `null` si el shape no
//     es un PreprocessedBalance plausible — el caller responde 400.
//
// Los consumidores del pipeline hacen `typeof x === 'bigint'` con fallback a
// los campos float, así que un `cents` parcialmente revivido degrada de forma
// segura (pierde precisión de centavo, no corrección).
// ---------------------------------------------------------------------------

export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Clon profundo JSON-safe: bigint → string decimal. */
export function toJsonSafe<T>(value: T): T {
  if (typeof value === 'bigint') {
    return value.toString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toJsonSafe(v);
    }
    return out as unknown as T;
  }
  return value;
}

const DECIMAL_RE = /^-?\d+$/;

function toBigIntOrUndefined(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && DECIMAL_RE.test(value)) return BigInt(value);
  // `number` solo si es entero seguro — los cents jamás viajan como float.
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return undefined;
}

function reviveCentsInPlace(snapshot: Record<string, unknown>): void {
  const controlTotals = snapshot.controlTotals as Record<string, unknown> | undefined;
  if (!controlTotals || typeof controlTotals !== 'object') return;
  const cents = controlTotals.cents as Record<string, unknown> | undefined;
  if (!cents || typeof cents !== 'object') return;

  const revived: Record<string, bigint> = {};
  let validCount = 0;
  for (const [k, v] of Object.entries(cents)) {
    const big = toBigIntOrUndefined(v);
    if (big !== undefined) {
      revived[k] = big;
      validCount += 1;
    }
  }
  // Sin ningún campo válido el objeto `cents` no aporta — se elimina para que
  // los consumidores caigan limpiamente al fallback float.
  if (validCount === 0) {
    delete controlTotals.cents;
  } else {
    controlTotals.cents = revived;
  }
}

function isPlausibleSnapshot(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const snap = value as Record<string, unknown>;
  return (
    typeof snap.period === 'string' &&
    snap.controlTotals !== null &&
    typeof snap.controlTotals === 'object' &&
    Array.isArray(snap.classes) &&
    snap.summary !== null &&
    typeof snap.summary === 'object'
  );
}

/**
 * Valida el shape mínimo de un `preprocessed` que llega del cliente (vía
 * /api/financial-report/* o round-trip de /api/upload) y restaura los BigInt.
 * Devuelve `null` si no es plausible — el caller debe responder 400 en vez de
 * dejar que un cast ciego produzca TypeError 500 (o totales falsificados con
 * shape imposible).
 */
export function revivePreprocessedBalance(input: unknown): PreprocessedBalance | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const pp = input as Record<string, unknown>;

  if (!Array.isArray(pp.periods) || pp.periods.length === 0) return null;
  if (!isPlausibleSnapshot(pp.primary)) return null;
  if (!pp.periods.every(isPlausibleSnapshot)) return null;
  if (pp.comparative !== null && pp.comparative !== undefined && !isPlausibleSnapshot(pp.comparative)) {
    return null;
  }
  if (typeof pp.cleanData !== 'string') return null;
  if (!Array.isArray(pp.rawRows)) return null;

  // Tras el round-trip JSON `primary`/`comparative` son copias independientes
  // de las entradas de `periods` — hay que revivir cada referencia.
  const snapshots: Record<string, unknown>[] = [
    ...(pp.periods as Record<string, unknown>[]),
    pp.primary as Record<string, unknown>,
  ];
  if (pp.comparative && typeof pp.comparative === 'object') {
    snapshots.push(pp.comparative as Record<string, unknown>);
  }
  for (const snap of snapshots) {
    reviveCentsInPlace(snap);
  }

  if (Array.isArray(pp.reclasificacionesNoCompensacion)) {
    for (const item of pp.reclasificacionesNoCompensacion as Record<string, unknown>[]) {
      if (item === null || typeof item !== 'object') continue;
      // 0n replica el fallback `?? 0` del orchestrator para valores ausentes;
      // BigInt('garbage') lanzaría, así que el caso inválido también cae a 0n.
      item.saldo_invertido_centavos =
        toBigIntOrUndefined(item.saldo_invertido_centavos) ?? BigInt(0);
    }
  }

  return pp as unknown as PreprocessedBalance;
}

export type { PreprocessedBalance, PeriodSnapshot };
