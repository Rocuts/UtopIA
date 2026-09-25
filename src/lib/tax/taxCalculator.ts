/* ============================================================
   1+1 · taxCalculator — Régimen Simple (SIMPLE) vs Ordinario
   Colombia · año gravable 2026. Funciones puras, sin dependencias.

   FUENTES NORMATIVAS (verificadas 07-ago-2026):
   - UVT 2026: Res. DIAN 000238 del 15-dic-2025 (vigente desde 01-ene-2026).
   - Tope de ingresos del SIMPLE: Art. 905 num. 2 E.T. (mod. art. 41 Ley 2155
     de 2021) → 100.000 UVT. La Corte Constitucional, Sentencia C-540 de 2023,
     declaró inexequible el sublímite de 12.000 UVT que la Ley 2277 de 2022
     había impuesto a las profesiones liberales: hoy NO hay sublímite por
     actividad.
   - Tarifas: Art. 908 E.T., numerales 1 a 3 (art. 44 Ley 2277 de 2022) y
     numeral 3 del art. 42 de la Ley 2155 de 2021, revivido por C-540/2023
     (DIAN Oficio 100208192-154 del 05-mar-2024).
   - Umbral de NO responsable de IVA / INC: Art. 437 par. 3 E.T. y
     Art. 908 par. 4 E.T. → 3.500 UVT. Es una responsabilidad DISTINTA del
     tope de pertenencia al régimen; nunca deben confundirse.

   RÉGIMEN ORDINARIO (auditoría 2026-09, tributario-calc-11): la renta se
   liquida con la tabla COMPLETA del Art. 241 E.T. para personas naturales o
   con la tarifa del 35 % del Art. 240 E.T. para personas jurídicas, y el
   resultado rotula cuál aplicó. Antes se usaba un único tramo del 19 %, que
   subestimaba el impuesto ordinario hasta en un 37 %. El margen de utilidad y
   la tarifa de ICA (Ley 14 de 1983, arts. 32-33: la fija cada concejo) son
   datos del usuario: sin ellos `compare()` marca la cifra ordinaria como NO
   disponible (`ordinarioDisponible: false` + motivo) y no recomienda régimen.
   ============================================================ */

// ---- Constantes 2026 ----
/** Res. DIAN 000238 del 15-dic-2025 — UVT año gravable 2026. */
export const UVT_2026 = 52374;
export const SMMLV_2026 = 1750905;

/**
 * SMMLV por año con fuente verificada en el repo (2026: Decreto 1469/2025,
 * `SMMLV_2026`). Fuente ÚNICA para las provisiones de nómina (Art. 114-1
 * E.T., `accounting/adjustments/provisions/employer.ts`) y el umbral de
 * SAGRILAFT (`fiscal-opinion/sagrilaft.ts`). Un año que no esté aquí es N/D:
 * nunca se sustituye por el SMMLV de otro año (re-auditoría 2026-09, NM-15).
 */
export const SMMLV_POR_ANIO: Readonly<Record<number, number>> = Object.freeze({
  2026: SMMLV_2026,
});

/** SMMLV del año, o `null` si el repo no tiene la constante verificada. */
export function smmlvVerificado(anio: number | null | undefined): number | null {
  if (typeof anio !== 'number') return null;
  return SMMLV_POR_ANIO[anio] ?? null;
}

/**
 * Tope de ingresos brutos para PERTENECER al Régimen Simple.
 * Art. 905 num. 2 E.T. (mod. art. 41 Ley 2155 de 2021); el sublímite de
 * 12.000 UVT de la Ley 2277 de 2022 fue declarado INEXEQUIBLE por la
 * Sentencia C-540 de 2023 (Corte Constitucional, 05-dic-2023).
 * Vigencia: año gravable 2022 en adelante → aplica a 2026.
 * 100.000 UVT × $52.374 = $5.237.400.000.
 */
export const TOPE_SIMPLE_UVT = 100_000;

/**
 * Umbral para NO ser responsable de IVA (y de INC de comidas y bebidas en el
 * SIMPLE). Art. 437 par. 3 num. 1 E.T. y Art. 908 par. 4 E.T. (Ley 2155/2021).
 * NO es el tope del Régimen Simple: son responsabilidades distintas.
 * Vigente para el año gravable 2026. 3.500 UVT × $52.374 = $183.309.000.
 */
