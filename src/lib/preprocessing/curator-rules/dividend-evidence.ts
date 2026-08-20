// ---------------------------------------------------------------------------
// Evidencia de distribución a socios — fuente ÚNICA de la regla.
// ---------------------------------------------------------------------------
// Vive en `preprocessing` y no junto al constructor del EFE porque es un hecho
// del PUC, no del formato de salida, y porque lo consumen las dos capas: R2
// (curator, calcula el flujo de financiación) y `deterministic-breakdown`
// (agents, construye el EFE determinista). Tenerlo en un solo sitio es
// deliberado: la duplicación sin sincronizar es la causa raíz que la auditoría
// integral ya nombró, y esta regla en concreto decide si el informe puede
// hablar de dividendos.
//
// `2360` — Dividendos o participaciones por pagar (Decreto 2650/1993).
// `35`   — Resultados del ejercicio / dividendos decretados con cargo a él.
//
// NO se incluye `2365`: en el PUC colombiano es *Retención en la fuente*. El
// balance testigo trae $17,6M en subcuentas 2365 de retefuente, y tomarlas por
// "evidencia de dividendos" es exactamente el error que se está corrigiendo.
//
// Tampoco la satisfacen las cuentas virtuales que inyecta R8 (`3605VC`,
// `3710VC`): empiezan por 36 y 37. Ese es el punto — fueron ellas las que
// fabricaron "dividendos estimados" por -$1.570.997.737,30 (2,09× la
// facturación del año) sobre un balance donde la 2360 no existe.
// ---------------------------------------------------------------------------

import type { PeriodSnapshot } from '../trial-balance';

export const DIVIDEND_EVIDENCE_PREFIXES = ['2360', '35'] as const;

function normalize(code: unknown): string {
  return String(code ?? '').replace(/[.\-\s]/g, '');
}

/**
 * ¿El balance trae cuentas capaces de PROBAR una distribución a socios?
 *
 * `false` ⇒ el EFE no puede presentar dividendos, ni "estimados" ni de ninguna
 * otra clase, ni mencionarlos en las notas (NIC 7 ¶43).
 */
export function hasDividendEvidenceAccounts(snap: PeriodSnapshot): boolean {
  return snap.classes.some((cls) =>
    cls.accounts.some((acc) => {
      const code = normalize(acc.code);
      return DIVIDEND_EVIDENCE_PREFIXES.some((pfx) => code.startsWith(pfx));
    }),
  );
}
