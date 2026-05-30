// ---------------------------------------------------------------------------
// AncoraView — view-model interno del cliente (NO Zod). Números en COP PESOS.
// ---------------------------------------------------------------------------
// `null` = dato no disponible. NUNCA inventar (Elite Protocol — defensa Art.
// 647 E.T.). Shape CONGELADO: las 4 áreas del workspace (Escudo / Valor /
// Verdad / Futuro) dependen de él literal. Producido por `deriveAncoraView`
// desde el `NiifAncora` (A01..A19/X01..X04/F01..F10) + `FiscalSnapshot`.
// ---------------------------------------------------------------------------

export interface AncoraView {
  /** true cuando hay un NiifAncora real (no demo / no vacío). */
  hasData: boolean;
  meta: {
    empresa: string | null;
    nit: string | null;
    /** Último dígito del cuerpo del NIT (routing calendario DIAN). */
    nitDigito: string;
    periodoActual: string;
    periodoComparativo: string | null;
  };
  /** Cifras NIIF en pesos COP (centavos / 100). null si el campo no está. */
  niif: {
    activos: number | null;
    activosPrev: number | null;
    pasivos: number | null;
    pasivosPrev: number | null;
    patrimonio: number | null;
    patrimonioPrev: number | null;
    ingresos: number | null;
    ingresosPrev: number | null;
    /** A09 — Ganancia Operacional (EBIT), NO EBITDA. */
    ebitOperacional: number | null;
    ebitOperacionalPrev: number | null;
    utilidadNeta: number | null;
    utilidadNetaPrev: number | null;
    efectivo: number | null;
    efectivoPrev: number | null;
    pasivoCorriente: number | null;
    inventarios: number | null;
    cartera: number | null;
    proveedores: number | null;
    /** A19 — variación de caja del período (NO es Free Cash Flow). */
    variacionCaja: number | null;
    gananciaBruta: number | null;
    activoCorriente: number | null;
    activoNoCorriente: number | null;
  };
  /** Cifras fiscales F01..F10 en pesos (F09/F10 son porcentajes) + Score DIAN. */
  fiscal: {
    f01: number | null;
    f02: number | null;
    f03: number | null;
    f04: number | null;
    f05: number | null;
    f06: number | null;
    f07: number | null;
    f08: number | null;
    /** F09 — tasa efectiva (%). */
    f09: number | null;
    /** F10 — cobertura de retenciones (%). */
    f10: number | null;
    scoreRiesgoDIAN: number | null;
    nivelRiesgo: string | null;
  };
  /** Métricas derivadas honestas (null si el input falta o invalidaría el cálculo). */
  derived: {
    crecimientoIngresosPct: number | null;
    margenNetoPct: number | null;
    margenOperacionalPct: number | null;
    /** Deuda / Patrimonio (A03 / A05). */
    deRatio: number | null;
    valoracion: {
      /** EV/EBIT operacional (múltiplo de mercado, NO EBITDA). */
      evEbit: number | null;
      /** Valor de liquidación ≈ patrimonio neto contable. */
      liquidacion: number | null;
      /** null — requiere WACC. */
      dcf: number | null;
      /** null — requiere WACC + g. */
      gordon: number | null;
      /** null — requiere comparables BVC. */
      transacciones: number | null;
      /** Promedio de los métodos disponibles; null si ninguno. */
      ponderado: number | null;
      faltaWacc: boolean;
    };
    /** Score de calidad NIIF 0-100 determinístico (rúbrica sobre checks). */
    scoreNiif: number | null;
    /** null cuando no es defendible (falta Utilidades Retenidas). */
    altmanZ: number | null;
    /** Razón de por qué `altmanZ` es null, o la variante usada. */
    altmanRazon: string | null;
    oportunidades: {
      /** Capitalización utilidades — Art. 36-3 E.T. (heurístico 40%). */
      capitalizacion36_3: number | null;
      /** Caja liberable optimizando rotación de cartera. */
      liberacionCartera: number | null;
      /** Ingresos proyectados manteniendo el crecimiento observado. */
      expansionIngresos: number | null;
    };
  };
}