export const UMBRAL_NO_RESPONSABLE_IVA_UVT = 3_500;

/** Art. 592 num. 1 E.T. — umbral de ingresos brutos para declarar renta. */
export const TOPE_ORD_UVT = 1400; // 1.400 UVT = $73.323.600
/** Art. 241 E.T. — primer tramo de la tabla marginal, tarifa 0%. */
export const RENTA_EXENTA_UVT = 1090;

/**
 * Tabla del Art. 241 E.T. (mod. art. 34 Ley 2010 de 2019), vigente para el
 * año gravable 2026. `baseUvt` es el impuesto acumulado de los tramos
 * anteriores (116, 788, 2.296, 5.901 y 10.352 UVT).
 */
export const ART_241_TRAMOS: ReadonlyArray<{
  desdeUvt: number;
  hastaUvt: number;
  tarifa: number;
  baseUvt: number;
}> = [
  { desdeUvt: 0, hastaUvt: 1_090, tarifa: 0, baseUvt: 0 },
  { desdeUvt: 1_090, hastaUvt: 1_700, tarifa: 0.19, baseUvt: 0 },
  { desdeUvt: 1_700, hastaUvt: 4_100, tarifa: 0.28, baseUvt: 116 },
  { desdeUvt: 4_100, hastaUvt: 8_670, tarifa: 0.33, baseUvt: 788 },
  { desdeUvt: 8_670, hastaUvt: 18_970, tarifa: 0.35, baseUvt: 2_296 },
  { desdeUvt: 18_970, hastaUvt: 31_000, tarifa: 0.37, baseUvt: 5_901 },
  { desdeUvt: 31_000, hastaUvt: Number.POSITIVE_INFINITY, tarifa: 0.39, baseUvt: 10_352 },
];

/** Art. 240 E.T. — tarifa general de renta de personas jurídicas (Ley 2277/2022). */
export const TARIFA_RENTA_PJ_ART_240 = 0.35;

/** Impuesto de renta de persona natural residente — Art. 241 E.T. (COP). */
export function impuestoArt241(rentaLiquidaGravableCop: number): number {
  const u = uvt(Math.max(0, rentaLiquidaGravableCop));
  const tramo =
    ART_241_TRAMOS.find((t) => u <= t.hastaUvt) ?? ART_241_TRAMOS[ART_241_TRAMOS.length - 1];
  return ((u - tramo.desdeUvt) * tramo.tarifa + tramo.baseUvt) * UVT_2026;
}

/**
 * Grupos de actividad del Art. 908 E.T. vigentes tras C-540/2023.
 * `aprovechamientoMateriales` es el parágrafo de tarifa única para CIIU
 * 4665, 3830 y 3811.
 */
export type RstGroup =
  | 'tiendas'
  | 'comercioIndustria'
  | 'comidasTransporte'
  | 'servicios'
  | 'aprovechamientoMateriales';

export type SemaforoLevel = 'verde' | 'amarillo' | 'rojo';

/** Qué mide el semáforo: son dos umbrales normativos distintos. */
export type SemaforoConcepto = 'tope-simple' | 'umbral-iva-inc';

export interface RstBracket {
  /** Límite superior del tramo, en UVT (inclusive). */
  uvtMax: number;
  rate: number;
}

