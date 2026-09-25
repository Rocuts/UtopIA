// ---------------------------------------------------------------------------
// Qué renglón de un estado financiero es DETALLE y cuál es subtotal
// ---------------------------------------------------------------------------
// Regla compartida por E15 (validador) y por el reconciliador de anclas. Vive
// en un solo sitio a propósito: dos implementaciones de "sumar la columna"
// derivarían, y la auditoría 2026-08 ya identificó la duplicación sin
// sincronizar como una de las causas raíz del producto.
//
// Por qué NO se usa `level` para decidirlo
// -----------------------------------------
// Porque el modelo no lo emite de forma estable. Medido en FASE 0 sobre tres
// corridas del MISMO balance, el encabezado "ACTIVO CORRIENTE" salió con
// `level: 3`, `level: 1` y `level: 0` respectivamente. Un filtro `level === 2`
// acierta por casualidad mientras el modelo se porte bien y falla en silencio
// cuando no — exactamente el modo de fallo que estamos intentando eliminar.
//
// Lo que sí es estable es el código PUC: en las tres corridas TODOS los
// renglones de detalle traían `account` poblado y TODOS los encabezados y
// totales lo traían en `null`. Es además lo semánticamente correcto: un renglón
// de detalle representa una cuenta y por tanto tiene código; un subtotal no
// representa ninguna.
// ---------------------------------------------------------------------------

import { parseMoneyCop } from './money';
import { isContraAsset } from '@/lib/preprocessing/curator-rules/contra-asset-registry';

const ZERO = BigInt(0);

/** Forma mínima de un renglón de estado financiero para poder sumarlo. */
export interface StatementLineLike {
  account: string | null;
  amountPrimary: string;
  level: number;
  isAbsolute: boolean;
}

/**
 * Suma los renglones de DETALLE de un estado, en centavos.
 *
 * Las cuentas correctoras (depreciación acumulada, deterioros) viajan en valor
 * absoluto por regla de presentación del NIIF Analyst aunque RESTEN; sumarlas a
 * ciegas daría un exceso sistemático de 2× la correctora en toda empresa con
 * PPE depreciado. Se identifican por código PUC (Decreto 2650/1993) y se restan.
 */
export function sumStatementDetail(lines: ReadonlyArray<StatementLineLike>): {
  sum: bigint;
  count: number;
} {
  const detail = lines.filter((l) => l.account !== null && l.account.trim() !== '');
  let sum = ZERO;
  for (const line of detail) {
    const amount = parseMoneyCop(line.amountPrimary);
    const contra = isContraAsset(line.account ?? '');
    sum += contra && line.isAbsolute ? -(amount < ZERO ? -amount : amount) : amount;
  }
  return { sum, count: detail.length };
}

// ---------------------------------------------------------------------------
// Columna comparativa y subtotales impresos (auditoría 2026-09)
// ---------------------------------------------------------------------------
// niif-contrato-08: E15 sólo sumaba `amountPrimary`; los renglones
// comparativos que el lector suma viajaban libres. niif-contrato-06: los
// subtotales impresos (activo/pasivo corriente y no corriente) y los
// encabezados con monto no se validaban, y el PDF los imprime como
// subtotales.
// ---------------------------------------------------------------------------

export type StatementPeriod = 'primary' | 'comparative';

/** Renglón con ambas columnas y su etiqueta. */
export interface StatementLineWithColumns extends StatementLineLike {
  label: string;
  amountComparative: string | null;
}

function isDetail(line: StatementLineLike): boolean {
  return line.account !== null && line.account.trim() !== '';
}

/** Monto firmado del renglón en el periodo pedido (correctoras restan). `null` si la celda no viaja. */
export function signedLineAmount(
  line: StatementLineWithColumns,
  period: StatementPeriod,
): bigint | null {
  const raw = period === 'primary' ? line.amountPrimary : line.amountComparative;
  if (raw === null) return null;
  const amount = parseMoneyCop(raw);
  if (!isDetail(line)) return amount;
  const contra = isContraAsset(line.account ?? '');
  return contra && line.isAbsolute ? -(amount < ZERO ? -amount : amount) : amount;
}

/**
 * Σ del detalle en el periodo pedido. `missing` cuenta los renglones de
 * detalle cuya celda es `null` (no verificables: una celda ausente no es un
 * cero).
 */
export function sumStatementDetailByPeriod(
  lines: ReadonlyArray<StatementLineWithColumns>,
  period: StatementPeriod,
): { sum: bigint; count: number; missing: number } {
  let sum = ZERO;
  let count = 0;
  let missing = 0;
  for (const line of lines) {
    if (!isDetail(line)) continue;
    count++;
    const v = signedLineAmount(line, period);
    if (v === null) missing++;
    else sum += v;
  }
  return { sum, count, missing };
}

/**
 * Subtotales impresos (renglón sin código con monto ≠ 0) que no se pueden
 * reconstruir sumando el detalle. Un subtotal honesto es: la suma del detalle
 * desde el renglón sin código anterior (subtotal al pie), la suma del detalle
 * hasta el siguiente renglón sin código (encabezado con monto), la suma
 * acumulada desde el inicio de la sección, o el total de la sección.
 */
export function findUnsupportedSubtotals(
  lines: ReadonlyArray<StatementLineWithColumns>,
  declaredTotal: bigint | null,
  period: StatementPeriod,
): Array<{ label: string; level: number; amount: bigint }> {
  const out: Array<{ label: string; level: number; amount: bigint }> = [];
  const abs = (v: bigint) => (v < ZERO ? -v : v);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDetail(line)) continue;
    const v = signedLineAmount(line, period);
    if (v === null || v === ZERO) continue;

    let trailing = ZERO;
    for (let j = i - 1; j >= 0 && isDetail(lines[j]); j--) {
      trailing += signedLineAmount(lines[j], period) ?? ZERO;
    }
    let leading = ZERO;
    for (let j = i + 1; j < lines.length && isDetail(lines[j]); j++) {
      leading += signedLineAmount(lines[j], period) ?? ZERO;
    }
    let cumulative = ZERO;
    for (let j = 0; j < i; j++) {
      if (isDetail(lines[j])) cumulative += signedLineAmount(lines[j], period) ?? ZERO;
    }
    const candidates = [trailing, leading, cumulative];
    if (declaredTotal !== null) candidates.push(declaredTotal);
    if (candidates.some((c) => c !== ZERO && abs(c) === abs(v))) continue;
    out.push({ label: line.label, level: line.level, amount: v });
  }
  return out;
}
