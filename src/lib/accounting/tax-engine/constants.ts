// ─── WS1 — Smart-Tax Engine: constantes Colombia 2026 ────────────────────────
//
// UVT (Unidad de Valor Tributario) y umbrales de retención hardcoded para el
// hot path. La tabla `uvt_constants` en DB tiene el histórico completo; este
// archivo evita un round-trip a BD por evaluación.
//
// Actualizar cada enero cuando la DIAN publique el decreto de UVT.
// Referencia 2026: Resolución DIAN 000187 / 2025-12-19.
// Referencia 2025: Resolución DIAN 000187 / 2024-12-19.

export const UVT_2026_COP = 52_374;
export const UVT_2025_COP = 49_799;

/**
 * Convierte un valor en UVT a COP para un año dado.
 * Tabla simple sin DB lookup — adecuado para el hot path de evaluación.
 * Para períodos anteriores a 2025, cae al valor 2025 como aproximación
 * conservadora (TODO: consultar tabla uvt_constants para períodos históricos).
 */
export function uvtToCopByYear(uvtAmount: number, year: number): number {
  if (year >= 2026) return Math.round(uvtAmount * UVT_2026_COP);
  if (year >= 2025) return Math.round(uvtAmount * UVT_2025_COP);
  // Para años anteriores a 2025 usar 2025 como fallback conservador.
  // TODO (diferido D2): consultar uvt_constants en DB para precisión histórica.
  return Math.round(uvtAmount * UVT_2025_COP);
}

// ---------------------------------------------------------------------------
// Umbrales mínimos de retención en la fuente (Art. 401 ET 2026)
// ---------------------------------------------------------------------------

/**
 * Art. 401 ET: no aplica retención si el pago es inferior a 4 UVT.
 * Aplica para: servicios generales, compras de bienes, etc.
 * RTF_SVC_4 usa este umbral (4 UVT = $209.496 COP 2026).
 */
export const RTF_THRESHOLD_UVT = 4;

/**
 * ReteFuente honorarios y comisiones NO tiene umbral mínimo por UVT —
 * se retiene desde el primer peso (Art. 392 ET — honorarios).
 * Se deja la constante en 0 para documentar la decisión explícita.
 */
export const RTF_HONORARIOS_THRESHOLD_UVT = 0;

// ---------------------------------------------------------------------------
// Códigos PUC referenciados por las reglas built-in (Decreto 2706/2012)
// ---------------------------------------------------------------------------

/** IVA generado (por pagar) — pasivo */
export const CUENTA_IVA_GENERADO = '240805';
/** IVA descontable — activo (mayor valor del gasto/activo en Colombia) */
export const CUENTA_IVA_DESCONTABLE = '240810';
/** ReteFuente practicada (por pagar a DIAN) — pasivo */
export const CUENTA_RETEFUENTE = '236525';
/** ICA por pagar — pasivo */
export const CUENTA_ICA = '236805';
/** Cuentas por pagar a proveedores — pasivo */
export const CUENTA_CXP_PROVEEDORES = '220500';
/** Gastos generales de publicidad / servicios (ejemplo en smoke test) */
export const CUENTA_GASTO_SERVICIOS = '529505';
