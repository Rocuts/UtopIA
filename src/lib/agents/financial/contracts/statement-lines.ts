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
