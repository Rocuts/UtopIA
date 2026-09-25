// ---------------------------------------------------------------------------
// Render compartido de la validación determinista (tabla de discrepancias)
// ---------------------------------------------------------------------------

import type { ValidationDiscrepancy } from './wacc';

/** Tabla Markdown "campo | emitido por el modelo | recalculado (publicado)". */
export function renderDiscrepancies(discrepancies: ValidationDiscrepancy[], lang: 'es' | 'en'): string {
  if (discrepancies.length === 0) {
    return lang === 'en'
      ? '_No material differences between the model output and the recomputation._'
      : '_Sin diferencias materiales entre lo emitido por el modelo y el recálculo._';
  }
  const header = lang === 'en'
    ? '| Field | Reported by the model | Recomputed (published) |\n|---|---:|---:|'
    : '| Campo | Emitido por el modelo | Recalculado (publicado) |\n|---|---:|---:|';
  return [header, ...discrepancies.map((d) => `| ${d.field} | ${d.reported} | ${d.recomputed} |`)].join('\n');
}
