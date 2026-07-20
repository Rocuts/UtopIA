// Validación DURA de input de la tool `registrar_hecho_negocio`, server-side.
// Complementa a los contratos Zod: reglas de coherencia kind↔campos que el
// schema (permisivo por diseño para el LLM) no expresa. PURO (sin DB).

import type { RegistrarHechoInput, FactKind } from './contracts';

// Kinds fiscalmente materiales: mueven cifras en reportes, así que EXIGEN
// período. Sin esta regla, el residual NULL del índice único parcial dejaría
// entrar dos activos sin período y doblar una cifra (Art. 647).
const MATERIAL_KINDS: readonly FactKind[] = ['donation', 'leasing', 'loss_carryforward'];

export function assertFactInputValid(input: RegistrarHechoInput): string | null {
  const isMaterial = MATERIAL_KINDS.includes(input.kind);
  if (isMaterial && (input.fiscalPeriod === null || input.fiscalPeriod.trim() === '')) {
    return `Un hecho de tipo "${input.kind}" requiere fiscalPeriod (año 'YYYY'). Pregunta al usuario el año fiscal y reintenta.`;
  }
  if (isMaterial && input.structured === null) {
    return `Un hecho de tipo "${input.kind}" requiere el objeto "structured" con los datos (ej. montoCentavos). Reintenta con structured.`;
  }
  // Donación: el monto debe ser > 0. Un hecho material de $0 (o negativo) sería
  // basura que en un reporte no aportaría / restaría, y elude tanto a la LLM como
  // al usuario. El schema (moneyCop `^-?\d+$`) admite 0 y negativos; se rechazan
  // aquí. BigInt(0) (no `0n`) por el target ES2017.
  if (
    input.kind === 'donation' &&
    input.structured !== null &&
    BigInt(input.structured.montoCentavos) <= BigInt(0)
  ) {
    return `Una donación requiere un monto mayor a cero (montoCentavos en centavos). Pregunta al usuario el monto donado y reintenta.`;
  }
  return null;
}