// ---- Tarifas SIMPLE consolidadas por grupo de actividad (Art. 908 E.T.) ----
// Todos los tramos terminan en 100.000 UVT: por encima de ese nivel el
// contribuyente queda excluido del régimen (Art. 905 num. 2 y Art. 914 E.T.),
// no existe tarifa SIMPLE aplicable.
export const RST_GROUPS: Record<RstGroup, RstBracket[]> = {
  // Art. 908 num. 1 E.T. (art. 44 Ley 2277 de 2022) — vigente año gravable 2026.
  // Tiendas pequeñas, mini-mercados, micro-mercados y peluquería.
  tiendas: [
    { uvtMax: 6_000, rate: 0.012 }, // 1,2%
    { uvtMax: 15_000, rate: 0.028 }, // 2,8%
    { uvtMax: 30_000, rate: 0.044 }, // 4,4%
    { uvtMax: TOPE_SIMPLE_UVT, rate: 0.056 }, // 5,6%
  ],
  // Art. 908 num. 2 E.T. (art. 44 Ley 2277 de 2022) — comercio al por mayor y
  // detal, servicios técnicos y mecánicos, construcción, industria,
  // telecomunicaciones y las demás actividades no incluidas en otros numerales.
  comercioIndustria: [
    { uvtMax: 6_000, rate: 0.016 }, // 1,6%
    { uvtMax: 15_000, rate: 0.02 }, // 2,0%
    { uvtMax: 30_000, rate: 0.035 }, // 3,5%
    { uvtMax: TOPE_SIMPLE_UVT, rate: 0.045 }, // 4,5%
  ],
  // Art. 908 num. 3 E.T. (art. 44 Ley 2277 de 2022) — expendio de comidas y
  // bebidas, y actividades de transporte.
  comidasTransporte: [
    { uvtMax: 6_000, rate: 0.031 }, // 3,1%
    { uvtMax: 15_000, rate: 0.034 }, // 3,4%
    { uvtMax: 30_000, rate: 0.04 }, // 4,0%
    { uvtMax: TOPE_SIMPLE_UVT, rate: 0.045 }, // 4,5%
  ],
  // Numeral 3 del art. 42 de la Ley 2155 de 2021, REVIVIDO por la Sentencia
  // C-540 de 2023 (que declaró inexequibles los numerales 4º y 5º del Art. 908
  // introducidos por el art. 44 de la Ley 2277 de 2022). Cubre servicios
  // profesionales, de consultoría y científicos con predominio del factor
  // intelectual —incluidas las profesiones liberales— y, por DIAN Oficio
  // 100208192-154 del 05-mar-2024, también educación y actividades de atención
  // de la salud humana y de asistencia social.
  // Efectos desde el año gravable 2023; aplica al año gravable 2026.
  servicios: [
    { uvtMax: 6_000, rate: 0.059 }, // 5,9%
    { uvtMax: 15_000, rate: 0.073 }, // 7,3%
    { uvtMax: 30_000, rate: 0.12 }, // 12,0%
    { uvtMax: TOPE_SIMPLE_UVT, rate: 0.145 }, // 14,5%
  ],
  // Art. 908 par. E.T. — tarifa única para CIIU 4665, 3830 y 3811
  // (aprovechamiento y recuperación de materiales). Condición adicional de
  // permanencia: la utilidad neta no puede superar el 3% del ingreso bruto.
  aprovechamientoMateriales: [{ uvtMax: TOPE_SIMPLE_UVT, rate: 0.0162 }], // 1,62%
};

// ---------------------------------------------------------------------------
// Conversión y umbrales
// ---------------------------------------------------------------------------

export function uvt(cop: number): number {
  return cop / UVT_2026;
}

/** Tope de ingresos para pertenecer al SIMPLE — Art. 905 num. 2 E.T. */
export function topeSimple(): number {
  return TOPE_SIMPLE_UVT * UVT_2026; // 5.237.400.000
}

/**
 * Umbral desde el cual se es responsable de IVA (e INC de comidas y bebidas)
 * — Art. 437 par. 3 E.T. / Art. 908 par. 4 E.T. NO es el tope del régimen.
 */
export function umbralNoResponsableIvaInc(): number {
  return UMBRAL_NO_RESPONSABLE_IVA_UVT * UVT_2026; // 183.309.000
}

/** Umbral de obligación de declarar renta — Art. 592 num. 1 E.T. */
export function topeOrdinario(): number {
  return TOPE_ORD_UVT * UVT_2026; // 73.323.600
}

// ---------------------------------------------------------------------------
// Impuesto unificado SIMPLE
// ---------------------------------------------------------------------------

