// ─── WS1 — Smart-Tax Engine: constantes Colombia 2026 ────────────────────────
//
// UVT (Unidad de Valor Tributario) y umbrales de retención hardcoded para el
// hot path. La tabla `uvt_constants` en DB tiene el histórico completo; este
// archivo evita un round-trip a BD por evaluación.
//
// Actualizar cada enero cuando la DIAN publique el decreto de UVT.
// Referencia 2026: Resolución DIAN 000238 / 2025-12-15.
// Referencia 2025: Resolución DIAN 000193 / 2024-12-04.

export const UVT_2026_COP = 52_374;
export const UVT_2025_COP = 49_799;

/**
 * Histórico oficial de UVT por año (resoluciones DIAN de cada diciembre).
 * Espejo estático de la tabla `uvt_constants` para mantener el hot path
 * síncrono y sin round-trip a BD. Actualizar cada enero.
 */
const UVT_BY_YEAR: Record<number, number> = {
  2026: UVT_2026_COP,
  2025: UVT_2025_COP,
  2024: 47_065,
  2023: 42_412,
  2022: 38_004,
  2021: 36_308,
  2020: 35_607,
};

const OLDEST_UVT_YEAR = Math.min(...Object.keys(UVT_BY_YEAR).map(Number));

/**
 * Convierte un valor en UVT a COP para un año dado usando el UVT oficial de
 * ESE año (antes todo período < 2025 usaba el UVT 2025 — retenciones
 * históricas incorrectas). Años posteriores al último conocido usan el más
 * reciente; años anteriores a 2020 usan 2020 con warning (el módulo contable
 * no procesa períodos tan antiguos).
 */
export function uvtToCopByYear(uvtAmount: number, year: number): number {
  const exact = UVT_BY_YEAR[year];
  if (exact !== undefined) return Math.round(uvtAmount * exact);
  if (year > 2026) return Math.round(uvtAmount * UVT_2026_COP);
  console.warn(
    `[tax-engine] UVT no tabulado para ${year}; usando UVT ${OLDEST_UVT_YEAR} como aproximación.`,
  );
  return Math.round(uvtAmount * UVT_BY_YEAR[OLDEST_UVT_YEAR]);
}

// ---------------------------------------------------------------------------
// Umbrales mínimos de retención en la fuente (DUR 1625/2016, mod. Decreto
// 0572/2025 — bases reducidas restablecidas por el Consejo de Estado,
// providencia CE 30229 del 02-jun-2026, con vigencia desde el 01-jul-2026.
// Entre el 08-may y el 30-jun-2026 rigieron las bases anteriores (4 / 27 UVT).
// El decreto sigue en litigio de fondo: revisar al cierre del proceso.
// ---------------------------------------------------------------------------

/**
 * Servicios generales: no aplica retención si el pago es inferior a 2 UVT
 * (DUR 1625/2016 Art. 1.2.4.4.1, mod. Decreto 0572/2025).
 * RTF_SVC_4 usa este umbral (2 UVT = $104.748 COP 2026).
 */
export const RTF_THRESHOLD_UVT = 2;

/**
 * Compras de bienes y demás "otros ingresos tributarios" (Art. 401 ET,
 * DUR 1625/2016 Arts. 1.2.4.6.9 / 1.2.4.9.1, mod. Decreto 0572/2025):
 * cuantía mínima 10 UVT = $523.740 COP 2026. Incluye arrendamiento de
 * bienes inmuebles (3,5%).
 */
export const RTF_OTROS_INGRESOS_THRESHOLD_UVT = 10;

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
