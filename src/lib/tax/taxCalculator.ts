/* ============================================================
   1+1 · taxCalculator — Régimen Simple (RST) vs Ordinario
   Colombia · UVT 2026. Funciones puras, sin dependencias.

   Port TypeScript del módulo de referencia del handoff
   (handoff/1-1/project/handoff/taxCalculator.js).

   ⚠️ TARIFAS ILUSTRATIVAS: las tasas RST por grupo CIIU y la carga
   del régimen ordinario están calibradas para demostración. Antes de
   producción, reemplace RST_GROUPS y los componentes de
   computeOrdinario() con las tablas oficiales DIAN vigentes
   (Régimen Simple — Art. 908 E.T. y ss., renta Art. 241, ICA, IVA).
   ============================================================ */

// ---- Constantes 2026 (Res. DIAN 000238 del 15-dic-2025) ----
export const UVT_2026 = 52374;
export const SMMLV_2026 = 1750905;
export const TOPE_RST_UVT = 3500; // 3.500 UVT — IVA / INC bimestral = $183.309.000
export const TOPE_ORD_UVT = 1400; // 1.400 UVT — renta ordinaria      = $73.323.600
export const RENTA_EXENTA_UVT = 1090; // Art. 241 E.T. — primer tramo a 0%

export type RstGroup = 'tiendas' | 'servicios';

export type SemaforoLevel = 'verde' | 'amarillo' | 'rojo';

export interface RstBracket {
  uvtMax: number;
  rate: number;
}

// ---- Tarifas RST consolidadas por grupo CIIU (ilustrativas) ----
// Grupo "tiendas, minimercados, micromercados y peluquería".
export const RST_GROUPS: Record<RstGroup, RstBracket[]> = {
  tiendas: [
    { uvtMax: 6000, rate: 0.0188 },
    { uvtMax: 15000, rate: 0.024 },
    { uvtMax: 30000, rate: 0.029 },
    { uvtMax: Infinity, rate: 0.034 },
  ],
  servicios: [
    { uvtMax: 6000, rate: 0.059 },
    { uvtMax: 15000, rate: 0.075 },
    { uvtMax: 30000, rate: 0.086 },
    { uvtMax: Infinity, rate: 0.095 },
  ],
};

export interface OrdinarioOptions {
  /** Utilidad / ventas (default 0.35). */
  margin?: number;
  /** Tarifa ICA municipal (default 11‰ comercio = 0.011). */
  icaRate?: number;
  /** IVA bimestral neto sobre ventas (default 0.01566). */
  ivaNetRate?: number;
}

export interface OrdinarioBreakdown {
  total: number;
  ica: number;
  renta: number;
  iva: number;
}

export interface Semaforo {
  level: SemaforoLevel;
  pct: number;
  tope: number;
  sales: number;
  message: string;
}

export interface CompareOptions extends OrdinarioOptions {
  group?: RstGroup;
  aportesPension?: number;
}

export interface CompareResult {
  rst: number;
  ordinario: number;
  recommended: 'RST' | 'Ordinario';
  savings: number;
  semaforo: Semaforo;
}

export function uvt(cop: number): number {
  return cop / UVT_2026;
}

export function topeRST(): number {
  return TOPE_RST_UVT * UVT_2026; // 183.309.000
}

export function topeOrdinario(): number {
  return TOPE_ORD_UVT * UVT_2026; // 73.323.600
}

// RST = ingresos × tarifa_grupo_CIIU − aportes_pension_PILA
export function computeRST(
  annualSales: number,
  group: RstGroup = 'tiendas',
  aportesPension = 0,
): number {
  const brackets = RST_GROUPS[group] ?? RST_GROUPS.tiendas;
  const u = uvt(annualSales);
  let rate = brackets[brackets.length - 1].rate;
  for (const bracket of brackets) {
    if (u <= bracket.uvtMax) {
      rate = bracket.rate;
      break;
    }
  }
  return Math.max(0, annualSales * rate - aportesPension);
}

// Ordinario = renta (Art.241) + ICA municipal + IVA bimestral neto
export function computeOrdinario(
  annualSales: number,
  opts: OrdinarioOptions = {},
): OrdinarioBreakdown {
  const margin = opts.margin ?? 0.35;
  const icaRate = opts.icaRate ?? 0.011;
  const ivaNetRate = opts.ivaNetRate ?? 0.01566;

  const ica = annualSales * icaRate;
  const utilidad = annualSales * margin;
  const utilidadUVT = uvt(utilidad);
  const renta =
    utilidadUVT <= RENTA_EXENTA_UVT
      ? 0
      : (utilidadUVT - RENTA_EXENTA_UVT) * UVT_2026 * 0.19; // tramo Art.241
  const ivaNeto = annualSales * ivaNetRate;
  return { total: ica + renta + ivaNeto, ica, renta, iva: ivaNeto };
}

const SEMAFORO_MESSAGES: Record<SemaforoLevel, string> = {
  verde: 'Va bien — todavía no llega al tope donde le empiezan a cobrar más.',
  amarillo: 'Ojo — está cerca del tope. Pronto podría cambiar de régimen.',
  rojo: 'Pasó el tope. Toca revisar su régimen tributario.',
};

// Semáforo fiscal: verde hasta 80% del tope, amarillo hasta el tope, rojo encima.
export function semaforo(annualSales: number, topeUVT: number = TOPE_RST_UVT): Semaforo {
  const tope = topeUVT * UVT_2026;
  const pct = annualSales / tope;
  const level: SemaforoLevel = pct < 0.8 ? 'verde' : pct < 1 ? 'amarillo' : 'rojo';
  return { level, pct, tope, sales: annualSales, message: SEMAFORO_MESSAGES[level] };
}

// Comparación RST vs Ordinario → recomendación + ahorro anual.
export function compare(annualSales: number, opts: CompareOptions = {}): CompareResult {
  const rst = computeRST(annualSales, opts.group, opts.aportesPension);
  const ord = computeOrdinario(annualSales, opts).total;
  const recommended = rst <= ord ? 'RST' : 'Ordinario';
  return {
    rst,
    ordinario: ord,
    recommended,
    savings: Math.abs(ord - rst),
    semaforo: semaforo(annualSales, TOPE_RST_UVT),
  };
}