export interface SimpleOptions {
  /** Aportes del EMPLEADOR al Sistema General de Pensiones, en COP/año. */
  aportesPension?: number;
  /**
   * Componente de ICA consolidado dentro de la tarifa SIMPLE, como fracción
   * de los ingresos. Lo fija cada concejo municipal (Art. 907 E.T.), no hay
   * valor nacional. Sin este dato el descuento por aportes a pensión NO se
   * aplica, porque el Art. 903 par. 4 E.T. prohíbe que cubra el ICA.
   */
  icaConsolidadoRate?: number;
}

export interface SimpleResult {
  /** false ⇒ ingresos por encima de 100.000 UVT: el régimen no es aplicable. */
  aplicaSimple: boolean;
  /** Tarifa consolidada del tramo, o null si el régimen no aplica. */
  tarifa: number | null;
  impuestoBruto: number;
  descuentoPensionAplicado: number;
  /** Exceso del descuento trasladable a recibos siguientes (Art. 903 par. 4). */
  descuentoPensionDiferido: number;
  /** Piso irreducible por ICA consolidado; null = componente no verificado. */
  pisoIcaConsolidado: number | null;
  impuesto: number;
  advertencias: string[];
}

/**
 * Impuesto unificado SIMPLE del año (Art. 908 E.T.) con el descuento por
 * aportes del empleador a pensiones del Art. 903 par. 4 E.T.
 *
 * El descuento no puede cubrir la parte que corresponda al impuesto de
 * industria y comercio consolidado; el exceso se traslada a los recibos
 * electrónicos siguientes (no se pierde ni reduce el ICA).
 */
export function computeSimple(
  annualSales: number,
  group: RstGroup = 'tiendas',
  opts: SimpleOptions = {},
): SimpleResult {
  const brackets = RST_GROUPS[group] ?? RST_GROUPS.tiendas;
  const aportesPension = Math.max(0, opts.aportesPension ?? 0);
  const advertencias: string[] = [];
  const u = uvt(annualSales);

  // Art. 905 num. 2 E.T.: por encima de 100.000 UVT no hay tarifa SIMPLE.
  if (u > TOPE_SIMPLE_UVT) {
    return {
      aplicaSimple: false,
      tarifa: null,
      impuestoBruto: 0,
      descuentoPensionAplicado: 0,
      descuentoPensionDiferido: aportesPension,
      pisoIcaConsolidado: null,
      impuesto: 0,
      advertencias: [
        'Ingresos superiores a 100.000 UVT: excluido del Régimen Simple ' +
          '(Art. 905 num. 2 y Art. 914 E.T.). No existe tarifa SIMPLE aplicable.',
      ],
    };
  }

  const bracket = brackets.find((b) => u <= b.uvtMax) ?? brackets[brackets.length - 1];
  const tarifa = bracket.rate;
  const impuestoBruto = annualSales * tarifa;

  if (group === 'aprovechamientoMateriales') {
    advertencias.push(
      'Tarifa del 1,62% (CIIU 4665/3830/3811, Art. 908 par. E.T.): solo puede ' +
        'permanecer en el SIMPLE si la utilidad neta no supera el 3% del ingreso bruto.',
    );
  }

  if (aportesPension === 0) {
    return {
      aplicaSimple: true,
      tarifa,
      impuestoBruto,
      descuentoPensionAplicado: 0,
      descuentoPensionDiferido: 0,
      pisoIcaConsolidado: opts.icaConsolidadoRate != null ? annualSales * opts.icaConsolidadoRate : null,
      impuesto: impuestoBruto,
      advertencias,
    };
  }

  // Art. 903 par. 4 E.T. — el descuento no puede cubrir el ICA consolidado.
  if (opts.icaConsolidadoRate == null) {
    advertencias.push(
      'Descuento por aportes a pensión NO aplicado: el Art. 903 par. 4 E.T. ' +
        'prohíbe que cubra el componente de ICA consolidado, y ese componente ' +
        'lo fija cada concejo municipal (Art. 907 E.T.) — no está verificado aquí.',
    );
    return {
      aplicaSimple: true,
      tarifa,
      impuestoBruto,
      descuentoPensionAplicado: 0,
      descuentoPensionDiferido: aportesPension,
      pisoIcaConsolidado: null,
      impuesto: impuestoBruto,
      advertencias,
    };
  }

  const pisoIcaConsolidado = annualSales * opts.icaConsolidadoRate;
  const margenDescontable = Math.max(0, impuestoBruto - pisoIcaConsolidado);
  const descuentoPensionAplicado = Math.min(aportesPension, margenDescontable);
  const descuentoPensionDiferido = aportesPension - descuentoPensionAplicado;
  if (descuentoPensionDiferido > 0) {
    advertencias.push(
      'Parte del descuento por aportes a pensión se traslada a recibos ' +
        'siguientes: no puede cubrir el ICA consolidado (Art. 903 par. 4 E.T.).',
    );
  }

  return {
    aplicaSimple: true,
    tarifa,
    impuestoBruto,
    descuentoPensionAplicado,
    descuentoPensionDiferido,
    pisoIcaConsolidado,
    impuesto: impuestoBruto - descuentoPensionAplicado,
    advertencias,
  };
}

