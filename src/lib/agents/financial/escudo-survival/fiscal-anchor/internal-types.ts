// ---------------------------------------------------------------------------
// Tipos internos del pipeline fiscal-anchor (no exportados al UI / validator)
// ---------------------------------------------------------------------------
// Estos shapes viven en BigInt centavos y son privados al módulo. La conversión
// a `FiscalAnchorBlock` (string MoneyCop + number porcentaje) ocurre en el
// builder final para preservar precisión durante el cálculo intermedio.
// ---------------------------------------------------------------------------

/** Cifras crudas extraídas del balance, en centavos BigInt. */
export interface FiscalRawBase {
  /**
   * F03 — sólo crédito imputable al impuesto de RENTA (Art. 373 E.T.): 135505,
   * 135515 y, si el nombre lo indica, 135595 / 1805. Ver credito-renta.ts.
   */
  retencionesAFavorCents: bigint;
  /**
   * Σ(Cta.135517) — IVA retenido. Se acredita en la declaración de IVA
   * (Art. 484-1 E.T.), NUNCA contra renta. Se extrae aparte para poder
   * declararlo en el bloque sin sumarlo a F03.
   */
  reteIvaAFavorCents: bigint;
  /**
   * Σ(Cta.135518 + 135510) — ICA retenido / anticipo de ICA. Crédito contra el
   * impuesto municipal de industria y comercio, nunca contra renta.
   */
  reteIcaAFavorCents: bigint;
  /**
   * Resto de 1355/1805 que no es crédito de renta (135520, 135525, 135530,
   * 1805 «Bienes de arte y cultura», 135595 sin nombre de renta). Se informa
   * aparte y nunca netea F02.
   */
  otrosActivosImpuestoNoRentaCents: bigint;
  /** |Σ(Cta.2408)| — IVA por pagar (magnitud absoluta). */
  ivaPorPagarCents: bigint;
  /** |Σ(Cta.2365)| — Retefuente por declarar. */
  reteFuentePorPagarCents: bigint;
  /** |Σ(Cta.2368)| — ICA por pagar. */
  icaPorPagarCents: bigint;
  /** |Σ(Grupo 24 entero)| — total pasivos fiscales. */
  totalPasivosFiscalesCents: bigint;
}

/** Las 10 cifras derivadas en BigInt + porcentajes con 1 decimal. */
export interface FiscalDerivedMetrics {
  f01Cents: bigint;
  f02Cents: bigint;
  f03Cents: bigint;
  f04Cents: bigint;
  f05Cents: bigint;
  f06Cents: bigint;
  f07Cents: bigint;
  f08Cents: bigint;
  /** Porcentaje (1 decimal). 0 si no aplicable. */
  f09Pct: number;
  /** Porcentaje (1 decimal). 0 si no aplicable. */
  f10Pct: number;
}
