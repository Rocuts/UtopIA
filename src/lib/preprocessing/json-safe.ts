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

// ---------------------------------------------------------------------------
// Cruce del preprocesado del cliente contra el re-derivado por el servidor
// ---------------------------------------------------------------------------
// niif-preproceso-33: `revivePreprocessedBalance` sólo valida la FORMA; un
// preprocesado manipulado con centavos coherentes entre sí pasaba como ancla
// vinculante. Quien lo recibe lo RE-DERIVA (desde el `rawData` de la petición
// o desde las filas crudas que trae el propio preprocesado, con los mismos
// ajustes confirmados) y usa el re-derivado; esta función dice si el declarado
// difería en los totales de control, para rechazarlo (422) en vez de aceptar
// en silencio un objeto que no corresponde a sus fuentes.
//
// Tras el viaje JSON `primary` y `comparative` son copias INDEPENDIENTES de
// entradas de `periods` (y son las que leen casi todos los consumidores), así
// que se comparan por separado.
// ---------------------------------------------------------------------------

function centsOf(snapshot: PeriodSnapshot | null | undefined): Record<string, bigint> {
  const cents = (snapshot?.controlTotals as { cents?: Record<string, unknown> } | undefined)?.cents;
  const out: Record<string, bigint> = {};
  if (!cents || typeof cents !== 'object') return out;
  for (const [k, v] of Object.entries(cents)) {
    const big = toBigIntOrUndefined(v);
    if (big !== undefined) out[k] = big;
  }
  return out;
}

function numbersOf(snapshot: PeriodSnapshot | null | undefined): Record<string, number> {
  const ct = snapshot?.controlTotals as Record<string, unknown> | undefined;
  const out: Record<string, number> = {};
  if (!ct || typeof ct !== 'object') return out;
  for (const [k, v] of Object.entries(ct)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function snapshotMismatches(
  label: string,
  claimed: PeriodSnapshot | null | undefined,
  derived: PeriodSnapshot | null | undefined,
): string[] {
  const out: string[] = [];
  const want = centsOf(derived);
  const got = centsOf(claimed);
  for (const key of Array.from(new Set([...Object.keys(want), ...Object.keys(got)])).sort()) {
    if (got[key] === want[key]) continue;
    const show = (v: bigint | undefined) => (v === undefined ? 'sin centavos' : v.toString());
    out.push(`${label} · ${key}: enviado ${show(got[key])}, recalculado ${show(want[key])} (centavos)`);
  }
  // Los consumidores también leen los totales en `number` (activo, pasivo…):
  // la misma derivación los reproduce exactos, así que se exigen iguales.
  const wantNum = numbersOf(derived);
  const claimedCt = (claimed?.controlTotals ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(wantNum).sort()) {
    if (claimedCt[key] === wantNum[key]) continue;
    out.push(`${label} · ${key}: enviado ${String(claimedCt[key])}, recalculado ${wantNum[key]}`);
  }
  return out;
}

/**
 * Diferencias entre los totales de control de un preprocesado declarado (el
 * que envía el cliente) y el re-derivado por el servidor. Vacío = coinciden al
 * centavo en todos los periodos y en las copias `primary` / `comparative`.
 */
export function preprocessedAnchorMismatches(
  claimed: PreprocessedBalance,
  derived: PreprocessedBalance,
): string[] {
  const out: string[] = [];
  const claimedPeriods = claimed.periods.map((p) => p.period);
  const derivedPeriods = derived.periods.map((p) => p.period);
  if (claimedPeriods.join('\u0000') !== derivedPeriods.join('\u0000')) {
    out.push(
      `periodos: enviado [${claimedPeriods.join(', ')}], recalculado [${derivedPeriods.join(', ')}]`,
    );
  }
  if (claimed.primary?.period !== derived.primary?.period) {
    out.push(`periodo primario: enviado ${claimed.primary?.period}, recalculado ${derived.primary?.period}`);
  }
  const claimedComparative = claimed.comparative?.period ?? null;
  const derivedComparative = derived.comparative?.period ?? null;
  if (claimedComparative !== derivedComparative) {
    out.push(
      `periodo comparativo: enviado ${claimedComparative ?? 'ninguno'}, recalculado ${derivedComparative ?? 'ninguno'}`,
    );
  }
  for (const snap of derived.periods) {
    const other = claimed.periods.find((p) => p.period === snap.period);
    if (other) out.push(...snapshotMismatches(snap.period, other, snap));
  }
  if (claimed.primary?.period === derived.primary?.period) {
    out.push(...snapshotMismatches(`primario ${derived.primary.period}`, claimed.primary, derived.primary));
  }
  if (derived.comparative && claimedComparative === derivedComparative) {
    out.push(
      ...snapshotMismatches(`comparativo ${derived.comparative.period}`, claimed.comparative, derived.comparative),
    );
  }
  return Array.from(new Set(out));
}

export type { PreprocessedBalance, PeriodSnapshot };
