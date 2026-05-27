// ---------------------------------------------------------------------------
// Tipos internos del pipeline fiscal-anchor (no exportados al UI / validator)
// ---------------------------------------------------------------------------
// Estos shapes viven en BigInt centavos y son privados al módulo. La conversión
// a `FiscalAnchorBlock` (string MoneyCop + number porcentaje) ocurre en el
// builder final para preservar precisión durante el cálculo intermedio.
// ---------------------------------------------------------------------------

/** Cinco cifras crudas extraídas del balance, en centavos BigInt. */
export interface FiscalRawBase {
  /** Σ(Cta.1355) + Σ(Cta.1805) — anticipos / retenciones a favor de renta. */
  retencionesAFavorCents: bigint;
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