/** Atajo numérico sobre {@link computeSimple}. */
export function computeRST(
  annualSales: number,
  group: RstGroup = 'tiendas',
  aportesPension = 0,
  icaConsolidadoRate?: number,
): number {
  return computeSimple(annualSales, group, { aportesPension, icaConsolidadoRate }).impuesto;
}

// ---------------------------------------------------------------------------
// Régimen ordinario (base comparable con el SIMPLE)
// ---------------------------------------------------------------------------

export type TipoContribuyenteRenta = 'persona_natural' | 'persona_juridica';

export interface OrdinarioOptions {
  /**
   * Utilidad / ventas, dato del usuario. Sin él se usa 0,35 como supuesto de
   * demostración y la cifra queda marcada `margenSupuesto: true`.
   */
  margin?: number;
  /**
   * Persona natural → tabla del Art. 241 E.T.; persona jurídica → 35 %
   * (Art. 240 E.T.). Default: persona natural (el caso típico de la balanza
   * SIMPLE de la pyme); el resultado rotula siempre cuál se aplicó.
   */
  tipoContribuyente?: TipoContribuyenteRenta;
  /**
   * Tarifa de ICA municipal como fracción de los ingresos. SIN default:
   * la fija cada concejo dentro de los rangos de la Ley 14 de 1983 arts.
   * 32-33 (2‰–7‰ industrial; 2‰–10‰ comercial y de servicios, con
   * excepciones distritales). No existe tarifa única nacional.
   */
  icaRate?: number;
}

export interface OrdinarioBreakdown {
  /** renta + ICA. Base comparable con el impuesto unificado SIMPLE. */
  total: number;
  /** null cuando no se suministró la tarifa municipal. */
  ica: number | null;
  renta: number;
  /** Tipo de contribuyente con que se liquidó la renta. */
  tipoContribuyente: TipoContribuyenteRenta;
  /** Rótulo de la tarifa aplicada (Art. 241 tabla PN / Art. 240 35 % PJ). */
  baseLegalRenta: string;
  /** true cuando el margen de utilidad no lo dio el usuario (supuesto 35 %). */
  margenSupuesto: boolean;
  advertencias: string[];
}

/**
 * Carga del régimen ordinario comparable con el SIMPLE = renta + ICA.
 *
 * El IVA NO entra: no integra el impuesto unificado (Art. 907 E.T.) y el
 * contribuyente del SIMPLE responsable de IVA lo sigue liquidando conforme al
 * régimen general, con declaración anual consolidada (Art. 915 E.T.). Cargarlo
 * solo del lado ordinario sesgaba artificialmente la comparación hacia el SIMPLE.
 */
