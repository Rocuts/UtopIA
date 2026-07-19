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
  return null;
}