export function computeOrdinario(
  annualSales: number,
  opts: OrdinarioOptions = {},
): OrdinarioBreakdown {
  const margenSupuesto = opts.margin == null;
  const margin = opts.margin ?? 0.35;
  const tipoContribuyente: TipoContribuyenteRenta = opts.tipoContribuyente ?? 'persona_natural';
  const advertencias: string[] = [];

  // Utilidad = ventas × margen: aproximación de la renta líquida gravable (no
  // descuenta rentas exentas, deducciones ni compensaciones del caso real).
  const utilidad = annualSales * margin;
  const renta =
    tipoContribuyente === 'persona_juridica'
      ? utilidad * TARIFA_RENTA_PJ_ART_240
      : impuestoArt241(utilidad);
  const baseLegalRenta =
    tipoContribuyente === 'persona_juridica'
      ? 'Persona jurídica — tarifa general del 35 % (Art. 240 E.T.)'
      : 'Persona natural residente — tabla marginal completa del Art. 241 E.T. (0 % a 39 %)';

  advertencias.push(
    `Renta estimada sobre utilidad = ventas × margen (${baseLegalRenta}): ` +
      'estimación, no liquidación oficial.',
  );
  if (margenSupuesto) {
    advertencias.push(
      'Margen de utilidad NO suministrado: se usó 35 % como supuesto de demostración. ' +
        'La cifra ordinaria no es del cliente hasta que confirme su margen.',
    );
  }

  if (opts.icaRate == null) {
    advertencias.push(
      'ICA no calculado: la tarifa la fija cada concejo municipal (Ley 14 de ' +
        '1983, arts. 32-33). No hay tarifa nacional única que se pueda suponer.',
    );
    return {
      total: renta,
      ica: null,
      renta,
      tipoContribuyente,
      baseLegalRenta,
      margenSupuesto,
      advertencias,
    };
  }

  const ica = annualSales * opts.icaRate;
  return {
    total: ica + renta,
    ica,
    renta,
    tipoContribuyente,
    baseLegalRenta,
    margenSupuesto,
    advertencias,
  };
}

// ---------------------------------------------------------------------------
// Semáforos — DOS umbrales normativos distintos
// ---------------------------------------------------------------------------

export interface Semaforo {
  level: SemaforoLevel;
  concepto: SemaforoConcepto;
  pct: number;
  /** Valor del umbral en COP. */
  tope: number;
  sales: number;
  message: string;
}

const MENSAJES_TOPE_SIMPLE: Record<SemaforoLevel, string> = {
  verde:
    'Va bien — sus ventas están lejos del tope de ingresos del Régimen Simple (100.000 UVT).',
  amarillo:
    'Ojo — se acerca al tope de ingresos del Régimen Simple (100.000 UVT). Hablemos antes de llegar.',
  rojo:
    'Superó el tope de ingresos del Régimen Simple (100.000 UVT): queda excluido del régimen (Art. 905 num. 2 E.T.).',
};

const MENSAJES_UMBRAL_IVA: Record<SemaforoLevel, string> = {
  verde:
    'Va bien — todavía no llega a las 3.500 UVT desde donde tendría que cobrar IVA.',
  amarillo:
    'Ojo — está cerca de las 3.500 UVT desde donde le tocaría inscribirse como responsable de IVA.',
  rojo:
    'Sus ventas del año pasan las 3.500 UVT: le toca inscribirse como responsable de IVA (Art. 437 par. 3 E.T.). Esto NO lo saca del Régimen Simple.',
};

function construirSemaforo(
  annualSales: number,
  umbralUVT: number,
  concepto: SemaforoConcepto,
  mensajes: Record<SemaforoLevel, string>,
): Semaforo {
  const tope = umbralUVT * UVT_2026;
  const pct = annualSales / tope;
  const level: SemaforoLevel = pct < 0.8 ? 'verde' : pct < 1 ? 'amarillo' : 'rojo';
  return { level, concepto, pct, tope, sales: annualSales, message: mensajes[level] };
}

/** Semáforo de PERTENENCIA al Régimen Simple — 100.000 UVT (Art. 905 num. 2 E.T.). */
export function semaforoTopeSimple(annualSales: number): Semaforo {
  return construirSemaforo(
    annualSales,
    TOPE_SIMPLE_UVT,
    'tope-simple',
    MENSAJES_TOPE_SIMPLE,
  );
}

/**
 * Semáforo de RESPONSABILIDAD de IVA / INC — 3.500 UVT
 * (Art. 437 par. 3 E.T. y Art. 908 par. 4 E.T.). No habla de régimen.
 */
export function semaforoResponsabilidadIvaInc(annualSales: number): Semaforo {
  return construirSemaforo(
    annualSales,
    UMBRAL_NO_RESPONSABLE_IVA_UVT,
    'umbral-iva-inc',
    MENSAJES_UMBRAL_IVA,
  );
}

// ---------------------------------------------------------------------------
// Comparación de regímenes
// ---------------------------------------------------------------------------

export interface CompareOptions extends OrdinarioOptions {
  group?: RstGroup;
  aportesPension?: number;
  icaConsolidadoRate?: number;
}

export interface CompareResult {
  rst: number;
  ordinario: number;
  /** null cuando falta un dato verificado: no se recomienda régimen a ciegas. */
  recommended: 'RST' | 'Ordinario' | null;
  /** true solo si las dos cifras se calcularon con datos verificados. */
  comparable: boolean;
  savings: number;
  /** Semáforo de pertenencia al régimen (100.000 UVT). */
  semaforo: Semaforo;
  /** Semáforo de responsabilidad de IVA / INC (3.500 UVT). */
  semaforoIvaInc: Semaforo;
  /**
   * false cuando la cifra ordinaria depende de supuestos (margen de utilidad o
   * tarifa de ICA no suministrados por el usuario): la UI debe mostrar N/D con
   * `ordinarioMotivoND` en lugar del número.
   */
  ordinarioDisponible: boolean;
  /** Motivo de la no disponibilidad; null cuando la cifra está disponible. */
  ordinarioMotivoND: string | null;
  /** Rótulo de la tarifa de renta aplicada (Art. 241 PN / Art. 240 PJ). */
  ordinarioBaseLegal: string;
  advertencias: string[];
}

/**
 * Comparación SIMPLE vs Ordinario. Devuelve `recommended: null` cuando algún
 * insumo no está verificado (tarifa de ICA municipal, componente de ICA
 * consolidado): optar por el SIMPLE es irrevocable durante el año gravable
 * (Art. 909 E.T.), así que no se recomienda régimen con supuestos inventados.
 */
export function compare(annualSales: number, opts: CompareOptions = {}): CompareResult {
  const simple = computeSimple(annualSales, opts.group, {
    aportesPension: opts.aportesPension,
    icaConsolidadoRate: opts.icaConsolidadoRate,
  });
  const ord = computeOrdinario(annualSales, opts);

  const semaforo = semaforoTopeSimple(annualSales);
  const semaforoIvaInc = semaforoResponsabilidadIvaInc(annualSales);
  const advertencias = [...simple.advertencias, ...ord.advertencias];

  const faltantes = [
    ord.margenSupuesto ? 'margen de utilidad del negocio' : null,
    opts.icaRate == null ? 'tarifa de ICA del municipio' : null,
  ].filter((x): x is string => x !== null);
  const ordinarioDisponible = faltantes.length === 0;
  const ordinarioMotivoND = ordinarioDisponible
    ? null
    : `N/D: falta ${faltantes.join(' y ')} (dato del usuario). Sin él la cifra del régimen ordinario sería un supuesto, no la del cliente.`;
  const ordinarioBaseLegal = ord.baseLegalRenta;

  // Excluido del SIMPLE: la comparación no existe, solo queda el ordinario.
  if (!simple.aplicaSimple) {
    return {
      rst: 0,
      ordinario: ord.total,
      recommended: 'Ordinario',
      comparable: true,
      savings: 0,
      semaforo,
      semaforoIvaInc,
      ordinarioDisponible,
      ordinarioMotivoND,
      ordinarioBaseLegal,
      advertencias,
    };
  }

  // Además de los datos territoriales, el margen de utilidad debe ser del
  // usuario: recomendar con un margen inventado es recomendar con supuestos.
  const datosTerritorialesVerificados =
    ordinarioDisponible && (!opts.aportesPension || opts.icaConsolidadoRate != null);

  return {
    rst: simple.impuesto,
    ordinario: ord.total,
    recommended: datosTerritorialesVerificados
      ? simple.impuesto <= ord.total
        ? 'RST'
        : 'Ordinario'
      : null,
    comparable: datosTerritorialesVerificados,
    savings: datosTerritorialesVerificados ? Math.abs(ord.total - simple.impuesto) : 0,
    semaforo,
    semaforoIvaInc,
    ordinarioDisponible,
    ordinarioMotivoND,
    ordinarioBaseLegal,
    advertencias,
  };
}
